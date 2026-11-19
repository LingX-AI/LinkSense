import { randomUUID } from "node:crypto";
import { desktopBrowserScreenshotPath, type BrowserUseResult } from "@linksense/shared";
import Fastify from "fastify";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { DesktopBrowserUse, registerDesktopBrowserScreenshotRoute } from "../src/modules/desktop-devices/browser-use.js";
import { MemoryBrowserStore } from "./browser-use-store.js";

async function fixture() {
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#2a5a7c" } }).jpeg().toBuffer();
  const browserConnection = randomUUID();
  const browser = {
    status: vi.fn(async () => ({ connected: true, connection_id: browserConnection })),
    execute: vi.fn(async (): Promise<BrowserUseResult> => ({
      ok: true, browser: "local",
      data: { tab_id: 1, mime_type: "image/jpeg", viewport: { width: 2, height: 2 }, image: image.toString("base64") },
    })),
  };
  const store = new MemoryBrowserStore();
  const service = new DesktopBrowserUse({
    applicationExternalSession: { findFirst: vi.fn().mockResolvedValue(null) },
    conversationTurn: { findFirst: vi.fn() },
    conversationTurnStartIntent: { findFirst: vi.fn() },
  }, browser, store, { credentialMasterKey: "test-only-screenshot-key", credentialKeyId: "fixture" });
  const leases = {
    authorizeToolResult: vi.fn(async () => scope),
    verifyRunBinding: vi.fn(async () => {}),
  };
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) =>
    reply.code(error instanceof AppError && error.code === "AUTH_REQUIRED" ? 401 : 404).send());
  registerDesktopBrowserScreenshotRoute(app, service, leases);
  const result = await service.execute(scope, { action: "screenshot", tab_id: 1 }, new AbortController().signal, async () => {});
  const id = result.data.screenshot_id;
  if (!id) throw new Error("Missing fixture screenshot");
  const url = `${desktopBrowserScreenshotPath}/${scope.turnId}/${id}`;
  const headers = { authorization: `Bearer lsdr_${"a".repeat(43)}` };
  return { app, browser, headers, image, leases, store, url };
}

it("keeps screenshot bytes encrypted and serves them once, without consuming the lease on HEAD", async ({ onTestFinished }) => {
  const { app, headers, image, leases, store, url } = await fixture();
  onTestFinished(() => app.close());
  expect((await app.inject({ method: "HEAD", url, headers })).statusCode).toBe(404);
  expect(leases.authorizeToolResult).not.toHaveBeenCalled();
  const persisted = [...store.values.values()].map(({ value }) => value);
  expect(persisted).toHaveLength(1);
  expect(persisted[0]).toMatch(/^v1\./u);
  expect(persisted[0]).not.toContain(image.toString("base64"));

  const response = await app.inject({ method: "GET", url, headers });
  expect(response.statusCode).toBe(200);
  expect(response.rawPayload).toEqual(image);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
});

it("does not return a screenshot if the run is revoked while the browser binding is checked", async ({ onTestFinished }) => {
  const { app, browser, headers, leases, url } = await fixture();
  onTestFinished(() => app.close());
  browser.status.mockImplementationOnce(async () => {
    leases.verifyRunBinding.mockRejectedValue(new AppError("AUTH_REQUIRED"));
    return { connected: true, connection_id: (await browser.status()).connection_id };
  });
  const response = await app.inject({ method: "GET", url, headers });
  expect(response.statusCode).toBe(401);
  expect(response.rawPayload.length).toBe(0);
});
