# DeerFlow 可借鉴机制与 LinkSense 边界评估

调研日期：2026-09-09。

## 结论

DeerFlow 最值得 LinkSense 参考的，不是它基于 LangGraph 实现的 Agent 循环，而是围绕不可信扩展、容器执行、定时任务、审计和产物交付形成的控制面机制。

建议优先投入以下方向：

1. Skill / Plugin 供应链审查。
2. Worker 出站网络策略。
3. 自动化 occurrence 的不可变执行快照。
4. 统一执行清单、关联 ID 和隐私优先支持包。
5. 高敏托管集成的凭据代理。

工作区变更审查、Project、批量产物下载等适合随后补齐。DeerFlow 自己实现的 RunManager、checkpoint、续跑、压缩、记忆、子 Agent 和工具调用修复则不应移植；这些能力在 LinkSense 中应继续以当前项目实际使用的 `codex app-server` 为权威。

## 研究基线与成熟度

- DeerFlow 基线：`main` commit [`0d4925305a6330a3442dcd336ed25750aea87cbd`](https://github.com/bytedance/deer-flow/tree/0d4925305a6330a3442dcd336ed25750aea87cbd)。
- LinkSense 对照基线：本地 `main` commit `e21b160e336a7d8231c9ca1a293ceb19048c499a`。
- 资料范围：仅使用 DeerFlow 官方仓库中的源码、测试、文档、Changelog 和官方 Release，不使用二手文章。
- DeerFlow 的 Changelog 仍将下面大多数机制列在面向 2.1.0 的 [`[Unreleased]`](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L8-L11) 中；当前正式 Release 是 [`v2.0.0`](https://github.com/bytedance/deer-flow/releases/tag/v2.0.0)。即使 main 上已经有源码和较完整测试，也只能评价为“已实现、尚未形成稳定发布契约”。
- DeerFlow 采用 [MIT License](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/LICENSE)。本文建议借鉴设计约束和数据契约，不建议直接移植 Python / LangGraph 实现；若复制了实质代码，必须保留许可证声明。

DeerFlow 的 Agent runtime 嵌入 Gateway，直接负责 thread、middleware、tool、checkpoint 和 SSE；[官方架构文档](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/docs/ARCHITECTURE.md#L51-L88) 对此写得很明确。LinkSense 的分界相反：Codex 负责线程与轮次语义，LinkSense 负责认证、授权、隔离、调度、持久化、审计和 UI。因此下面每项建议都以“不能重写 Codex 生命周期”为筛选条件。

## 优先级总览

| 优先级 | 机制 | LinkSense 当前基础 | 建议增量 | DeerFlow main 成熟度 |
| --- | --- | --- | --- | --- |
| P0 | Skill / Plugin 供应链审查 | 已有安全解包、结构校验和风险摘要 | 增加确定性内容扫描、只读审查、版本化 findings、hash-gated 发布 | SkillScan Phase 1，源码和测试已存在，2.1 未发布 |
| P0 | Worker 出站网络策略 | Worker 已隔离资源和网络，但接入通用 egress network；HTTP MCP 已有专用代理 | 增加组织/应用级 `isolated` / `allowlist` profile，策略摘要成为 Worker identity | opt-in、Docker 28+、只覆盖 HTTP(S)，2.1 未发布 |
| P1 | Automation 不可变快照 | 已有 `AutomationRun`、幂等键、排队和 Codex 原生 turn 提交 | occurrence admission 时冻结指令、模型、应用及能力版本；可选 fresh task / reuse task | durable occurrence 设计已有实现，2.1 未发布 |
| P1 | 执行清单与关联 ID | Turn / start intent 已固化模型、能力和 MCP；各服务有 request id | 增加用户可查的 redacted execution manifest 与贯穿 API、Runner、模型网关、审计的 execution trace id | trace 与 assembly descriptor 均在 main，2.1 未发布 |
| P1 | 隐私优先支持包 | 已有 health / readiness、资源监控和部署 doctor | 增加管理员可预览、可下载、schema-versioned 的脱敏支持包 | 生成器和测试已存在，2.1 未发布 |
| P1 | 高敏托管集成凭据代理 | HTTP MCP 已用服务端代理注入凭据；stdio MCP 将值注入子进程环境 | 仅对高价值、协议可约束的托管集成使用 broker；任意 stdio 保持明确高风险 | Lark broker 默认关闭，2.1 未发布 |
| P1 | 双层授权收敛 | 已有组织、应用、能力、知识库和凭据授权 | 统一为可审计 policy decision：装配前过滤，LinkSense-owned 执行点再次校验 | 统一 AuthorizationProvider 已实现，2.1 未发布 |
| P2 | 产物收据与批量下载 | 已有严格 artifact registration、MinIO、checksum 和用户可见事件 | 增加每 turn 交付状态、从已注册对象生成 ZIP；不得改写 Codex terminal status | delivery receipt 和安全 ZIP 已实现，2.1 未发布 |
| P2 | 工作区变更审查 | 已映射 Codex `fileChange`，有安全路径摘要，主动禁止原始 diff 进入事件 | 先核对 app-server 是否已有 review 接口；确认缺口后再做授权、按需、bounded diff | 前后快照、敏感文件降级和 UI 已实现，2.1 未发布 |
| P2 | Projects / Workspaces | 已有任务、分支、归档、应用和知识库，但未见独立 Project 域模型 | 先做纯组织层 Project；应用仍是执行模板，Project 不共享 Codex 上下文 | Projects MVP Phase 1，2.1 未发布 |

## P0：Skill / Plugin 供应链审查

### DeerFlow 的机制

DeerFlow 把“安全解包”和“内容是否危险”视为两层不同的问题：

- 安装器拒绝绝对路径、父目录穿越、NTFS ADS、非法根目录等，并对条目数、单文件与总解压量设限。[installer.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/skills/installer.py#L64-L192)
- 确定性 SkillScan 检查私钥和高置信 token、动态执行、shell 执行、敏感路径读取与网络外传组合、reverse shell、云 metadata、fork bomb、破坏性 shell 等。当前策略是 `CRITICAL` 阻断，其他等级告警。[orchestrator.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/skills/skillscan/orchestrator.py#L37-L87) · [阻断策略](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/skills/skillscan/orchestrator.py#L152-L174)
- Skill reviewer 以只读、bounded reader 读取待审包，不安装、不激活、不执行目标代码。[readers.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/skills/review/readers.py#L119-L213)
- Changelog 明确将它称为 [`Native SkillScan (phase 1)`](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L232-L243)，说明规则覆盖率和误报策略仍会继续变化。

### LinkSense 的现状与缺口

LinkSense 已有很扎实的第一层：[`DEFAULT_CAPABILITY_PACKAGE_LIMITS`](../../apps/api/src/modules/capabilities/importer.ts#L55-L77) 限制压缩包、条目、解压总量和压缩比；[`extractArchive`](../../apps/api/src/modules/capabilities/importer.ts#L390-L455) 拒绝重复路径、symlink、超限条目和路径逃逸。

现有 [`scanRiskSummary`](../../apps/api/src/modules/capabilities/importer.ts#L931-L977) 主要识别“是否包含脚本、MCP、URL、依赖下载命令、环境变量声明”，适合作为管理员提示，但还不是内容安全扫描。例如它不能直接给出私钥、凭据外传、动态执行或 reverse shell 的 rule-level finding。

### 建议的 LinkSense 契约

导入和发布流程建议固定为：

```text
staging
  → 安全解包与结构校验
  → 确定性内容扫描
  → 可选 LLM 辅助审查（只读、仅供参考）
  → 权限 / 联网 / 依赖 / 凭据需求清单
  → 管理员批准或带理由 waiver
  → 绑定内容 SHA-256 和 scanner version 发布
  → 启用时验证发布 hash
```

每个 finding 至少包含 `scanner_version`、`rule_id`、`severity`、相对文件、行号、脱敏 evidence、修复建议和扫描时间。内容 hash 改变后，旧审批和 waiver 自动失效。阻断应只依赖确定性、高置信规则；LLM 审查不能作为唯一阻断器，也不能执行包内代码。

建议落点是现有 `apps/api/src/modules/capabilities` 导入、预览、市场发布链路及对应 shared schema；ClawHub 上游的安全状态只能是额外信号，不能替代 LinkSense 本地 admission。

### 代价和边界

- 静态扫描只能降低风险，不能证明安全；跨文件数据流、混淆代码和运行时下载仍可能绕过。
- 规则升级会引入误报和历史包重新评估问题，需要 scanner version、例外理由、操作者和有效期。
- 不要照搬 DeerFlow 的阈值。LinkSense 当前包大小与使用场景不同，应基于已有上限继续收紧，不应因为 DeerFlow 允许更大包而放宽。

## P0：Worker 出站网络策略

### DeerFlow 的机制

DeerFlow 为 AIO Docker sandbox 定义了 `open`、`isolated`、`allowlist` 三种模式，allowlist 支持精确域名和前导通配符，并拒绝把 IP literal 当成域名规则。[sandbox_config.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/config/sandbox_config.py#L6-L71)

受限 sandbox 位于内部网络，受信 sidecar 只代理 HTTP absolute-form 与 HTTPS CONNECT；代理自行解析 DNS，并拒绝非公网地址。[network_proxy.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/community/aio_sandbox/network_proxy.py#L1-L6) · [公网地址检查](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/community/aio_sandbox/network_proxy.py#L75-L136)

官方配置文档还把 policy digest 纳入 sandbox identity：策略或 proxy image 变化后，不复用旧 sandbox。该机制要求 Docker Engine 28+，仅覆盖 HTTP(S)，且 `open` 仍为兼容默认。[配置说明](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/docs/CONFIGURATION.md#L728-L810) · [Changelog 限制](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L381-L389)

### LinkSense 的现状与缺口

LinkSense Worker 已有只读根文件系统、capability drop、`no-new-privileges`、PID / CPU / memory 上限和受控挂载，这是很好的执行隔离基础。[worker-manager.ts](../../apps/runner/src/controller/worker-manager.ts#L1345-L1438)

但每个 Worker 仍连接同一个 `LINKSENSE_WORKER_EGRESS_NETWORK`；这里体现的是“有独立出口网络”，并非按组织、应用或能力限制目的地。[worker-manager.ts](../../apps/runner/src/controller/worker-manager.ts#L1428-L1436) 现有 HTTP MCP 代理已经实现请求头白名单、服务端凭据注入、超时和拒绝重定向，可作为代理边界的局部先例。[http-egress-proxy.ts](../../apps/runner/src/mcp/http-egress-proxy.ts#L24-L149)

### 建议的 LinkSense 契约

第一阶段只做静态策略，不引入新的暂停/续跑语义：

- 定义组织或应用级 `egress_profile`：`isolated`、`allowlist`、受控 `open`。
- 让非控制面流量只能经过受信网络代理；代理负责 DNS，拒绝 loopback、private、link-local、metadata、IP literal 和重定向后的越权目的地。
- 将规范化域名规则、批准范围、代理镜像版本和协议版本计算为 digest，放入 Worker contract；digest 变化即回收并重建 Worker。
- 记录结构化 denial：owner、application、turn、目标域名、端口、规则和 decision，不记录 URL query、body 或 secret header。
- 为依赖安装、模型、搜索和托管服务建立显式 profile，不让 `*.com` 一类宽泛规则成为常态。

动态临时授权放到第二阶段。只有当前项目实际使用的 app-server schema 能提供合适的用户输入/工具挂起边界时，才允许复用 LinkSense 已有 durable user-input UI；否则代理应直接返回确定性拒绝，不能通过自定义 turn continuation 假装恢复原工具调用。

### 代价和边界

- 无 TLS MITM 时，HTTPS CONNECT 通常只能约束 host / port，无法区分同域多租户和具体路径。
- HTTP(S) proxy 不覆盖 UDP、QUIC 和任意 TCP，需要从容器网络层确保旁路不可达。
- DNS rebinding、IPv4 / IPv6、IDNA、企业代理、包管理镜像均需失败路径测试。
- 不建议沿用 DeerFlow 的 `open` 默认。LinkSense 面向组织，宜按风险分级迁移：先 audit-only，再对高风险应用默认 allowlist / isolated。

## P1：Automation occurrence 的不可变执行快照

### DeerFlow 的机制

DeerFlow 将 schedule definition 和每次 occurrence ledger 分开，并提供 `fresh_thread_per_run` 与 `reuse_thread` 两种上下文模式；scheduler 只决定何时启动，实际执行仍走正常 run path。[Scheduled Tasks 设计](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/docs/superpowers/specs/2026-07-01-scheduled-tasks-mvp-design.md#L21-L30) · [执行边界](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/docs/superpowers/specs/2026-07-01-scheduled-tasks-mvp-design.md#L116-L127)

main 上进一步将 busy reused-thread occurrence 放入可跨重启恢复的 durable queue。[Changelog](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L1086-L1094)

### LinkSense 的现状与缺口

LinkSense 已经用 [`AutomationRun`](../../prisma/schema.prisma#L1757-L1779) 记录 occurrence、幂等键和 turn / pending request，`claimOccurrence` 也在事务中锁定定义并创建 run。[repository.ts](../../apps/api/src/modules/automations/repository.ts#L258-L343) 执行仍通过 `submitScheduledTurn` 进入现有 Codex 路径，这个方向正确。[service.ts](../../apps/api/src/modules/automations/service.ts#L368-L447)

当前 `AutomationRun` 不保存本次 occurrence 使用的 instruction、model、reasoning、application / capability generation 等不可变快照。进程在 `dispatching` 阶段失败后重领，或请求进入 pending queue 后，审计记录难以单独回答“这次原本被批准执行的配置是什么”。

### 建议的 LinkSense 契约

- occurrence admission 时冻结 `instruction`、model / reasoning、target mode、application id + version、capability / MCP generation、knowledge base ids 和授权 policy id；对敏感信息只保存 key / id / digest，不保存值。
- `AutomationRun` 指向该不可变 snapshot。后续修改 automation definition 只影响新 occurrence。
- 增加 `context_mode: reuse_task | fresh_task_per_run`，保留现有 reuse 行为作为兼容默认。fresh 模式每次创建新的 LinkSense task，再恰好提交一次原生 Codex turn。
- queued occurrence 展示其 snapshot 摘要；取消、过期和失败都写 occurrence 状态，不制造额外 Codex turn 状态。
- 调度层可以安全重试“claim / enqueue / dispatch bookkeeping”，但绝不能自动重放一个已经被 Codex 接受的完整 turn。

这项改动涉及新增 Prisma 字段或快照表，真正实施前应按项目迁移规则确认兼容方案；本文没有修改数据库。

## P1：执行清单、关联 ID 与支持包

这三项适合按同一个“可诊断执行”主题设计，但可以分期交付。

### Effective execution manifest

DeerFlow 的 assembly descriptor 记录 resolved model、prompt hash、授权后 tools、middleware / policy、deferred tools、skills 和 effective policies，并对无序集合排序、保留有意义的 middleware 顺序来生成 fingerprint。[extensions/AGENTS.md](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/extensions/AGENTS.md#L157-L172)

LinkSense 已在 [`ConversationTurnStartIntent`](../../prisma/schema.prisma#L837-L879) 固化 application instructions、model、capability / MCP generation、解析后的列表和 credential usage receipts，随后在 [`ConversationTurn`](../../prisma/schema.prisma#L774-L811) 保存关键执行选择。建议把这些已有事实投影成 schema-versioned、可审计但脱敏的 manifest，而不是再创建一套运行时：

- application id、更新时间或版本、instructions hash；
- model id、provider configuration revision、reasoning effort；
- capability / MCP id、版本、内容 hash 和最终授权结果；
- sandbox profile digest、Worker image / contract revision；
- Codex thread / turn / item 原生 ID；
- secret 只记录 credential id、key name 和使用 receipt，不记录值。

manifest 用于复现和解释，不用于重放 turn。它应在 admission 后不可变，并可从任务详情和审计日志查看。

### End-to-end execution correlation

DeerFlow 现在为每个 HTTP 响应，包括 SSE 和 response-start 前的 500，写 `X-Trace-Id`；同一个 ID 进入 run metadata、checkpoint、scheduled task 和观测系统。[trace_middleware.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/app/gateway/trace_middleware.py#L11-L39) · [Changelog](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L15-L28)

LinkSense 已在 API 错误中返回 Fastify `request.id`，模型网关也有自己的 request id，但当前检索未发现一个贯穿 API admission、Runner、模型网关、事件、审计和 automation occurrence 的统一执行关联 ID。建议在 turn / occurrence admission 时由服务端签发 `execution_trace_id`，不可由请求 metadata 覆盖，并在所有结构化日志和支持界面传播。它只关联现有实体，不代表新的生命周期状态。

### Privacy-first support bundle

DeerFlow 的 `make support-bundle` 生成 `triage.json`、manifest、环境与配置摘要、issue draft 和 ZIP；默认不收 `.env`、原始对话和用户文件正文，thread 只收 workspace / upload / output 文件清单，并对命令输出和结构递归脱敏。[support_bundle.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/scripts/support_bundle.py#L23-L152) · [thread 摘要](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/scripts/support_bundle.py#L277-L320) · [最终清单](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/scripts/support_bundle.py#L780-L787)

LinkSense 可以复用现有 health / readiness、Docker 资源状态和部署 doctor，在管理后台提供：

1. 选择时间窗口或 `execution_trace_id`。
2. 先显示将被收集的字段、文件名和估算大小。
3. 管理员显式确认后生成短期下载包。
4. 包内包含 schema version、LinkSense build / Worker image revision、服务健康、redacted effective manifest、错误码与计数、相关日志的 allowlisted 字段。

默认排除对话正文、用户上传内容、产物正文、完整 URL、header、环境变量值和凭据。仅靠正则脱敏并不安全，应先采用字段 allowlist，再用正则做第二层防护；生成、下载和过期清理都要写审计。

## P1：高敏托管集成的凭据代理

### DeerFlow 的机制

DeerFlow 的 `required-secrets` 约束要求 secret 值不进入 prompt、message、tool args、command、trace、checkpoint 或 run record；宿主先清理 secret-shaped 环境变量，再只给当前调用注入已声明值，审计只记录名称。[skills/AGENTS.md](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/skills/AGENTS.md#L19-L32) · [secret_context.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/runtime/secret_context.py#L1-L182)

它也承认 env / mount 中的值仍可被 sandbox 代码读取，因此 Lark 的高价值凭据改由 sidecar broker 持有，sandbox 只看到 loopback shim。该实现默认关闭。[Changelog](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L369-L374)

### LinkSense 的建议边界

LinkSense 的 HTTP MCP 路径已经接近 broker：目标与凭据留在服务端，Worker 请求经过受控代理。任意 stdio MCP 则必然更危险：[`personalStdioChildEnvironment`](../../apps/runner/src/mcp/personal-stdio-launcher.ts#L75-L95) 将映射后的值放进目标子进程环境，目标代码拥有读取和外传它的能力。

不建议声称能为任意 stdio MCP 做“无感、通用的 secret broker”。现实可行的增量是：

- 默认清理所有未声明的 secret-shaped 环境变量和 `SSH_AUTH_SOCK`；
- manifest 只声明 key / credential binding，不保存值；
- 对飞书、Teams、企业微信、GitHub 等协议明确、价值高的托管集成提供窄接口 broker，sandbox 只能调用经过审计的 API 子集；
- 对任意 stdio MCP 明示“服务实现可读取所绑定凭据”，只有通过供应链审查与授权后才启用；
- 审计 credential id / key name / integration operation，不记录值、header 或完整外部响应。

代价是 broker 必须按协议维护，不能覆盖任意 CLI 和任意文件操作。这个限制比给用户不真实的“凭据隔离”承诺更重要。

## P1：统一 policy decision，装配前过滤与执行点复核

DeerFlow 将 `principal / resource / action / target / context` 输入交给统一 AuthorizationProvider：能力在 agent assembly 前被移除，真正执行时再复核；provider 异常默认 fail-closed。[enforcement.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/authz/enforcement.py#L15-L42) · [adapter.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/authz/adapter.py#L1-L15)

LinkSense 已有大量服务端资源授权，这项建议是“收敛决策和审计”，不是另造 RBAC：

- 向 Codex materialize Skills、MCP、应用资源前，计算一次 effective capability set，未授权资源不进入可见目录或配置。
- 在 LinkSense-owned MCP、文件、知识库、凭据和外部代理端点再次按当前身份、owner、application、resource state 校验。
- interactive approval 只能批准策略允许被批准的动作，不能越过组织级 deny。
- manifest 记录 policy id / version、decision 与 reason code，不记录敏感输入。
- 不尝试拦截或重写 Codex 自带 thread、turn、shell、file-tool 生命周期；若官方 schema 没有授权挂点，LinkSense 只能在自身拥有的资源边界执法。

## P2：产物收据、批量下载与工作区变更审查

### 产物收据与批量下载

DeerFlow 用 `present_files` 形成用户可见产物列表，并在 terminal 前持久化 `run.delivery`。它还会比较本 run 新增或修改的 output 与已 presentation path；main 当前会在应交付但没有 presentation 时把 DeerFlow 自己的 run 判错。[present_file_tool.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/tools/builtins/present_file_tool.py#L33-L120) · [worker.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/runtime/runs/worker.py#L254-L344)

LinkSense 的 [`registerArtifact`](../../apps/api/src/modules/files/service.ts#L563-L680) 已校验 owner、running turn、realpath descendant、regular file、稳定读取、大小、MIME 和 checksum，再写 MinIO、数据库与用户事件。这比重新扫描任意 workspace path 更适合作为 LinkSense 的交付事实源。

建议：

- 为明确声明“必须产生文件”的应用或 goal 增加独立 `delivery_status: not_required | pending | complete | incomplete`，依据已注册 artifact，而不是模型文本猜测。
- `incomplete` 只能成为 LinkSense 的交付告警或 needs-attention 状态，不能把 Codex 原生 completed turn 改写成 failed，也不能触发自动重放。
- “下载本 turn 全部产物”从数据库记录和 MinIO 对象生成 ZIP，不回头打包整个 workspace。
- ZIP 仍需成员数、单文件、总量、文件名、Unicode collision、超时和并发限制。DeerFlow 的 fail-closed ZIP 可作为威胁模型参考。[artifact_archive.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/app/gateway/artifact_archive.py#L68-L193)

### 工作区变更审查

DeerFlow 对 run 前后 workspace / outputs 做 bounded snapshot，排除 `.git`、cache、browser frames、tool result、`node_modules` 等；symlink 不跟随，敏感、二进制和大文件降级为 metadata-only。[scanner.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/workspace_changes/scanner.py#L19-L46) · [敏感路径和 symlink](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/workspace_changes/scanner.py#L80-L160) · [recorder.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/workspace_changes/recorder.py#L126-L237)

LinkSense 已将 app-server `fileChange` 投影为路径和 add / update / delete kind；[`events.ts`](../../packages/shared/src/events.ts#L1022-L1036) 明确不让原始 diff 和 tool output 泄漏到业务事件，这是应该保留的安全边界。

如果需要完整 review，先核对项目实际使用的 `codex app-server` schema 和官方文档：

1. 如果 Codex 已提供 turn / item 级 review 或 diff 读取接口，直接授权后按需调用并展示。
2. 只有确认原生能力缺失且用户批准补充后，才实现 LinkSense worker-side bounded snapshot / diff。
3. raw diff 不写入通用 SSE / event journal；仅在 owner authorization、审计和短 TTL 下按需返回。
4. 敏感路径、symlink、二进制和大文件只能返回元数据，不能提供内容差异。

## P2：Projects / Workspaces 与小型 UX 增量

DeerFlow Projects MVP 提供侧栏分组、Project 详情、Project 内预创建 thread、分支继承、移动、归档、恢复和删除。[Changelog](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L451-L467) 数据模型刻意把名称等展示属性与 `threads_meta.project_id` 成员关系分开，并明确 Phase 1 不加入共享 memory / agent config。[model.py](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/packages/harness/deerflow/persistence/projects/model.py#L1-L36)

LinkSense 可以将 Project 定义为纯组织控制面：

- Application 是“如何执行”的版本化模板；Project 是“这些任务属于哪个工作”的容器。
- 新任务必须在第一次 Codex turn 之前持久化 project membership，避免 run 已启动但列表归属错误。
- fork 默认继承 Project，用户可移动；Project 删除只解除成员关系，不删除任务。
- 第一阶段不共享 Codex context、memory 或 workspace，也不暗中注入 Project instructions。
- 如果未来增加 Project instructions，必须明示与 Application instructions 的优先级，并作为可见、可审计的 native turn input 组成部分，而不是隐藏记忆。

DeerFlow 还加入了长对话 outline，以及基于 delivery receipt 的“本 run 全部文件 ZIP”。[Changelog](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/CHANGELOG.md#L435-L444) 这两项都是低风险 UX 增量：outline 可在前端从已有 user messages 计算；ZIP 应沿用上面的已注册 artifact 边界。

## 明确不要复制

| DeerFlow 机制 | 不复制的原因 | LinkSense 应采用的做法 |
| --- | --- | --- |
| LangGraph `RunManager`、checkpoint、rollback、stream bridge、run recovery | 会形成第二套 thread / turn 权威状态 | 继续映射当前 app-server 原生 ID、事件和终态；LinkSense 只保存稳定投影和外部控制面状态 |
| `/goal` evaluator、隐藏 goal continuation、TokenBudget middleware | LinkSense 已使用 Codex Goal 与原生 token usage；自定义续跑会制造额外 attempts | 只暴露和持久化 Codex 原生 goal / usage，不自行重放 turn |
| 自定义 lead / subagent / durable batch agent runtime | Codex 已有原生协作 Agent；复制会造成身份、进度、取消与恢复语义冲突 | 映射原生 agent 事件；BullMQ 只负责非 Agent 平台工作或一次性 admission bookkeeping |
| Summarization、context compaction、DeerMem 注入 | 属于 Agent engine 上下文策略 | 复用 Codex 原生线程、压缩和个性化记忆；LinkSense 只负责用户开关、授权和数据治理 |
| `ReadBeforeWriteMiddleware` | 会拦截、改变 Codex 文件工具行为，且 DeerFlow 实现依赖自身 graph/tool state | 依赖 Codex 原生文件编辑并发语义；仅在 LinkSense 自有 artifact editor 上使用 ETag / hash 并发控制 |
| Tool receipt ledger 注入模型、subagent report citation verification | DeerFlow 的 receipt 序号和报告协议属于它自己的 runtime；注入另一套模型协议会污染 Codex 上下文 | 审计可引用 app-server 原生 tool / item ID 和 LinkSense redacted event；不要让模型学习第二套 receipt 语法 |
| 自定义 tool-call repair、loop detector、recursion limiter | 会改变模型与工具的执行尝试和终止原因 | 等待并使用 app-server 原生行为；必要时只做外部资源限额与告警 |
| DeerFlow `ask_clarification` / structured form runtime | LinkSense 已有 app-server `item/tool/requestUserInput` 和 durable interactive form | 继续复用现有 native request 与 LinkSense-owned form projection，不另建 clarification lifecycle |
| DeerFlow durable MCP task runtime | 可能与当前 app-server 对 MCP Tasks 的支持重叠，并带来 polling / cancel / completion 双重状态 | 先核对当前 app-server schema；只有确认缺口、说明维护成本并获得批准后才补控制面 adapter |
| Gateway 可导入的任意 Python extensions | 企业环境扩大供应链和远程代码执行面 | 扩展继续走审查、版本化、隔离的 Skill / Plugin / MCP 契约，不让 API 可写配置直接加载宿主代码 |
| DooD 原始 Docker socket、`open` egress、`seccomp=unconfined` 式兼容默认 | 与面向组织的 least-privilege 目标冲突 | Worker 管理由受信 Runner 控制；用户代码拿不到 Docker socket；受限应用默认 allowlist / isolated |
| Agent 在对话中直接改 `SOUL.md`、全局 config 或生产策略 | 容易将 prompt injection 变成持久控制面变更 | 只允许生成提议草稿，经授权用户审阅、diff、批准和审计后发布 |

DeerFlow 的 run-event 文档也明确说明 `run.end` 不是权威生命周期状态，而是流传输控制信号。[RUN_EVENT_STREAM.md](https://github.com/bytedance/deer-flow/blob/0d4925305a6330a3442dcd336ed25750aea87cbd/backend/docs/RUN_EVENT_STREAM.md#L198-L212) 这正好印证 LinkSense 当前原则：传输事件不能自行发明或改写 Codex 终态。

## 建议实施顺序

### 阶段 1：先降低不可信代码风险

1. 在 capability import / marketplace publish 前增加确定性 SkillScan contract。
2. 为现有 Worker 增加静态 egress profile 与 policy digest；先 audit-only，再对高风险应用收紧。
3. 将任意 stdio MCP 的凭据可见性明确展示在风险摘要中。

验收重点：恶意 ZIP、凭据、外传、私网目标、DNS rebinding、policy 漂移、未授权启用和 waiver 过期都 fail-closed；不改变任何 Codex turn / item 状态。

### 阶段 2：让执行可解释、可复现

1. Automation occurrence admission snapshot。
2. Redacted effective execution manifest。
3. End-to-end `execution_trace_id`。
4. 管理员 support bundle。

验收重点：给定一个 automation run 或 turn，可以回答“谁、何时、用什么应用/模型/能力/授权/Worker 合同启动了哪个原生 Codex turn”，但不能据此自动重放，也不能泄漏用户正文和 secret。

### 阶段 3：补产品交付体验

1. 基于已注册 artifact 的 delivery status 和批量 ZIP。
2. 核对 app-server 后决定是否增加 workspace diff review。
3. Project 纯组织层和长对话 outline。

验收重点：交付告警与 Codex terminal status 分离；Project 不隐式共享上下文；raw diff 和产物内容不进入通用事件或诊断包。

## 决策门槛

每个后续实现应先回答以下问题：

1. 这是 Codex 原生 thread / turn / item / tool / approval / retry / recovery 语义吗？如果是，停止并先核对当前 app-server schema。
2. LinkSense 是否拥有这个资源边界，例如 capability admission、credential broker、network proxy、artifact registry、automation scheduler 或 audit？只有拥有边界才适合执法。
3. 新状态是否只是对原生状态的不可变引用或独立控制面状态？如果它会替换 Codex 状态，设计不成立。
4. 失败时是否会制造第二次完整 Codex turn？如果会，设计不成立。
5. 审计、诊断和支持数据是否默认排除用户正文、文件正文、URL query、header 和 secret？如果不是，不能上线。

按这个门槛筛选后，DeerFlow 可以成为 LinkSense 很好的安全与产品控制面样本，但不应成为第二套 Agent engine。
