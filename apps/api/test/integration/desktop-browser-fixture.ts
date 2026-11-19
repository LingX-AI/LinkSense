import assert from "node:assert/strict";
import { once } from "node:events";
import type { FastifyInstance } from "fastify";
import {
  browserUseCommandSchema, browserUseFailure, browserUsePairingSchema, browserUsePairResponseSchema,
  desktopBrowserScreenshotPath, type BrowserUseResult,
} from "@linksense/shared";
import sharp from "sharp";
import { WebSocket } from "ws";

export async function attachDesktopBrowserFixture(input: {
  app: FastifyInstance; address: string; ownerId: string;
}) {
  const tabId = 17;
  const title = "Shared Mac fixture tab";
  const ref = "fixture-document:42";
  const image = await sharp({
    create: { width: 20, height: 10, channels: 3, background: { r: 20, g: 70, b: 110 } },
  }).jpeg().toBuffer();
  const pairing = await input.app.inject({ method: "POST", url: "/api/v1/browser-use/pairing", payload: {} });
  assert.equal(pairing.statusCode, 200);
  const { code } = browserUsePairingSchema.parse(pairing.json().data);
  const exchange = await input.app.inject({ method: "POST", url: "/api/v1/browser-use/pair", payload: { code } });
  assert.equal(exchange.statusCode, 200);
  const paired = browserUsePairResponseSchema.parse(exchange.json());
  assert.equal(paired.owner_id, input.ownerId);
  const url = new URL("/api/v1/browser-use/socket", input.address);
  url.protocol = "ws:";
  const socket = new WebSocket(url, { origin: `chrome-extension://${"a".repeat(32)}` });
  const nextMessage = () => once(socket, "message", { signal: AbortSignal.timeout(5_000) });
  try {
    await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
    const ready = nextMessage();
    socket.send(JSON.stringify({ token: paired.token, browser: "chrome" }));
    const [first] = await ready;
    assert.equal(JSON.parse(String(first)).type, "ready");
    const observed: string[] = [];
    const cancelled: string[] = [];
    const pending = new Set<string>();
    let clicked = false;
    socket.on("message", value => {
      const data: unknown = JSON.parse(value.toString());
      if (data === "pong") return;
      if (typeof data === "object" && data && "type" in data && data.type === "cancel" &&
          "id" in data && typeof data.id === "string") {
        if (pending.delete(data.id)) cancelled.push(data.id);
        return;
      }
      const command = browserUseCommandSchema.parse(data);
      observed.push(command.request.action);
      if (command.request.action === "scroll") {
        pending.add(command.id);
        return;
      }
      const tab = { tab_id: tabId, title, url: "https://browser-fixture.example.test/" };
      let result: BrowserUseResult = browserUseFailure("BROWSER_USE_ACCESS_DENIED");
      if (command.request.action === "tabs") {
        result = { ok: true, browser: "local", data: { tabs: [tab] } };
      } else if ("tab_id" in command.request && command.request.tab_id === tabId) {
        switch (command.request.action) {
          case "snapshot":
            result = { ok: true, browser: "local", data: {
              ...tab, elements: [{ ref, role: "button", name: clicked ? "Clicked" : "Click fixture" }],
            } };
            break;
          case "click":
            if (command.request.ref === ref && !clicked) {
              clicked = true;
              result = { ok: true, browser: "local", data: tab };
            }
            break;
          case "screenshot":
            result = { ok: true, browser: "local", data: {
              ...tab, mime_type: "image/jpeg", viewport: { width: 20, height: 10 }, image: image.toString("base64"),
            } };
            break;
        }
      }
      socket.send(JSON.stringify({ id: command.id, result }));
    });
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('"ping"');
    }, 20_000);
    heartbeat.unref();
    socket.once("close", () => clearInterval(heartbeat));
    return {
      socket, title, tabId, image, ref, observed, cancelled, token: paired.token,
      readImage: (turnId: string, id: string, token: string) => fetch(
        new URL(`${desktopBrowserScreenshotPath}/${turnId}/${id}`, input.address),
        { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3_000) },
      ),
    };
  } catch (error) {
    socket.terminate();
    throw error;
  }
}
