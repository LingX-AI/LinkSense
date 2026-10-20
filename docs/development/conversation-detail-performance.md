# 对话详情的思考记录查询优化

`GET /api/v1/conversations/:id` 会补充读取当前历史页内的完整思考记录。原查询对每条 `item/reasoning/textDelta` 执行关联 `NOT EXISTS`，反复查找同一任务、同一条目的后续完成事件；增量越多，重复扫描越明显。

查询复用现有 Prisma 和 PostgreSQL：先在当前对话及历史页的任务范围内，按任务与条目 ID 聚合完成事件的最大序号，再通过 `LEFT JOIN` 判断增量是否被后续完成事件覆盖。`MATERIALIZED` 保证完成记录聚合只执行一次。不增加依赖、索引或数据库迁移。

以下语义保持一致：

- 返回完整思考正文，保留未完成、中断时的增量，按事件序号排序。
- 同一条目多次完成时，只过滤最后一次完成之前的增量，保留其后的增量。
- 不同对话、不同任务和历史页之间相互隔离。
- 完成记录聚合沿用原查询对全部可见性级别的处理，最终只返回允许展示的事件。
- JSON 缺失字段和 `null` 保持原有 SQL 比较语义；服务继续严格校验返回行及原生事件，拒绝越权或损坏数据。

本次不改变接口响应结构、前端交互、事件写入或 Codex 生命周期。

## 本地对照结果

2026-10-20，在独立 PostgreSQL 16 临时容器中应用项目现有正式迁移，构造 6453 条事件：187 条开始记录、6079 条增量、187 条完成记录。新旧查询读取同一批已持久化数据，返回值逐项相等。

| 指标 | 原查询 | 优化后 |
| --- | ---: | ---: |
| SQL 执行时间 | 718.915 ms | 2.101 ms |
| 完成记录查询或聚合的执行次数 | 6079 次关联子查询 | 1 次聚合 |

时间来自 `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)`。回归脚本校验结果一致、无逐增量关联 `SubPlan`、完成记录只聚合一次；不使用受机器负载影响的时间阈值判定测试成功。

以上是本地模拟数据结果，不代表生产会话的实际接口耗时。部署后仍需在相同会话上复测服务端及 HTTP 总耗时。

## 验证命令

从仓库根目录执行：

```sh
pnpm --filter @linksense/api test
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/api lint
pnpm --filter @linksense/api build
pnpm --filter @linksense/api exec tsx test/integration/conversation-reasoning-postgres.ts
```

集成脚本仅使用自己创建的临时数据库和容器，不读取应用 `.env`；结束时断开连接并清理该容器。需要 Docker 和已存在的 `postgres:16-alpine` 镜像。原查询仅保留在该测试脚本中作为结果与执行计划的对照，不参与应用运行。
