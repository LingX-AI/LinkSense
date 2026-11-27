/** This code runs only in the trusted shell, never in a generated application's realm. */
export const publicAppShellScript = String.raw`(() => {
  "use strict";
  if (window.top !== window.self) return;
  const config = JSON.parse(document.getElementById("app-config").textContent);
  const frame = document.querySelector("iframe");
  let active = null;
  let generation = 0;
  let controller = new AbortController();
  frame.addEventListener("load", () => {
    generation++;
    if (active) active.close();
    active = null;
    controller.abort();
    controller = new AbortController();
  });
  window.addEventListener("pagehide", () => { controller.abort(); if (active) active.close(); });
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.origin !== "null" || active ||
        event.data?.protocol !== "linksense.public.v1" ||
        event.ports.length !== 1) return;
    const port = event.ports[0];
    active = port;
    const current = generation;
    let pending = 0;
    port.onmessage = async (packet) => {
      const message = packet.data;
      if (active !== port || current !== generation || !message ||
          typeof message.id !== "string" || message.id.length > 80) return;
      if (pending >= 8) {
        port.postMessage({ id: message.id, ok: false, error: { error_code: "CONFLICT" } });
        return;
      }
      pending++;
      try {
        let body, endpoint = config.endpoint;
        const headers = { "x-linksense-app-capability": config.capability };
        if (message.operation === "upload") {
          if (!(message.file instanceof Blob) || message.file.size > 20 * 1024 * 1024 ||
              typeof message.bucketId !== "string" || typeof message.fileId !== "string" ||
              typeof message.name !== "string") throw new Error("VALIDATION_ERROR");
          endpoint += "/upload/" + encodeURIComponent(message.bucketId) + "/" + encodeURIComponent(message.fileId);
          headers["content-type"] = "application/octet-stream";
          headers["x-linksense-file-name"] = encodeURIComponent(message.name);
          headers["x-linksense-file-type"] = message.file.type || "application/octet-stream";
          body = message.file;
        } else if (message.operation === "request") {
          body = JSON.stringify(message.request);
          if (body.length > 2 * 1024 * 1024) throw new Error("FILE_LIMIT_EXCEEDED");
          headers["content-type"] = "application/json";
        } else throw new Error("FORBIDDEN");
        const response = await fetch(endpoint, {
          method: "POST", headers, body, credentials: "same-origin", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(message.operation === "upload" ? 150000 : 35000)]),
        });
        if (response.status === 204) {
          if (active === port && current === generation) port.postMessage({ id: message.id, ok: true });
          return;
        }
        const json = (!response.ok || !message.binary) && (response.headers.get("content-type") || "").includes("application/json");
        const data = json ? await response.json() : await response.arrayBuffer();
        if (active !== port || current !== generation) return;
        if (!response.ok) port.postMessage({ id: message.id, ok: false, error: data });
        else if (json) port.postMessage({ id: message.id, ok: true, data });
        else port.postMessage({ id: message.id, ok: true, bytes: data,
          contentType: response.headers.get("content-type") }, [data]);
      } catch (error) {
        if (active === port && current === generation)
          port.postMessage({ id: message.id, ok: false, error: {
            error_code: ["VALIDATION_ERROR", "FORBIDDEN", "FILE_LIMIT_EXCEEDED"].includes(error.message)
              ? error.message : "WEB_SITE_BACKEND_UNAVAILABLE"
          } });
      } finally { pending--; }
    };
    port.start();
    port.postMessage({ ready: true });
  });
  frame.src = config.path;
})();`;

/** A public-app-only SDK; it never receives the broker capability or native session. */
export const publicAppSdkScript = String.raw`(() => {
  "use strict";
  if (globalThis.LinkSenseApp) return;
  const script = document.currentScript;
  const target = new URL(script.src).origin;
  let port, sequence = 0, connected = false;
  const pending = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  const readyTimeout = setTimeout(() => readyReject(new Error("LINKSENSE_SDK_NOT_READY")), 15000);
  function start() {
    if (parent === self) {
      clearTimeout(readyTimeout); readyReject(new Error("LINKSENSE_SDK_NOT_READY")); return;
    }
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (event) => {
      const value = event.data;
      if (value?.ready === true && !connected) {
        connected = true; clearTimeout(readyTimeout); readyResolve(); return;
      }
      const operation = pending.get(value?.id);
      if (!operation) return;
      pending.delete(value.id); clearTimeout(operation.timeout);
      if (!value.ok) {
        const error = new Error(value.error?.message || value.error?.error_code || "WEB_SITE_BACKEND_UNAVAILABLE");
        error.code = value.error?.error_code;
        operation.reject(error);
      } else operation.resolve(value.bytes instanceof ArrayBuffer
        ? new Blob([value.bytes], { type: value.contentType || "application/octet-stream" }) : value.data);
    };
    port.start();
    parent.postMessage({ protocol: "linksense.public.v1" }, target, [channel.port2]);
  }
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
  window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
  async function send(message) {
    await ready;
    if (pending.size >= 8) throw new Error("CONFLICT");
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id); reject(new Error("WEB_SITE_BACKEND_UNAVAILABLE"));
      }, message.operation === "upload" ? 160000 : 40000);
      pending.set(id, { resolve, reject, timeout });
      try { port.postMessage({ ...message, id }); }
      catch (error) { pending.delete(id); clearTimeout(timeout); reject(error); }
    });
  }
  function request(path, options = {}) {
    return send({ operation: "request", request: {
      path, method: options.method || "GET", ...(options.body !== undefined ? { body: options.body } : {})
    } });
  }
  const id = (value) => encodeURIComponent(value);
  const rows = (table) => "/tablesdb/app/tables/" + id(table) + "/rows";
  const filePath = (bucket, file) => "/storage/buckets/" + id(bucket) + "/files/" + id(file);
  globalThis.LinkSenseApp = Object.freeze({
    version: "1.0.0", ready: () => ready, request,
    account: Object.freeze({
      create: (input) => request("/account", { method: "POST", body: { userId: "unique()", ...input } }),
      get: () => request("/account"),
      login: (input) => request("/account/sessions/email", { method: "POST", body: input }),
      anonymous: () => request("/account/sessions/anonymous", { method: "POST", body: {} }),
      logout: () => request("/account/sessions/current", { method: "DELETE" }),
    }),
    tables: Object.freeze({
      list: (table, queries = []) => {
        const search = new URLSearchParams();
        for (const query of queries) search.append("queries[]", query);
        return request(rows(table) + (search.size ? "?" + search : ""));
      },
      get: (table, row) => request(rows(table) + "/" + id(row)),
      create: (table, data, permissions, rowId = "unique()") =>
        request(rows(table), { method: "POST", body: { rowId, data,
          ...(permissions !== undefined ? { permissions } : {}) } }),
      update: (table, row, data) => request(rows(table) + "/" + id(row), { method: "PATCH", body: { data } }),
      delete: (table, row) => request(rows(table) + "/" + id(row), { method: "DELETE" }),
    }),
    storage: Object.freeze({
      upload: (bucketId, file, fileId = "unique()") => send({
        operation: "upload", bucketId, fileId, file, name: file.name || "upload"
      }),
      download: (bucket, file) => send({ operation: "request", binary: true,
        request: { path: filePath(bucket, file) + "/download", method: "GET" } }),
      delete: (bucket, file) => request(filePath(bucket, file), { method: "DELETE" }),
    }),
    functions: Object.freeze({
      execute: (fn, input = {}) => request("/functions/" + id(fn) + "/executions",
        { method: "POST", body: { ...input, async: false } }),
    }),
  });
})();`;
