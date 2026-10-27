import { timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyInstance } from "fastify";
import rateLimit, { normalizeIP } from "@fastify/rate-limit";
import type { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  localBrowserReadOnly,
  localBrowserRequestSchema,
  localBrowserFailure,
  runtimeServiceSessionHeader,
  localBrowserPairExchangeSchema,
  browserUseIntentRequestSchema,
  browserUseIntentSchema,
} from "@linksense/shared";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { hmacSha256 } from "../../lib/crypto.js";
import { ok } from "../../lib/http.js";
import { LocalBrowserService } from "./service.js";
import { browserExtensionZip } from "./extension.js";
import type { BrowserUseIntentService } from "./intent.js";

const secret = z.string().min(32).max(100);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
export async function registerLocalBrowserRoutes(
  app: FastifyInstance,
  options: {
    service: LocalBrowserService;
    prisma: PrismaClient;
    sharedSecret: string;
    socketPath: string;
    intent: Pick<BrowserUseIntentService, "detect">;
    redis: Redis;
    rateLimitHmacSecret: string;
  },
): Promise<void> {
  const { service, prisma } = options;
  await app.register(
    async (routes) => {
      routes.addHook("preHandler", routes.authenticate);
      routes.addHook("onSend", async (_request, reply) => {
        reply.header("cache-control", "private, no-store");
      });
      routes.get("/local-browser", async (request) =>
        ok(await service.status(request.authUser!.id), request.id),
      );
      routes.post("/conversations/:id/browser-use-intent", { bodyLimit: 1000 }, async (request) => {
        const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
        const { message_id } = browserUseIntentRequestSchema.parse(request.body);
        return ok(browserUseIntentSchema.parse(await options.intent.detect(request.authUser!.id, id, message_id)), request.id);
      });
      routes.get("/local-browser/extension", async (_request, reply) =>
        reply
          .type("application/zip")
          .header(
            "content-disposition",
            'attachment; filename="linksense-browser-extension.zip"',
          )
          .send(await browserExtensionZip()),
      );
      routes.post(
        "/local-browser/pairing",
        { bodyLimit: 1000 },
        async (request) => {
          z.strictObject({}).parse(request.body);
          const origin = z.url().optional().parse(request.headers.origin);
          const browser = origin ? new URL(origin) : undefined;
          const endpoint = new URL(service.endpoint);
          // Preserve the page's exact loopback origin; credentials stay bound to the configured server.
          if (
            browser && browser.origin === origin &&
            loopbackHosts.has(browser.hostname) &&
            loopbackHosts.has(endpoint.hostname) &&
            browser.protocol === endpoint.protocol &&
            browser.port === endpoint.port
          ) endpoint.hostname = browser.hostname;
          const pairing = await service.pairing(
            request.authUser!.id,
            request.authUser!.authValidAfter.toISOString(),
          );
          return ok(
            { ...pairing, endpoint: endpoint.href },
            request.id,
          );
        },
      );
      routes.delete("/local-browser", async (request) => {
        await service.revoke(request.authUser!.id);
        return ok({ connected: false }, request.id);
      });
    },
    { prefix: "/api/v1" },
  );

  await app.register(async (routes) => {
    routes.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "no-store");
    });
    await routes.register(rateLimit, {
      redis: options.redis,
      nameSpace: "linksense:local-browser-pair-rate:",
      max: 10,
      timeWindow: "1 minute",
      skipOnError: false,
      keyGenerator: (request) => hmacSha256(
        options.rateLimitHmacSecret,
        "local-browser-pair:ip:",
        normalizeIP(request.ip),
      ),
      errorResponseBuilder: () => new AppError("LOCAL_BROWSER_PAIR_RATE_LIMITED"),
    });
    routes.post(
      "/api/v1/local-browser/pair",
      { bodyLimit: 1000 },
      async (request) => {
        const { code, approval_id } = localBrowserPairExchangeSchema.parse(request.body);
        const token = await service.pair(code, approval_id);
        const credential = await service.authenticate(token);
        if (!credential) throw new AppError("AUTH_REQUIRED");
        return { token, owner_id: credential.owner, approval_id: credential.approval_id };
      },
    );
  });

  app.post(
    "/internal/local-browser/execute",
    { bodyLimit: 40_000 },
    async (request, reply) => {
      const supplied = Buffer.from(
        request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "",
      );
      const expected = Buffer.from(options.sharedSecret);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw new AppError("AUTH_REQUIRED");
      // Published service callers must never inherit the publisher's local login sessions.
      if (request.headers[runtimeServiceSessionHeader])
        throw new AppError("FORBIDDEN");
      const owner = z.uuid().parse(request.headers["x-linksense-owner-id"]);
      const body = z
        .strictObject({
          conversationId: z.uuid(),
          turnId: z.uuid(),
          input: localBrowserRequestSchema,
        })
        .parse(request.body);
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: body.conversationId,
          ownerId: owner,
          archiveStatus: "active",
        },
        select: { id: true },
      });
      const turn = conversation
        ? await prisma.conversationTurn.findFirst({
            where: {
              id: body.turnId,
              conversationId: body.conversationId,
              status: "running",
            },
          })
        : null;
      const user = await prisma.user.findUnique({ where: { id: owner } });
      if (!turn || !user || user.status !== "active")
        throw new AppError("FORBIDDEN");
      if (
        turn.collaborationMode === "plan" &&
        !localBrowserReadOnly(body.input)
      )
        return localBrowserFailure("LOCAL_BROWSER_ACCESS_DENIED");
      const controller = new AbortController();
      const abort = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once("close", abort);
      try {
        return await service.execute(
          owner,
          body.conversationId,
          body.input,
          controller.signal,
        );
      } finally {
        reply.raw.off("close", abort);
      }
    },
  );

  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 4_100_000,
    perMessageDeflate: false,
  });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split("?")[0] !== options.socketPath) {
      socket.destroy();
      return;
    }
    // Only an extension may initiate this transport; credentials are never put in URLs.
    if (
      !/^chrome-extension:\/\/[a-p]{32}$/.test(request.headers.origin ?? "")
    ) {
      socket.destroy();
      return;
    }
    if (sockets.clients.size >= 1000) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) =>
      sockets.emit("connection", ws),
    );
  };
  app.server.on("upgrade", upgrade);
  sockets.on("connection", (socket) => {
    let owner: string | undefined;
    let connection: string | undefined;
    let authenticating = false;
    let handlingReply = false;
    let lastPing = Date.now();
    let authValidAfter: string | undefined;
    let credentialToken: string | undefined;
    let inFlight: string | undefined;
    const deadline = setTimeout(() => socket.close(4401), 5000);
    const handle = async (raw: string) => {
      if (!owner) {
        if (authenticating) {
          socket.close(4401);
          return;
        }
        authenticating = true;
        const input = z
          .strictObject({ token: secret, browser: z.enum(["chrome", "edge"]) })
          .parse(JSON.parse(raw));
        const credential = await service.authenticate(input.token);
        const user = credential
          ? await prisma.user.findUnique({ where: { id: credential.owner } })
          : null;
        if (
          !credential ||
          !user ||
          user.status !== "active" ||
          user.authValidAfter.toISOString() !== credential.auth_valid_after
        ) {
          socket.close(credential || await service.wasRevoked(input.token) ? 4403 : 4401);
          return;
        }
        const id = await service.connect(
          credential.owner,
          input.token,
          input.browser,
        );
        if (socket.readyState !== WebSocket.OPEN) {
          await service.disconnect(credential.owner, id);
          return;
        }
        owner = credential.owner;
        authValidAfter = credential.auth_valid_after;
        credentialToken = input.token;
        connection = id;
        clearTimeout(deadline);
        socket.send(
          JSON.stringify({ type: "ready", connection_id: connection }),
        );
        void pump().catch(() => socket.close(4500));
        return;
      }
      if (raw === '"ping"') {
        lastPing = Date.now();
        socket.send('"pong"');
        return;
      }
      if (handlingReply) {
        socket.close(4400);
        return;
      }
      handlingReply = true;
      try {
        await service.reply(owner, connection!, JSON.parse(raw));
      } finally {
        handlingReply = false;
      }
    };
    const pump = async () => {
      let refreshAt = 0;
      while (socket.readyState === WebSocket.OPEN && owner && connection) {
        if (Date.now() - lastPing > 45_000) {
          socket.close(4408);
          break;
        }
        if (Date.now() >= refreshAt) {
          if (!(await service.maintain(owner, connection))) {
            socket.close(credentialToken && await service.wasRevoked(credentialToken) ? 4403 : 4401);
            break;
          }
          refreshAt = Date.now() + 10_000;
        }
        if (inFlight) {
          if ((await service.activeCommand(owner)) !== inFlight) {
            socket.send(JSON.stringify({ type: "cancel", id: inFlight }));
            inFlight = undefined;
          }
        }
        const command = await service.next(owner, connection);
        if (command) {
          const user = await prisma.user.findUnique({ where: { id: owner } });
          if (
            !user ||
            user.status !== "active" ||
            user.authValidAfter.toISOString() !== authValidAfter ||
            (await service.status(owner)).connection_id !== connection
          ) {
            socket.close(4403);
            break;
          }
          socket.send(JSON.stringify(command));
          inFlight = command.id;
        }
        await delay(250);
      }
    };
    socket.on("message", (raw) => {
      void handle(raw.toString()).catch(() => socket.close(4400));
    });
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      clearTimeout(deadline);
      if (owner && connection)
        void service
          .disconnect(owner, connection)
          .catch(() => app.log.warn("local browser disconnect cleanup failed"));
    });
  });
  app.addHook("onClose", async () => {
    app.server.off("upgrade", upgrade);
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
  });
}
