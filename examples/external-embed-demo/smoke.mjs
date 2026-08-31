import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { URL } from "node:url";

import { createExternalEmbedDemoServer } from "./server.mjs";

const APP_ID = "lsa_external_demo_app_id";
const APP_SECRET = "lss_external_demo_secret_with_sufficient_entropy";
const SESSION_REQUIRED = "50000000-0000-4000-8000-0000000000a1";
const SESSION_PUBLIC = "50000000-0000-4000-8000-0000000000b1";

const requireFromWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);

async function main() {
  const { chromium } = requireFromWeb("@playwright/test");
  const fixture = createLinkSenseFixture();
  const fixtureOrigin = await listen(fixture.server);
  const demo = createExternalEmbedDemoServer({
    env: {
      LINKSENSE_BASE_URL: fixtureOrigin,
      LINKSENSE_API_BASE_URL: fixtureOrigin,
      LINKSENSE_APP_ID: APP_ID,
      LINKSENSE_APP_SECRET: APP_SECRET,
      LINKSENSE_EXTERNAL_SUBJECT: "smoke-user",
      LINKSENSE_EXTERNAL_TENANT: "smoke-tenant",
      LINKSENSE_DISPLAY_NAME: "外部接入 Smoke 用户",
      LINKSENSE_LOCALE: "en-US",
    },
  });
  const demoOrigin = await listen(demo);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const requiredResult = await runRequiredModeSmoke(page, fixture, demoOrigin);
    const requiredRetryResult = await runRequiredRetrySmoke(
      page,
      fixture,
      demoOrigin,
    );
    const requiredInvalidCredentialResult =
      await runRequiredInvalidCredentialSmoke(page, fixture, demoOrigin);
    const publicResult = await runPublicModeSmoke(page, fixture, demoOrigin);
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          demo_origin: demoOrigin,
          fixture_origin: fixtureOrigin,
          required: requiredResult,
          required_retry: requiredRetryResult,
          required_invalid_credential: requiredInvalidCredentialResult,
          public: publicResult,
        },
        null,
        2,
      ),
    );
    process.stdout.write("\n");
  } finally {
    await browser.close();
    await closeServer(demo);
    await closeServer(fixture.server);
  }
}

async function runRequiredModeSmoke(page, fixture, demoOrigin) {
  fixture.setMode("required");
  fixture.state.reset();
  const requests = [];
  const handler = recordRequest(requests);
  page.on("request", handler);
  await page.goto(`${demoOrigin}/required`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-demo-status="ticket-delivered"]', {
    timeout: 10_000,
  });
  const status = await page.locator("#status").textContent();
  const frameState = await page
    .frameLocator("#linksense-app")
    .locator("#state")
    .textContent();
  assert.match(status ?? "", /ticket 已发送/u);
  assert.equal(frameState, "session started");
  assert.equal(
    await page.frameLocator("#linksense-app").locator("html").getAttribute("lang"),
    "en-US",
  );
  await page.getByRole("button", { name: "中文" }).click();
  await page
    .frameLocator("#linksense-app")
    .locator('html[lang="zh-CN"]')
    .waitFor();
  assert.equal(fixture.state.tickets.length, 1);
  assert.equal(fixture.state.exchanges.length, 1);
  assert.equal(fixture.state.publicSessions.length, 0);
  assert.ok(requests.some((url) => url.endsWith("/api/linksense-ticket")));
  assert.ok(
    fixture.state.tickets.every((ticket) => ticket.app_secret === APP_SECRET),
  );
  assert.ok(
    fixture.state.tickets.every((ticket) => ticket.origin === demoOrigin),
  );
  page.off("request", handler);
  return {
    tickets: fixture.state.tickets.length,
    exchanges: fixture.state.exchanges.length,
  };
}

async function runRequiredRetrySmoke(page, fixture, demoOrigin) {
  fixture.setMode("required");
  fixture.state.reset();
  fixture.failNextExchanges(1);
  const requests = [];
  const handler = recordRequest(requests);
  page.on("request", handler);
  await page.goto(`${demoOrigin}/required`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-demo-status="ticket-delivered"]', {
    timeout: 10_000,
  });
  await page
    .frameLocator("#linksense-app")
    .locator("#state")
    .filter({ hasText: "session started" })
    .waitFor({ timeout: 10_000 });
  assert.equal(fixture.state.tickets.length, 2);
  assert.equal(fixture.state.exchanges.length, 2);
  assert.ok(
    requests.some((url) => url.endsWith("/api/v1/embed/sessions/exchange")),
  );
  page.off("request", handler);
  return {
    tickets: fixture.state.tickets.length,
    exchanges: fixture.state.exchanges.length,
  };
}

async function runRequiredInvalidCredentialSmoke(page, fixture, demoOrigin) {
  fixture.setMode("required");
  fixture.state.reset();
  fixture.rejectTickets(true);
  await page.goto(`${demoOrigin}/required`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-demo-status="failed"]', {
    timeout: 10_000,
  });
  const status = await page.locator("#status").textContent();
  const frameState = await page
    .frameLocator("#linksense-app")
    .locator("#state")
    .textContent();
  assert.match(status ?? "", /App ID 或 App Secret 无效/u);
  assert.match(frameState ?? "", /App ID 或 App Secret 无效/u);
  assert.equal(fixture.state.tickets.length, 1);
  assert.equal(fixture.state.exchanges.length, 0);
  fixture.rejectTickets(false);
  return {
    tickets: fixture.state.tickets.length,
    exchanges: fixture.state.exchanges.length,
  };
}

async function runPublicModeSmoke(page, fixture, demoOrigin) {
  fixture.setMode("public");
  fixture.state.reset();
  const requests = [];
  const handler = recordRequest(requests);
  page.on("request", handler);
  await page.goto(`${demoOrigin}/public`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-demo-status="waiting-session"]', {
    timeout: 10_000,
  });
  await page
    .frameLocator("#linksense-app")
    .locator("#state")
    .filter({ hasText: "public session started" })
    .waitFor({ timeout: 10_000 });
  assert.equal(fixture.state.tickets.length, 0);
  assert.equal(fixture.state.exchanges.length, 0);
  assert.equal(fixture.state.publicSessions.length, 1);
  assert.equal(
    await page.frameLocator("#linksense-app").locator("html").getAttribute("lang"),
    "en-US",
  );
  assert.ok(
    fixture.state.publicSessions.every(
      (session) => session.origin === demoOrigin && session.app_id === APP_ID,
    ),
  );
  assert.ok(
    !requests.some(
      (url) =>
        url.endsWith("/api/linksense-ticket") ||
        url.endsWith("/api/v1/embed/tickets") ||
        url.endsWith("/api/v1/embed/sessions/exchange"),
    ),
  );
  assert.ok(
    requests.some((url) => url.endsWith("/api/v1/embed/public-sessions")),
  );
  page.off("request", handler);
  return {
    public_sessions: fixture.state.publicSessions.length,
  };
}

function createLinkSenseFixture() {
  let mode = "required";
  const state = {
    tickets: [],
    exchanges: [],
    publicSessions: [],
    exchangeFailuresRemaining: 0,
    rejectTickets: false,
    reset() {
      this.tickets = [];
      this.exchanges = [];
      this.publicSessions = [];
      this.exchangeFailuresRemaining = 0;
      this.rejectTickets = false;
    },
  };
  const server = createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const requestUrl = new URL(request.url ?? "/", origin);
    try {
      if (
        request.method === "GET" &&
        requestUrl.pathname.startsWith("/api/v1/embed/frame/")
      ) {
        const appId = decodeURIComponent(
          requestUrl.pathname.split("/").at(-1) ?? "",
        );
        const parentOrigin = requestUrl.searchParams.get("parent_origin") ?? "";
        const locale =
          requestUrl.searchParams.get("locale") === "en-US" ? "en-US" : "zh-CN";
        assert.equal(appId, APP_ID);
        sendHtml(
          response,
          fixtureFrameHtml({ origin, parentOrigin, appId, mode, locale }),
        );
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/v1/embed/tickets"
      ) {
        const body = await readJsonBody(request);
        state.tickets.push(body);
        if (
          state.rejectTickets ||
          body.app_id !== APP_ID ||
          body.app_secret !== APP_SECRET ||
          body.origin !== body.origin?.trim()
        ) {
          sendJson(response, 401, {
            success: false,
            error: { code: "APPLICATION_EXTERNAL_CREDENTIALS_INVALID" },
          });
          return;
        }
        sendJson(response, 201, {
          success: true,
            data: {
              ticket: `lst_${"t".repeat(64)}`,
            iframe_url: `${origin}/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(body.origin)}`,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        });
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/v1/embed/sessions/exchange"
      ) {
        const body = await readJsonBody(request);
        state.exchanges.push(body);
        if (state.exchangeFailuresRemaining > 0) {
          state.exchangeFailuresRemaining -= 1;
          sendJson(response, 503, {
            success: false,
            error: { code: "RUNNER_UNAVAILABLE" },
          });
          return;
        }
        sendJson(response, 201, {
          success: true,
          data: {
            access_token: `jwt_${"a".repeat(64)}`,
            renewal_token: `lsr_${"r".repeat(64)}`,
            access_token_expires_at: new Date(
              Date.now() + 2 * 60 * 60_000,
            ).toISOString(),
            renewal_token_expires_at: new Date(
              Date.now() + 8 * 60 * 60_000,
            ).toISOString(),
            session_expires_at: new Date(
              Date.now() + 7 * 24 * 60 * 60_000,
            ).toISOString(),
            session_id: SESSION_REQUIRED,
          },
        });
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/api/v1/embed/public-sessions"
      ) {
        const body = await readJsonBody(request);
        state.publicSessions.push(body);
        sendJson(response, 201, {
          success: true,
          data: {
            session_id: SESSION_PUBLIC,
            session_expires_at: new Date(
              Date.now() + 7 * 24 * 60 * 60_000,
            ).toISOString(),
          },
        });
        return;
      }
      sendJson(response, 404, { success: false, error: "not_found" });
    } catch (error) {
      sendJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : "fixture_failed",
      });
    }
  });
  return {
    server,
    state,
    setMode(nextMode) {
      mode = nextMode;
    },
    failNextExchanges(count) {
      state.exchangeFailuresRemaining = count;
    },
    rejectTickets(enabled) {
      state.rejectTickets = enabled;
    },
  };
}

function fixtureFrameHtml({ origin, parentOrigin, appId, mode, locale }) {
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <title>LinkSense fixture</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui; background: #fff; color: #202124; }
      main { display: grid; place-items: center; min-height: 100vh; padding: 24px; box-sizing: border-box; }
      .card { border: 1px solid #e4e7ec; border-radius: 24px; padding: 32px; width: min(520px, 100%); text-align: center; }
      code { background: #f6f7f9; border-radius: 8px; padding: 4px 8px; }
    </style>
  </head>
  <body>
    <main><div class="card"><h1>LinkSense iframe fixture</h1><p>mode: <code>${mode}</code></p><p id="state">loading</p></div></main>
    <script>
      const config = ${JSON.stringify({ origin, parentOrigin, appId, mode, locale })};
      const state = document.getElementById("state");
      function post(message) {
        window.parent.postMessage({ appId: config.appId, ...message }, config.parentOrigin);
      }
      async function jsonFetch(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok || payload.success !== true) {
          const error = new Error(payload.error?.code ?? payload.error ?? response.statusText);
          error.status = response.status;
          error.code = payload.error?.code ?? "EMBED_REQUEST_FAILED";
          throw error;
        }
        return payload.data;
      }
      window.addEventListener("message", async (event) => {
        if (event.origin !== config.parentOrigin || event.source !== window.parent) return;
        if (event.data?.type === "linksense:locale" && event.data?.appId === config.appId) {
          if (event.data.locale === "zh-CN" || event.data.locale === "en-US") {
            document.documentElement.lang = event.data.locale;
          }
          return;
        }
        if (event.data?.type === "linksense:host-authentication-failed" && event.data?.appId === config.appId) {
          state.textContent = event.data.message ?? "host authentication failed";
          return;
        }
        if (event.data?.type !== "linksense:ticket" || event.data?.appId !== config.appId) return;
        state.textContent = "exchanging ticket";
        try {
          await jsonFetch("/api/v1/embed/sessions/exchange", {
            ticket: event.data.ticket,
            origin: config.parentOrigin,
          });
          state.textContent = "session started";
        } catch (error) {
          state.textContent = error.message;
          post({ type: "linksense:ready", authMode: config.mode });
        }
      });
      post({ type: "linksense:ready", authMode: config.mode });
      if (config.mode === "public") {
        state.textContent = "creating public session";
        jsonFetch("/api/v1/embed/public-sessions", {
          app_id: config.appId,
          origin: config.parentOrigin,
        }).then(() => {
          state.textContent = "public session started";
        }).catch((error) => {
          state.textContent = error.message;
        });
      }
    </script>
  </body>
</html>`;
}

function recordRequest(requests) {
  return (request) => {
    requests.push(request.url());
  };
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? `${error.stack}\n` : `${error}\n`);
  process.exit(1);
});
