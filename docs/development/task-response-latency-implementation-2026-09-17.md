# 任务响应延迟优化：实施与验收记录

日期：2026-09-17。对应[源码审计与分阶段方案](task-response-latency-analysis-2026-09-17.md)。首轮修改 API、Runner、共享内部契约、Web 和原有延迟冒烟工具，未执行部署、数据库迁移或真实模型压测。用户随后要求本地实测，已完成真实页面和模型请求采样，并修复 Controller 遗漏启动回调转发的问题，详见[本地复测记录](task-response-latency-local-validation-2026-09-17.md)。下文未注明复测的测试数字与状态均为首轮记录。

工作区同时存在其他任务的持续修改；本记录仅归纳本次延迟优化。测试数字对应各命令执行时的工作区快照，未回退或整理其他任务的改动。

目标保持为新任务 3000 ms、连续对话 1000 ms 内出现本轮非空 AI 文字。创建成功、HTTP 202、推理事件、工具状态和转圈均不计作首字。代码回归通过不能代替本地及部署环境的性能达标验收。

## 已实现的关键路径优化

| 范围 | 实施结果 | 回归依据 |
| --- | --- | --- |
| 用户运行时协调 | Redis 原子共享租约允许后台预热与独立任务准入并行；账户变更和环境回收继续使用排他锁。租约续期、到期检查、等待写者屏障均在 Redis 协调 | 真实隔离 Redis 验证多实例互斥、等待写者阻止新读者、过期租约不能续期、错误 token 不能释放租约；单测覆盖续期失败后禁止提交 |
| 原生启动结果 | Runner 持久化启动结果后独立通知 API，API 从既有 durable operation 校验并建立业务 turn 关联；成功后立即唤醒待交付事件 | 通知前已经持久化、重复通知幂等、owner/generation 校验、API 不可达时仍只有一次原生提交；10 秒事件退避可被即时唤醒 |
| 项目预热 | 请求、队列、reservation 和认领携带项目及协作模式；目录由服务端授权记录解析；准备前和交付前检查项目仍归属当前用户 | 项目工作区一致、模式不符不认领、项目删除竞态、跨用户认领失败 |
| 预热有效期 | 前端按用户、页面、项目、模型配置管理作用域；活动可见页面每 5 分钟刷新，15 分钟无活动停止；运行中暂停后台刷新 | 模型查询未就绪不重复预热，作用域切换隔离，过期 reservation 更新；暂停刷新仍可认领已准备好的任务 |
| 运行容量 | 预热不逐出既有任务，达到预热容量后推迟；容量大于 1 时保留一个前台进程槽；正在执行的任务不被预热重新配置 | 容量边界、活动进程保护、前台仍能启动 |
| 凭据读取 | 使用现有 Prisma 事务按插件批量读取能力、禁用偏好、绑定和所需凭据；每次授权屏障重新读取，单批最多 4 次查询 | 多插件一次快照、重复绑定检查、禁用和撤销立即生效、owner 过滤、无插件不查询 |
| 重复工作 | 将已经授权的 RuntimePlacement 传给正常启动/检查请求，避免再次查询任务路径；运行时和模板版本未变化时不重复写入 | Runner adapter 验证不调用路径 resolver；既有会话与授权测试通过 |
| SSE 游标 | 仅推进已经处理的连续事件前缀；同一批提交合并一次 sessionStorage 写入；断线前刷入已提交游标 | 延后消费、乱序提交、补流、消费者抛错后可重发；不跳过未消费事件 |

复用项目已有 ioredis/Lua、Prisma、Zod、Pino、eventsource-parser、React 和 Performance API，没有为本次优化添加依赖。原有 Codex 原生恢复、审批、工具调用和整轮执行语义不变；新增通知是 LinkSense 的业务关联通知，不是新增一次 turn/start。

共享租约不会让同一个任务无序并行：已有任务锁、数据库事务和原生进程锁继续生效。账户变更等待在途租约排空，等待期间新租约被短期写者屏障挡住。后台租约每 40 秒续期一次，TTL 120 秒；续期失败或本地有效期耗尽后，创建持久化记录和分发原生启动前的检查会拒绝继续提交。

预热 receipt 现在明确表示已入队，不表示 native thread 已就绪。最终是否复用仍由 Runner 的运行时、能力、MCP 和配置指纹判断。旧的临时预热 reservation 不符合新 scope 时不会被认领；创建真实任务仍可正常执行。

## 首字测量与归因

| 层 | 新增观测 | 限制 |
| --- | --- | --- |
| API | 用户租约等待、任务锁等待、能力解析、Runner receipt、启动投影、HTTP 总时长；沿 Fastify request logger 关联 task/turn | 异步恢复请求有自己的 request ID，使用 conversationId/turnId 串联；各阶段可能重叠，不可直接求和 |
| Runner | native start 持久化完成耗时；进程是否复用及未复用原因 | 不是模型首字时间，也不是所有初始化子步骤的完整分解 |
| 模型网关 | 上游响应头、首字节、首段非空文字、正常流结束；HTTP 与 WebSocket 标记 | 协议首包不算首字；上游非流式 JSON 单列，未伪造其流式首字；已有错误日志继续提供超时和取消原因 |
| Web | 从发送开始到 SSE 首段文字、到 React 首次文字提交；新任务包括创建时间，允许 SSE 先于提交 receipt 到达 | React commit 不等于显示器已经绘制，仍需真实浏览器采样；最多保留有限数量的 pending/Performance 记录 |
| 冒烟脚本 | 新任务/续聊逐条检查 first_text_ms；首字缺失、非法测量、未正常完成或超时都会失败 | 观察 SSE 到达，不测浏览器绘制；订阅发生在提交 receipt 后，不能作为上游纯耗时 |

结构化日志消息分别为 `task admission latency`、`runner task latency`、`model upstream latency`。前端 Performance measure 名称为 `linksense:sse_first_text` 和 `linksense:ui_first_text_commit`，detail 仅含任务 ID、turn ID、任务类别。

网关在原有背压链路中观察流；测试验证原始响应字节未改写，UTF-8 分片与空白 delta 不误报首字。所有新增计时不写入用户输入、模型正文、密钥或认证头。

只允许根据同一任务/turn/request 的网关记录认定上游慢；不能把数据库、锁、冷启动、SSE 等待归入上游豁免。首轮没有实际归因样本；后续[本地复测](task-response-latency-local-validation-2026-09-17.md)已区分上游等待与 API OOM 导致的事件积压，整体仍未达标。

## 验证记录

以下为本次实际执行的验证。完整组件组后又增加了两个缺陷回归，最后一行的受影响测试在最终代码上执行；不将重复执行的数量累加成覆盖率。

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @linksense/api exec vitest run --pool=threads --maxWorkers=2 --maxConcurrency=2` | 254 文件、3118 项通过 |
| `pnpm --filter @linksense/runner test` | 64 文件、805 项通过；1 项原有条件跳过，本次未新增 skip |
| `pnpm --filter @linksense/shared test` | 57 文件、459 项通过 |
| `pnpm --filter @linksense/web exec vitest run --project application --maxWorkers=2` | 18 文件、227 项通过 |
| `pnpm --filter @linksense/web exec vitest run --project components --project shared-components --project node --maxWorkers=4` | 327 文件、3145 项通过 |
| `pnpm --filter @linksense/web exec vitest run src/api/sse.test.ts src/features/conversations/use-conversation-events.test.tsx src/features/conversations/use-conversation-prewarm.test.tsx src/features/conversations/response-latency.test.ts` | 最终受影响回归 4 文件、44 项通过 |
| `pnpm exec node --test scripts/latency-smoke.test.mjs` | 11 项通过；覆盖创建计时、冷项目参数、超标/缺字失败与终态后的 SSE 补流 |
| API、Runner、Web 的 `typecheck` 与 `lint` | 通过；Web 有一条既有 TanStack Virtual / React Compiler 警告，无错误 |
| shared、API、Runner、Web 的 `build` | 通过；Web 的已有大 chunk 提示仍存在 |
| `git diff --check` | 通过 |

曾并行运行多组完整测试和构建，引发主机争用及测试超时；改为分组执行后通过。未放宽超时、删断言或跳过失败测试。API 构建内置文档校验发现工作区已有文档内容改变，已将内置能力 digest 与实际打包内容同步。

首轮未运行浏览器或真实模型请求。随后用户明确要求自动测试，已使用 ego-browser 完成本地真实模型与页面验证；未执行部署环境压测或生产代理配置变更。

## 升级与现有资源

内部执行契约从 `user-project-runtime-v24` 更新为 `user-project-runtime-v25`。API、Controller、动态 Worker 镜像必须按同一发布单元更新。**不得让旧 API 排他锁实现与新共享租约实现同时服务请求**；旧写者看不到新读者，混合版本运行会破坏生命周期互斥。

发布顺序：

1. 在隔离环境构建和检查同版 shared、API、Controller、Worker 与 Web；使用项目固定的 Codex 版本验证原生流程。
2. 在维护窗口停止新的准入和预热，等待活动任务、启动 intent 与 outbox 正常收敛；不得以清空数据库或删除工作目录代替排空。
3. 同步切换全部 API 与 Controller/Worker 版本，确认运行契约一致和健康检查通过，再开放流量。
4. 验证原有普通/项目/应用任务能继续对话，权限撤销仍生效，未交付事件能够恢复；再执行下文延迟矩阵。

本次没有 Prisma schema 或迁移修改；start operation、intent、事件 outbox 的持久化结构未修改。用户存储路径和 owner storage key 未因 v25 改变。已有任务和 native history 不应要求用户重建；Controller 的现有契约检查会拒绝不匹配的 Worker。冷进程重建和临时预热失效可能使升级后的首次访问较慢，应单列。

现有恢复、重复投影、Worker 契约不匹配、授权与持久化测试已回归；**尚未在装有升级前数据的实际部署环境完成升级演练**。这仍是发布验收项，不能根据无数据库迁移就宣布升级无风险。回退同样先排空活动状态并整体切换，不混合新旧锁协议。

## 本地和部署环境的验收命令

先在受控测试账户配置 `LINKSENSE_LATENCY_ACCESS_TOKEN` 和 `LINKSENSE_LATENCY_API_URL`。令牌通过环境注入，不写入报告或命令历史。以下命令会调用模型并产生测试任务；未在本次实施中执行。

无预热的新任务及随后续聊：

```sh
LINKSENSE_LATENCY_ALLOW_TURN=1 \
LINKSENSE_LATENCY_SKIP_PREWARM=1 \
LINKSENSE_LATENCY_TURN_SAMPLES=2 \
LINKSENSE_LATENCY_ENFORCE=1 \
LINKSENSE_LATENCY_JSON=1 \
pnpm benchmark:latency
```

已有测试任务连续对话，在环境中设置 `LINKSENSE_LATENCY_CONVERSATION_ID`，然后执行：

```sh
LINKSENSE_LATENCY_ALLOW_TURN=1 \
LINKSENSE_LATENCY_TURN_SAMPLES=30 \
LINKSENSE_LATENCY_ENFORCE=1 \
LINKSENSE_LATENCY_JSON=1 \
pnpm benchmark:latency
```

项目任务设置 `LINKSENSE_LATENCY_PROJECT_ID`，协作模式设置 `LINKSENSE_LATENCY_COLLABORATION_MODE=plan` 或 `default`。未设置 `ALLOW_TURN=1` 的默认模式只测预热入队；其通过不代表首字达标。

同一任务上的 30 轮只有第一轮可能是新任务样本。采集 30 个新任务样本需要独立创建 30 次；同一热 Worker 上连续创建也不能称为 30 个冷 Worker 样本。真正冷 Worker 使用无既有 Worker 的专用账户，工具不包含停掉其他任务/容器的路径。默认在成功收集测量后清理临时任务，需保留原始事件时设置 `LINKSENSE_LATENCY_CLEANUP_EPHEMERAL=0`。

本地与部署分别采集：无预热、预热已就绪、预热在途、过期后、项目/普通/应用、模型/模式切换、长历史、长输出、并发容量边界、断线恢复。记录实际 SHA、镜像、Codex、资源限制和模型配置；逐条判断 3000/1000 ms，不将失败或缺字样本从分母删除。P95/P99 需要足够样本，不能拿单元测试耗时作为环境性能数据。

## 原方案中仍需证据触发的工作

- 阶段 F 的“创建任务并提交首条消息合并接口”原本以 B–E 后仍接近 3 秒为前提。本次保留现有两次 HTTP 请求；尚无优化后的真实环境样本来触发该分支。后续若确认网络往返是瓶颈，需要一并实现覆盖创建与首轮 intent 的持久化幂等，不能简单并发两个请求，也不能放弃预热 reservation 的原生任务身份复用。
- 登录时提前准备 Worker、进一步调整 TTL/容量尚未实施；需要真实冷启动比例、内存和容量数据，避免把所有用户永久保温。
- 阶段 G 的 Markdown 已完成块缓存以真实页面 profile 为前提，本次未修改 Streamdown 渲染策略。已完成游标合并与首字提交测量，但尚未测真实绘制、长任务、长输出停顿分布和代理缓冲。
- 阶段 A 的池等待、事件循环延迟、磁盘提交尾延迟及所有初始化子步骤尚未形成完整观测矩阵；当前已实现的是与本次直接修复相关的关键阶段。

因此，本记录确认关键路径代码与回归已落地，不宣称原方案所有条件分支已完成，也不宣称本地和部署已满足 3 秒 / 1 秒。发布与性能验收必须以实际样本闭环。
