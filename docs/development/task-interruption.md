# 任务停止链路与回归验证

## 协议依据

本次检查覆盖停止按钮、提交回执、API 权限与启动意图、Runner 控制接口、独立 app-server、原生事件持久化，以及 SSE/详情刷新。

以部署固定的 Codex `0.150.1` 生成的 app-server TypeScript schema 为准核对了 `TurnInterruptParams` 和 `TurnInterruptResponse`。本机默认 Codex 为 `0.142.5`，没有用本机版本代替部署协议。官方 [app-server 文档](https://learn.chatgpt.com/docs/app-server) 规定 `turn/interrupt` 接收 `threadId`、`turnId`，响应只是接收回执，最终结果由 `turn/completed` 的 `interrupted` 状态确认。

## 问题与处理

| 场景 | 原链路问题 | 处理 |
| --- | --- | --- |
| 提交已接受，数据库中的轮次尚未创建 | 停止请求进入启动恢复轮询，等待会话锁、准备流程和数据库写入，最长可等待 60 秒 | 按启动操作 ID 直接保存停止意图；启动恢复及数据库处理不阻塞停止回执 |
| 初始化、等待技能/MCP 就绪 | 只能等用户轮次启动之后再停止 | 在现有任务控制目录持久化取消标记；启动前检查，取消后不再发出用户 `turn/start` |
| 启动与停止同时发生 | `turn/start` 已返回编号，原生调度器可能尚未注册轮次 | 复用原生注册确认后再中断；完成事件同时到达时按已结束处理 |
| 切换模型、执行准备阶段压缩 | 隐藏的压缩轮次尚在执行，用户轮次还没有编号 | 从原生读取定位该压缩轮次并中断，收到终态后结束准备，禁止继续启动用户轮次 |
| 原生事件已经到达，输出还在保存 | 生命周期判断排在资源处理和事件持久化之后 | 控制层立即记录原生开始/结束事实；业务事件仍按原顺序持久化 |
| 目标任务自动继续 | 停止只命中第一轮；或暂停目标需等待会话锁 | 按当前逻辑目标定位，先原生暂停自动继续，再读取并中断当前实际运行轮次；轮次间隙同样可以暂停 |
| 停止后服务恢复 | 重新找回原生轮次，但遗漏此前保存的取消意图 | 启动恢复及运行状态核对都检查取消标记，继续中断同一原生执行；用户明确恢复目标时清除旧标记 |
| 用户再次点击停止 | API 看到已有 `interruptRequestedAt` 就直接返回，未重新联系执行服务 | 合并同时进行的中断请求；上次请求结束后允许用户明确重试 |
| SSE 丢失、详情第一次刷新仍为运行中 | 一次刷新后没有持续核对，按钮可能一直加载 | 停止期间每秒核对详情；不反复取消正在进行的详情请求；20 秒未确认则结束按钮加载并提示可重试 |
| 停止请求已接受，任务尚未实际结束 | 页面仅凭请求时间就显示“已中断” | 运行中的任务显示“正在中断”，继续等待真实终态；期间保留运行状态和交互限制 |

## 边界

- 普通轮次仅中断指定原生编号；目标任务必须匹配当前逻辑目标，旧目标请求不会停止新的目标。
- 停止入口继续执行资源所有权校验；准备阶段入口还校验运行时版本标识。无权限、无效输入和底层失败不会记为成功中断。
- 原生停止、目标暂停和停止路径中的原生读取采用 5 秒请求超时，沿用已有失联进程清理机制。前端对包含登录刷新在内的整个停止请求设置 20 秒上限。
- 接收停止请求不等同于进程已经结束。网络不可达、外部工具取消延迟或准备阶段已有 I/O 尚未返回时，无法保证物理执行在点击瞬间结束；页面会给出可重试的失败反馈，不伪造终态。
- 不增加整轮重试、重新发送用户输入、数据库状态替代原生终态、数据库迁移或依赖包。复用现有 Zod、TanStack Query、原生 AbortController 和启动操作持久化设施。

## 验证

回归测试使用可控的 app-server、故障注入和虚拟时钟覆盖注册竞态、启动取消、恢复锁阻塞、模型切换准备、目标续跑、显式恢复、重复点击、原生失败、权限隔离、事件落库阻塞、SSE 丢失和中英文/回退显示。

2026-09-11 验证结果：API 397 项、Runner 234 项、Web 345 项，共 976 项相关单元测试通过；API、Runner、Web 类型检查、改动文件 ESLint 和生产构建通过。Runner 最后补充的恢复目标及请求校验变更重新运行了进程池和隔离测试，192 项通过。

相关测试的复现命令（验证时按测试项目分批执行）：

```sh
pnpm --filter @linksense/api test test/conversations.service.test.ts test/conversations.routes.test.ts test/runner-adapter.test.ts
pnpm --filter @linksense/runner test test/process-pool.test.ts test/runtime-isolation.test.ts test/owner-isolation.test.ts test/controller-server.test.ts
pnpm --filter @linksense/web exec vitest run --project application src/test/application/task-actions.test.tsx src/test/application/editing.test.tsx src/test/application/submission.test.tsx src/test/application/interactive-submission.test.tsx --maxWorkers=2
pnpm --filter @linksense/web exec vitest run --project components --project shared-components --project node src/features/conversations/conversation-thread.test.tsx src/features/conversations/conversation-interrupt.test.ts src/features/conversations/conversation-execution-lifecycle.test.ts src/features/conversations/conversation-refresh-policy.test.ts src/features/conversations/conversation-detail-query.test.ts src/features/conversations/conversation-composer.test.tsx --maxWorkers=2
```

另外执行 API、Runner、Web 的类型检查、改动文件 ESLint 检查和生产构建。没有连接真实模型运行，也没有执行浏览器端到端验证。构建保留现有大分包体积告警，不属于本次停止功能的改动范围。
