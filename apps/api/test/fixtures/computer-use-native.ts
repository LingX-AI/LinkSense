import Fastify from "fastify";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { registerComputerUseRoutes } from "../../src/modules/computer-use/routes.js";
import { ComputerUseService } from "../../src/modules/computer-use/service.js";
import { MemoryBrowserStore } from "../browser-use-store.js";
import { AppError } from "../../src/lib/errors.js";
import { sendAppError } from "../../src/lib/http.js";

const owner = "10000000-0000-4000-8000-000000000001";
const conversation = "20000000-0000-4000-8000-000000000001";
const turn = "30000000-0000-4000-8000-000000000001";
const date = new Date("2026-01-01T00:00:00Z");
const secret = randomBytes(32).toString("base64url");
const app = Fastify();
app.decorate("authenticate", async () => { throw new AppError("AUTH_REQUIRED"); });
app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
let active = true;
const prisma = {
  conversation: { findFirst: async () => active ? { id: conversation, title: "Native bridge whitebox" } : null },
  conversationTurn: { findFirst: async () => active ? { id: turn, collaborationMode: "default" } : null },
  user: { findUnique: async () => ({ id: owner, status: "active", authValidAfter: date }) },
} as unknown as PrismaClient;
const service = new ComputerUseService(new MemoryBrowserStore(), "http://127.0.0.1/api/v1/computer-use");
await registerComputerUseRoutes(app, { service, prisma, sharedSecret: secret, intent: { detect: async () => false } });
const origin = await app.listen({ host: "127.0.0.1", port: 0 });
const pairing = await service.pairing(owner, date.toISOString());
process.stdout.write(JSON.stringify({ origin, code: pairing.code }) + "\n");
const input = createInterface({ input: process.stdin });
try {
  for await (const line of input) {
    const command = JSON.parse(line) as { type: string; input?: unknown };
    if (command.type === "execute") {
      const reply = await app.inject({
        method: "POST", url: "/internal/computer-use/execute",
        headers: { authorization: `Bearer ${secret}`, "x-linksense-owner-id": owner },
        payload: { conversationId: conversation, turnId: turn, input: command.input },
      });
      process.stdout.write(JSON.stringify({ status: reply.statusCode, result: reply.json() }) + "\n");
    } else if (command.type === "revoke") {
      await service.revoke(owner);
      process.stdout.write('{"ok":true}\n');
    } else if (command.type === "archive") {
      active = false;
      process.stdout.write('{"ok":true}\n');
    } else if (command.type === "state") {
      process.stdout.write(JSON.stringify(await service.status(owner)) + "\n");
    }
  }
} finally {
  await app.close();
}
