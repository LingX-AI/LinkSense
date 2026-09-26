# Prompt Cache 全链路复核（2026-09-20）

复核基线：`b67cfb8`，Runner 固定 Codex `0.154.0`。本次仅分析并补充文档，未修改生产代码、配置、数据库或执行付费模型实验。

**优先级需要调整：当前最大的成本优化候选是记忆生成链路，其次是新任务／新轮次的公共上下文复用；“统一缓存 key”不再适合作为通用首选。** 先修复实验与计量，再评估独立的记忆模型策略和原生生成预算。以下区分已验证事实、推断和待实验方案。

## 1. 用量证据与统计边界

只读查询当前本地实例 PostgreSQL，窗口从 `2026-09-13 00:00:00 UTC` 起，查询于 2026-09-20。主任务最近记录为 `2026-09-20 03:32:27.663 UTC`。实例包含开发／测试流量，不能代表所有部署或生产用户。

命中率统一为 `sum(cached_input_tokens) / sum(input_tokens)`。费用来自数据库已有计价快照，单位 USD，**不是供应商账单**，也未补计当前未记录的缓存写入费用。部分模型配置价格为零，零费用不等于无资源消耗。

| 链路 | 记录口径 | 输入 Token | 缓存读取 Token | 读取命中率 | 非缓存读取输入 Token | 配置估算费用 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 主任务 | 1,396 条原生用量增量记录 | 83,579,907 | 80,121,046 | 95.86% | 3,458,861 | $35.8949 |
| 记忆提取 extract | 139 次模型请求 | 7,945,738 | 1,580,544 | 19.89% | 6,365,194 | $42.8096 |
| 记忆整合 consolidate | 744 次模型请求 | 58,630,411 | 55,913,161 | 95.37% | 2,717,250 | $48.0750 |
| 自动标题 | 32 次请求 | 14,513 | 0 | 0% | 14,513 | $0.0297 |
| 文档／查询 embedding | 37 次请求 | 1,227 | 0 | 0% | 1,227 | $0.0006 |

记忆链路合计约 $90.88，占上述已记录费用约 **71.7%**，是主任务费用的 **2.53 倍**。单独记忆提取的非缓存读取输入已是整个主任务链路的 **1.84 倍**。因此它比继续提高主任务总体命中率更值得投入。

“非缓存读取输入”是 input 减 read，其中可能包含未单独识别的 cache write，不能直接等同于供应商普通输入计费量。记忆的 883 条记录均标记为 `measurement_method=provider`，但缺失缓存字段仍可能被当前解析器写成零。

主任务总命中率也掩盖了差异：按模型看，deepseek-flash 为 97.60%，gpt-5.6-luna 为 80.25%，terra 为 88.57%。按完整历史中的首次观测位置分组后再筛选窗口，线程首条用量记录为 58.03%，后续轮次首条为 78.94%，轮内后续记录为 97.84%。这是**用量增量记录分组**，不等于 HTTP 请求数，也不能将“首次观测”直接认定为冷缓存。

整合的 744 次请求不等于 744 个记忆作业：一个原生整合 agent 可能进行多次模型请求和工具调用。现有数据不足以证明发生重复调度，应先补充运行归属再判断。

## 2. 当前全链路

| 环节 | 已核实状态 | 优化判断 |
| --- | --- | --- |
| 前端提交 | `apps/web/src/pages/conversation-pages.tsx:2964` 提交本次输入、能力选择、知识库选择、幂等键及模式 | 未发现由此提交完整聊天历史；无需在前端建立模型结果缓存 |
| API 调度 | `apps/api/src/modules/conversations/service.ts:11041` 从持久化 intent 还原上下文与原生 thread 标识 | 保持恢复、幂等和原生 turn 语义，不能为命中率重放完整 turn |
| 工作区 | `apps/runner/src/workspace/workspace-manager.ts:237` 同一用户共享 HOME、CODEX_HOME，默认工作区也共享；显式项目仍有不同 cwd | 上次“每任务随机工作区路径”的分析前提已变化 |
| 指令组装 | `apps/runner/src/context.ts:173` 固定平台规则、个性化、应用指令、知识库与附件通过 additionalContext 分源注入 | 普通任务与应用任务应分别实验；优先拆开大块内容中的固定／动态部分 |
| 长上下文传输 | `apps/runner/src/codex/additional-context.ts:11` 以全文摘要标记所有分片 | 局部变化会使所有分片变化；需要在源头分离内容，不能直接删除版本约束 |
| 原生会话 | `apps/runner/src/process-pool.ts:1969` 准备上下文后启动 turn；thread 使用原生 start/resume | 保留原生历史、压缩、模型切换和恢复行为；本次未重跑完整原生多轮上下文去重实验 |
| 工具与插件 | 能力物化有稳定排序；tool compatibility 会提升新发现工具至工具目录 | 继续检查工具目录的真实变化，不为缓存删除权限、版本或工具定义 |
| 原生 Responses | 网关传递原生请求；WebSocket 已处理 previous_response_id 对应工具映射 | 最近修复的映射复用不应再次列为未修复问题 |
| Chat 桥接 | `apps/runner/src/model-gateway/chat-completions-bridge.ts:27` 使用字段白名单 | 不保留缓存选项，也不主动请求流式 include_usage；需按供应商能力修复，收益取决于该路径流量 |
| 记忆请求 | `apps/runner/src/process-pool.ts:7628` extract 与 consolidation 模型均显式设置为前台模型 | 当前最高优先级候选；既要看命中，也要看调用规模、价格和输出量 |
| 计量／存储 | 原生协议有 cacheWriteInputTokens，内部事件、持久化与单价结构没有对应字段 | 目前不能完整比较“写一次、读多次”的成本 |
| 前端／账单 | 消费现有 input/read/output 契约与价格快照 | 补计量时必须同步类型、接口、展示、导出和账单语义 |
| 延迟 | 网关已有 upstream headers、first byte、first text 等阶段日志 | 在现有日志上关联用量与渠道，无需另造延迟体系 |

## 3. 最高优先级候选：记忆模型与原生生成预算

`memoryConfigOverrides` 将 `memories.extract_model`、`memories.consolidation_model` 设置为当前任务模型，生成与使用记忆也绑定到同一开关。结果是记忆处理的模型选择随前台任务变化，使用较贵前台模型时辅助链路也承担相应价格。样本中仅 sol 的 27 次记忆请求就产生约 $24.55 的配置费用。

建议按以下顺序实验，而非先建设自定义缓存或记忆调度器：

1. 对 extract 和 consolidate 分别测量每次成功作业的输入、输出、模型请求数、费用和质量。整合已有 95.37% 的读取命中率，主要关注规模和模型单价；提取只有 19.89%，同时检查重复前缀和输入规模。
2. 验证独立、稳定的记忆模型策略，不随前台任务随意切换。用真实脱敏任务的事实保留、偏好准确性、过期信息处理和后续任务表现验收，不能仅按价格选模型。
3. 优先验证原生候选数量、历史窗口和整合规模控制。官方当前配置包含 `memories.max_rollouts_per_startup`、`max_rollout_age_days`、`max_raw_memories_for_consolidation`、`min_rollout_idle_hours` 等；**正式采用前要在固定的 0.154.0 中验证字段、边界和实际效果**，不能把最新文档默认值当成部署值。[官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)
4. 保留外部上下文场景的原生记忆限制，不为了缓存率扩大记忆采集范围。若拆开“使用”和“生成”开关，应明确既有历史和待处理候选的原生行为。

不能只改两个模型配置：`model-gateway.ts:2283` 的授权只接受 lease 模型或受控模型切换压缩源。独立记忆模型必须配套渠道解析、限定用途的授权、价格快照、用量归属、配置验证及管理界面，避免 403 或按错误模型计价。不同模型／渠道不共享缓存，因此“便宜模型策略”是成本优化，不能承诺它必然提高命中率。

## 4. 必须先补齐的计量

原生 `TokenUsageBreakdown` 已有 `cacheWriteInputTokens`，但 `apps/runner/src/codex/event-mapper.ts:510` 白名单丢弃它；`packages/shared/src/events.ts:1369` 的严格 schema、Prisma 两张 usage 表及 `packages/shared/src/model-pricing.ts` 都未保留写入量／写入价格。API 当前按 `(input-read) × 普通输入价 + read × 缓存读取价 + output × 输出价` 计价。

如果目标渠道对缓存写入单独收费，这个公式不足以核算实际缓存收益。官方 GPT-5.6 及以后模型明确区分普通输入、缓存读取和缓存写入；必须先核实转发渠道返回字段与计费合同，不直接套用官方倍率。[官方缓存计价说明](https://developers.openai.com/api/docs/guides/prompt-caching)

建议扩展现有体系，采集以下必要元数据，避免记录完整 prompt、工具结果或密钥：

- workload、operation、原生运行归属、渠道／协议、配置模型与返回模型、请求关联 ID。
- input、read、write、output，以及每个字段是已观测、估算还是未知。
- 首字延迟及总耗时，复用 `model-gateway/latency.ts`。
- 必要时记录带作用域的工具／固定前缀指纹；用于比较变化，不把客户端 JSON 字符数当成供应商 Token 数。

现有 `readProviderTokenUsage` 及 Chat usage 归一化会将缺失 cached_tokens 写成零。应区分“明确零命中”和“渠道未返回数据”，否则桥接渠道看似低命中也可能只是可观测性缺失。

在支持的官方 Responses 渠道，可小比例使用 `prompt_cache_options.comparison_response_id` 获取原生缓存诊断，辅助区分工具变化、模型变化等原因；这仅请求诊断，不加载历史或强制缓存。转发渠道是否支持需要独立验证。[官方缓存诊断](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics)

## 5. 公共前缀仍有空间，但要重新建立基线

2026-09-11 的实验基于 Codex 0.150.1、每任务目录与生成的任务 AGENTS.md。当前同用户新任务默认使用相同 workspace，且不生成该 AGENTS.md。

本次隔离探针确认：两个新任务 `sameWorkspace=true`、`sameHome=true`、`sameCodexHome=true`，`generatedWorkspaceAgents=false`。旧脚本 `run.ts:165` 仍读取该文件，并要求旧模板标记；在固定 0.154.0 Worker 镜像、禁用外网的夹具运行中，capture 阶段退出 1，采样为零、真实请求为零。其“不同任务路径”的描述也已不符合默认行为。

因此不能沿用旧实验的 18.1%／35.5% 降费比例评估当前版本。历史结果仍然有效，但只能说明当时的小样本观测。

下一轮应覆盖：同用户同工作区／不同项目、普通任务／应用任务、Default／Plan、稳定／变化工具集合、start／resume、多轮以及 HTTP／WebSocket。固定平台指令可以继续尝试前置到原生 developerInstructions，但要核查优先级、既有 thread 的恢复和动态模式切换，而非直接搬动所有上下文。

此外，官方现在明确说明 GPT-5.6 及以后模型自动处理缓存路由，prompt_cache_key 主要用于分开缓存核算；较早模型的路由优化行为不同。不能给所有渠道统一覆盖 key，也不能把转发渠道的模型名称等同于官方实现。[官方缓存键说明](https://developers.openai.com/api/docs/guides/prompt-caching)

## 6. 两项后续定向优化

### 大块上下文的局部变更放大

`prepareCodexAdditionalContext` 对长内容分片，每片包含全文 SHA-256。使用项目函数对 20,000 个 ASCII 字符做隔离测试，只修改最后一个字符，10 个上下文条目的 value 全部变化；序列化内容约 21,793 字符。

这确认了应用层的变化放大，**尚未量化其在当前原生版本中的追加 Token 和真实成本**。保留旧版本失效及信任级别约束，在分片前把稳定规则与动态元数据分成独立语义来源；再测试局部变更、条目删除、缩短内容和 resume。不能直接删除摘要或只替换一片，造成新旧规则混用。优先关注长应用指令和 Plan Skill 内容，普通短上下文不需要复杂化。

### 工具目录和 Chat 桥接

tool compatibility 将新发现的工具提升至顶层，工具集合变化可能影响复用。原有能力排序已经存在，应验证目录哈希和别名稳定性，保留原生增量语义；不要全局重排已有工具、隐藏真实变更或加载无关工具来保持哈希。

Chat 桥接按供应商能力传递缓存选项和流式 usage，补齐实际支持的 usage 字段映射。当前没有按协议的完整用量分层，所以不能承诺这项改动能显著提高总体命中率。

## 7. 既有数据与升级影响

本次没有迁移或改变运行行为。实施上述方案前应处理这些明确边界：

| 变更 | 受影响的既有资源／失败条件 | 验证与升级要求 |
| --- | --- | --- |
| 写入 Token、观测状态和价格 | 历史记录缺少字段；误填零会伪造“已观测零写入”；重算会改变账单 | 历史未知保留未知，明确是否重算并获得接受；同步 usage、账单、导出及前端 schema。迁移风险单独确认 |
| 新事件字段 | 内部 strictObject 会拒绝不认识的字段 | 消费者先支持完整新契约再升级生产者，或协调原子部署；覆盖旧事件、新事件和恢复读取 |
| 独立记忆模型 | 旧设置无新策略，既有渠道可能不支持目标模型，当前 lease 会拒绝跨模型请求 | 显式确定升级后的策略；验证现有用户、禁用记忆、缺失设置、渠道撤销与价格归属，不能默默要求重建用户或会话 |
| 指令位置／分片来源调整 | 原生已有 thread 保存历史；新旧规则可能并存，权限与优先级可能变化 | 在代表性旧 thread 上验证 resume、Plan 切换、缩短／删除指令；不重写旧历史，不引入 LinkSense 整轮重试 |
| 工具映射／桥接参数 | 历史 response ID、旧渠道配置、已安装插件及不同协议支持范围 | 覆盖 WebSocket 续接、HTTP、旧插件安装和不支持参数的渠道；不以静默降级掩盖配置错误 |

这些是未实施方案的验收约束，不是已确认的升级事故。用户偏好不保留兼容层，并不等于接受旧资源不可用；具体破坏影响必须先说明并确认。

## 8. 建议执行顺序与验收

1. **先恢复可测性**：修复当前基准入口，建立 0.154.0 端到端夹具检查；补齐未知／读取／写入计量及渠道分层。复用现有 Vitest、Zod、原生 Codex 和网关，无需新缓存库。
2. **先做记忆专项实验**：分别对提取和整合测试固定模型策略、原生候选数量与整合规模，比较每次成功作业成本和记忆质量。当前证据支持最高优先级，但不支持预先承诺节省百分比。
3. **再做前缀实验**：重点测应用任务、首轮与新轮次，普通长任务内已有较高复用。只对有实测收益的协议／渠道启用。
4. **按流量补齐桥接与分片优化**：确认这两条路径在实际费用中的占比，再决定是否提升优先级。

统一验收指标：每个成功业务任务成本、非缓存读取输入量、写入量、总输入量、P50/P95 首字延迟、失败率和任务质量；不要只追求 cache hit rate。标题与 embedding 在当前样本中费用极小，不值得作为首批优化对象。

## 9. 已执行验证及限制

- 固定 Worker 镜像中核验 Codex 0.154.0，并生成原生 app-server TypeScript schema，确认 thread 指令参数和 cacheWriteInputTokens。
- 只读数据库聚合，全程事务 `BEGIN READ ONLY` / `ROLLBACK`；未读取或保存业务 prompt 正文。
- 工作区探针确认共享路径和未生成任务 AGENTS.md；长上下文探针确认局部变更放大。最初使用 tsx eval 时遇到 ESM 导出方式问题，改用 Node ESM + tsx 后探针成功。
- 旧基准在禁网的 0.154.0 Worker 内执行失败，0 条结构采样、0 次真实模型请求；这是待修复项，不计作验证通过。
- 以下相关测试 **8 个文件、125 项全部通过**：

```sh
pnpm --filter @linksense/runner exec vitest run --pool=forks --maxWorkers=1 test/prompt-cache-benchmark.test.ts test/context.test.ts test/additional-context.test.ts test/model-gateway.test.ts test/model-gateway-tool-compat.test.ts test/model-gateway-latency.test.ts test/knowledge-selection-context.test.ts test/event-mapper.test.ts
```

本次仅文档变更，未运行全仓类型检查、lint、构建及全量测试；未做浏览器验证、生产 A/B、供应商账单对账或真实记忆质量评估。125 项单元测试通过不能证明旧基准端到端可运行，也不能替代实施方案的历史数据升级测试。
