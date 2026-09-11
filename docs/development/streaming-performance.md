# 流式事件吞吐排查与验证

记录日期：2026-09-11。模型：`deepseek-flash`，`native_responses`，`medium` 推理强度。改动前代码基准：`9711fdd`。

## 问题与定位

目标是在同一次请求上让 LinkSense 的正文接收速度跟上模型输出，避免事件积压随正文长度持续增长。供应商面板的输出 token 数可能包含推理 token，不能直接与页面可见正文的速度比较。

实际链路为：

```text
模型 → ModelGateway → Codex app-server → notificationChain
    → 持久化 outbox → Worker HTTP → Controller → API 逐事件事务
    → Redis 唤醒 → PostgreSQL 事件分页 → HTTP SSE → 前端
```

原实现每个事件单独请求 API，并等待回执、删除已确认文件、同步目录后再发送下一个事件。模型输出越快，队列越容易积压。SSE 事件历史读取还需要多次数据库往返，进一步占用处理时间。

代码检查未发现前端固定每秒输出几十个 token 的限制：已有逻辑按动画帧处理收到的全部增量，流式 Markdown 动画已关闭。本次未修改前端显示逻辑。

单独优化历史查询仍不足以解决问题：同一段真实模型事件回放中，末尾正文滞后从约 4.2 秒降到约 3.2 秒，仍然积压。因此进一步优化事件传输的固定开销。

## 实现与不变量

复用现有 Prisma、Zod、Fastify 和 outbox，不增加依赖，也不修改数据库结构。

1. 历史读取使用一个参数化 `Prisma.sql` 查询，将分支、准备阶段任务、可见事件、分页和过滤后的序列上界放在同一数据库快照内。加上原有所有权检查，空页轮询从 6 次读取降至 2 次。使用 `EXISTS`，无需加载整个分支的 turn ID 列表。PostgreSQL 单条查询的快照语义见[官方文档](https://www.postgresql.org/docs/16/transaction-iso.html)。
2. Worker 从已持久化的队列中立即取出连续完整事件，一次最多 32 条，目标请求大小 256 KiB；不等待凑满。单个已有大事件单独发送，沿用原有请求大小限制。
3. 每条事件保留原来的 `deliveryId`、内容和次序。API 依次 `await` 原有 `ingest`，每条事件仍独立执行原有事务、去重、分支检查和生命周期处理。正文、工具、审批和完成事件不需要另外分类。
4. API 只确认批次开头已按原有语义处理的连续前缀，包含原本应忽略的旧分支事件；遇到未就绪或错误立即停止，后续事件不执行。HTTP 请求断开后，在当前事件处理结束处停止。已经提交但未拿到回执的事件沿用原有 delivery ID 重试。
5. Worker 严格验证回执是原请求的连续前缀，只删除确认过的文件，再同步一次目录。乱序、缺项、陌生 ID 或多余 ID 的回执不会清理队列。每条新事件的文件与目录持久化仍在 `publish` 返回前完成。

合并的是 HTTP 往返及已确认文件的目录同步，不合并事件内容，不并行执行同一会话的事件。后端到前端的 SSE 事件契约保持原样。

## deepseek-flash 实测

测试在独立 Docker 网络、PostgreSQL 16、Redis 7.4 中运行；测试进程限制 2 CPU / 1536 MiB，数据库与 Redis 各 1 CPU / 256 MiB。使用实际 Worker 镜像中的 Codex **0.150.1** 和宿主机绑定目录保存 outbox。模型凭据仅通过受控运行时配置传入测试进程，不写入结果。

真实请求经过 ModelGateway、Codex、事件映射、持久化队列、Controller HTTP 代理、API、PostgreSQL、Redis 和 HTTP SSE。测试驱动复现 ProcessPool 的串行通知发布方式；鉴权、任务准入和准备阶段使用测试夹具。没有执行浏览器页面或生产环境测试。

在同一个单调时钟上记录每个 Codex 正文增量与对应 SSE 到达时间。吞吐比较使用相同正文的首末增量时长，同时检查每条增量的延迟，避免只看平均速度掩盖积压。

| 场景 | 模型/回放正文时长 | SSE 正文时长 | 增量延迟 P95 | 最后一段正文滞后 |
| --- | ---: | ---: | ---: | ---: |
| 修改前，真实轨迹两倍速回放 | 4.823 s | 10.266 s | 5327 ms | 5482 ms |
| 修改后，同一轨迹两倍速回放 | 4.822 s | 4.784 s | 69 ms | 14 ms |
| 修改后，真实模型请求 1 | 8.290 s | 8.270 s | 132 ms | 42 ms |
| 修改后，真实模型请求 2 | 7.180 s | 7.150 s | 76 ms | 10 ms |

两倍速回放包含 1360 条正文增量、2363 个字符；两轮最终真实请求分别包含 1094 / 892 条正文增量、1910 / 1498 个字符。正文内容及顺序一致，增量数、持久化事件数和完成状态校验通过。两轮真实请求的单次延迟峰值分别为 202 / 251 ms。

修改后 SSE 正文吞吐约为模型的 100%，没有持续增长的末尾积压。SSE 首末时间窗口偶尔比模型窗口略短，是首段传输延迟与随后追赶造成的，不代表生成速度超过模型。

这验证了测试资源和负载下的吞吐目标。浏览器实际绘制延迟、部署网络和多任务并发未在本次性能测试中测量，不能据此承诺所有环境零延迟或不存在任何瓶颈。

## 回归检查

覆盖逐事件等待、完整事件传输、部分成功、首项失败、请求断开、回执丢失、非法回执、Worker 重启、批次大小限制和损坏队列记录。

真实 PostgreSQL / Redis / HTTP SSE 集成检查还覆盖：重复提交不重复生成消息、批次中途切换分支重新校验、压缩准备阶段可见性、跨会话隔离、隐藏事件、原生与旧标题事件、分页、过滤序列空隙和断线恢复。

执行命令（从仓库根目录）：

```sh
pnpm --filter @linksense/api exec vitest run --maxWorkers=2 --maxConcurrency=2
pnpm --filter @linksense/runner exec vitest run --maxWorkers=2
pnpm --filter @linksense/shared test
pnpm --filter @linksense/web exec vitest run src/api/sse.test.ts src/features/conversations/use-conversation-events.test.tsx src/features/conversations/streaming-messages.test.ts src/features/conversations/streaming-markdown.test.ts --maxWorkers=2
pnpm exec tsx apps/api/test/integration/context-compaction-sse.ts
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/shared typecheck
pnpm --filter @linksense/api lint
pnpm --filter @linksense/runner lint
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api build
pnpm --filter @linksense/runner build
```

集成脚本创建并清理自己的容器，以独立 Prisma 配置应用已有迁移；不读取应用 `.env` 或操作应用数据库。Web 检查仅运行上述单元测试，不启动 Playwright。

全量 API 回归发现既有部署收尾测试使用模块 mock 却未隔离，结果依赖其他测试的加载顺序；已将它纳入项目现有的模块隔离测试列表。

最终结果：API 2739 项通过；Runner 678 项通过、1 项既有跳过；共享包 302 项通过；前端相关单元测试 56 项通过。上述集成测试、包级类型检查、项目 lint 命令和三个包的构建均通过。额外单独对 `vitest.config.ts` 执行 ESLint 时，项目的 TypeScript 服务因该配置文件不在 lint 的 tsconfig 范围内拒绝解析；没有扩展 lint 范围，该配置已由实际全量 Vitest 运行验证。

## 发布要求

内部 `/internal/runner/events` 请求改为 `events` 数组，响应改为 `accepted_delivery_ids`。旧单事件 HTTP 形式已移除。

运行契约升级为 `shared-user-home-v22`，并纳入 Worker 合约缓存标识，避免重用旧协议 Worker。**API、Controller、Worker 必须从同一版本构建并协调更新，不能只更新其中一项。** 升级沿用现有部署停机/活动任务收尾流程；回滚同样要整套回滚。

此修改无需新增数据库迁移。本次只完成代码与隔离环境验证，未更新正在运行的本地服务或部署环境。
