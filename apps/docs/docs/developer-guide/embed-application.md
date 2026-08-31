---
title: 嵌入 LinkSense 应用
description: 在外部业务系统中安全嵌入 LinkSense 应用，并传递 HTTP MCP 会话凭证。
---

# 嵌入 LinkSense 应用

把 LinkSense 应用嵌入业务系统后，用户只会看到该应用的聊天界面，不会看到 LinkSense 的主导航、插件中心或管理页面。

## 选择访问模式

| 模式 | 适用场景 | ticket | 用户历史 |
| --- | --- | --- | --- |
| 不需要认证 | 官网、公开问答等公共页面 | 不需要 | 不按业务用户恢复 |
| 需要认证 | 内部系统、合作伙伴门户 | 由业务后端申请 | 通过稳定的 `external_subject` 恢复 |

开始前，请让 LinkSense 管理员完成以下设置：

- 开启应用外部访问。
- 选择正确的访问模式。
- 把业务页面的精确 Origin 加入“允许嵌入的来源”。
- 可为每个允许来源分别配置最多 4 个内置问题；问题会按管理员填写的内容原样显示，不做自动翻译。
- 提供 App ID；需要认证时还要提供完整 App Secret。

允许来源示例：

```text
https://portal.example.com
https://ops.example.com
http://127.0.0.1:5055
```

生产环境必须使用 HTTPS。本地调试可以使用 `localhost` 或 `127.0.0.1` 的 HTTP 地址。

## 最短接入：不需要认证

公共页面不需要 ticket。通过 iframe URL 的 `locale` 参数设置初始语言：

```html
<iframe
  id="linksense-app"
  src="https://linksense.example.com/api/v1/embed/frame/lsa_xxx?parent_origin=https%3A%2F%2Fportal.example.com&amp;locale=zh-CN"
  title="LinkSense 应用"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
  allow="clipboard-write"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

其中：

- `lsa_xxx` 是 App ID。
- `parent_origin` 是经过 URL 编码的业务页面 Origin。
- `locale` 是可选的初始界面语言，仅支持 `zh-CN` 和 `en-US`。
- 公共模式由 iframe 自己创建会话，父页面不申请 ticket，也不处理 token。

## 最短接入：需要认证

认证链路只有四步：

```text
iframe 发送 linksense:ready
  -> 业务前端请求自己的后端
  -> 业务后端用 App ID + App Secret 向 LinkSense 申请一次性 ticket
  -> 业务前端通过 postMessage 把 ticket 交给 iframe
```

首次认证和后续重新认证使用同一个 `linksense:ready` 事件。

### 1. 业务后端申请 ticket

App Secret 只能保存在业务后端。调用：

```http
POST https://linksense.example.com/api/v1/embed/tickets
Content-Type: application/json
```

请求体：

```json
{
  "app_id": "lsa_xxx",
  "app_secret": "lss_xxx",
  "origin": "https://portal.example.com",
  "external_subject": "user-123",
  "external_tenant": "tenant-a",
  "display_name": "张三"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `app_id` | 是 | LinkSense App ID |
| `app_secret` | 是 | LinkSense App Secret，只能由后端读取 |
| `origin` | 是 | 当前业务页面 Origin，必须在允许列表中 |
| `external_subject` | 否 | 稳定的业务用户 ID；需要恢复个人上下文时应传入 |
| `external_tenant` | 否 | 租户或组织 ID；多租户系统建议传入 |
| `display_name` | 否 | 显示名称，不参与身份判断 |

响应中的 `ticket` 只能使用一次，并在 60 秒后过期：

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

Node.js / Express 示例：

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
      message: payload.error?.message ?? "无法获取 LinkSense 访问凭证",
    })
    return
  }

  res.json({
    ticket: payload.data.ticket,

    // 可选：供应用 HTTP MCP 使用，不是 LinkSense 会话 ID。
    sessionId: req.businessMcpSessionId ?? null,
  })
})
```

:::warning
只有业务系统明确允许下游 MCP 使用的会话凭证才能作为 `sessionId` 返回。不要直接暴露原本只用于 HttpOnly Cookie 的会话 ID。
:::

### 2. 业务前端传递 ticket

下面的代码可以直接作为最小接入模板。它会合并重复的 `linksense:ready`，避免同时申请多个 ticket。

```html
<iframe
  id="linksense-app"
  src="https://linksense.example.com/api/v1/embed/frame/lsa_xxx?parent_origin=https%3A%2F%2Fportal.example.com&amp;locale=zh-CN"
  title="LinkSense 应用"
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
            message: payload.message ?? "无法获取 LinkSense 访问凭证",
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

## 用户身份与 Codex 上下文

`external_subject` 是恢复用户上下文的唯一业务身份来源。它由业务后端申请 ticket 时提交，不通过 `postMessage` 发送，也不会转发给 MCP。

```text
external_subject + external_tenant + application
  -> LinkSense 外部用户
  -> conversation
  -> Codex thread 上下文
```

建议：

- 使用不会变化的内部用户主键，不要使用昵称、手机号或邮箱。
- 多租户系统同时传 `external_tenant`，避免不同租户用户串联。
- 每次申请 ticket 都为同一用户传入相同身份字段。
- 这些字段必须由后端根据当前登录用户生成，不信任浏览器参数。

公共模式没有可信业务身份，因此不按用户跨访问恢复历史。

## 界面语言与内置问题

嵌入页只接受两种界面语言：`zh-CN` 和 `en-US`，支持以下两种设置方式：

1. 在 iframe `src` 中加入 `locale`，设置首次加载或重新加载后的初始语言。
2. iframe 加载后，通过独立的 `linksense:locale` 消息实时切换，不需要刷新 iframe。

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

- URL 参数示例：`&locale=en-US`。未传或传入其他值时使用 `zh-CN`。
- `linksense:locale` 只接受 `zh-CN` 或 `en-US`；空值和其他值会被忽略，保持当前语言不变。
- 运行时消息会覆盖当前语言；iframe 重新加载后，再次以 URL 参数为初始语言。
- 不要在 `linksense:ticket` 或 `linksense:context` 中传递 `locale`。
- `locale` 只切换 LinkSense 的按钮、菜单、状态和错误提示，不进入用户问题、任务上下文或 MCP 参数。

管理员为当前来源配置的内置问题会显示在新任务欢迎区域。问题文本不会跟随 `locale` 翻译：管理员填写什么，用户就看到什么。用户点击问题后，LinkSense 只把它填入输入框并聚焦，仍需用户主动发送。

## 任务列表与自动命名

嵌入页右上角的“任务列表”只显示当前外部用户在当前应用中创建的任务，不会显示其他用户或其他应用的内容。

- “新任务”会创建一个独立的 Codex 任务上下文。
- 用户发送首条真实任务后，LinkSense 会根据任务内容自动生成标题，不会一直使用应用名称。
- 删除操作是永久删除，不是归档；确认后会删除该任务的消息、附件和结果，且无法恢复。
- 删除当前任务时，LinkSense 会先创建并切换到新的空白任务，再删除原任务，避免 iframe 停留在失效上下文。
- 正在执行的任务不能永久删除，应先等待任务结束或停止执行。

## 把业务 sessionId 传给 HTTP MCP

`postMessage` 中的 `sessionId` 是可选的业务系统凭证，与 LinkSense 自己的会话 ID 无关。

当它存在时，LinkSense 会在该用户的应用任务调用 HTTP MCP 时自动发送：

```http
X-Session-Id: business-session-value
X-API-Key: configured-mcp-api-key
```

具体行为：

- MCP 原有 API Key Header 与 `X-Session-Id` 同时发送，互不覆盖。
- 如果 MCP 把 API Key Header 也配置成 `X-Session-Id`，调用会因 Header 冲突而失败；必须使用不同名称。
- 没有 `sessionId` 时，请求中完全不出现 `X-Session-Id`。
- `sessionId` 加密保存，不显示在聊天消息、工具参数、事件或日志中。
- AI 子进程无法读取该值；只有当前会话的 HTTP MCP 出站代理可以使用。
- 该能力只适用于挂到应用上的 HTTP MCP。

业务会话变化后，可以单独更新：

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

清除：

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

## postMessage 协议

iframe → 父页面：

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `linksense:ready` | `appId`, `authMode` | iframe 已就绪；`required` 模式当前需要 ticket。首次认证和重新认证使用同一事件 |

父页面 → iframe：

| 事件 | 字段 | 说明 |
| --- | --- | --- |
| `linksense:ticket` | `appId`, `ticket`, `sessionId?` | 提供一次性 ticket，可同时绑定业务 sessionId |
| `linksense:locale` | `appId`, `locale` | 动态切换界面语言；仅接受 `zh-CN` 或 `en-US` |
| `linksense:session-id` | `appId`, `sessionId?` | 动态更新 sessionId；传 `null` 或省略表示清除 |
| `linksense:host-authentication-failed` | `appId`, `message?` | 宿主后端无法取得 ticket，让 iframe 显示失败状态 |

所有消息必须同时校验：

- `event.origin` 是预期的 LinkSense 或业务系统 Origin。
- `event.source` 是预期的 iframe 或父窗口。
- `appId` 与当前嵌入应用一致。

不要使用 `"*"` 作为 `postMessage` 的 `targetOrigin`。

## 凭证期限

| 凭证 | 当前期限 | 说明 |
| --- | --- | --- |
| ticket | 60 秒、一次性 | 使用后立即失效 |
| LinkSense access token | 2 小时 | iframe 在到期前约 2 分钟自动续期 |
| LinkSense renewal token | 8 小时滚动 | 每次续期轮换，最长不超过外部会话期限 |
| LinkSense 外部会话 | 7 天 | 到期后 required 模式再次发送 `linksense:ready` |
| App Secret | 不自动过期 | 手动重新生成后，旧凭证和旧会话立即失效 |
| 业务 `sessionId` | 由业务系统决定 | LinkSense 不判断有效性，只转发给 MCP |
| MCP API Key | 由 MCP 决定 | 无效时 MCP 返回调用错误 |

以下操作也会提前使 LinkSense 会话失效：关闭外部访问、修改认证模式或允许来源、停用应用、主动退出、检测到 renewal token 重放。

## 安全检查清单

- App Secret 只放在后端配置或密钥管理系统中。
- 不把 App Secret 或 ticket 写入 URL、Cookie、浏览器存储、日志、监控事件或错误上报。
- `sessionId` 只在当前页面内存中短暂传递，不写入前端持久化存储、日志或错误上报。
- ticket 不缓存、不重用；每次收到 `linksense:ready` 时重新申请。
- `external_subject` 和 `external_tenant` 只由后端根据当前登录用户生成。
- 允许来源使用精确 Origin，不使用通配符。
- 生产环境使用 HTTPS。
- App Secret 可能泄露时，立即在 LinkSense 中重新生成并更新后端配置。

## 本地验证

启动外部系统 demo：

```bash
LINKSENSE_BASE_URL=http://localhost:5173 \
LINKSENSE_API_BASE_URL=http://localhost:5173 \
LINKSENSE_APP_ID=lsa_xxx \
LINKSENSE_APP_SECRET=lss_xxx \
node examples/external-embed-demo/server.mjs
```

打开 `http://127.0.0.1:5055/required`，并确保该 Origin 已加入允许列表。

运行浏览器 smoke：

```bash
node examples/external-embed-demo/smoke.mjs
```

验证真实 MCP Header 转发：

```bash
pnpm --filter @linksense/runner exec vitest run \
  test/http-egress-proxy.integration.test.ts
```

## 常见问题

### iframe 一直等待访问凭证

检查父页面是否收到 `linksense:ready`、是否通过自己的后端取得 ticket，以及 `event.origin`、`event.source`、`appId` 是否校验正确。

### App ID 或 App Secret 无效

确认后端使用当前完整 App Secret。重新生成 App Secret 后，旧密钥立即失效。

### 同一用户没有恢复历史

确认每次申请 ticket 时都传入相同的 `external_subject`；多租户系统还要传相同的 `external_tenant`。

### MCP 没有收到 X-Session-Id

确认业务后端返回了非空 `sessionId`、父页面把它放入 `linksense:ticket`，并且应用绑定的是 HTTP MCP。不要把 MCP API Key Header 配置成 `X-Session-Id`。

### iframe 被浏览器拦截

确认当前页面 Origin 在允许列表中、`parent_origin` 完全一致、生产环境使用 HTTPS，并排查浏览器扩展或企业安全策略。
