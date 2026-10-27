import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { LocalBrowserRequest } from "@linksense/shared";
import { controlMessageSchema } from "../browser-extension/control-protocol.js";

const task = "20000000-0000-4000-8000-000000000001";
const connection = "30000000-0000-4000-8000-000000000001";
const commandId = "40000000-0000-4000-8000-000000000001";
let background: string;
beforeAll(async () => {
  const result = await build({
    entryPoints: ["browser-extension/background.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    conditions: ["development"],
  });
  background = result.outputFiles[0]!.text;
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: (value: T) => resolvePromise?.(value) };
}

async function fixture(userAgent = "Chrome") {
  const local: Record<string, unknown> = {};
  const session = {
    endpoint: "https://linksense.example/api/v1/local-browser",
    token: "x".repeat(43),
    new_tabs: true,
  };
  const stored: Record<string, unknown> = {
    session,
    grant_owner_id: "10000000-0000-4000-8000-000000000001",
    grants: [{ tab_id: 7, conversation_id: task }],
  };
  let messageHandler:
    | ((
        raw: unknown,
        sender: { url: string; tab?: { id: number }; frameId?: number },
        respond: (result: unknown) => void,
      ) => boolean)
    | undefined;
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(local[key]) })),
        set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(local, structuredClone(value)); }),
      },
      session: {
        get: vi.fn(async (keys: string | string[]) =>
          structuredClone(
            Object.fromEntries(
              (typeof keys === "string" ? [keys] : keys).map((key) => [
                key,
                stored[key],
              ]),
            ),
          ),
        ),
        set: vi.fn(async (value: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(value));
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of typeof keys === "string" ? [keys] : keys) delete stored[key];
        }),
      },
    },
    tabs: {
      get: vi.fn(async (id: number): Promise<{ id: number; url: string; title: string; windowId?: number; incognito?: boolean }> => ({
        id,
        url: "https://page.example/",
        title: "Page",
        windowId: 3,
      })),
      query: vi.fn(async () => [{ id: 7, url: "https://page.example/" }]),
      create: vi.fn(async () => ({ id: 8 })),
      update: vi.fn(async () => ({})),
      sendMessage: vi.fn<(tab: number, message: unknown, options?: { frameId: number }) => Promise<{ applied: boolean; reduced_motion?: boolean; stopped?: boolean }>>().mockResolvedValue({ applied: true, reduced_motion: true }),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    debugger: {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand: vi.fn<(target: { tabId: number }, method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>>().mockResolvedValue({}),
      onDetach: { addListener: vi.fn() },
    },
    windows: { update: vi.fn(async () => ({})) },
    scripting: { executeScript: vi.fn(async () => []) },
    action: { setBadgeText: vi.fn(async () => {}), openPopup: vi.fn(async () => {}) },
    runtime: {
      getURL: (file: string) => `chrome-extension://fixture/${file}`,
      onMessage: {
        addListener: (handler: typeof messageHandler) => {
          messageHandler = handler;
        },
      },
    },
  };
  const sockets: Socket[] = [];
  const fetchPairing = vi.fn<typeof fetch>();
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    onopen?: () => void;
    onclose?: (event: { code: number }) => void;
    onmessage?: (event: { data: string }) => void;
    send = vi.fn();
    constructor() {
      sockets.push(this);
    }
    close(code = 1000) {
      this.readyState = 3;
      this.onclose?.({ code });
    }
    receive(value: unknown) {
      this.onmessage?.({ data: JSON.stringify(value) });
    }
  }
  runInNewContext(background, {
    chrome,
    WebSocket: Socket,
    navigator: { platform: "Linux", userAgent },
    URL,
    Date,
    AbortController,
    AbortSignal,
    fetch: fetchPairing,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
  });
  const popup = (type: string, options: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve) =>
      messageHandler?.(
        { type, origin: "https://linksense.example", ...options },
        { url: chrome.runtime.getURL("popup.html") },
        resolve,
      ),
    );
  await popup("connect");
  const socket = sockets[0]!;
  socket.readyState = Socket.OPEN;
  socket.onopen?.();
  socket.receive({ type: "ready", connection_id: connection });
  await setImmediate();
  const execute = (request: LocalBrowserRequest, id = commandId) =>
    socket.receive({
      id,
      connection_id: connection,
      conversation_id: task,
      expires_at: Date.now() + 30_000,
      request,
    });
  const pageMessage = (raw: unknown, url = "https://linksense.example/conversations/new", tab = 7, frameId = 0) =>
    new Promise<unknown>((resolve) => messageHandler?.(raw, { url, tab: { id: tab }, frameId }, resolve));
  return { chrome, socket, sockets, execute, popup, pageMessage, stored, local, session, fetchPairing };
}

it.each(["disconnect", "cancel", "revoke", "expire"])(
  "does not send input when %s occurs while the debugger is attaching",
  async (reason) => {
    const { chrome, socket, execute, popup } = await fixture();
    const attaching = deferred<void>();
    chrome.debugger.attach.mockReturnValueOnce(attaching.promise);
    execute({ action: "type", tab_id: 7, text: "must not be typed", clear: false });
    await vi.waitFor(() => expect(chrome.debugger.attach).toHaveBeenCalled());
    if (reason === "disconnect") socket.close();
    if (reason === "cancel") socket.receive({ type: "cancel", id: commandId });
    if (reason === "revoke") await popup("release");
    if (reason === "expire")
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    attaching.resolve(undefined);
    await setImmediate();
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 },
      "Input.insertText",
      expect.anything(),
    );
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
  },
);

it("does not open a tab if the command is cancelled while reading its session", async () => {
  const { chrome, socket, execute, session } = await fixture();
  const reading = deferred<Record<string, unknown>>();
  chrome.storage.session.get.mockReturnValueOnce(reading.promise);
  execute({ action: "open", url: "https://page.example/" });
  await setImmediate();
  socket.receive({ type: "cancel", id: commandId });
  reading.resolve({ session });
  await setImmediate();
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});

const browserOwner = "10000000-0000-4000-8000-000000000001";
const approval = { origin: "https://linksense.example", owner_id: browserOwner, new_tabs: true, enabled: true, approval_id: "50000000-0000-4000-8000-000000000001" };
it.each([["Chrome/154", "chrome://extensions/"], ["Chrome/154 Edg/154", "edge://extensions/"]])("opens only the fixed extension manager from the trusted account's settings page in %s", async (userAgent, expected) => {
  const { chrome, local, pageMessage } = await fixture(userAgent);
  local.trust = approval;
  chrome.tabs.get.mockResolvedValue({ id: 7, url: "https://linksense.example/settings/general", title: "Settings" });
  expect(await pageMessage({ type: "open_extensions", owner_id: browserOwner }, "https://linksense.example/conversations/new")).toEqual({ detected: true, ok: true });
  expect(chrome.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: expected, active: true });
});
it.each([
  ["https://untrusted.example/settings/general", browserOwner, 0],
  ["https://linksense.example/conversations/new", browserOwner, 0],
  ["https://linksense.example/settings/general", "90000000-0000-4000-8000-000000000001", 0],
  ["https://linksense.example/settings/general", browserOwner, 1],
])("rejects opening internal settings from untrusted scope %s / %s / %i", async (url, owner_id, frame) => {
  const { chrome, local, pageMessage } = await fixture();
  local.trust = approval;
  chrome.tabs.get.mockResolvedValue({ id: 7, url, title: "Settings" });
  expect(await pageMessage({ type: "open_extensions", owner_id }, url, 7, frame)).toEqual({ ok: false });
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});
it("reconnects a lost transport with bounded backoff and stops after six failures", async () => {
  const { socket, sockets } = await fixture();
  socket.close(1006);
  for (const seconds of [1, 2, 4, 8, 16, 30]) {
    const count = sockets.length;
    await vi.advanceTimersByTimeAsync(seconds * 1000);
    expect(sockets).toHaveLength(count + 1);
    sockets.at(-1)!.close(1006);
  }
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sockets).toHaveLength(7);
});
it("keeps explicit disconnect disabled across reconnect attempts", async () => {
  const { socket, sockets, popup, local, pageMessage } = await fixture();
  local.trust = approval;
  socket.close(1006);
  await popup("disconnect");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sockets).toHaveLength(1);
  expect(await pageMessage({ type: "detect", owner_id: browserOwner })).toMatchObject({ pairing_mode: "blocked" });
});
it("renews an approved account automatically on a conversation page while preserving page grants", async () => {
  const { chrome, socket, stored, local, pageMessage, fetchPairing } = await fixture();
  local.trust = approval;
  socket.close(4401);
  await setImmediate();
  chrome.tabs.get.mockResolvedValue({ id: 7, url: "https://linksense.example/conversations/new", title: "LinkSense" });
  fetchPairing.mockResolvedValue(Response.json({ token: "n".repeat(43), owner_id: browserOwner, approval_id: approval.approval_id }));
  expect(await pageMessage({ type: "detect", owner_id: browserOwner })).toMatchObject({ pairing_mode: "automatic" });
  expect(await pageMessage({ type: "pair", automatic: true, owner_id: browserOwner, pairing: { code: "p".repeat(43), endpoint: "https://linksense.example/api/v1/local-browser" } })).toMatchObject({ ok: true });
  expect(stored.session).toMatchObject({ owner_id: browserOwner, token: "n".repeat(43), new_tabs: true });
  expect(stored.grants).toEqual([{ tab_id: 7, conversation_id: task }]);
  expect(chrome.action.openPopup).not.toHaveBeenCalled();
});
it("requires confirmation when the account changes and never consumes its code automatically", async () => {
  const { local, pageMessage, fetchPairing, chrome } = await fixture();
  local.trust = approval;
  const owner_id = "10000000-0000-4000-8000-000000000002";
  expect(await pageMessage({ type: "detect", owner_id })).toMatchObject({ pairing_mode: "confirmation" });
  await pageMessage({ type: "pair", automatic: true, owner_id, pairing: { code: "p".repeat(43), endpoint: "https://linksense.example/api/v1/local-browser" } });
  expect(fetchPairing).not.toHaveBeenCalled();
  expect(chrome.action.openPopup).toHaveBeenCalledOnce();
});
it("does not reuse trust when the pairing code belongs to another account", async () => {
  const { local, pageMessage, fetchPairing, chrome } = await fixture();
  local.trust = approval;
  chrome.tabs.get.mockResolvedValue({ id: 7, url: "https://linksense.example/conversations/new", title: "LinkSense" });
  fetchPairing.mockResolvedValue(Response.json({ token: "n".repeat(43), owner_id: "10000000-0000-4000-8000-000000000002" }));
  expect(await pageMessage({ type: "pair", automatic: true, owner_id: browserOwner, pairing: { code: "p".repeat(43), endpoint: "https://linksense.example/api/v1/local-browser" } })).toEqual({ ok: false });
});
it("stops automatic renewal when the server revokes or replaces the browser", async () => {
  const { local, socket, stored, pageMessage } = await fixture();
  local.trust = approval;
  socket.close(4403);
  await vi.waitFor(() => expect(stored.session).toBeUndefined());
  expect(local.trust).toMatchObject({ enabled: false });
  expect(stored.grants).toBeUndefined();
  expect(await pageMessage({ type: "detect", owner_id: browserOwner })).toMatchObject({ pairing_mode: "blocked" });
});
it("does not offer sharing for LinkSense's own page and saves new-tab changes", async () => {
  const { local, stored, popup, chrome, session } = await fixture();
  local.trust = approval;
  stored.session = { ...session, owner_id: browserOwner };
  chrome.tabs.query.mockResolvedValue([{ id: 7, url: "https://linksense.example/settings/general" }]);
  expect(await popup("popup_status")).toMatchObject({ can_allow: false });
  expect(await popup("preferences", { new_tabs: false })).toEqual({ ok: true });
  expect(stored.session).toMatchObject({ new_tabs: false });
  expect(local.trust).toMatchObject({ new_tabs: false });
});
it("clears page grants from another account during automatic pairing", async () => {
  const { chrome, local, stored, pageMessage, fetchPairing } = await fixture();
  local.trust = approval;
  stored.grant_owner_id = "10000000-0000-4000-8000-000000000002";
  chrome.tabs.get.mockResolvedValue({ id: 7, url: "https://linksense.example/conversations/new", title: "LinkSense" });
  fetchPairing.mockResolvedValue(Response.json({ token: "n".repeat(43), owner_id: browserOwner, approval_id: approval.approval_id }));
  await pageMessage({ type: "pair", automatic: true, owner_id: browserOwner, pairing: { code: "p".repeat(43), endpoint: "https://linksense.example/api/v1/local-browser" } });
  expect(stored.grants).toBeUndefined();
  expect(stored.grant_owner_id).toBe(browserOwner);
});
it("offers the first confirmation once without consuming credentials or repeating the popup", async () => {
  const { chrome, pageMessage, fetchPairing } = await fixture();
  const request = { type: "pair", automatic: true, owner_id: browserOwner, pairing: { code: "p".repeat(43), endpoint: "https://linksense.example/api/v1/local-browser" } };
  await pageMessage(request);
  await pageMessage(request);
  expect(chrome.action.openPopup).toHaveBeenCalledOnce();
  expect(fetchPairing).not.toHaveBeenCalled();
});
it("resumes a deliberately disconnected site directly from the extension", async () => {
  const { local, popup, chrome, pageMessage } = await fixture();
  local.trust = approval;
  await popup("disconnect");
  expect(await popup("connect")).toEqual({ ok: true });
  expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://linksense.example/conversations/new" });
  expect(await pageMessage({ type: "detect", owner_id: browserOwner })).toMatchObject({ pairing_mode: "automatic" });
});
it("does not revive the old socket when another tab probes during approved renewal", async () => {
  const { chrome, local, stored, session, sockets, pageMessage, fetchPairing } = await fixture();
  local.trust = approval;
  stored.session = { ...session, owner_id: browserOwner };
  chrome.tabs.get.mockResolvedValue({ id: 7, url: "https://linksense.example/conversations/new", title: "LinkSense" });
  const response = deferred<Response>();
  fetchPairing.mockReturnValueOnce(response.promise);
  const renewing = pageMessage({ type: "pair", automatic: true, owner_id: browserOwner, pairing: { code: "p".repeat(43), endpoint: "https://linksense.example/api/v1/local-browser" } });
  await vi.waitFor(() => expect(fetchPairing).toHaveBeenCalled());
  expect(await pageMessage({ type: "detect", owner_id: browserOwner, resume: true })).toMatchObject({ pairing_mode: "reconnecting" });
  expect(sockets).toHaveLength(1);
  response.resolve(Response.json({ token: "n".repeat(43), owner_id: browserOwner, approval_id: approval.approval_id }));
  await renewing;
  expect(sockets).toHaveLength(2);
});

it("detaches a stalled debugger call on cancellation so the next command can run", async () => {
  const { chrome, socket, execute } = await fixture();
  const pending = deferred<Record<string, unknown>>();
  chrome.debugger.sendCommand.mockReturnValueOnce(pending.promise);
  execute({ action: "type", tab_id: 7, text: "cancelled input", clear: false });
  await vi.waitFor(() => expect(chrome.debugger.sendCommand).toHaveBeenCalled());
  socket.receive({ type: "cancel", id: commandId });
  execute(
    { action: "open", url: "https://page.example/" },
    "40000000-0000-4000-8000-000000000002",
  );
  try {
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(chrome.debugger.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 7 }, "Input.insertText", expect.anything(),
    );
  } finally {
    pending.resolve({});
    await setImmediate();
  }
});

it("times out a stalled debugger call at the command deadline", async () => {
  vi.useFakeTimers();
  const { chrome, socket, execute } = await fixture();
  const pending = deferred<Record<string, unknown>>();
  chrome.debugger.sendCommand.mockReturnValueOnce(pending.promise);
  execute({ action: "type", tab_id: 7, text: "expired input", clear: false });
  try {
    await vi.waitFor(() => expect(chrome.debugger.sendCommand).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(30_001);
    expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({
      id: commandId, result: { ok: false, code: "LOCAL_BROWSER_TIMEOUT" },
    });
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
  } finally {
    pending.resolve({});
    await setImmediate();
  }
});

it("does not reconnect when the user disconnects before a pending pairing completes", async () => {
  const { chrome, popup, stored, session, fetchPairing } = await fixture();
  stored.pending = {
    code: "p".repeat(43), endpoint: session.endpoint,
    source_tab: 7, source_origin: "https://linksense.example",
  };
  chrome.tabs.get.mockResolvedValue({
    id: 7, url: "https://linksense.example/settings/general", title: "Settings",
  });
  const pairing = deferred<Response>();
  fetchPairing.mockReturnValueOnce(pairing.promise);
  const connecting = popup("connect");
  await vi.waitFor(() => expect(fetchPairing).toHaveBeenCalled());
  const disconnecting = popup("disconnect");
  await setImmediate();
  pairing.resolve(Response.json({ token: "y".repeat(43) }));
  await Promise.all([connecting, disconnecting]);
  expect(stored.session).toBeUndefined();
});

it("rejects a pending pairing if its server differs from the origin shown at confirmation", async () => {
  const { chrome, popup, stored, fetchPairing } = await fixture();
  stored.pending = {
    code: "p".repeat(43), endpoint: "https://different.example/api/v1/local-browser",
    source_tab: 7, source_origin: "https://different.example",
  };
  chrome.tabs.get.mockResolvedValue({
    id: 7, url: "https://different.example/settings/general", title: "Settings",
  });
  fetchPairing.mockResolvedValue(Response.json({ token: "y".repeat(43) }));
  expect(await popup("connect")).toEqual({ ok: false });
  expect(fetchPairing).not.toHaveBeenCalled();
});

const previewData = { tab_id: 7, title: "Page", url: "https://page.example/", image: "AQID", captured_at: 1 };
const previewSourceTab = 99;
async function previewFixture() {
  const fixtureValue = await fixture();
  fixtureValue.stored.session = { ...fixtureValue.session, owner_id: browserOwner };
  fixtureValue.stored.previews = [{ owner_id: browserOwner, conversation_id: task, preview: previewData }];
  const sourceTab = { id: previewSourceTab, title: "LinkSense", url: `https://linksense.example/conversations/${task}` };
  const targetTab = await fixtureValue.chrome.tabs.get(7);
  fixtureValue.chrome.tabs.get.mockImplementation(async id => id === previewSourceTab ? sourceTab : targetTab);
  const request = (type: string, owner = browserOwner, conversation = task, source = `https://linksense.example/conversations/${conversation}`, tab_id = 7) => {
    sourceTab.url = source;
    return fixtureValue.pageMessage({ type, owner_id: owner, conversation_id: conversation, tab_id }, source, previewSourceTab);
  };
  return { ...fixtureValue, request, sourceTab };
}
it.each(["preview", "activate"])("allows %s after SPA navigation even when MessageSender retains the document's initial URL", async type => {
  const { pageMessage } = await previewFixture();
  expect(await pageMessage({ type, owner_id: browserOwner, conversation_id: task, tab_id: 7 }, "https://linksense.example/conversations/new", previewSourceTab)).toMatchObject({ ok: true });
});
it.each(["preview", "activate"])("denies %s when the live source tab has left the authorized conversation", async type => {
  const { pageMessage, sourceTab, chrome } = await previewFixture();
  for (const url of ["https://untrusted.example/conversations/" + task, "https://linksense.example/settings/general", "https://linksense.example/conversations/20000000-0000-4000-8000-000000000002"]) {
    sourceTab.url = url;
    expect(await pageMessage({ type, owner_id: browserOwner, conversation_id: task, tab_id: 7 }, `https://linksense.example/conversations/${task}`, previewSourceTab)).toEqual({ ok: false });
  }
  expect(chrome.tabs.update).not.toHaveBeenCalled();
});
it("does not expose task previews to an iframe inside the chat tab", async () => {
  const { pageMessage } = await previewFixture();
  expect(await pageMessage({ type: "preview", owner_id: browserOwner, conversation_id: task }, `https://linksense.example/conversations/${task}`, previewSourceTab, 1)).toEqual({ ok: false });
});
it("returns only the current task's authorized thumbnail and focuses its actual tab and window", async () => {
  const { request, chrome } = await previewFixture();
  expect(await request("preview")).toMatchObject({ ok: true, preview: previewData });
  expect(await request("activate")).toMatchObject({ ok: true });
  expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
  expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
});
it("keeps thumbnails private across source origins, accounts and conversation pages", async () => {
  const { request, chrome } = await previewFixture();
  expect(await request("preview", browserOwner, task, "https://untrusted.example/conversations/" + task)).toEqual({ ok: false });
  expect(await request("preview", "10000000-0000-4000-8000-000000000002")).toEqual({ ok: false });
  expect(await request("preview", browserOwner, task, "https://linksense.example/settings/general")).toEqual({ ok: false });
  expect(await request("preview", browserOwner, "20000000-0000-4000-8000-000000000002")).not.toHaveProperty("preview");
  expect(chrome.tabs.update).not.toHaveBeenCalled();
});
it("does not expose a revoked thumbnail or activate a stale tab identifier", async () => {
  const { request, stored, chrome } = await previewFixture();
  expect(await request("activate", browserOwner, task, `https://linksense.example/conversations/${task}`, 9)).toEqual({ ok: false });
  stored.grants = [];
  expect(await request("preview")).not.toHaveProperty("preview");
  expect(await request("activate")).not.toHaveProperty("preview");
  expect(chrome.tabs.update).not.toHaveBeenCalled();
});
it("preserves a completed browser action when its optional thumbnail cannot be captured", async () => {
  const { stored, session, socket, execute, chrome } = await fixture();
  stored.session = { ...session, owner_id: browserOwner };
  execute({ action: "type", tab_id: 7, text: "once", clear: false });
  await vi.waitFor(() => {
    expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ id: commandId, result: { ok: true } });
  });
  expect(chrome.debugger.sendCommand.mock.calls.filter(call => String(call[1]) === "Input.insertText")).toHaveLength(1);
});

function nativeCursorFixture(chrome: Awaited<ReturnType<typeof fixture>>["chrome"]) {
  let document = "document-a";
  chrome.debugger.sendCommand.mockImplementation(async (_target, method) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: { loaderId: document } } };
    if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } };
    return {};
  });
  return { navigate: () => { document = "document-b"; } };
}
it("waits for the displayed pointer to arrive before dispatching the native click", async () => {
  const { chrome, socket, execute } = await fixture();
  nativeCursorFixture(chrome);
  const arriving = deferred<{ applied: boolean; reduced_motion: boolean }>();
  chrome.tabs.sendMessage.mockImplementation(async (_tab, raw) => {
    if (raw && typeof raw === "object" && "action" in raw && raw.action === "move") return arriving.promise;
    return { applied: true, reduced_motion: true };
  });
  execute({ action: "click_at", tab_id: 7, x: 400, y: 300 });
  await vi.waitFor(() => expect(chrome.tabs.sendMessage.mock.calls.some(call => controlMessageSchema.safeParse(call[1]).data?.action === "move")).toBe(true));
  expect(chrome.debugger.sendCommand.mock.calls.some(call => call[1] === "Input.dispatchMouseEvent" && call[2]?.type === "mousePressed")).toBe(false);
  arriving.resolve({ applied: true, reduced_motion: true });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ id: commandId, result: { ok: true } }));
  const events = chrome.debugger.sendCommand.mock.calls.filter(call => call[1] === "Input.dispatchMouseEvent").map(call => call[2]);
  expect(events).toEqual([
    expect.objectContaining({ type: "mouseMoved", x: 400, y: 300 }),
    expect.objectContaining({ type: "mousePressed", x: 400, y: 300 }),
    expect.objectContaining({ type: "mouseReleased", x: 400, y: 300 }),
  ]);
});
it("cancels a pending pointer movement when the page's stop-sharing control is pressed", async () => {
  const { chrome, socket, execute, pageMessage, stored } = await fixture();
  nativeCursorFixture(chrome);
  const arriving = deferred<{ applied: boolean; reduced_motion: boolean }>();
  chrome.tabs.sendMessage.mockImplementation(async (_tab, raw) => {
    if (raw && typeof raw === "object" && "action" in raw && raw.action === "move") return arriving.promise;
    return { applied: true, reduced_motion: true };
  });
  execute({ action: "click_at", tab_id: 7, x: 900, y: 600 });
  await vi.waitFor(() => expect(chrome.tabs.sendMessage.mock.calls.some(call => controlMessageSchema.safeParse(call[1]).data?.action === "move")).toBe(true));
  expect(await pageMessage({ type: "stop_control" }, "https://page.example/")).toEqual({ ok: true });
  arriving.resolve({ applied: true, reduced_motion: true });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ id: commandId, result: { ok: false, code: "LOCAL_BROWSER_CANCELLED" } }));
  expect(stored.grants).toEqual([]);
  expect(chrome.debugger.sendCommand.mock.calls.some(call => call[2]?.type === "mousePressed")).toBe(false);
});
it("does not click old coordinates when the document changes during pointer movement", async () => {
  const { chrome, socket, execute } = await fixture();
  const page = nativeCursorFixture(chrome);
  chrome.tabs.sendMessage.mockImplementation(async (_tab, raw) => {
    if (raw && typeof raw === "object" && "action" in raw && raw.action === "move") page.navigate();
    return { applied: true, reduced_motion: true };
  });
  execute({ action: "click_at", tab_id: 7, x: 400, y: 300 });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ id: commandId, result: { ok: false, code: "LOCAL_BROWSER_STALE_REF" } }));
  expect(chrome.debugger.sendCommand.mock.calls.some(call => call[2]?.type === "mousePressed")).toBe(false);
});

it("loads the presentation bundle only for an authorized page that has no receiver", async () => {
  const { chrome, socket, execute } = await fixture();
  chrome.tabs.sendMessage.mockResolvedValueOnce({ applied: false });
  execute({ action: "type", tab_id: 7, text: "once", clear: false });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ result: { ok: true } }));
  expect(chrome.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({ target: { tabId: 7 }, files: ["control.js"], injectImmediately: true });
});
it("does not inject presentation code into an unapproved page", async () => {
  const { chrome, socket, execute } = await fixture();
  execute({ action: "type", tab_id: 99, text: "denied", clear: false });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ result: { ok: false, code: "LOCAL_BROWSER_ACCESS_DENIED" } }));
  expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
});
it("does not fail or replay native typing when presentation injection is blocked", async () => {
  const { chrome, socket, execute } = await fixture();
  chrome.tabs.sendMessage.mockResolvedValue({ applied: false });
  chrome.scripting.executeScript.mockRejectedValue(new Error("injection blocked"));
  execute({ action: "type", tab_id: 7, text: "once", clear: false });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ result: { ok: true } }));
  expect(chrome.debugger.sendCommand.mock.calls.filter(call => call[1] === "Input.insertText")).toHaveLength(1);
});
it("hides presentation when its browser connection is explicitly stopped", async () => {
  const { chrome, socket, execute, popup } = await fixture();
  execute({ action: "type", tab_id: 7, text: "once", clear: false });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ result: { ok: true } }));
  await popup("disconnect");
  expect(chrome.tabs.sendMessage.mock.calls.some(call => controlMessageSchema.safeParse(call[1]).data?.action === "hide")).toBe(true);
});

it("honors a stop reported by the presentation before its separate revocation message arrives", async () => {
  const { chrome, socket, execute, stored } = await fixture();
  nativeCursorFixture(chrome);
  chrome.tabs.sendMessage.mockImplementation(async (_tab, raw) => {
    if (controlMessageSchema.safeParse(raw).data?.action === "move") return { applied: false, stopped: true };
    return { applied: true, reduced_motion: true };
  });
  execute({ action: "click_at", tab_id: 7, x: 800, y: 500 });
  await vi.waitFor(() => expect(JSON.parse(String(socket.send.mock.lastCall?.[0]))).toMatchObject({ result: { ok: false, code: "LOCAL_BROWSER_CANCELLED" } }));
  expect(stored.grants).toEqual([]);
  expect(chrome.debugger.sendCommand.mock.calls.some(call => call[2]?.type === "mousePressed")).toBe(false);
});
