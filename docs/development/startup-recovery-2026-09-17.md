# 2026-09-17 开发启动与退出故障排查

## 现场结论

本次无法启动发生在 API 的 `task-recovery` 阶段。Runner、PostgreSQL、Redis 均正常，API 容器仍在运行，但 4000 端口未监听。Vite 的 `ECONNREFUSED` 是下游表现。

恢复一条已有的运行中任务时，`McpServerService.resolveRecovery()` 将任务的空 MCP 快照与用户当前的全部个人 MCP 比较，抛出 `CONFLICT`。外层将它归类为 `RUNNING_TURN_RECOVERY_FAILED`，API 因此启动失败。

另外，失败清理和热更新退出都会等待后台工作完成：

- 知识库索引校验等待整轮文档扫描；现场有 36 份文档，Elasticsearch 单次请求超时为 60 秒，关闭信号没有传给请求。
- ClawHub 调用 `worker.close()` 后等待完整目录同步结束，网络请求和重试等待没有收到取消信号。[BullMQ 文档](https://docs.bullmq.io/guide/workers/graceful-shutdown)说明该关闭方法自身没有超时，必须让处理中的任务及时结束。
- `pnpm dev` 还会输出每个服务最近 20 行历史日志，将以前的代理失败混入本次正常启动。

本次 API 的 cgroup `oom`、`oom_kill`、`oom_group_kill` 均为 0。重启时观察到的退出码 137 对应 Docker 先发 SIGTERM、等待 10 秒后再发 SIGKILL，不能据此认定是 OOM。此前的内存问题和优化建议见 [OOM 分析](./oom-analysis-2026-09-17.md)。

## 修复

1. 以任务持久化的 MCP 选择为恢复边界，复用已有的指定服务器校验。无关的新增 MCP 不再阻塞旧任务，也不会把其凭据注入旧任务。快照中服务器的所有权、启用状态、重复 ID、版本及凭据变更仍严格校验。
2. ClawHub 复用 [BullMQ 原生取消信号](https://docs.bullmq.io/guide/workers/cancelling-jobs)，传到现有 HTTP 客户端及 `p-retry`。停止消费后取消当前任务；失败的同步不会发布不完整目录。
3. 索引校验在关闭时取消扫描，通过文档锁传递取消信号，最终使用官方 Elasticsearch 客户端的 `signal` 选项中止请求。取消后不推进扫描游标，下次仍可重新检查未完成的文档。
4. API 记录各资源组关闭的开始、结束、耗时和失败数量，便于直接定位停在哪一步；日志不输出原始异常或凭据。
5. 开发日志改为 `--since` 本次启动时间，保留日志连接前产生的本次启动错误，排除之前会话的历史输出。

未修改数据库结构或迁移，未手工修改任务状态或凭据；原阻塞任务通过原有 Runner 恢复流程得到完成状态，没有手工清除运行记录或重放输入。无需重建已有资源。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| 修复后首次 `pnpm dev` | 18.754 秒，输出 `LINKSENSE_DEV_READY` |
| 再次运行 `pnpm dev` | 4.529 秒，正常复用服务并启动监听 |
| API 容器重启 | 从 10.387 秒、SIGKILL、退出码 137 降为 1.306 秒、退出码 0 |
| 知识库资源关闭 | 502 毫秒 |
| 真实 BullMQ + 挂起的本地 HTTP 请求取消 | 7 毫秒结束，没有发布部分目录；隔离的测试队列已清理 |
| 官方 Elasticsearch 客户端取消 | 索引存在性、映射、计数、激活、清理五个 HTTP 阶段均通过测试 |
| HTTP | Web、bootstrap、API readiness、Web 代理 readiness 均为 200；未登录访问任务为 401 |
| 容器 | API、Runner、Web、Docs 均 healthy；API cgroup OOM 计数为 0 |

受影响 API 测试：57 个文件、1,162 项通过，覆盖知识库、恢复、MCP、ClawHub、启动和 Office；`pnpm test:deployment`：356 项通过。API 类型检查、改动文件 ESLint、API 构建和 `git diff --check` 均通过。

实际使用的主要命令：

```sh
pnpm --filter @linksense/api exec vitest run test/knowledge test/mcp-service.test.ts test/mcp-routes.test.ts test/services.preflight.test.ts test/conversations.service.test.ts test/events.service.test.ts test/index.test.ts test/clawhub-service.test.ts test/clawhub-scheduler.test.ts test/clawhub-client.test.ts test/office-converter.test.ts --maxWorkers=2 --maxConcurrency=2
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/api build
pnpm test:deployment
pnpm dev
```

验证范围是受影响后端和开发启动链路；未运行整个仓库的所有测试，也未做浏览器自动化或长时间内存压力测试。本次启动成功不能替代此前 OOM 优化方案中的负载验证。
