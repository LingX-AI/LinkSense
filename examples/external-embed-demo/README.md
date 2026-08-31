# LinkSense 外部接入 Demo

这个目录是一个最小第三方系统示例，用来验证 LinkSense 应用 iframe 外部接入。它包含：

- 一个外部后端：`server.mjs`
- 一个外部前端：由后端直接服务的 `/required` 和 `/public` 页面
- 一个浏览器 smoke：`smoke.mjs`

## 运行 demo

先在 LinkSense 应用的“外部访问”页面完成配置，并把 demo 的 Origin 加入允许来源。

默认 demo Origin 是：

```bash
http://127.0.0.1:5055
```

### 需要认证

需要认证模式下，App Secret 只放在外部后端环境变量里，不会返回给浏览器。

```bash
LINKSENSE_BASE_URL=http://localhost:5173 \
LINKSENSE_API_BASE_URL=http://localhost:5173 \
LINKSENSE_APP_ID=lsa_xxx \
LINKSENSE_APP_SECRET=lss_xxx \
node examples/external-embed-demo/server.mjs
```

打开：

```text
http://127.0.0.1:5055/required
```

链路是：

```text
外部前端 iframe ready
  -> 外部前端请求自己的后端 /api/linksense-ticket
  -> 外部后端用 App ID / App Secret 请求 LinkSense /api/v1/embed/tickets
  -> 外部前端把一次性 ticket 以及可选的 sessionId postMessage 给 iframe
  -> LinkSense iframe 自己完成后续会话建立
```

### 不需要认证（公共访问）

公共模式直接使用 App ID 定位应用，不需要 App Secret，也不需要 ticket 或 token。

```bash
LINKSENSE_BASE_URL=http://localhost:5173 \
LINKSENSE_APP_ID=lsa_xxx \
node examples/external-embed-demo/server.mjs
```

打开：

```text
http://127.0.0.1:5055/public
```

链路是：

```text
外部前端只加载 iframe
  -> LinkSense iframe 直接创建公共外部会话
```

Demo 会把 `LINKSENSE_LOCALE` 作为 iframe URL 的 `locale` 参数。页面上的“中文 / English”按钮则通过独立的 `linksense:locale` 消息演示无刷新动态切换。语言不会放入 `linksense:ticket` 或 `linksense:context`。

也可以直接用页面查询参数覆盖初始语言，例如：`http://127.0.0.1:5055/public?locale=en-US`。

## 自动 smoke

这个 smoke 不依赖真实 LinkSense 数据库。它会启动一个可控的 LinkSense iframe 协议 fixture，并用真实 Chromium 验证两种模式：

- `required` 会请求外部后端 `/api/linksense-ticket`，并由后端换取 ticket。
- `public` 不会请求 `/api/linksense-ticket`、`/api/v1/embed/tickets` 或 `/api/v1/embed/sessions/exchange`，只创建公共会话。

```bash
node examples/external-embed-demo/smoke.mjs
```

预期输出包含：

```json
{
  "ok": true
}
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `PORT` | demo 服务端口，默认 `5055` |
| `LINKSENSE_BASE_URL` | 浏览器可访问的 LinkSense Web Origin，默认 `http://localhost:5173` |
| `LINKSENSE_API_BASE_URL` | 外部后端请求 LinkSense API 的 Origin，默认等于 `LINKSENSE_BASE_URL` |
| `LINKSENSE_APP_ID` | 外部访问 iframe 使用的 App ID |
| `LINKSENSE_APP_SECRET` | 需要认证模式下的 App Secret，仅后端读取 |
| `LINKSENSE_PARENT_ORIGIN` | 可选。强制指定父页面 Origin；默认按当前请求 Host 自动推导 |
| `LINKSENSE_EXTERNAL_SUBJECT` | 可选。传给 LinkSense 的外部用户标识 |
| `LINKSENSE_EXTERNAL_TENANT` | 可选。传给 LinkSense 的外部租户标识 |
| `LINKSENSE_DISPLAY_NAME` | 可选。外部用户显示名称 |
| `LINKSENSE_LOCALE` | 可选。iframe URL 的初始界面语言，支持 `zh-CN` 或 `en-US`，默认 `zh-CN` |
