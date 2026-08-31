import { createServer } from "node:http";
import { URL } from "node:url";

const DEFAULT_PORT = 5055;
const DEFAULT_LINKSENSE_BASE_URL = "http://localhost:5173";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function createExternalEmbedDemoServer(options = {}) {
  const baseConfig = resolveDemoConfig(options.env ?? process.env, options);
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", requestOrigin(request));
      if (request.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/demo.css") {
        sendText(response, 200, demoCss(), "text/css; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/demo.js") {
        sendText(
          response,
          200,
          demoJavaScript(),
          "text/javascript; charset=utf-8",
        );
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/config") {
        const mode = embedMode(requestUrl.searchParams.get("mode"));
        const config = requestScopedConfig(
          baseConfig,
          request,
          mode,
          requestUrl.searchParams.get("locale"),
        );
        sendJson(response, 200, publicConfig(config));
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/linksense-ticket"
      ) {
        const config = requestScopedConfig(baseConfig, request, "required");
        const ticket = await requestLinkSenseTicket(config);
        sendJson(
          response,
          ticket?.error && Number.isInteger(ticket.status)
            ? ticket.status
            : 200,
          ticket,
        );
        return;
      }
      if (request.method === "GET" && isDemoPagePath(requestUrl.pathname)) {
        const mode = pageMode(requestUrl.pathname);
        const config = requestScopedConfig(
          baseConfig,
          request,
          mode,
          requestUrl.searchParams.get("locale"),
        );
        sendHtml(response, demoHtml(config));
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 500, {
        error: "external_demo_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}

export function resolveDemoConfig(env = process.env, overrides = {}) {
  const linksenseBaseUrl = normalizeOrigin(
    overrides.linksenseBaseUrl ??
      env.LINKSENSE_BASE_URL ??
      DEFAULT_LINKSENSE_BASE_URL,
    "LINKSENSE_BASE_URL",
  );
  return {
    port: numberValue(overrides.port ?? env.PORT, DEFAULT_PORT),
    linksenseBaseUrl,
    linksenseApiBaseUrl: normalizeOrigin(
      overrides.linksenseApiBaseUrl ??
        env.LINKSENSE_API_BASE_URL ??
        linksenseBaseUrl,
      "LINKSENSE_API_BASE_URL",
    ),
    configuredParentOrigin:
      overrides.parentOrigin ?? env.LINKSENSE_PARENT_ORIGIN ?? null,
    appId: overrides.appId ?? env.LINKSENSE_APP_ID ?? "",
    appSecret: overrides.appSecret ?? env.LINKSENSE_APP_SECRET ?? "",
    externalSubject:
      overrides.externalSubject ??
      env.LINKSENSE_EXTERNAL_SUBJECT ??
      "external-demo-user",
    externalTenant:
      overrides.externalTenant ??
      env.LINKSENSE_EXTERNAL_TENANT ??
      "external-demo-tenant",
    displayName: overrides.displayName ?? env.LINKSENSE_DISPLAY_NAME ?? "外部用户",
    locale: embedLocale(overrides.locale ?? env.LINKSENSE_LOCALE),
  };
}

function requestScopedConfig(baseConfig, request, mode, localeOverride = null) {
  const parentOrigin =
    baseConfig.configuredParentOrigin ?? requestOrigin(request);
  return {
    ...baseConfig,
    mode,
    locale:
      localeOverride === null ? baseConfig.locale : embedLocale(localeOverride),
    parentOrigin: normalizeOrigin(parentOrigin, "LINKSENSE_PARENT_ORIGIN"),
    linksenseOrigin: new URL(baseConfig.linksenseBaseUrl).origin,
  };
}

function publicConfig(config) {
  return {
    mode: config.mode,
    app_id: config.appId,
    parent_origin: config.parentOrigin,
    linksense_origin: config.linksenseOrigin,
    linksense_base_url: config.linksenseBaseUrl,
    iframe_url: iframeUrl(config),
    locale: config.locale,
    ticket_endpoint_available:
      config.mode === "required" && Boolean(config.appId && config.appSecret),
  };
}

async function requestLinkSenseTicket(config) {
  assertConfigured(config.appId, "LINKSENSE_APP_ID");
  assertConfigured(config.appSecret, "LINKSENSE_APP_SECRET");
  const response = await fetch(
    `${config.linksenseApiBaseUrl}/api/v1/embed/tickets`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
        origin: config.parentOrigin,
        external_subject: config.externalSubject,
        external_tenant: config.externalTenant,
        display_name: config.displayName,
      }),
    },
  );
  const payload = await safeJson(response);
  if (!response.ok || payload?.success !== true) {
    return {
      error: "linksense_ticket_failed",
      status: response.status,
      error_code: payload?.error?.code ?? payload?.error_code ?? null,
      message: payload?.error?.message ?? payload?.message ?? response.statusText,
    };
  }
  return payload.data;
}

function iframeUrl(config) {
  assertConfigured(config.appId, "LINKSENSE_APP_ID");
  const url = new URL(
    `/api/v1/embed/frame/${config.appId}`,
    config.linksenseBaseUrl,
  );
  url.searchParams.set("parent_origin", config.parentOrigin);
  url.searchParams.set("locale", config.locale);
  return url.toString();
}

function demoHtml(config) {
  const title =
    config.mode === "required"
      ? "LinkSense 外部接入 Demo - 需要认证"
      : "LinkSense 外部接入 Demo - 不需要认证";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/demo.css" />
  </head>
  <body data-mode="${config.mode}">
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Third-party system mock</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="lead">
          这个页面模拟第三方系统自己的业务页面，LinkSense 应用只作为 iframe 嵌入。
        </p>
        <nav class="mode-switch" aria-label="接入模式">
          <a href="/required" ${config.mode === "required" ? 'aria-current="page"' : ""}>需要认证</a>
          <a href="/public" ${config.mode === "public" ? 'aria-current="page"' : ""}>不需要认证</a>
        </nav>
        <div class="locale-switch" role="group" aria-label="通过 postMessage 切换嵌入页语言">
          <span>运行时语言</span>
          <button type="button" data-locale="zh-CN" aria-pressed="${config.locale === "zh-CN"}">中文</button>
          <button type="button" data-locale="en-US" aria-pressed="${config.locale === "en-US"}">English</button>
        </div>
      </section>

      <section class="panel">
        <div>
          <h2>接入状态</h2>
          <p id="status" data-demo-status="booting">正在加载配置…</p>
        </div>
        <dl class="meta">
          <div><dt>模式</dt><dd>${config.mode === "required" ? "需要认证" : "不需要认证"}</dd></div>
          <div><dt>LinkSense</dt><dd>${escapeHtml(config.linksenseBaseUrl)}</dd></div>
          <div><dt>Parent Origin</dt><dd>${escapeHtml(config.parentOrigin)}</dd></div>
          <div><dt>Locale</dt><dd>${escapeHtml(config.locale)}</dd></div>
        </dl>
      </section>

      <section class="layout">
        <div class="iframe-card">
          <div class="card-title">嵌入的 LinkSense 应用</div>
          <iframe
            id="linksense-app"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            allow="clipboard-write"
            title="嵌入式 LinkSense 应用"
          ></iframe>
        </div>
        <aside class="log-card">
          <div class="card-title">事件日志</div>
          <ol id="events" aria-live="polite"></ol>
        </aside>
      </section>
    </main>
    <script type="module" src="/demo.js"></script>
  </body>
</html>`;
}

function demoJavaScript() {
  return String.raw`
const mode = document.body.dataset.mode === "public" ? "public" : "required";
const requestedLocale = new URLSearchParams(window.location.search).get("locale");
const frame = document.getElementById("linksense-app");
const statusEl = document.getElementById("status");
const eventsEl = document.getElementById("events");
const localeButtons = Array.from(document.querySelectorAll("[data-locale]"));
const ticketRetryDelays = [0, 1000, 2500, 5000, 8000];
let config = null;
let sessionStarted = false;
let ticketAttempt = 0;
let ticketRequestInFlight = false;
let ticketRetryTimer = null;

function setStatus(status, text) {
  statusEl.dataset.demoStatus = status;
  statusEl.textContent = text;
}

function log(message, detail) {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString();
  item.textContent = detail
    ? time + " " + message + ": " + JSON.stringify(detail)
    : time + " " + message;
  eventsEl.prepend(item);
}

function sendLocale(locale) {
  if (!config || (locale !== "zh-CN" && locale !== "en-US")) return;
  frame.contentWindow?.postMessage(
    {
      type: "linksense:locale",
      appId: config.app_id,
      locale,
    },
    config.linksense_origin,
  );
  localeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
  });
  log("locale sent to iframe", { locale });
}

localeButtons.forEach((button) => {
  button.addEventListener("click", () => sendLocale(button.dataset.locale));
});

async function jsonFetch(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload.error) {
    const message =
      payload?.message ??
      payload?.error?.message ??
      (typeof payload?.error === "string" ? payload.error : response.statusText);
    const error = new Error(message);
    error.status =
      typeof payload?.status === "number" ? payload.status : response.status;
    error.errorCode =
      payload?.error_code ??
      payload?.error?.code ??
      (typeof payload?.error === "string" ? payload.error : null);
    throw error;
  }
  return payload;
}

function ticketFailureDetails(error) {
  return {
    message:
      error instanceof Error && error.message
        ? error.message
        : "外部后端申请访问凭证失败",
    status: typeof error?.status === "number" ? error.status : null,
    error_code:
      typeof error?.errorCode === "string" ? error.errorCode : null,
  };
}

function isRetryableTicketFailure(failure) {
  if (
    failure.error_code === "APPLICATION_EXTERNAL_CREDENTIALS_INVALID" ||
    failure.error_code === "APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED" ||
    failure.status === 401 ||
    failure.status === 403 ||
    failure.status === 404
  ) {
    return false;
  }
  return (
    failure.status === null ||
    failure.status === 408 ||
    failure.status === 409 ||
    failure.status === 429 ||
    failure.status >= 500
  );
}

function ticketFailureMessage(failure) {
  if (
    failure.error_code === "APPLICATION_EXTERNAL_CREDENTIALS_INVALID" ||
    failure.status === 401 ||
    failure.status === 403
  ) {
    return "App ID 或 App Secret 无效，请复制当前应用的新 App Secret，并重启外部 demo 后端。";
  }
  if (failure.error_code === "APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED") {
    return "当前应用还没有开启对应的外部访问模式，请保存外部访问设置后重试。";
  }
  return failure.message || "外部后端申请访问凭证失败，请稍后重试。";
}

function failTicketAuthentication(failure) {
  const message = ticketFailureMessage(failure);
  setStatus("failed", message);
  log("ticket authentication failed", failure);
  if (config?.app_id && config?.linksense_origin) {
    frame.contentWindow?.postMessage(
      {
        type: "linksense:host-authentication-failed",
        appId: config.app_id,
        error_code: failure.error_code,
        status: failure.status,
        message,
      },
      config.linksense_origin,
    );
  }
}

async function requestTicket() {
  if (sessionStarted) return;
  if (ticketRequestInFlight) {
    log("ticket request skipped", { reason: "request already in flight" });
    return;
  }
  ticketRequestInFlight = true;
  setStatus("requesting-ticket", "正在通过外部后端换取一次性 ticket…");
  log("requesting ticket");
  try {
    const ticket = await jsonFetch("/api/linksense-ticket", {
      method: "POST",
    });
    if (!ticket.ticket) throw new Error("外部后端没有返回 ticket");
    if (sessionStarted) return;
    frame.contentWindow?.postMessage(
      {
        type: "linksense:ticket",
        appId: config.app_id,
        ticket: ticket.ticket,
      },
      config.linksense_origin,
    );
    sessionStarted = true;
    setStatus("ticket-delivered", "ticket 已发送，等待 LinkSense iframe 建立会话…");
    log("ticket delivered to iframe", { expires_at: ticket.expires_at ?? null });
  } finally {
    ticketRequestInFlight = false;
  }
}

function scheduleTicketRequest(reason) {
  if (mode !== "required" || sessionStarted || ticketRequestInFlight || ticketRetryTimer) {
    return;
  }
  if (ticketAttempt >= ticketRetryDelays.length) {
    failTicketAuthentication({
      message: "多次申请访问凭证失败，请稍后重试。",
      status: null,
      error_code: "TICKET_RETRY_EXHAUSTED",
    });
    log("ticket retry exhausted", { reason });
    return;
  }
  const attempt = ticketAttempt + 1;
  const delay = ticketRetryDelays[ticketAttempt];
  ticketAttempt += 1;
  if (delay > 0) {
    setStatus(
      "retrying-ticket",
      "LinkSense 暂时不可用，" + Math.round(delay / 1000) + " 秒后重新申请 ticket…"
    );
  }
  log("ticket request scheduled", { attempt, delay_ms: delay, reason });
  ticketRetryTimer = window.setTimeout(() => {
    ticketRetryTimer = null;
    void requestTicket().catch((error) => {
      const failure = ticketFailureDetails(error);
      log("ticket request failed", failure);
      if (!isRetryableTicketFailure(failure)) {
        failTicketAuthentication(failure);
        return;
      }
      scheduleTicketRequest("ticket request failed");
    });
  }, delay);
}

window.addEventListener("message", (event) => {
  if (!config || event.origin !== config.linksense_origin || event.source !== frame.contentWindow) {
    return;
  }
  const data = event.data;
  if (!data || typeof data !== "object" || data.appId !== config.app_id) {
    return;
  }
  log("message from iframe", data);
  if (data.type === "linksense:ready") {
    const iframeMode =
      data.authMode === "public"
        ? "public"
        : data.authMode === "required"
          ? "required"
          : null;
    if (iframeMode && iframeMode !== mode) {
      setStatus(
        "failed",
        mode === "public"
          ? "当前 LinkSense 应用仍配置为需要认证，请先在应用外部访问中切换为不需要认证，或使用需要认证模式接入。"
          : "当前 LinkSense 应用已配置为不需要认证，请使用不需要认证模式接入。",
      );
      log("embed mode mismatch", { page_mode: mode, iframe_auth_mode: iframeMode });
      return;
    }
    if (mode === "required") {
      sessionStarted = false;
      ticketAttempt = 0;
      if (ticketRetryTimer) {
        window.clearTimeout(ticketRetryTimer);
        ticketRetryTimer = null;
      }
      scheduleTicketRequest("iframe ready");
    } else {
      setStatus("waiting-session", "公共模式：iframe 已就绪，正在直接创建会话…");
    }
  }
});

try {
  const configQuery = new URLSearchParams({ mode });
  if (requestedLocale !== null) configQuery.set("locale", requestedLocale);
  config = await jsonFetch("/api/config?" + configQuery.toString());
  if (!config.app_id) {
    throw new Error("缺少 LINKSENSE_APP_ID");
  }
  if (mode === "required" && !config.ticket_endpoint_available) {
    throw new Error("需要认证模式缺少 LINKSENSE_APP_ID 或 LINKSENSE_APP_SECRET");
  }
  frame.src = config.iframe_url;
  setStatus("iframe-loading", "iframe 正在加载…");
  log("iframe url prepared", { iframe_url: config.iframe_url, mode });
} catch (error) {
  setStatus("failed", error instanceof Error ? error.message : "初始化失败");
  log("demo initialization failed", { message: statusEl.textContent });
}
`;
}

function demoCss() {
  return `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #202124;
  background: #f6f7f9;
}
body { margin: 0; }
.shell { width: min(1180px, calc(100vw - 48px)); margin: 0 auto; padding: 40px 0; }
.hero { margin-bottom: 24px; }
.eyebrow { margin: 0 0 8px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; }
h1 { margin: 0; font-size: clamp(28px, 5vw, 44px); letter-spacing: -0.04em; }
.lead { max-width: 720px; color: #5f6368; line-height: 1.7; }
.mode-switch { display: inline-flex; gap: 8px; padding: 6px; margin-top: 16px; border: 1px solid #e4e7ec; border-radius: 999px; background: #fff; }
.mode-switch a { padding: 8px 14px; border-radius: 999px; color: #475569; text-decoration: none; font-weight: 650; }
.mode-switch a[aria-current="page"] { color: #fff; background: #202124; }
.locale-switch { display: inline-flex; align-items: center; gap: 6px; margin: 16px 0 0 12px; color: #64748b; font-size: 13px; }
.locale-switch button { border: 1px solid #e4e7ec; border-radius: 999px; padding: 8px 12px; background: #fff; color: #475569; cursor: pointer; font: inherit; font-weight: 650; }
.locale-switch button[aria-pressed="true"] { border-color: #202124; background: #202124; color: #fff; }
.panel, .iframe-card, .log-card { background: #fff; border: 1px solid #e4e7ec; border-radius: 24px; box-shadow: 0 16px 45px rgba(15,23,42,.06); }
.panel { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding: 20px 24px; margin-bottom: 20px; }
.panel h2, .card-title { margin: 0 0 10px; font-size: 15px; font-weight: 760; }
#status { margin: 0; color: #2563eb; font-weight: 680; }
#status[data-demo-status="failed"] { color: #dc2626; }
#status[data-demo-status="ticket-delivered"],
#status[data-demo-status="waiting-session"] { color: #15803d; }
.meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin: 0; min-width: min(660px, 100%); }
.meta div { min-width: 0; }
.meta dt { color: #64748b; font-size: 12px; }
.meta dd { margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; }
.iframe-card, .log-card { padding: 18px; }
iframe { width: 100%; height: 720px; border: 1px solid #eef0f3; border-radius: 18px; background: #fff; }
#events { display: flex; flex-direction: column; gap: 10px; max-height: 720px; overflow: auto; padding: 0; margin: 0; list-style: none; }
#events li { padding: 10px 12px; border-radius: 14px; background: #f8fafc; color: #475569; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
@media (max-width: 960px) {
  .panel, .layout { display: block; }
  .meta { grid-template-columns: 1fr; margin-top: 18px; }
  .log-card { margin-top: 20px; }
}
`;
}

function isDemoPagePath(pathname) {
  return pathname === "/" || pathname === "/required" || pathname === "/public";
}

function pageMode(pathname) {
  return pathname === "/public" ? "public" : "required";
}

function embedMode(value) {
  return value === "public" ? "public" : "required";
}

function embedLocale(value) {
  return value === "en-US" ? "en-US" : "zh-CN";
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function requestOrigin(request) {
  const host = request.headers.host ?? `localhost:${DEFAULT_PORT}`;
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string" && forwardedProto.trim()
      ? forwardedProto.trim().split(",")[0]
      : "http";
  return `${proto}://${host}`;
}

function normalizeOrigin(value, name) {
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid origin");
    }
    return parsed.origin;
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }
}

function assertConfigured(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : fallback;
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendText(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": JSON_CONTENT_TYPE,
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = resolveDemoConfig(process.env);
  const server = createExternalEmbedDemoServer({ env: process.env });
  server.listen(config.port, "127.0.0.1", () => {
    const origin = `http://127.0.0.1:${config.port}`;
    process.stdout.write(`External embed demo is running:\n`);
    process.stdout.write(`  required: ${origin}/required\n`);
    process.stdout.write(`  public:   ${origin}/public\n`);
  });
}
