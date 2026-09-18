# 交互式应用预览加载阻塞排查

## 原因与现场证据

2026-09-18 排查本地 HTTP 开发环境中交互式应用预览持续显示“正在加载”的问题。

- 同一个试运行对话被 `InteractiveApplicationPage` 和其内嵌的 `ConversationPage` 分别订阅，再加上左侧开发对话，每个开发页保持 3 条 SSE 长连接。
- 后台标签页没有释放订阅。现场 Chrome 同时打开两个开发页，API 容器存在 6 条持续连接。
- HTTP/1.1 下，同一浏览器、同一域名的连接额度由多个标签页共用，SSE 也占用额度；6 条持续连接会让普通接口、预览资源和热更新模块请求排队。[MDN 连接限制说明](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)、[Chrome 请求排队说明](https://developer.chrome.com/docs/devtools/network/reference#timing-explanation)。
- 页面阻塞时，从浏览器外通过相同本地入口请求 bootstrap 接口返回 200，耗时约 22 毫秒。API 日志中已到达服务端的详情、预览令牌等请求正常返回，工程的预览应用、试运行对话和资源包关联也完整。
- 截图中的 `completion-notifications` 是普通 JSON 请求。它们 pending 与预览共同受连接占用影响，并不是这些接口需要一直等待任务完成。

代码重复订阅、现场连接数和独立请求结果共同指向浏览器连接额度被占满。没有取得浏览器 Timing 面板的 Stalled 明细，不能将该项作为已验证证据。

## 修复

1. 由内嵌对话统一订阅试运行事件，将应用业务事件交给预览。预览区不再创建第二条相同对话的 SSE 连接。
2. 共用连接从头提供应用历史结果；聊天区以已经取得的详情游标为边界，只应用后续事件，防止旧执行状态覆盖当前状态。
3. 标签页隐藏时先提交已收到的消息片段，再取消 SSE 请求。重新显示后使用最后实际处理的游标续接。已断开连接的迟到回调被忽略。
4. 主动暂停不会显示断线警告，也不会中断后端任务或重新提交任务。

复用现有 SSE 客户端、AbortController 和 Page Visibility API，未增加依赖或接口超时重试。

一个开发页现在仅需要开发对话、试运行对话各一条连接。HTTP/1.1 本身的连接上限仍然存在；本次消除了重复订阅和隐藏标签页持续占用这两个问题。

## 数据与更新影响

没有数据库、存储事件格式、后端接口或应用包格式变更。已有应用及试运行历史继续使用原记录，不需要重新创建或发布。回归用例覆盖先前已有结果、详情游标晚于结果事件、实时续接及重复事件去重。

本地容器中的源文件摘要已与工作区核对一致。由于旧连接也可能挡住热更新模块请求，重启了本地 `web` 服务释放旧连接，未重启 API 或 runner。随后前端入口和经前端代理的 bootstrap 请求均返回 200，约 5 毫秒。生产更新时需要让已打开的页面加载新前端资源。

## 验证

- 先增加回归测试，确认旧实现无法释放后台连接、也不支持共享历史回放，再修复实现。
- Hook、应用运行页、SSE、事件契约和相关通知单元测试：10 个文件、85 项通过。
- 完整 application 测试：23 个文件、245 项；首次 244 项通过，1 项是此前图标调整遗留的样式断言。将断言更新为图标实际尺寸和已确认的默认 `bot` 图标后，相关两个文件共 11 项复测通过。
- 新增开发页组合测试使用真实页面组件、SSE 解析器和内存网络流，覆盖冷缓存加载、单一试运行订阅、SDK 初始化后回放历史结果、显隐聊天不新增连接、后台释放、游标续接、事件去重及不创建新任务。补充历史回放断言后再次通过。
- 修改文件的 ESLint、web TypeScript 检查、web 生产构建通过。构建仍提示部分现有产物大于 500 kB。
- 遵循项目约定，修改页面后未使用 Playwright 或浏览器自动操作进行视觉验收；单元测试中的 DOM 验证不代表已完成真实浏览器视觉复测。

主要验证命令：

```sh
pnpm --filter @linksense/web exec vitest run --project application --maxWorkers=3
pnpm --filter @linksense/web exec vitest run --project application src/test/application/task-status.test.tsx src/test/application/interactive-preview.test.tsx --maxWorkers=2
pnpm --filter @linksense/web exec vitest run --project application src/test/application/interactive-preview.test.tsx --maxWorkers=2
pnpm --filter @linksense/web exec vitest run --project components --project node src/features/conversations/use-conversation-events.test.tsx src/features/applications/interactive-application-page.ui.test.tsx src/features/applications/interactive-application-page.test.ts src/features/applications/interactive-application-submission.test.ts src/api/sse.test.ts src/api/sse-reconnect-delay.test.ts src/api/contracts.test.ts src/features/conversations/conversation-event-subscription.test.ts src/features/conversations/conversation-live-events.test.ts src/features/conversations/conversation-live-state.test.tsx src/features/usage/credit-quota-refresh-center.test.tsx src/features/browser-notifications --maxWorkers=3
pnpm --filter @linksense/web exec eslint src/features/conversations/use-conversation-events.ts src/features/conversations/use-conversation-events.test.tsx src/features/applications/interactive-application-page.tsx src/features/applications/interactive-application-page.ui.test.tsx src/pages/conversation-pages.tsx src/test/application/interactive-preview.test.tsx src/test/application/task-status.test.tsx
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/web build
```
