export const interactiveApplicationSdkV1 = String.raw`(() => {
  "use strict";
  const protocol = "linksense.interactive.v1";
  let instanceId = null;
  let requestSequence = 0;
  const pending = new Map();
  const listeners = new Map();
  const bufferedEvents = new Map();
  const seenEventIds = new Set();

  function post(message) {
    window.parent.postMessage({ protocol, instanceId, ...message }, "*");
  }

  function request(method, params = {}) {
    if (!instanceId) {
      return Promise.reject(new Error("LINKSENSE_SDK_NOT_READY"));
    }
    const requestId = String(++requestSequence);
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      post({ type: "request", requestId, method, params });
    });
  }

  function on(name, handler) {
    if (typeof name !== "string" || typeof handler !== "function") {
      throw new TypeError("LinkSense.events.on requires an event name and handler");
    }
    const current = listeners.get(name) || new Set();
    current.add(handler);
    listeners.set(name, current);
    const buffered = bufferedEvents.get(name) || [];
    bufferedEvents.delete(name);
    for (const event of buffered) invokeHandler(handler, event);
    return () => {
      current.delete(handler);
      if (current.size === 0) listeners.delete(name);
    };
  }

  function invokeHandler(handler, event) {
    try { handler(event); } catch (error) {
      queueMicrotask(() => { throw error; });
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.protocol !== protocol) return;
    if (message.type === "initialize") {
      instanceId = message.instanceId;
      post({ type: "initialized" });
      window.dispatchEvent(new CustomEvent("linksense:ready"));
      return;
    }
    if (!instanceId || message.instanceId !== instanceId) return;
    if (message.type === "response") {
      const operation = pending.get(message.requestId);
      if (!operation) return;
      pending.delete(message.requestId);
      if (message.ok) operation.resolve(message.result);
      else operation.reject(new Error(message.error || "LINKSENSE_SDK_REQUEST_FAILED"));
      return;
    }
    if (message.type === "custom-event") {
      if (
        typeof message.name !== "string" ||
        !message.event ||
        typeof message.event.id !== "string" ||
        seenEventIds.has(message.event.id)
      ) return;
      seenEventIds.add(message.event.id);
      const handlers = listeners.get(message.name);
      if (!handlers || handlers.size === 0) {
        const buffered = bufferedEvents.get(message.name) || [];
        buffered.push(message.event);
        bufferedEvents.set(message.name, buffered);
        return;
      }
      for (const handler of handlers) invokeHandler(handler, message.event);
    }
  });

  const api = Object.freeze({
    version: "1.0.0",
    ready: () => instanceId
      ? Promise.resolve()
      : new Promise((resolve) => window.addEventListener("linksense:ready", resolve, { once: true })),
    context: Object.freeze({
      getCurrentUser: () => request("context.getCurrentUser"),
    }),
    resources: Object.freeze({
      listCapabilities: () => request("resources.listCapabilities"),
      listKnowledgeBases: () => request("resources.listKnowledgeBases"),
      listMcpServers: () => request("resources.listMcpServers"),
    }),
    tasks: Object.freeze({
      run: (input) => request("tasks.run", input),
      interrupt: (turnId) => request("tasks.interrupt", { turnId }),
    }),
    chat: Object.freeze({
      show: () => request("chat.show"),
      hide: () => request("chat.hide"),
      toggle: () => request("chat.toggle"),
    }),
    events: Object.freeze({ on }),
  });

  Object.defineProperty(window, "LinkSense", {
    value: api,
    configurable: false,
    enumerable: true,
    writable: false,
  });
  post({ type: "ready" });
})();
`;
