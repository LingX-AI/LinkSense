import { timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Duplex } from "node:stream";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  computerUseClientMessageSchema, computerUseHelloSchema, computerUseIntentRequestSchema,
  computerUsePairRequestSchema, computerUseReadOnly, computerUseRequestSchema, computerUseFailure,
  runtimeServiceSessionHeader,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { hmacSha256 } from "../../lib/crypto.js";
import { ok } from "../../lib/http.js";
import type { BrowserUseIntentService } from "../browser-use/intent.js";
import type { ComputerUseService } from "./service.js";

export async function registerComputerUseRoutes(app: FastifyInstance, options: {
  service: ComputerUseService;
  prisma: PrismaClient;
  sharedSecret: string;
  intent: Pick<BrowserUseIntentService, "detect">;
  clientArchive?: string;
  windowsClientArchive?: string;
}): Promise<void> {
  const { service, prisma } = options;
  const archives = {
    darwin: options.clientArchive ?? fileURLToPath(new URL("../../../../../outputs/desktop/LinkSense-Desktop-macos.zip", import.meta.url)),
    win32: options.windowsClientArchive ?? fileURLToPath(new URL("../../../../../outputs/desktop/LinkSense-Desktop-windows.exe", import.meta.url)),
  };
  const clientAvailable = async (platform: keyof typeof archives): Promise<boolean> => {
    try { const info = await lstat(archives[platform]); return info.isFile() && !info.isSymbolicLink() && info.size > 0; }
    catch { return false; }
  };
  await app.register(async (routes) => {
    routes.addHook("preHandler", routes.authenticate);
    routes.addHook("onSend", async (_request, reply) => { reply.header("cache-control", "private, no-store"); });
    routes.get("/computer-use", async (request) => {
      const clients = {
        darwin: await clientAvailable("darwin"),
        win32: await clientAvailable("win32"),
        linux: false,
      };
      const status = await service.status(request.authUser!.id);
      return ok({
        ...status,
        client_available: clients.darwin,
        clients,
      }, request.id);
    });
    routes.get("/computer-use/client", async (request, reply) => {
      const platform = z.enum(["darwin", "win32"]).default("darwin").safeParse(request.query && (request.query as { platform?: unknown }).platform);
      if (!platform.success || !await clientAvailable(platform.data)) throw new AppError("SERVICE_TEMPORARILY_UNAVAILABLE");
      return reply.type(platform.data === "win32" ? "application/vnd.microsoft.portable-executable" : "application/zip").header("content-disposition",
        `attachment; filename="${platform.data === "win32" ? "LinkSense-Desktop-windows.exe" : "LinkSense-Desktop-macos.zip"}"`)
        .send(createReadStream(archives[platform.data]));
    });
    routes.post("/computer-use/pairing", { bodyLimit: 1_000 }, async (request) => {
      z.strictObject({}).parse(request.body);
      return ok(await service.pairing(request.authUser!.id, request.authUser!.authValidAfter.toISOString()), request.id);
    });
    routes.delete("/computer-use", async (request) => {
      await service.revoke(request.authUser!.id);
      return ok({ connected: false }, request.id);
    });
    routes.post("/conversations/:id/computer-use-intent", { bodyLimit: 1_000 }, async (request) => {
      const { id } = z.strictObject({ id: z.uuid() }).parse(request.params);
      const { message_id } = computerUseIntentRequestSchema.parse(request.body);
      return ok(await options.intent.detect(request.authUser!.id, id, message_id), request.id);
    });
  }, { prefix: "/api/v1" });

  app.post("/api/v1/computer-use/pair", { bodyLimit: 1_000 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    const bucket = hmacSha256(options.sharedSecret, "computer-use-pair:", request.ip);
    if (!await service.store.put(`computer-use:pair-rate:${bucket}`, "1", 1_000, true))
      throw new AppError("CONFLICT", undefined, 429);
    const input = computerUsePairRequestSchema.parse(request.body);
    return service.pair(input.code, input.name, input.platform);
  });

  app.post("/internal/computer-use/execute", { bodyLimit: 40_000 }, async (request, reply) => {
    const token = Buffer.from(request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "");
    const expected = Buffer.from(options.sharedSecret);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) throw new AppError("AUTH_REQUIRED");
    if (request.headers[runtimeServiceSessionHeader]) throw new AppError("FORBIDDEN");
    const owner = z.uuid().parse(request.headers["x-linksense-owner-id"]);
    const body = z.strictObject({
      conversationId: z.uuid(), turnId: z.uuid(), input: computerUseRequestSchema,
    }).parse(request.body);
    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversationId, ownerId: owner, archiveStatus: "active", applicationId: null },
      select: { id: true, title: true },
    });
    const turn = conversation ? await prisma.conversationTurn.findFirst({
      where: { id: body.turnId, conversationId: body.conversationId, status: "running" },
    }) : null;
    const user = await prisma.user.findUnique({ where: { id: owner } });
    if (!conversation || !turn || user?.status !== "active") throw new AppError("FORBIDDEN");
    if (turn.collaborationMode === "plan" && !computerUseReadOnly(body.input))
      return computerUseFailure("COMPUTER_USE_ACCESS_DENIED");
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", abort);
    try {
      return await service.execute(owner, {
        conversationId: body.conversationId, turnId: body.turnId,
        title: conversation.title, readOnly: turn.collaborationMode === "plan",
      }, body.input, controller.signal);
    } finally { reply.raw.off("close", abort); }
  });

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 6_600_000, perMessageDeflate: false });
  const socketPath = `${new URL(service.endpoint).pathname}/socket`;
  const browserSocketPaths = new Set([
    new URL("browser-use/socket", service.endpoint).pathname,
    new URL("local-browser/socket", service.endpoint).pathname,
  ]);
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split("?")[0] !== socketPath) {
      if (!browserSocketPaths.has(request.url?.split("?")[0] ?? "")) socket.destroy();
      return;
    }
    if (request.url !== socketPath || sockets.clients.size >= 1_000) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws));
  };
  app.server.on("upgrade", upgrade);
  sockets.on("connection", (socket) => {
    let owner: string | undefined;
    let connection: string | undefined;
    let token: string | undefined;
    let authValidAfter: string | undefined;
    let authenticating = false;
    let inFlight: { id: string; conversationId: string; turnId: string } | undefined;
    let lastHeartbeat = Date.now();
    let messages = Promise.resolve();
    let pendingMessages = 0;
    let pauseSent = false;
    let resumeRevision = 0;
    const deadline = setTimeout(() => socket.close(4401), 5_000);
    const handle = async (raw: string) => {
      if (!owner) {
        if (authenticating) { socket.close(4401); return; }
        authenticating = true;
        const hello = computerUseHelloSchema.parse(JSON.parse(raw));
        const credential = await service.authenticate(hello.token);
        const user = credential ? await prisma.user.findUnique({ where: { id: credential.owner } }) : null;
        if (!credential || credential.device.id !== hello.device_id ||
          user?.status !== "active" || user.authValidAfter.toISOString() !== credential.auth_valid_after) {
          socket.close(4403); return;
        }
        const id = await service.connect(credential, hello.token);
        if (socket.readyState !== WebSocket.OPEN) { await service.disconnect(credential.owner, id); return; }
        owner = credential.owner;
        connection = id;
        token = hello.token;
        authValidAfter = credential.auth_valid_after;
        clearTimeout(deadline);
        socket.send(JSON.stringify({ type: "ready", connection_id: id }));
        void pump().catch(() => socket.close(4500));
        return;
      }
      const input = computerUseClientMessageSchema.parse(JSON.parse(raw));
      if (!connection) return;
      if (input.type === "heartbeat") {
        if (!await service.maintain(owner, connection, { control: input.control, permissions: input.permissions })) { socket.close(4403); return; }
        lastHeartbeat = Date.now();
        socket.send(JSON.stringify({ type: "heartbeat" }));
      } else if (input.type === "pause") {
        pauseSent = true;
        await service.pause(owner, connection);
      } else if (input.type === "resume") {
        pauseSent = true;
        await service.resume(owner, connection);
        resumeRevision++;
        pauseSent = false;
      } else if (input.type === "reply") {
        await service.reply(owner, connection, input.id, input.result);
        if (inFlight?.id === input.id) inFlight = undefined;
      }
    };
    const pump = async () => {
      let verifiedAt = 0;
      while (socket.readyState === WebSocket.OPEN && owner && connection && token) {
        if (Date.now() - lastHeartbeat > 30_000) { socket.close(4408); break; }
        if (Date.now() - verifiedAt > 1_000) {
          const user = await prisma.user.findUnique({ where: { id: owner } });
          if (user?.status !== "active" || user.authValidAfter.toISOString() !== authValidAfter ||
            !await service.authenticate(token) || !await service.maintain(owner, connection)) {
            socket.close(4403); break;
          }
          verifiedAt = Date.now();
        }
        const observedResumeRevision = resumeRevision;
        const paused = await service.paused(owner, connection);
        if (observedResumeRevision === resumeRevision && paused && !pauseSent) {
          pauseSent = true;
          socket.send(JSON.stringify({ type: "pause" }));
        }
        const activeCommand = inFlight;
        if (activeCommand) {
          const turn = await prisma.conversationTurn.findFirst({
            where: { id: activeCommand.turnId, conversationId: activeCommand.conversationId, status: "running" },
            select: { id: true },
          });
          const conversation = turn ? await prisma.conversation.findFirst({
            where: { id: activeCommand.conversationId, ownerId: owner, archiveStatus: "active", applicationId: null },
            select: { id: true },
          }) : null;
          const cancelled = !conversation || !await service.active(owner, activeCommand.id) || await service.paused(owner, connection);
          if (inFlight === activeCommand && cancelled) {
            socket.send(JSON.stringify({ type: "cancel", id: activeCommand.id }));
            inFlight = undefined;
          }
        }
        const command = await service.next(owner, connection);
        if (command) {
          const turn = await prisma.conversationTurn.findFirst({
            where: { id: command.turn_id, conversationId: command.conversation_id, status: "running" },
          });
          const conversation = turn ? await prisma.conversation.findFirst({
            where: { id: command.conversation_id, ownerId: owner, archiveStatus: "active", applicationId: null },
            select: { id: true },
          }) : null;
          if (!conversation || !turn || turn.collaborationMode === "plan" && !computerUseReadOnly(command.request)) {
            await service.reply(owner, connection, command.id, computerUseFailure("COMPUTER_USE_ACCESS_DENIED"));
            continue;
          }
          // Database checks may outlast cancellation, connection replacement or the dispatch deadline.
          if (!await service.maintain(owner, connection) || await service.paused(owner, connection) ||
            !await service.active(owner, command.id) || command.expires_at <= Date.now() ||
            socket.readyState !== WebSocket.OPEN) continue;
          socket.send(JSON.stringify(command));
          inFlight = { id: command.id, conversationId: command.conversation_id, turnId: command.turn_id };
        }
        await delay(250);
      }
    };
    socket.on("message", (raw) => {
      if (pendingMessages >= 16) { socket.close(4408); return; }
      pendingMessages++;
      // Preserve control order without allowing an unbounded transport backlog.
      messages = messages.then(async () => {
        if (socket.readyState === WebSocket.OPEN) await handle(raw.toString());
      }).catch(() => socket.close(4400)).finally(() => { pendingMessages--; });
    });
    socket.on("error", () => socket.close());
    socket.on("close", () => {
      clearTimeout(deadline);
      if (owner && connection) void service.disconnect(owner, connection).catch(() => {
        app.log.warn("computer use connection cleanup failed");
      });
    });
  });
  app.addHook("onClose", async () => {
    app.server.off("upgrade", upgrade);
    for (const socket of sockets.clients) socket.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
  });
}
