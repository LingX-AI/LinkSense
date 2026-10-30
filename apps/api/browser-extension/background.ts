import { z } from "zod";
import {
  localBrowserCommandSchema,
  localBrowserPairingSchema,
  localBrowserFailure,
  localBrowserFailureCodes,
  localBrowserPairResponseSchema,
  localBrowserPreviewSchema,
  type LocalBrowserCommand,
  type LocalBrowserResult,
} from "@linksense/shared/local-browser";
import { controlMessageSchema, controlReplySchema, cursorPath, excludeControlSubtree, type ControlMessage, type CursorPoint } from "./control-protocol.js";

const pairingSchema = localBrowserPairingSchema.extend({
  source_tab: z.number().int(),
  source_origin: z.url(),
  owner_id: z.uuid().optional(),
  requested_at: z.number().optional(),
});
const grantSchema = z.strictObject({
  tab_id: z.number().int(),
  conversation_id: z.uuid().nullable(),
});
const sessionSchema = z.strictObject({
  endpoint: z.url(),
  token: z.string().min(32),
  new_tabs: z.boolean(),
  owner_id: z.uuid().optional(),
});
const trustSchema = z.strictObject({
  origin: z.url(), owner_id: z.uuid(), new_tabs: z.boolean(), enabled: z.boolean(),
  approval_id: z.uuid().optional(),
});
const previewEntrySchema = z.strictObject({
  conversation_id: z.uuid(),
  owner_id: z.uuid(),
  preview: localBrowserPreviewSchema,
});
const maxPreviews = 8;
type Grant = z.infer<typeof grantSchema>;
let socket: WebSocket | undefined;
let generation = 0;
let queue = Promise.resolve();
let grantQueue = Promise.resolve();
let connectionQueue = Promise.resolve();
let connectionIntent = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let automaticBlocked = false;
let pairingInFlight = false;
let executing:
  | { command: LocalBrowserCommand; generation: number; controller: AbortController }
  | undefined;
const attached = new Set<number>();
const controlled = new Map<number, { request: string; point?: CursorPoint; reduced: boolean }>();
const queued = new Set<string>();
const cancelled = new Set<string>();
async function boundedVisual<T>(operation: () => Promise<T>): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<undefined>(resolve => { timeout = setTimeout(resolve, 900); })]);
  } catch { return undefined; }
  finally { clearTimeout(timeout); }
}
async function visualMessage(tab: number, message: ControlMessage) {
  const result = controlReplySchema.safeParse(await boundedVisual(() => chrome.tabs.sendMessage(tab, message, { frameId: 0 })));
  return result.success ? result.data : undefined;
}
async function hideControl(tab: number): Promise<void> {
  const state = controlled.get(tab);
  controlled.delete(tab);
  if (state) await visualMessage(tab, { type: "linksense-control", action: "hide", request_id: state.request, duration: 0 });
}
function controlStatus(action: LocalBrowserCommand["request"]["action"]): NonNullable<ControlMessage["status"]> {
  if (action === "click" || action === "click_at") return "clicking";
  if (action === "type" || action === "key") return "typing";
  if (action === "scroll") return "scrolling";
  if (action === "snapshot" || action === "screenshot") return "observing";
  return "working";
}
async function presentControl(tab: number, action: ControlMessage["action"], point?: CursorPoint, duration = 0): Promise<void> {
  const execution = assertExecuting();
  await authorized(execution.command, tab);
  assertExecuting();
  const previous = controlled.get(tab);
  const position = point ?? (action === "show" ? previous?.point : undefined);
  const message = controlMessageSchema.parse({ type: "linksense-control", action, request_id: execution.command.id, status: controlStatus(execution.command.request.action), ...position, duration });
  let reply = await visualMessage(tab, message);
  if (action === "show" && !reply?.applied && !reply?.stopped) {
    await authorized(execution.command, tab);
    assertExecuting();
    await boundedVisual(() => chrome.scripting.executeScript({ target: { tabId: tab }, files: ["control.js"], injectImmediately: true }));
    await authorized(execution.command, tab);
    assertExecuting();
    reply = await visualMessage(tab, message);
  }
  if (reply?.stopped) {
    await stopSharing(tab);
    throw new Error("LOCAL_BROWSER_CANCELLED");
  }
  controlled.set(tab, { request: execution.command.id, reduced: reply?.reduced_motion ?? previous?.reduced ?? false, ...(point ? { point } : previous?.point ? { point: previous.point } : {}) });
  assertExecuting();
}
async function moveControlPointer(tab: number, point: CursorPoint): Promise<void> {
  const size = await viewport(tab);
  if (point.x < 0 || point.y < 0 || point.x >= size.width || point.y >= size.height)
    throw new Error("LOCAL_BROWSER_COMMAND_FAILED");
  const previous = controlled.get(tab);
  const from = {
    x: Math.min(Math.max(previous?.point?.x ?? 36, 0), size.width - 1),
    y: Math.min(Math.max(previous?.point?.y ?? 72, 0), size.height - 1),
  };
  if (previous?.point && Math.hypot(point.x - from.x, point.y - from.y) < .5) {
    await presentControl(tab, "move", point);
    return;
  }
  const path = previous?.reduced ? [point] : cursorPath(from, point);
  const duration = previous?.reduced ? 0 : Math.round(Math.min(340, Math.max(160, Math.hypot(point.x - from.x, point.y - from.y) * .4)) / path.length);
  for (const destination of path) {
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", ...destination, buttons: 0 });
    await presentControl(tab, "move", destination, duration);
  }
}
async function finishControl(request: string, aborted: boolean): Promise<void> {
  for (const [tab, state] of controlled) {
    if (state.request !== request) continue;
    if (aborted || !(await grants()).some(grant => grant.tab_id === tab && grant.conversation_id === executing?.command.conversation_id))
      await hideControl(tab);
    else await visualMessage(tab, { type: "linksense-control", action: "idle", request_id: request, duration: 0 });
  }
}
async function focusedControlPoint(tab: number): Promise<CursorPoint | undefined> {
  try {
    const root = z.object({ root: z.object({ nodeId: z.number() }) }).parse(await cdp(tab, "DOM.getDocument", { depth: 0 }));
    const focus = z.object({ nodeId: z.number() }).parse(await cdp(tab, "DOM.querySelector", { nodeId: root.root.nodeId, selector: ":focus" }));
    if (!focus.nodeId) return undefined;
    const box = z.object({ model: z.object({ content: z.array(z.number()).length(8) }) }).parse(await cdp(tab, "DOM.getBoxModel", { nodeId: focus.nodeId }));
    const point = { x: (box.model.content[0]! + box.model.content[4]!) / 2, y: (box.model.content[1]! + box.model.content[5]!) / 2 };
    const size = await viewport(tab);
    return point.x >= 0 && point.y >= 0 && point.x < size.width && point.y < size.height ? point : undefined;
  } catch { return undefined; }
}
async function controlBackendId(tab: number): Promise<number | undefined> {
  try {
    const root = z.object({ root: z.object({ nodeId: z.number() }) }).parse(await cdp(tab, "DOM.getDocument", { depth: 0 }));
    const host = z.object({ nodeId: z.number() }).parse(await cdp(tab, "DOM.querySelector", { nodeId: root.root.nodeId, selector: "[data-linksense-control]" }));
    if (!host.nodeId) return undefined;
    return z.object({ node: z.object({ backendNodeId: z.number() }) }).parse(await cdp(tab, "DOM.describeNode", { nodeId: host.nodeId })).node.backendNodeId;
  } catch { return undefined; }
}
async function trustedSite(): Promise<z.infer<typeof trustSchema> | undefined> {
  const result = trustSchema.safeParse((await chrome.storage.local.get("trust")).trust);
  return result.success ? result.data : undefined;
}
async function disableAutomatic(forgetApproval = false): Promise<void> {
  automaticBlocked = true;
  const trust = await trustedSite();
  if (trust) {
    const { approval_id, ...site } = trust;
    await chrome.storage.local.set({ trust: { ...site, ...(!forgetApproval && approval_id ? { approval_id } : {}), enabled: false } });
  }
}
async function grants(): Promise<Grant[]> {
  return z
    .array(grantSchema)
    .parse((await chrome.storage.session.get("grants")).grants ?? []);
}
async function previews(): Promise<z.infer<typeof previewEntrySchema>[]> {
  return z.array(previewEntrySchema).max(maxPreviews).parse(
    (await chrome.storage.session.get("previews")).previews ?? [],
  );
}
async function waitForPreviewPage(tab: number): Promise<void> {
  const { controller } = assertExecuting();
  await new Promise<void>(resolve => {
    const finish = () => {
      clearTimeout(deadline);
      chrome.tabs.onUpdated.removeListener(updated);
      controller.signal.removeEventListener("abort", finish);
      resolve();
    };
    const updated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
      if (id === tab && change.status === "complete") finish();
    };
    const deadline = setTimeout(finish, 2000);
    chrome.tabs.onUpdated.addListener(updated);
    controller.signal.addEventListener("abort", finish, { once: true });
    void chrome.tabs.get(tab).then(info => { if (info.status !== "loading") finish(); }, finish);
    if (controller.signal.aborted) finish();
  });
  assertExecuting();
}
async function rememberPreview(command: LocalBrowserCommand, tab: number): Promise<void> {
  const session = sessionSchema.parse((await chrome.storage.session.get("session")).session);
  if (!session.owner_id) return;
  if (["open", "navigate", "click", "click_at"].includes(command.request.action)) await waitForPreviewPage(tab);
  await presentControl(tab, "show");
  const size = await viewport(tab);
  const image = z.object({ data: localBrowserPreviewSchema.shape.image }).parse(
    await cdp(tab, "Page.captureScreenshot", {
      format: "jpeg", quality: 55, captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: Math.min(1, 480 / size.width, 320 / size.height) },
    }),
  );
  const data = await tabData(tab);
  const preview = localBrowserPreviewSchema.parse({ ...data, image: image.data, captured_at: Date.now() });
  const previous = await previews();
  assertExecuting();
  await chrome.storage.session.set({ previews: [
    { conversation_id: command.conversation_id, owner_id: session.owner_id, preview },
    ...previous.filter(item => item.conversation_id !== command.conversation_id),
  ].slice(0, maxPreviews) });
}
async function mutateGrants(
  update: (current: Grant[]) => Grant[],
): Promise<void> {
  const operation = grantQueue.then(async () => {
    const next = update(await grants());
    await chrome.storage.session.set({ grants: next });
  });
  grantQueue = operation.catch(() => undefined);
  await operation;
}
function webUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("LOCAL_BROWSER_ACCESS_DENIED");
  return url;
}
function connectionEndpoint(value: string): URL {
  const url = webUrl(value);
  if (!url.pathname.endsWith("/api/v1/local-browser") || url.search || url.hash)
    throw new Error("LOCAL_BROWSER_ACCESS_DENIED");
  return url;
}
async function detach(tab: number): Promise<void> {
  attached.delete(tab);
  await Promise.all([chrome.debugger.detach({ tabId: tab }).catch(() => undefined), hideControl(tab)]);
}
async function stopSharing(tab: number): Promise<void> {
  cancelTab(tab);
  await mutateGrants(current => current.filter(grant => grant.tab_id !== tab));
  await detach(tab);
}
function invalidateConnection(): void {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  executing?.controller.abort("LOCAL_BROWSER_CANCELLED");
  generation++;
  socket?.close();
  socket = undefined;
}
async function stop(preserveGrants = false): Promise<void> {
  invalidateConnection();
  await Promise.all([...attached].map(detach));
  await Promise.all([...controlled.keys()].map(hideControl));
  if (!preserveGrants) await mutateGrants(() => []);
  await chrome.storage.session.remove([
    "session",
    "pending",
    ...(preserveGrants ? [] : ["grants"]),
    ...(preserveGrants ? [] : ["grant_owner_id"]),
    ...(preserveGrants ? [] : ["previews"]),
    "connected",
  ]);
  await chrome.action.setBadgeText({ text: "" });
}
function assertExecuting(): NonNullable<typeof executing> {
  if (
    !executing ||
    executing.generation !== generation ||
    socket?.readyState !== WebSocket.OPEN ||
    cancelled.has(executing.command.id)
  )
    throw new Error("LOCAL_BROWSER_CANCELLED");
  if (executing.command.expires_at <= Date.now())
    throw new Error("LOCAL_BROWSER_TIMEOUT");
  if (executing.controller.signal.aborted)
    throw new Error(
      executing.controller.signal.reason === "LOCAL_BROWSER_TIMEOUT"
        ? "LOCAL_BROWSER_TIMEOUT"
        : "LOCAL_BROWSER_CANCELLED",
    );
  return executing;
}
async function debuggerCall<T>(
  tab: number,
  operation: () => Promise<T>,
): Promise<T> {
  const { controller } = assertExecuting();
  let abort = () => {};
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new Error(controller.signal.reason));
    };
  });
  controller.signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([operation(), cancellation]);
  } finally {
    controller.signal.removeEventListener("abort", abort);
    if (controller.signal.aborted) await detach(tab);
  }
}
async function cdp(
  tab: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const execution = assertExecuting();
  // Recheck before each protocol command, including the second half of a click/type.
  await authorized(execution.command, tab);
  assertExecuting();
  if (!attached.has(tab)) {
    try {
      await debuggerCall(tab, async () => {
        await chrome.debugger.attach({ tabId: tab }, "1.3");
        if (
          execution.controller.signal.aborted ||
          execution.generation !== generation
        ) {
          await detach(tab);
          throw new Error("LOCAL_BROWSER_CANCELLED");
        }
        attached.add(tab);
      });
      await authorized(execution.command, tab);
      assertExecuting();
      await debuggerCall(tab, () =>
        chrome.debugger.sendCommand({ tabId: tab }, "Page.enable"),
      );
      await authorized(execution.command, tab);
      assertExecuting();
    } catch (error) {
      await detach(tab);
      throw error;
    }
  }
  return debuggerCall(tab, () =>
    chrome.debugger.sendCommand({ tabId: tab }, method, params),
  );
}
function cancelTab(tab: number): void {
  const request = executing?.command.request;
  if (request && "tab_id" in request && request.tab_id === tab)
    executing?.controller.abort("LOCAL_BROWSER_CANCELLED");
}
async function tabData(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  return {
    tab_id: tabId,
    url: (tab.url ?? "").slice(0, 4096),
    title: (tab.title ?? "").slice(0, 500),
  };
}
async function authorized(
  command: LocalBrowserCommand,
  tabId: number,
): Promise<void> {
  const all = await grants();
  const grant = all.find((item) => item.tab_id === tabId);
  if (!grant) throw new Error("LOCAL_BROWSER_ACCESS_DENIED");
  const tab = await chrome.tabs.get(tabId).catch(() => {
    throw new Error("LOCAL_BROWSER_ACCESS_DENIED");
  });
  const session = sessionSchema.parse(
    (await chrome.storage.session.get("session")).session,
  );
  if (
    tab.incognito ||
    !tab.url ||
    webUrl(tab.url).origin === new URL(session.endpoint).origin
  )
    throw new Error("LOCAL_BROWSER_ACCESS_DENIED");
  // Read/claim and user revocation share a queue so a stale read cannot restore a removed grant.
  await mutateGrants((current) => {
    assertExecuting();
    const latest = current.find((item) => item.tab_id === tabId);
    if (!latest) throw new Error("LOCAL_BROWSER_ACCESS_DENIED");
    if (
      latest.conversation_id &&
      latest.conversation_id !== command.conversation_id
    )
      throw new Error("LOCAL_BROWSER_TAB_BUSY");
    return current.map((item) =>
      item.tab_id === tabId
        ? { ...item, conversation_id: command.conversation_id }
        : item,
    );
  });
}
async function documentId(tab: number): Promise<string> {
  return z
    .object({
      frameTree: z.object({ frame: z.object({ loaderId: z.string() }) }),
    })
    .parse(await cdp(tab, "Page.getFrameTree")).frameTree.frame.loaderId;
}
async function viewport(tab: number) {
  const data = z
    .object({
      cssVisualViewport: z.object({
        clientWidth: z.number(),
        clientHeight: z.number(),
      }),
    })
    .parse(await cdp(tab, "Page.getLayoutMetrics"));
  return {
    width: data.cssVisualViewport.clientWidth,
    height: data.cssVisualViewport.clientHeight,
  };
}
async function selectAll(tab: number): Promise<void> {
  const modifiers = navigator.platform.includes("Mac") ? 4 : 2;
  await cdp(tab, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers,
    commands: ["selectAll"],
  });
  await cdp(tab, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers,
  });
}
async function run(command: LocalBrowserCommand): Promise<LocalBrowserResult> {
  assertExecuting();
  const request = command.request;
  if (request.action === "status")
    return {
      ok: true,
      browser: "local",
      data: { connected: socket?.readyState === WebSocket.OPEN },
    };
  if (request.action === "tabs") {
    const all = await grants();
    const tabs = await Promise.all(
      all
        .filter(
          (grant) =>
            !grant.conversation_id ||
            grant.conversation_id === command.conversation_id,
        )
        .map((grant) => tabData(grant.tab_id).catch(() => null)),
    );
    return {
      ok: true,
      browser: "local",
      data: { tabs: tabs.filter((tab) => tab !== null).slice(0, 100) },
    };
  }
  const session = sessionSchema.parse(
    (await chrome.storage.session.get("session")).session,
  );
  if (
    "url" in request &&
    webUrl(request.url).origin === new URL(session.endpoint).origin
  )
    return localBrowserFailure("LOCAL_BROWSER_ACCESS_DENIED");
  if (request.action === "open") {
    if (!session.new_tabs)
      return localBrowserFailure("LOCAL_BROWSER_ACCESS_DENIED");
    assertExecuting();
    const tab = await chrome.tabs.create({ url: request.url, active: true });
    const tabId = tab.id;
    if (!tabId) throw new Error("LOCAL_BROWSER_COMMAND_FAILED");
    assertExecuting();
    await mutateGrants((current) => {
      assertExecuting();
      return [
        ...current,
        { tab_id: tabId, conversation_id: command.conversation_id },
      ];
    });
    return { ok: true, browser: "local", data: await tabData(tabId) };
  }
  const tab = request.tab_id;
  await authorized(command, tab);
  if (request.action === "release") {
    await mutateGrants((current) =>
      current.map((grant) =>
        grant.tab_id === tab ? { tab_id: tab, conversation_id: null } : grant,
      ),
    );
    await detach(tab);
    return { ok: true, browser: "local", data: { tab_id: tab } };
  }
  await presentControl(tab, "show");
  if (request.action === "navigate")
    await cdp(tab, "Page.navigate", { url: request.url });
  if (request.action === "snapshot") {
    const loader = await documentId(tab);
    const tree = z
      .object({
        nodes: z.array(
          z.object({
            nodeId: z.string(),
            childIds: z.array(z.string()).optional(),
            ignored: z.boolean().optional(),
            backendDOMNodeId: z.number().optional(),
            role: z.object({ value: z.string() }).optional(),
            name: z.object({ value: z.string() }).optional(),
          }),
        ),
      })
      .parse(await cdp(tab, "Accessibility.getFullAXTree"));
    const elements = excludeControlSubtree(tree.nodes, await controlBackendId(tab))
      .filter(
        (node) => !node.ignored && node.backendDOMNodeId && node.name?.value,
      )
      .slice(0, 200)
      .map((node) => ({
        ref: `${loader}:${node.backendDOMNodeId}`,
        role: node.role?.value.slice(0, 100) ?? "",
        name: node.name!.value.slice(0, 500),
      }));
    return {
      ok: true,
      browser: "local",
      data: { ...(await tabData(tab)), elements },
    };
  }
  if (request.action === "screenshot") {
    const image = z.object({ data: z.string().max(4_000_000) }).parse(
      await cdp(tab, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 65,
        captureBeyondViewport: false,
      }),
    );
    return {
      ok: true,
      browser: "local",
      data: {
        ...(await tabData(tab)),
        image: image.data,
        mime_type: "image/jpeg",
        viewport: await viewport(tab),
      },
    };
  }
  let point: { x: number; y: number } | undefined;
  if (request.action === "click") {
    const parts = request.ref.split(":");
    const backendNodeId = Number(parts.pop());
    if (
      !Number.isInteger(backendNodeId) ||
      backendNodeId <= 0 ||
      parts.join(":") !== (await documentId(tab))
    )
      return localBrowserFailure("LOCAL_BROWSER_STALE_REF");
    try {
      await cdp(tab, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
      const box = z
        .object({ model: z.object({ content: z.array(z.number()).length(8) }) })
        .parse(await cdp(tab, "DOM.getBoxModel", { backendNodeId }));
      point = {
        x: (box.model.content[0]! + box.model.content[4]!) / 2,
        y: (box.model.content[1]! + box.model.content[5]!) / 2,
      };
    } catch {
      return localBrowserFailure("LOCAL_BROWSER_STALE_REF");
    }
  }
  if (request.action === "click_at") point = { x: request.x, y: request.y };
  if (point) {
    const size = await viewport(tab);
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x >= size.width ||
      point.y >= size.height
    )
      return localBrowserFailure("LOCAL_BROWSER_COMMAND_FAILED");
    const document = await documentId(tab);
    await moveControlPointer(tab, point);
    if (document !== await documentId(tab) || (request.action === "click" && !request.ref.startsWith(`${document}:`)))
      return localBrowserFailure("LOCAL_BROWSER_STALE_REF");
    await presentControl(tab, "click", point);
    await cdp(tab, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await cdp(tab, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  }
  if (request.action === "type") {
    const focus = await focusedControlPoint(tab);
    if (focus) await moveControlPointer(tab, focus);
    await presentControl(tab, "type");
    if (request.clear) await selectAll(tab);
    await cdp(tab, "Input.insertText", { text: request.text });
  }
  if (request.action === "scroll") {
    await moveControlPointer(tab, { x: request.x, y: request.y });
    await presentControl(tab, "scroll", { x: request.x, y: request.y });
    await cdp(tab, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: request.x,
      y: request.y,
      deltaX: request.delta_x,
      deltaY: request.delta_y,
    });
  }
  if (request.action === "key") {
    await presentControl(tab, "type");
    if (request.key === "SelectAll") await selectAll(tab);
    else {
      const codes = {
        Enter: 13,
        Tab: 9,
        Escape: 27,
        Backspace: 8,
        ArrowUp: 38,
        ArrowDown: 40,
        ArrowLeft: 37,
        ArrowRight: 39,
        Home: 36,
        End: 35,
        PageUp: 33,
        PageDown: 34,
      };
      await cdp(tab, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: request.key,
        windowsVirtualKeyCode: codes[request.key],
      });
      await cdp(tab, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: request.key,
        windowsVirtualKeyCode: codes[request.key],
      });
    }
  }
  return { ok: true, browser: "local", data: await tabData(tab) };
}
async function connect(): Promise<void> {
  const previous = generation;
  const session = sessionSchema.parse(
    (await chrome.storage.session.get("session")).session,
  );
  if (previous !== generation) throw new Error("LOCAL_BROWSER_CANCELLED");
  const url = connectionEndpoint(session.endpoint);
  await chrome.storage.session.set({ connected: false });
  if (previous !== generation) throw new Error("LOCAL_BROWSER_CANCELLED");
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname += "/socket";
  const current = ++generation;
  socket?.close();
  const ws = new WebSocket(url);
  let connectionId: string | undefined;
  socket = ws;
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send('"ping"');
  }, 20_000);
  ws.onopen = () => {
    if (current !== generation) return;
    ws.send(
      JSON.stringify({
        token: session.token,
        browser: navigator.userAgent.includes("Edg/") ? "edge" : "chrome",
      }),
    );
  };
  ws.onmessage = (event: MessageEvent<unknown>) => {
    if (current !== generation) return;
    if (typeof event.data !== "string" || event.data.length > 20_000) {
      ws.close();
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      ws.close();
      return;
    }
    if (value === "pong") return;
    const cancellation = z
      .strictObject({ type: z.literal("cancel"), id: z.uuid() })
      .safeParse(value);
    if (cancellation.success) {
      if (queued.has(cancellation.data.id)) cancelled.add(cancellation.data.id);
      if (executing?.command.id === cancellation.data.id)
        executing.controller.abort("LOCAL_BROWSER_CANCELLED");
      return;
    }
    const ready = z
      .object({ type: z.literal("ready"), connection_id: z.uuid() })
      .safeParse(value);
    if (ready.success) {
      reconnectAttempts = 0;
      connectionId = ready.data.connection_id;
      void chrome.storage.session.set({ connected: true });
      void chrome.action.setBadgeText({ text: "ON" });
      return;
    }
    const command = localBrowserCommandSchema.safeParse(value);
    if (!command.success || command.data.connection_id !== connectionId) {
      ws.close();
      return;
    }
    queued.add(command.data.id);
    queue = queue
      .then(async () => {
        if (current !== generation || ws.readyState !== WebSocket.OPEN) {
          queued.delete(command.data.id);
          cancelled.delete(command.data.id);
          return;
        }
        let result: LocalBrowserResult;
        const controller = new AbortController();
        executing = { command: command.data, generation: current, controller };
        const deadline = setTimeout(
          () => controller.abort("LOCAL_BROWSER_TIMEOUT"),
          Math.max(0, command.data.expires_at - Date.now()),
        );
        try {
          if (cancelled.has(command.data.id))
            throw new Error("LOCAL_BROWSER_CANCELLED");
          result = await run(command.data);
          if (result.ok && result.data.tab_id && command.data.request.action !== "release") {
            // A failed thumbnail must never turn a completed browser mutation into a retryable action.
            await rememberPreview(command.data, result.data.tab_id).catch(() => undefined);
          }
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          result = localBrowserFailure(
            localBrowserFailureCodes.find((item) => item === code) ??
              "LOCAL_BROWSER_COMMAND_FAILED",
          );
        } finally {
          await finishControl(command.data.id, controller.signal.aborted).catch(() => undefined);
          clearTimeout(deadline);
          executing = undefined;
        }
        const resultTab = result.ok ? result.data.tab_id : undefined;
        if (resultTab && command.data.request.action !== "release") {
          const retained = (await grants()).some(
            (grant) =>
              grant.tab_id === resultTab &&
              grant.conversation_id === command.data.conversation_id,
          );
          if (!retained)
            result = localBrowserFailure("LOCAL_BROWSER_ACCESS_DENIED");
        }
        queued.delete(command.data.id);
        cancelled.delete(command.data.id);
        if (current === generation && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ id: command.data.id, result }));
      })
      .catch(() => ws.close());
  };
  ws.onclose = (event: CloseEvent) => {
    clearInterval(heartbeat);
    if (current !== generation) return;
    generation++;
    socket = undefined;
    executing?.controller.abort("LOCAL_BROWSER_CANCELLED");
    void chrome.storage.session.set({ connected: false });
    void chrome.action.setBadgeText({ text: "" });
    for (const tab of attached) void detach(tab);
    if (event.code === 4403) {
      automaticBlocked = true;
      const cleanup = connectionQueue.then(async () => { await disableAutomatic(true); await stop(); });
      connectionQueue = cleanup.catch(() => {});
    } else if (event.code === 4401) {
      void chrome.storage.session.remove("session");
    } else if (!automaticBlocked && reconnectAttempts < 6) {
      const retryGeneration = generation;
      const wait = Math.min(1000 * 2 ** reconnectAttempts++, 30_000);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (generation === retryGeneration)
          void connect().catch(() => chrome.action.setBadgeText({ text: "" }));
      }, wait);
    }
  };
  ws.onerror = () => ws.close();
}

async function acceptPairing(
  pairing: z.infer<typeof pairingSchema>,
  newTabs: boolean,
  assertCurrent: () => void,
  automatic = false,
): Promise<void> {
  pairingInFlight = true;
  try {
    const source = await chrome.tabs.get(pairing.source_tab);
    if (!source.url || new URL(source.url).origin !== pairing.source_origin)
      throw new Error("denied");
    assertCurrent();
    // Close our old transport before exchanging its replacement, so revocation cannot disable this approved renewal.
    invalidateConnection();
    const trust = automatic ? await trustedSite() : undefined;
    assertCurrent();
    if (automatic && !trust?.approval_id) throw new Error("denied");
    const response = await fetch(`${connectionEndpoint(pairing.endpoint).href}/pair`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairing.code, ...(automatic ? { approval_id: trust?.approval_id } : {}) }), signal: AbortSignal.timeout(10_000),
      credentials: "omit", redirect: "error",
    });
    if (!response.ok) {
      if (automatic && [401, 403].includes(response.status)) { await disableAutomatic(true); await stop(); }
      throw new Error("denied");
    }
    const credential = localBrowserPairResponseSchema.parse(await response.json());
    if (pairing.owner_id && credential.owner_id !== pairing.owner_id)
      throw new Error("denied");
    assertCurrent();
    const grantOwner = (await chrome.storage.session.get("grant_owner_id")).grant_owner_id;
    assertCurrent();
    await stop(automatic && Boolean(credential.owner_id) && grantOwner === credential.owner_id);
    assertCurrent();
    await chrome.storage.session.set({
      session: {
        endpoint: pairing.endpoint, token: credential.token, new_tabs: newTabs,
        ...(credential.owner_id ? { owner_id: credential.owner_id } : {}),
      },
      ...(credential.owner_id ? { grant_owner_id: credential.owner_id } : {}),
    });
    if (credential.owner_id) {
      await chrome.storage.local.set({ trust: {
        origin: pairing.source_origin, owner_id: credential.owner_id,
        new_tabs: newTabs, enabled: true,
        ...(credential.approval_id ? { approval_id: credential.approval_id } : {}),
      } });
    }
    assertCurrent();
    automaticBlocked = false;
    reconnectAttempts = 0;
    await connect();
  } finally {
    pairingInFlight = false;
  }
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  const parsed = z
    .object({
      type: z.enum([
        "detect",
        "pair",
        "popup_status",
        "connect",
        "allow",
        "release",
        "disconnect",
        "preferences",
        "preview",
        "activate",
        "stop_control",
        "open_extensions",
      ]),
      pairing: localBrowserPairingSchema.optional(),
      new_tabs: z.boolean().optional(),
      origin: z.url().optional(),
      owner_id: z.uuid().optional(),
      automatic: z.boolean().optional(),
      resume: z.boolean().optional(),
      conversation_id: z.uuid().optional(),
      tab_id: z.number().int().positive().optional(),
    })
    .safeParse(raw);
  if (!parsed.success) {
    respond({ ok: false });
    return false;
  }
  const message = parsed.data;
  const controlsConnection =
    sender.url === chrome.runtime.getURL("popup.html") &&
    (message.type === "connect" || message.type === "disconnect" || message.type === "preferences");
  const intent = controlsConnection ? ++connectionIntent : undefined;
  const assertCurrentConnection = () => {
    if (intent !== connectionIntent) throw new Error("LOCAL_BROWSER_CANCELLED");
  };
  if (controlsConnection && message.type === "disconnect") {
    automaticBlocked = true;
    invalidateConnection();
  }
  const handle = async () => {
    if (message.type === "open_extensions") {
      if (!sender.tab?.id || sender.frameId !== 0 || !sender.url || !message.owner_id) throw new Error("denied");
      const source = await chrome.tabs.get(sender.tab.id);
      if (!source.url) throw new Error("denied");
      const url = new URL(source.url);
      if (url.origin === "null" || new URL(sender.url).origin !== url.origin || !url.pathname.endsWith("/settings/general")) throw new Error("denied");
      const stored = await chrome.storage.session.get(["session", "pending"]);
      const session = sessionSchema.safeParse(stored.session);
      const pending = pairingSchema.safeParse(stored.pending);
      const trust = await trustedSite();
      const known = (session.success && session.data.owner_id === message.owner_id && new URL(session.data.endpoint).origin === url.origin) ||
        (pending.success && pending.data.owner_id === message.owner_id && pending.data.source_origin === url.origin) ||
        (trust?.owner_id === message.owner_id && trust.origin === url.origin);
      if (!known) throw new Error("denied");
      await chrome.tabs.create({ url: navigator.userAgent.includes("Edg/") ? "edge://extensions/" : "chrome://extensions/", active: true });
      return { detected: true, ok: true };
    }
    if (message.type === "stop_control") {
      const tab = sender.tab?.id;
      if (!tab || !sender.url || !(await grants()).some(grant => grant.tab_id === tab)) throw new Error("denied");
      await stopSharing(tab);
      return { ok: true };
    }
    if (message.type === "preview" || message.type === "activate") {
      if (!sender.tab?.id || sender.frameId !== 0 || !sender.url || !message.owner_id || !message.conversation_id)
        throw new Error("denied");
      const session = sessionSchema.parse((await chrome.storage.session.get("session")).session);
      // MessageSender.url can retain the document's initial path after SPA navigation.
      const source = await chrome.tabs.get(sender.tab.id);
      const sourceUrl = source.url ? new URL(source.url) : undefined;
      const origin = new URL(session.endpoint).origin;
      if (session.owner_id !== message.owner_id || new URL(sender.url).origin !== origin ||
          sourceUrl?.origin !== origin || !sourceUrl.pathname.endsWith(`/conversations/${message.conversation_id}`) ||
          socket?.readyState !== WebSocket.OPEN) throw new Error("denied");
      const entry = (await previews()).find(item => item.owner_id === message.owner_id && item.conversation_id === message.conversation_id);
      if (!entry) return { detected: true, ok: true };
      const granted = async () => (await grants()).some(grant => grant.tab_id === entry.preview.tab_id && grant.conversation_id === message.conversation_id);
      if (!await granted()) return { detected: true, ok: true };
      const tab = await chrome.tabs.get(entry.preview.tab_id);
      if (!tab.url || tab.incognito || webUrl(tab.url).origin === new URL(session.endpoint).origin)
        return { detected: true, ok: true };
      if (message.type === "preview") return { detected: true, ok: true, preview: entry.preview };
      if (message.tab_id !== tab.id || !await granted()) throw new Error("denied");
      await chrome.tabs.update(tab.id, { active: true });
      if (!await granted()) throw new Error("denied");
      await chrome.windows.update(tab.windowId, { focused: true });
      return { detected: true, ok: true };
    }
    if (message.type === "detect") {
      if (!message.owner_id || !sender.url || !sender.tab?.id) return { detected: true };
      if (pairingInFlight) return { detected: true, pairing_mode: "reconnecting" };
      const origin = new URL(sender.url).origin;
      const trust = await trustedSite();
      const stored = await chrome.storage.session.get(["pending", "session", "connected"]);
      const approved = trust?.origin === origin && trust.owner_id === message.owner_id;
      if (approved && (!trust.enabled || automaticBlocked))
        return { detected: true, pairing_mode: "blocked" };
      const session = sessionSchema.safeParse(stored.session);
      if (session.success && new URL(session.data.endpoint).origin === origin && session.data.owner_id === message.owner_id) {
        if (socket?.readyState === WebSocket.OPEN && stored.connected)
          return { detected: true, pairing_mode: "connected" };
        if (message.resume) reconnectAttempts = 0;
        if (!socket && !reconnectTimer && reconnectAttempts < 6) await connect();
        return { detected: true, pairing_mode: "reconnecting" };
      }
      const pending = pairingSchema.safeParse(stored.pending);
      if (pending.success && pending.data.source_origin === origin && pending.data.owner_id === message.owner_id &&
          Date.now() - (pending.data.requested_at ?? 0) < 120_000)
        return { detected: true, pairing_mode: "pending" };
      return { detected: true, pairing_mode: approved && trust.approval_id ? "automatic" : "confirmation" };
    }
    if (message.type === "pair") {
      if (!sender.tab?.id || !sender.url || !message.pairing)
        throw new Error("denied");
      const origin = new URL(sender.url).origin;
      const endpoint = connectionEndpoint(message.pairing.endpoint);
      if (endpoint.origin !== origin ||
          (!message.owner_id && !new URL(sender.url).pathname.endsWith("/settings/general")))
        throw new Error("denied");
      const pairing = {
        ...message.pairing, source_tab: sender.tab.id, source_origin: origin,
        ...(message.owner_id ? { owner_id: message.owner_id } : {}), requested_at: Date.now(),
      };
      const trust = await trustedSite();
      if (message.automatic && trust?.approval_id && trust.origin === origin && trust.owner_id === message.owner_id) {
        if (!trust.enabled || automaticBlocked) return { detected: true, ok: false };
        const automaticIntent = ++connectionIntent;
        const check = () => {
          if (automaticIntent !== connectionIntent || automaticBlocked) throw new Error("denied");
        };
        const operation = connectionQueue.then(async () => {
          check();
          try { await acceptPairing(pairing, trust.new_tabs, check, true); }
          finally { if (automaticIntent !== connectionIntent) await stop(); }
        });
        connectionQueue = operation.catch(() => {});
        await operation;
        return { detected: true, ok: true };
      }
      const previousPending = pairingSchema.safeParse((await chrome.storage.session.get("pending")).pending);
      await chrome.storage.session.set({
        pending: pairing,
      });
      if (!message.automatic || !previousPending.success || previousPending.data.source_origin !== origin ||
          previousPending.data.owner_id !== message.owner_id)
        await chrome.action.openPopup().catch(() => undefined);
      return { detected: true, ok: true };
    }
    if (sender.url !== chrome.runtime.getURL("popup.html"))
      throw new Error("denied");
    const stored = await chrome.storage.session.get([
      "pending",
      "session",
      "connected",
    ]);
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (message.type === "popup_status") {
      const session = sessionSchema.safeParse(stored.session);
      const trust = await trustedSite();
      const endpoint = stored.pending ? pairingSchema.parse(stored.pending).endpoint : session.success ? session.data.endpoint : trust?.origin;
      let canAllow = false;
      try {
        canAllow = Boolean(tab?.id && tab.url && !tab.incognito && endpoint &&
          webUrl(tab.url).origin !== new URL(endpoint).origin);
      } catch { /* Internal browser pages cannot be shared. */ }
      return {
        connected:
          stored.connected === true && socket?.readyState === WebSocket.OPEN,
        ...(stored.pending
          ? {
              pending_origin: pairingSchema.parse(stored.pending).source_origin,
            }
          : {}),
        ...(stored.session
          ? {
              origin: new URL(sessionSchema.parse(stored.session).endpoint)
                .origin,
            }
          : trust ? { origin: trust.origin } : {}),
        allowed: (await grants()).some((grant) => grant.tab_id === tab?.id),
        can_allow: canAllow,
        reconnecting: pairingInFlight || reconnectTimer !== undefined || socket?.readyState === WebSocket.CONNECTING,
        new_tabs: session.success ? session.data.new_tabs : false,
        page_title: tab?.title?.slice(0, 200) ?? "",
        page_host: canAllow && tab?.url ? new URL(tab.url).host : "",
      };
    }
    if (message.type === "disconnect") {
      await disableAutomatic();
      await stop();
      return { ok: true };
    }
    if (message.type === "connect") {
      if (!stored.pending && !stored.session) {
        const trust = await trustedSite();
        if (!trust || message.origin !== trust.origin) throw new Error("denied");
        assertCurrentConnection();
        await chrome.storage.local.set({ trust: { ...trust, enabled: true } });
        automaticBlocked = false;
        const pages = await chrome.tabs.query({});
        const page = pages.find(item => {
          try { return item.url && new URL(item.url).origin === trust.origin; }
          catch { return false; }
        });
        if (page?.id) await chrome.tabs.sendMessage(page.id, { type: "linksense-reconnect" }).catch(() => undefined);
        else await chrome.tabs.create({ url: `${trust.origin}/conversations/new` });
        return { ok: true };
      }
      if (!stored.pending && stored.session) {
        if (
          message.origin !==
          new URL(sessionSchema.parse(stored.session).endpoint).origin
        ) throw new Error("denied");
        assertCurrentConnection();
        automaticBlocked = false;
        reconnectAttempts = 0;
        await connect();
        return { ok: true };
      }
      const pairing = pairingSchema.parse(stored.pending);
      if (message.origin !== pairing.source_origin) throw new Error("denied");
      await acceptPairing(pairing, message.new_tabs === true, assertCurrentConnection);
      return { ok: true };
    }
    if (message.type === "preferences") {
      const session = sessionSchema.parse(stored.session);
      if (message.origin !== new URL(session.endpoint).origin || message.new_tabs === undefined)
        throw new Error("denied");
      if (!message.new_tabs && executing?.command.request.action === "open")
        executing.controller.abort("LOCAL_BROWSER_CANCELLED");
      await chrome.storage.session.set({ session: { ...session, new_tabs: message.new_tabs } });
      const trust = await trustedSite();
      if (trust && trust.origin === new URL(session.endpoint).origin && trust.owner_id === session.owner_id)
        await chrome.storage.local.set({ trust: { ...trust, new_tabs: message.new_tabs } });
      return { ok: true };
    }
    if (!tab?.id || !tab.url || tab.incognito) throw new Error("denied");
    if (message.type === "allow") {
      const session = sessionSchema.parse(stored.session);
      if (
        !stored.connected ||
        webUrl(tab.url).origin === new URL(session.endpoint).origin
      )
        throw new Error("denied");
      await mutateGrants((current) =>
        current.some((grant) => grant.tab_id === tab.id)
          ? current
          : [...current, { tab_id: tab.id!, conversation_id: null }],
      );
    } else {
      await stopSharing(tab.id);
    }
    return { ok: true };
  };
  const run = async () => {
    if (controlsConnection) assertCurrentConnection();
    try {
      return await handle();
    } finally {
      if (controlsConnection && intent !== connectionIntent) await stop();
    }
  };
  // Serialize credential writes; a newer disconnect invalidates an in-flight pairing immediately.
  const operation = controlsConnection ? connectionQueue.then(run) : run();
  if (controlsConnection) connectionQueue = operation.then(() => {}, () => {});
  void operation.then(respond, () => respond({ ok: false }));
  return true;
});
chrome.tabs.onRemoved.addListener((tab) => {
  cancelTab(tab);
  attached.delete(tab);
  controlled.delete(tab);
  void mutateGrants((current) =>
    current.filter((grant) => grant.tab_id !== tab),
  ).catch(() => undefined);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  void (async () => {
    const stored = await chrome.storage.session.get("session");
    if (!stored.session) return;
    let prohibited: boolean;
    try {
      prohibited =
        webUrl(change.url!).origin ===
        new URL(sessionSchema.parse(stored.session).endpoint).origin;
    } catch {
      prohibited = true;
    }
    if (!prohibited) return;
    cancelTab(tabId);
    await mutateGrants((current) =>
      current.filter((grant) => grant.tab_id !== tabId),
    );
    await detach(tabId);
  })().catch(() => undefined);
});
chrome.debugger.onDetach.addListener((source) => {
  if (!source.tabId) return;
  cancelTab(source.tabId);
  attached.delete(source.tabId);
  void hideControl(source.tabId);
  void mutateGrants((current) =>
    current.filter((grant) => grant.tab_id !== source.tabId),
  ).catch(() => undefined);
});
// Browser restarts clear session credentials and grants; reconnection requires explicit user consent.
