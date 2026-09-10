---
title: Embed a LinkSense application
description: Securely embed a LinkSense application in an external business system and provide HTTP MCP session credentials.
---

# Embed a LinkSense application

An embedded LinkSense application shows only that application's chat interface. Users do not see the LinkSense main navigation, Plugin Center, or administration pages.

## System maintenance

During a scheduled maintenance window, both access modes show the maintenance reason and expected time window, with chat and other business operations unavailable. Open frames check system status every 30 seconds and recover automatically when the window ends or an administrator disables maintenance. Users do not need to refresh the host application.

Embedded business endpoints return HTTP `503` with error code `SYSTEM_MAINTENANCE_ACTIVE` during maintenance. Frame loading, system status checks, and existing session renewal remain available. Unexpired sessions are retained so users can continue the current conversation. If reauthentication is necessary, the frame uses the `linksense:ready` flow below. Displaying maintenance does not forcibly stop tasks that are already running.

## Choose an access mode

| Mode | Use case | Ticket | User history |
| --- | --- | --- | --- |
| No authentication | Public websites and open Q&A | Not required | Not restored per business user |
| Requires authentication | Internal systems and partner portals | Requested by your backend | Restored through a stable `external_subject` |

Before integrating, ask the LinkSense administrator to:

- Enable external access for the application.
- Select the correct access mode.
- Add the exact origin of your business page to Allowed embed origins.
- Optionally configure up to four built-in questions for each allowed origin. LinkSense displays the text exactly as entered and does not translate it.
- Provide the App ID and, for authenticated access, the complete App Secret.

Example allowed origins:

```text
https://portal.example.com
https://ops.example.com
http://127.0.0.1:5055
```

Use HTTPS in production. HTTP on `localhost` or `127.0.0.1` is acceptable for local development.

## Minimal integration: no authentication

A public page does not need a ticket. Set the initial language with the iframe URL's `locale` parameter:

```html
<iframe
  id="linksense-app"
  src="https://linksense.example.com/api/v1/embed/frame/lsa_xxx?parent_origin=https%3A%2F%2Fportal.example.com&amp;locale=en-US"
  title="LinkSense application"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
  allow="clipboard-write"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

Where:

- `lsa_xxx` is the App ID.
- `parent_origin` is the URL-encoded business page origin.
- `locale` is the optional initial interface language. It accepts only `zh-CN` or `en-US`.
- The iframe creates its own public session. The parent does not request a ticket or handle tokens.

## Minimal integration: requires authentication

The authentication flow has four steps:

```text
iframe sends linksense:ready
  -> business frontend calls its own backend
  -> business backend requests a one-time ticket with App ID + App Secret
  -> business frontend sends the ticket to the iframe with postMessage
```

Initial authentication and later reauthentication use the same `linksense:ready` event.

### 1. Request a ticket from the business backend

App Secret must exist only on the business backend. Call:

```http
POST https://linksense.example.com/api/v1/embed/tickets
Content-Type: application/json
```

Request body:

```json
{
  "app_id": "lsa_xxx",
  "app_secret": "lss_xxx",
  "origin": "https://portal.example.com",
  "external_subject": "user-123",
  "external_tenant": "tenant-a",
  "display_name": "Jane Doe"
}
```

| Field | Required | Description |
| --- | --- | --- |
| `app_id` | Yes | LinkSense App ID |
| `app_secret` | Yes | LinkSense App Secret; backend only |
| `origin` | Yes | Current business page origin; it must be allowed |
| `external_subject` | No | Stable business user ID; provide it to restore personal context |
| `external_tenant` | No | Tenant or organization ID; recommended for multi-tenant systems |
| `display_name` | No | Display name; never used as identity |

The response ticket is single-use and expires after 60 seconds:

```json
{
  "success": true,
  "data": {
    "ticket": "lst_xxx",
    "iframe_url": "https://linksense.example.com/api/v1/embed/frame/lsa_xxx?parent_origin=https%3A%2F%2Fportal.example.com",
    "expires_at": "2026-08-25T08:00:00.000Z"
  }
}
```

Node.js / Express example:

```js
app.post("/api/linksense-ticket", async (req, res) => {
  const response = await fetch(
    "https://linksense.example.com/api/v1/embed/tickets",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        app_id: process.env.LINKSENSE_APP_ID,
        app_secret: process.env.LINKSENSE_APP_SECRET,
        origin: "https://portal.example.com",
        external_subject: req.user.id,
        external_tenant: req.user.tenantId,
        display_name: req.user.name,
      }),
    },
  )

  const payload = await response.json()
  if (!response.ok || payload.success !== true) {
    res.status(response.status).json({
      error: "linksense_ticket_failed",
      message: payload.error?.message ?? "Unable to get LinkSense access",
    })
    return
  }

  res.json({
    ticket: payload.data.ticket,

    // Optional: for the application's HTTP MCP. This is not a LinkSense session ID.
    sessionId: req.businessMcpSessionId ?? null,
  })
})
```

:::warning
Return only a session credential that your business system explicitly permits downstream MCP services to use. Do not expose a session ID that was intended to remain inside an HttpOnly cookie.
:::

### 2. Send the ticket from the business frontend

The following is a minimal copy-ready integration. It coalesces repeated `linksense:ready` events so the page does not request multiple tickets concurrently.

```html
<iframe
  id="linksense-app"
  src="https://linksense.example.com/api/v1/embed/frame/lsa_xxx?parent_origin=https%3A%2F%2Fportal.example.com&amp;locale=en-US"
  title="LinkSense application"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
  allow="clipboard-write"
  style="width: 100%; height: 720px; border: 0"
></iframe>

<script>
  const appId = "lsa_xxx"
  const linkSenseOrigin = "https://linksense.example.com"
  const frame = document.getElementById("linksense-app")
  let ticketRequest = null

  async function provideTicket() {
    if (ticketRequest) return ticketRequest

    ticketRequest = (async () => {
      const response = await fetch("/api/linksense-ticket", {
        method: "POST",
        credentials: "same-origin",
      })
      const payload = await response.json()

      if (!response.ok || !payload.ticket) {
        frame.contentWindow.postMessage(
          {
            type: "linksense:host-authentication-failed",
            appId,
            message: payload.message ?? "Unable to get LinkSense access",
          },
          linkSenseOrigin,
        )
        return
      }

      frame.contentWindow.postMessage(
        {
          type: "linksense:ticket",
          appId,
          ticket: payload.ticket,
          ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        },
        linkSenseOrigin,
      )
    })().finally(() => {
      ticketRequest = null
    })

    return ticketRequest
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== linkSenseOrigin) return
    if (event.source !== frame.contentWindow) return

    const message = event.data
    if (!message || message.appId !== appId) return
    if (message.type !== "linksense:ready") return
    if (message.authMode !== "required") return

    void provideTicket()
  })
</script>
```

## Business identity and Codex context

`external_subject` is the only business identity used to restore user context. The business backend submits it when requesting a ticket. It is not sent through `postMessage` and is never forwarded to MCP.

```text
external_subject + external_tenant + application
  -> LinkSense external user
  -> conversation
  -> Codex thread context
```

Recommendations:

- Use an immutable internal user primary key, not a display name, phone number, or email address.
- In multi-tenant systems, also send `external_tenant` to prevent cross-tenant identity collisions.
- Send the same identity fields every time the same user requests a ticket.
- Generate these values on the backend from the authenticated user. Do not trust browser parameters.

Public mode has no trusted business identity and does not restore history per user across visits.

## Interface locale and built-in questions

The embedded page accepts two interface locales, `zh-CN` and `en-US`, with two supported configuration methods:

1. Add `locale` to the iframe `src` to set the initial language after the first load or any reload.
2. After the iframe loads, send a dedicated `linksense:locale` message to switch immediately without reloading it.

```js
const frame = document.getElementById("linksense-app")
const linkSenseOrigin = "https://linksense.example.com"

function setLinkSenseLocale(locale) {
  frame.contentWindow.postMessage(
    {
      type: "linksense:locale",
      appId: "lsa_xxx",
      locale,
    },
    linkSenseOrigin,
  )
}

setLinkSenseLocale("en-US")
```

- URL example: `&locale=en-US`. A missing or unsupported value falls back to `zh-CN`.
- `linksense:locale` accepts only `zh-CN` or `en-US`; empty or unsupported values are ignored and leave the current language unchanged.
- A runtime message overrides the current language. After an iframe reload, the URL parameter becomes the initial language again.
- Do not include `locale` in `linksense:ticket` or `linksense:context`.
- `locale` only changes LinkSense buttons, menus, states, and error messages. It is never added to the user's question, task context, or MCP arguments.

Built-in questions configured for the current origin appear in the new-task welcome area. Their text never changes with `locale`: users see exactly what the administrator entered. Selecting a question fills and focuses the composer but does not send it automatically.

## Task list and automatic naming

The embedded page's Task list shows only tasks created by the current external user in the current application. It never exposes another user or another application's tasks.

- New task creates an independent Codex task context.
- After the user starts the first real request, LinkSense generates a title from that request instead of continuing to display the application name.
- Delete is permanent, not an archive operation. After confirmation, the task's messages, attachments, and results are deleted and cannot be recovered.
- When the current task is deleted, LinkSense creates and selects a new empty task before deleting the old one so the iframe never remains attached to an invalid context.
- A running task cannot be permanently deleted. Wait for it to finish or stop it first.

## Send a business sessionId to HTTP MCP

The optional `sessionId` in `postMessage` is a business-system credential. It is unrelated to LinkSense's own session ID.

When present, LinkSense automatically sends these headers whenever that user's application task calls an HTTP MCP:

```http
X-Session-Id: business-session-value
X-API-Key: configured-mcp-api-key
```

Behavior:

- The existing MCP API Key Header and `X-Session-Id` are sent together without overwriting each other.
- If the MCP API Key Header is also configured as `X-Session-Id`, the call fails because of the Header conflict. Use a different name.
- Without `sessionId`, the HTTP request does not contain `X-Session-Id` at all.
- LinkSense encrypts `sessionId` and does not expose it in chat messages, tool arguments, events, or logs.
- The AI child process cannot read it. Only the current session's HTTP MCP egress proxy can use it.
- This feature applies only to HTTP MCP servers attached to the application.

Update the business session credential independently:

```js
frame.contentWindow.postMessage(
  {
    type: "linksense:session-id",
    appId,
    sessionId: "new-business-session",
  },
  linkSenseOrigin,
)
```

Clear it:

```js
frame.contentWindow.postMessage(
  {
    type: "linksense:session-id",
    appId,
    sessionId: null,
  },
  linkSenseOrigin,
)
```

## postMessage protocol

iframe → parent:

| Event | Fields | Description |
| --- | --- | --- |
| `linksense:ready` | `appId`, `authMode` | The iframe is ready; in `required` mode it currently needs a ticket. Initial authentication and reauthentication use the same event |

Parent → iframe:

| Event | Fields | Description |
| --- | --- | --- |
| `linksense:ticket` | `appId`, `ticket`, `sessionId?` | Provides a one-time ticket and may bind a business sessionId |
| `linksense:locale` | `appId`, `locale` | Changes the interface language dynamically; accepts only `zh-CN` or `en-US` |
| `linksense:session-id` | `appId`, `sessionId?` | Updates sessionId dynamically; `null` or omission clears it |
| `linksense:host-authentication-failed` | `appId`, `message?` | Tells the iframe that the host backend could not obtain a ticket |

Every message must validate:

- `event.origin` is the expected LinkSense or business-system origin.
- `event.source` is the expected iframe or parent window.
- `appId` matches the embedded application.

Never use `"*"` as the `postMessage` target origin.

## Credential lifetimes

| Credential | Current lifetime | Notes |
| --- | --- | --- |
| Ticket | 60 seconds, single-use | Invalid immediately after use |
| LinkSense access token | 2 hours | The iframe renews it about 2 minutes before expiry |
| LinkSense renewal token | Rolling 8 hours | Rotated on each renewal and capped by the external session lifetime |
| LinkSense external session | 7 days | After expiry, required mode sends `linksense:ready` again |
| App Secret | No automatic expiry | Regeneration invalidates old credentials and sessions immediately |
| Business `sessionId` | Defined by the business system | LinkSense does not validate its lifetime; it only forwards it to MCP |
| MCP API Key | Defined by the MCP service | An invalid key produces an MCP call error |

The LinkSense session can also become invalid early when external access is disabled, the authentication mode or allowed origins change, the application is disabled, the user logs out, or renewal-token replay is detected.

## Security checklist

- Store App Secret only in backend configuration or a secret manager.
- Never write App Secret or ticket to URLs, cookies, browser storage, logs, monitoring events, or error reports.
- Keep `sessionId` only in page memory while it is being delivered. Do not persist it in frontend storage, logs, or error reports.
- Never cache or reuse a ticket. Request a new one for every `linksense:ready` event.
- Generate `external_subject` and `external_tenant` on the backend from the authenticated user.
- Configure exact allowed origins; do not use wildcards.
- Use HTTPS in production.
- If App Secret may have leaked, regenerate it in LinkSense immediately and update backend configuration.

## Local verification

Start the external-system demo:

```bash
LINKSENSE_BASE_URL=http://localhost:5173 \
LINKSENSE_API_BASE_URL=http://localhost:5173 \
LINKSENSE_APP_ID=lsa_xxx \
LINKSENSE_APP_SECRET=lss_xxx \
node examples/external-embed-demo/server.mjs
```

Open `http://127.0.0.1:5055/required` and make sure that origin is allowed.

Run the browser smoke:

```bash
node examples/external-embed-demo/smoke.mjs
```

Verify real MCP Header forwarding:

```bash
pnpm --filter @linksense/runner exec vitest run \
  test/http-egress-proxy.integration.test.ts
```

## Troubleshooting

### The iframe keeps waiting for access

Confirm that the parent receives `linksense:ready`, obtains a ticket through its own backend, and validates `event.origin`, `event.source`, and `appId` correctly.

### App ID or App Secret is invalid

Make sure the backend uses the current complete App Secret. Regenerating App Secret invalidates the old value immediately.

### The same user does not see previous history

Send the same `external_subject` for that user on every ticket request. Multi-tenant systems must also send the same `external_tenant`.

### MCP does not receive X-Session-Id

Confirm that the business backend returned a non-empty `sessionId`, the parent included it in `linksense:ticket`, and the application uses an attached HTTP MCP. Do not configure the MCP API Key Header as `X-Session-Id`.

### The browser blocks the iframe

Confirm that the current page origin is allowed, `parent_origin` matches exactly, production uses HTTPS, and no browser extension or enterprise policy blocks iframes.
