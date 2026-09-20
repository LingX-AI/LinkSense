# 记忆生成高消耗排查（2026-09-20）

## 结论与统计范围

本次只读核查本地 OSS 实例 PostgreSQL、用户原生 Codex SQLite 状态与日志、Runner/API/前端代码及固定 Codex 0.154.0 的配置 schema。未修改运行配置或业务代码，未调用付费模型。

按照截图的 Asia/Shanghai 时区，统计 2026-09-14 00:00 起至本次查询时的记录。数据库合计 **12,831.330456 credits**，其中记忆 **9,270.384854 credits（72.248%）**、AI 回答 **3,558.011322 credits**，与截图四舍五入后的数字一致。此数据是应用保存的用量及价格快照，不是供应商账单。

已确认的主要原因：记忆使用当前任务模型；提取读取大量低缓存命中的历史；整合包含多次模型请求，累计上下文较大；生成默认开启，缺少独立的记忆成本策略。另有无记忆产出及结果解析失败的调用。**尚无证据证明发生重复扣费或重复调度。**

## 1. 消耗拆分

| 类型 | 记录数量 | 输入 token | 缓存读取 token | 缓存命中率 | 输出 token | credits |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 记忆提取 extract | 140 次请求 | 8,248,290 | 1,586,432 | 19.23% | 271,762 | 4,488.365694 |
| 记忆整合 consolidate | 709 次请求 | 57,684,915 | 55,034,665 | 95.41% | 452,388 | 4,782.019160 |
| AI 回答 | 1,343 条原生用量增量记录 | 81,193,719 | 77,882,902 | 95.92% | 678,698 | 3,558.011322 |

主回答的记录数量不是 HTTP 请求数量，不能直接与记忆请求数比较。709 次整合请求也不等于 709 个整合作业。

- 记忆合计输入 65,933,205 token，输出 724,150 token；输出量超过主回答的 678,698 token。
- 记忆非缓存读取输入为 9,312,108 token，是主回答 3,310,817 token 的约 2.81 倍。缓存读取命中率不同解释了为何记忆总输入较少，费用却是主回答的约 2.61 倍。
- 提取平均输入 58,916 token，最大 463,106；整合平均输入 81,361 token，最大 219,733。记忆生成并非每次只保存几句偏好，其模型调用会读取和整理历史上下文。
- “非缓存读取输入”按 input 减 cached 计算；当前计量未单列缓存写入，不能据此推断供应商的完整收费口径。

## 2. 当前任务模型直接决定记忆模型

`apps/runner/src/process-pool.ts` 的 `memoryConfigOverrides` 同时设置：

```text
memories.extract_model = 当前任务模型
memories.consolidation_model = 当前任务模型
```

创建 app-server 时传入 `input.model`。模型网关按该任务 lease 的模型及单价保存用量。

| 模型 | 记忆请求数 | 记忆 credits（约） |
| --- | ---: | ---: |
| gpt-5.6-luna | 231 | 4,500.62 |
| gpt-5.6-sol | 27 | 2,455.07 |
| deepseek-flash | 491 | 1,311.55 |
| gpt-5.6-terra | 19 | 1,003.15 |
| Qwen3.8-27B、bonsai-2 | 81 | 0（保存的价格为零） |

仅 27 次 sol 请求就占记忆费用约 26.5%。其中两次提取输入合计 271,409 token，缓存仅 5,888 token，消耗约 903.52 credits。零价格不代表没有 token 消耗。

9 月 18 日记忆提取约 2,413.93 credits，整合约 2,147.27 credits，合计约 4,561.20 credits，是图中最高峰。

独立记忆模型不能只修改两个配置值：当前网关限制 lease 可请求的模型，还需要处理用途授权、渠道解析、计价快照和模型可用性。直接换名可能导致拒绝请求或错误计价。

## 3. 生成默认开启，未配置专项规模控制

- `apps/runner/src/workspace/workspace-manager.ts` 新用户默认 `memories_enabled: true`。
- `deploy/codex-home-template/config.toml` 开启 `features.memories`、`generate_memories`、`use_memories`；本地用户配置亦如此。
- 生成和使用绑定同一用户开关；Plan 模式关闭记忆，外部上下文限制保持开启。
- 模板和进程覆盖没有设置历史窗口、每次扫描候选数、整合记忆条数等专项限制，实际使用原生默认行为。
- 固定版本 `rust-v0.154.0` 的原生配置 schema 和 `codex-rs/config/src/types.rs` 已确认支持相关参数，源码默认值为：每批最多 2 条候选、历史窗口 10 天、至少空闲 6 小时、整合最多 256 条原始记忆、未使用保留窗口 30 天。不同于最新文档中的部分默认值。未验证调整后的实际降费效果。

原生状态库现有 113 条 stage1 输出，110 条被选用于 phase2；原始记忆约 343,700 字符、摘要约 398,077 字符。这是当前存量，不能当作本周新增量，也不能当作每次请求必定包含的全文。

Runner 按任务管理 app-server，进程空闲回收默认 900 秒。启动和恢复可能影响原生后台处理机会，但现有计费记录没有原生记忆作业 ID、源历史版本和完成状态，**本次无法量化重启放大、重复处理或整合被中断的费用**。不据此新增自定义重试或调度器。

## 4. 有调用消耗但没有记忆收益的情况

保留的原生日志覆盖 9 月 15—20 日，61 条阶段一完成汇总记录显示：108 个 claimed 作业，98 个成功，其中 60 个有输出、38 个无输出，10 个失败。该日志窗口与整个计费窗口不同，不将它直接除以 140 次请求估算浪费比例。

日志另有 6 条 JSON 解析失败告警（`trailing characters`）、2 条终止事件前 WebSocket 断开告警。当前原生 jobs 表中也有上下文窗口不足、流中断等失败状态；该表保存的是当前状态，不是完整本周失败历史。

网关在上游 `response.completed` 时记录用量；此时原生阶段一可能尚未完成业务结果解析。因此，上游生成完成后若解析失败，或者原生判断没有值得保存的记忆，仍会产生已完成模型调用的消耗。这些情况有证据，但当前数据不能准确给出对应 credits，也不足以认定失败重试是主因。

## 5. 计费及展示核查

- 849 条记忆记录全部为 `measurement_method=provider`，不是本地字符数估算。
- 849 条记录有 849 个不同 request ID；数据库唯一约束及 `createMany(skipDuplicates: true)` 防止同一 outbox 记录重送入账。
- HTTP SSE 检查遇到首个完成事件后返回；WebSocket 完成时清理 pending request，且排除 `generate:false` 预热。既有测试覆盖普通请求与记忆请求区分、完成事件计量和 outbox 恢复。
- 逐条按保存单价核算：`(input-cached) × input_price + cached × cached_price + output × output_price`；记忆记录中费用不一致的行数为 **0**。缓存 token 没有同时按普通输入再计一遍。
- 个人额度接口分别汇总主回答及模型辅助用量；数据库总和与页面截图一致。
- request ID 由网关生成，不是上游 response ID；独立 UUID 和唯一约束只能排除同一投递重复入账，不能单凭这些证据排除同一业务作业被重新调用。还未进行供应商账单或 response ID 对账。
- 缺失的缓存字段会被当前解析器视为 0；本次未保存原始上游响应，无法区分部分记录是真零命中还是字段缺失。

### 是否属于 Codex 原生 bug

本次进一步读取 `rust-v0.154.0` 的 `codex-rs/memories/write/src/{start,phase1,phase2,lib}.rs`：

- 原生确实在启动记忆流水线时先提取、再整合；阶段一读取过滤后的 rollout 历史并要求严格 JSON 输出，阶段二启动独立整合 agent，因此一次作业可能产生多个模型请求。
- 原生提供独立的提取/整合首选模型；LinkSense 显式覆盖成前台任务模型。这一成本放大属于集成配置选择，不能归因于原生强制使用高价模型。
- 阶段二先领取全局锁；已有作业运行、成功冷却期或失败退避期内会跳过；同步输入后，工作区无变化且记忆产物有效时跳过模型整合。注意：此阶段领取锁不检查剩余重试次数，计数耗尽后仍可在退避结束后重新领取，详见下文防重核查。整合 agent 还禁用记忆工具及递归委派，未发现“记忆生成再触发记忆生成”的证据。
- 原生明确区分有输出成功、无输出成功和失败；失败进入原生作业失败处理，重试延迟常量为 3,600 秒。无输出不是天然的 bug。
- 解析失败是已发生的异常，但缺少对应上游原始响应，无法区分第三方模型/协议适配不满足严格结构化输出与原生结果拼接问题。不能把异常直接归属 Codex，也不能据此宣称是本周高费用主因。

进一步核查 `codex-rs/state/src/runtime/memories.rs`、`memories/write/src/{prompts,guard}.rs`，确认两个具体的成本放大条件：

1. 阶段一按历史 `updated_at` 与成功 watermark 判断是否需要处理；更新时间推进后允许再次提取。每次提取读取过滤后的整份 rollout，而不是仅新增消息。输入上限为模型有效上下文窗口的 70%，缺少有效窗口信息时回落到 150,000 token。这解释了为何可出现几十万 token 的单次提取。**算法存在重复读取旧内容的条件，但本次还未证明这 140 次请求中有多少属于重复提取同一源历史。**
2. `guard::rate_limits_check` 遇到 `!auth.uses_codex_backend()` 返回未知，外层 `unwrap_or(true)` 放行。当前 API/自定义 Provider 接入下，原生 25% 剩余额度保护不会检查 LinkSense credits。这是明确的适用范围差异，不能把该原生参数当作应用记忆预算；本次没有进一步验证应用所有额度阻断路径。

此外，网关保存的 `conversation_id` 是启动请求所用 lease 的任务，不是阶段一实际抽取的源 thread ID。原生扫描用户的合格历史，而本周图表按消费发生时间汇总；因此无法用该字段直接计算“源任务消耗 / 该任务记忆提取消耗”，也不能假设本周记忆只处理本周创建的任务。

当前应将此问题定性为**已确认的成本异常，包含原生非增量提取的放大条件和 LinkSense 模型/默认开启/额度约束的集成问题；尚未定位到可复现的 Codex 原生逻辑缺陷**。原生已有去重保护不代表所有故障路径都已排除；重复调度、进程退出后重做等仍需要作业级证据。高消耗符合现有实现不等于成本合理，不应据此关闭问题。

## 6. 建议处理顺序

1. 优先评估独立、稳定的记忆模型策略，避免随前台任务选用高价模型；用偏好准确性、事实保留及后续任务效果验证质量。
2. 使用固定版本支持的原生参数控制历史范围和整合规模，并验证对既有记忆、待处理历史和用户关闭操作的影响。每次候选数量只是批次限制，不等于长期总预算。
3. 补充原生作业关联、源历史版本、上游 response ID 和业务成功/无输出/失败结果，再判断重复处理、重启和失败的成本。不记录 prompt、历史正文或凭据。
4. 先验证“关闭记忆”的停止边界，再将它作为可靠的止损措施。当前用户开关只控制生成/使用参数和活动任务的 memory mode；原生启动任务检查的是 feature flag，`generate_memories=false` 本身仅影响新建 thread 是否成为候选，不能据此保证停止处理既有候选。现有候选、已启动作业及下一次启动都需要覆盖。本次未替用户关闭或修改该行为。

## 7. 验证与限制

已执行：PostgreSQL `BEGIN READ ONLY` / `ROLLBACK` 聚合与费用公式校验；SQLite `mode=ro` 状态及日志聚合；Worker `/pnpm/codex --version` 确认为 0.154.0；读取该版本配置 schema。

```sh
pnpm --filter @linksense/runner exec vitest run --pool=forks --maxWorkers=1 test/model-gateway.test.ts test/event-sink.test.ts
pnpm --filter @linksense/api exec vitest run --maxWorkers=1 test/usage-analytics.service.test.ts test/personal-quota.test.ts
```

4 个文件、88 项测试通过。本次只新增排查文档，没有生产代码或数据库结构变更；未运行全仓 typecheck、lint、build、浏览器验证或付费 A/B 实验。

官方参考：[记忆配置](https://developers.openai.com/zh-Hans/docs/customization/memories)、[配置 schema](https://developers.openai.com/codex/config-schema.json)。当前官方 schema 会变化，本次固定版本字段另外按 `rust-v0.154.0` 核查。

## 8. 本机 Codex 桌面版对照

2026-09-20 另行只读检查本机桌面安装、配置与数据库。当前运行的应用包位于 `/Applications/ChatGPT.app`，bundle ID 是 `com.openai.codex`，版本 `26.915.31945`（9922）；内置原生二进制为 `0.155.0-alpha.9.2`。这与 LinkSense Worker 的 0.154.0 不同，不用桌面前端默认值替代 Worker 原生默认值。

执行 `/Applications/ChatGPT.app/Contents/Resources/codex features list`，确认当前本地配置下 `memories stable false`，`chronicle` 也为 false。活动 app-server 进程未带记忆相关命令行覆盖。配置没有 `[memories]` 模型覆盖，最近桌面 session 元数据确认为 `originator=Codex Desktop`、`model_provider=custom`；不能将本机等同于官方 ChatGPT 额度接入的样本。

只读查询 `/Users/one/.codex` 下数据库得到：

| 检查项 | 结果 |
| --- | --- |
| 9 月 14 日零点（上海）以来开始的记忆作业 | 0 |
| 同期新增 stage1 输出 | 0 |
| 现存 stage1 输出 | 6 条，最后生成于 8 月 20 日 11:47（上海） |
| 最后阶段一作业 | 8 月 20 日 12:05（上海） |
| 最后整合作业完成时间 | 8 月 20 日 11:51（上海） |
| 原生保留日志窗口 | 9 月 9—20 日，无 memory target 或阶段一/整合标记 |
| 记忆文件最后修改时间 | 8 月 20 日 |

还核查了 `.codex/sqlite` 下旧数据库：无记忆作业和输出，其日志截止 6 月 17 日。没有把旧库与当前库叠加统计。

桌面应用包的记忆设置逻辑同时调用 feature 开关写入以及 `memories.generate_memories` / `memories.use_memories` 写入；记忆启用状态按 feature、生成和使用三者共同判断。配置中的 extract/consolidation 模型默认为未指定，未发现 LinkSense 那样强制覆盖为前台任务模型的路径。

这与 LinkSense 的两个差异明确：

1. 本机现在原生 feature 关闭，LinkSense 模板及进程 feature 覆盖启用。
2. 桌面关闭操作涉及 feature；LinkSense 个性化处理只更新生成/使用参数和活动 thread memory mode，没有关闭 feature。结合固定版启动流水线的条件，需要专门验证并修复“关闭记忆后仍处理既有历史”的风险。

**当前本机没有发现最近 7 天大量生成记忆的情况；不能用这个关闭状态的样本证明桌面版开启后一定低消耗。** 现存记忆表没有 input/output token 字段，历史整合作业也缺少独立用量账本，所以无法精确还原 8 月以前的记忆 token 或费用。现存 6 条输出不是历史总作业数；文件仍存在也不代表当前在生成或使用。

本次未读取凭据、改动本机设置、启动新模型请求或自动打开浏览器；只更新本排查记录。

### 本机不配置记忆模型时的选择策略

按本机内置版本 `rust-v0.155.0-alpha.9.2` 再次核查 `model-provider/src/provider.rs`、`memories/write/src/{phase1,phase2,lib}.rs`：

| 阶段 | 未配置覆盖时的默认模型 | 原生推理强度 |
| --- | --- | --- |
| 提取 | `gpt-5.6-luna` | low |
| 整合 | `gpt-5.6-terra` | medium |

两项模型分别来自 `DEFAULT_MEMORY_EXTRACTION_PREFERRED_MODEL` 和 `DEFAULT_MEMORY_CONSOLIDATION_PREFERRED_MODEL`。阶段一先读取 `config.memories.extract_model`，缺省才调用 provider 的提取首选模型；阶段二对 `consolidation_model` 作同样处理。它不是根据任务难度、当前前台模型或实时价格自动选模。

普通配置 Provider（包含本机 `custom` + `responses`）使用上述 trait 默认值，没有按 API Key / ChatGPT 登录方式改写这两个记忆默认模型；特殊 Provider 可以另行实现自己的首选模型。当前前台 `gpt-6-astra` / high 不决定这两项默认值，也不决定记忆推理强度。

请求仍通过配置的 Provider 发送，不能把本机 `custom` 的默认模型名理解为绕过渠道直连官方。渠道必须支持相应模型；这里的选择逻辑没有“默认模型不可用就自动换成当前任务模型”的分支。尚未发起请求验证本机渠道的模型可用性。

这些是**在开启记忆且没有其他覆盖时**该版本将采用的策略；本机目前 feature 关闭，没有实际运行这两类记忆调用。

## 后续变更：LinkSense 默认关闭记忆

根据用户后续要求，已将新用户的 `memories_enabled`、前端缺省展示和部署模板中的原生 `features.memories`、`memories.generate_memories`、`memories.use_memories` 全部改为 `false`。Runner 启动进程时按用户保存的选择同时覆盖这三个原生开关，覆盖顺序位于模板功能参数之后；因此旧原生配置中的开启值不能绕过用户的关闭选择，用户主动开启仍然有效。Plan 模式保持关闭。

以上调查中的默认开启和缺少 feature 覆盖描述，记录的是修改前状态。此次只修改代码和模板，没有部署，也没有批量改写已有用户保存的选择或终止正在运行的任务。已有用户保存的开启状态继续保留。

验证：Runner 相关测试 270 项、前端个性化测试 14 项、文档测试 23 项通过；另有 1 项已有 Linux 专用测试在 macOS 跳过。Runner 和 Web 类型检查、相关 lint、Runner 构建通过。新增测试覆盖默认关闭、旧原生配置覆盖、保存选择跨重启保留和手动开启；Plan/Default 切换测试补充验证原生功能开关。

## 原生防重复机制进一步核查

按 `rust-v0.154.0` 的 `state/src/runtime/memories.rs` 和 `memories/write/src/{lib,phase1,phase2}.rs` 核查：

- 阶段一以 thread ID 为作业键，用源历史更新时间与 `stage1_outputs.source_updated_at` 或 `jobs.last_success_watermark` 比较；成功处理过同一版本即跳过。无输出成功同样推进成功标记，不会因没有记忆内容而不停重试。
- 阶段一领取作业在 SQLite `BEGIN IMMEDIATE` 事务中完成，同时检查活跃租约和共享运行数限制。租约为 3,600 秒，只有匹配 ownership token 的当前作业能提交结果。状态持久化，因此正常进程重启不会清空防重记录。
- 阶段一失败退避 3,600 秒，初始失败预算为 3，每次成功写入失败状态扣减一次；同一版本耗尽后跳过。源版本更新可重置预算并绕过旧版本退避，但不能抢占仍有效的运行租约。进程崩溃而未写失败状态不等于扣减预算，租约到期后仍可能被接管。
- 阶段二使用同一记忆数据库内的 singleton global 锁；在 LinkSense 用户目录隔离下是用户内全局，而不是跨用户全局。租约 3,600 秒，心跳间隔 90 秒。成功后冷却 6 小时，新增阶段一结果不会绕过这个成功冷却。
- 阶段二同步输入后检查 Git 工作区差异；无差异且产物有效时不启动整合 agent，并记录成功。成功整合需要验证产物、确认锁所有权，再更新工作区基线和成功状态。
- **纠正此前概括：阶段二没有以重试计数实现硬停止。** 失败会递减 `retry_remaining`，但领取函数不检查该字段；退避结束后仍可领取，是否调用模型再由工作区差异和产物验证决定。原生测试 `phase2_global_lock_can_be_claimed_after_retry_budget_is_exhausted` 明确要求这一行为，因此它是该版本的既定行为，不能单凭字段名判断为意外 bug。
- 防重不等于模型调用恰好一次：源版本更新、失败后恢复、租约到期接管，以及模型完成但成功状态尚未持久化时中断，都可能造成同一材料再次进入模型。实际本周费用中这些情况各占多少，仍无作业级证据。

本次阅读了相关原生实现及测试断言，没有编译或运行原生 Rust 测试，也没有触发模型调用。

## 后续实现：结构化输出、提取模型选择与防重接入

根据用户确认，管理员现在从现有对话模型中选择记忆提取模型，不新增独立 Base URL、凭据或单价配置。未选择时使用当前任务模型；选择与否均按该模型已配置的推理强度列表取最低值。任务本身的推理强度和记忆整合模型保持原有行为。

已修复 `chat_completions_bridge` 丢失 Responses `text.format` 的问题，完整映射 `response_format.json_schema` 的名称、描述、严格约束和 Schema，同时保留函数工具的 `strict`。流式和非流式请求共用转换逻辑。修复前新增回归用例可以复现约束丢失；修复后通过。这能避免由适配器丢失约束造成的解析失败，但不能证明既往所有解析失败均由此引起。

提取请求通过原生记忆用途标记选用独立网关授权、渠道和单价快照，HTTP 与 WebSocket 均覆盖；同一任务凭据不能将专用模型用于普通回答。最低推理强度在请求转发时设置，因为固定原生版本的阶段一推理值是常量，没有对应的独立配置项。管理员界面只保存模型 ID，实际渠道凭据仍从加密模型设置解析，经内部接口传给 Runner，不发送给前端或放入 Codex 命令行。

模型改名同步更新记忆引用；删除已引用的模型或渠道会被拒绝；隐藏于任务模型选择器的对话模型仍可用于提取，但必须有有效渠道凭据。已有 version 9 加密设置没有此字段时继续有效，默认采用当前任务模型；不涉及数据库表或字段迁移。

第 3 项复用已经接入的原生持久化防重，未另建内容缓存、重试调度器或作业表。补充测试确认用户共享 Codex 状态在任务删除、记忆开关和 WorkspaceManager 重建后保留，不同用户不共享状态。该测试用状态文件验证目录生命周期，**没有执行原生 SQLite 领取作业算法，也不代表模型调用恰好一次**；原生阶段二失败计数耗尽后仍能再领取的问题保持上述结论。

运行契约由 `user-project-runtime-v25` 升至 `user-project-runtime-v26`，已有版本不匹配检查会拒绝旧 Runner/Worker。API、Controller、Worker 和 Web 应从同一版本构建并协调更新，使用既有部署收尾流程处理活动任务；回滚也需要整套回滚。测试明确覆盖拒绝 v25 和新字段跨 Controller 到 Worker 保留。历史模型设置、任务和用户共享记忆数据无需重建。本次未部署。

### 验证边界与剩余限制

- 已有设置读取/更新、模型引用保护、三种协议的用途路由和真实模型单价快照、HTTP/WS 最低推理强度、前端中英文及语言回退均有测试。相关单元测试、类型检查、lint 与 API/Runner/Web 构建通过；Web 构建仍有文档预览依赖的 Node 模块 externalized 和较大 chunk 提示。
- 未调用实际付费模型验证输出质量、节省比例或整合长期成本；未运行浏览器自动验证和原生 Rust 测试。记忆整合仍可能产生大量调用，此次不是记忆预算或失败次数上限。
- 固定原生版本的提取上下文由 `config.to_models_manager_config()` 构造，仍包含任务级 `model_context_window`。原生会以模型自身的 `max_context_window` 限制覆盖值，但无法由此保证所有自定义模型的提取容量正确。本次没有新增完整的逐模型原生 catalog，因此选择容量更小、原生缺少上限信息的专用模型，长历史仍可能超限；这一组合尚未验证为可上线使用。[原生请求上下文](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/memories/write/src/runtime.rs)、[模型窗口覆盖](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/models-manager/src/model_info.rs)。

本次执行的验证命令（分批运行，以下均通过）：

```sh
pnpm --filter @linksense/shared test
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api exec vitest run test/model-provider-settings.test.ts
pnpm --filter @linksense/api exec vitest run test/runner-adapter.test.ts
pnpm --filter @linksense/runner exec vitest run test/process-pool.test.ts test/workspace-manager.test.ts --maxWorkers=1
pnpm --filter @linksense/runner exec vitest run test/chat-completions-bridge.test.ts test/model-gateway.test.ts test/controller-worker-contract.test.ts test/owner-isolation.test.ts test/template-features.test.ts --maxWorkers=2
pnpm --filter @linksense/runner exec vitest run test/controller-worker-manager.test.ts test/turn-start-contract.test.ts test/controller-worker-contract.test.ts --maxWorkers=2
pnpm --filter @linksense/web exec vitest run src/features/admin/model-settings-draft.test.ts src/features/admin/model-provider-settings-form.test.tsx src/features/admin/model-channel-editors.test.tsx src/pages/admin-settings.test.tsx --maxWorkers=2
pnpm --filter @linksense/docs test
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/runner lint
pnpm --filter @linksense/api exec eslint src/modules/system/model-provider-settings.ts src/adapters/runner.ts test/model-provider-settings.test.ts test/runner-adapter.test.ts
pnpm --filter @linksense/web exec eslint src/features/admin/model-provider-settings-form.tsx src/features/admin/model-provider-settings-form.test.tsx src/features/admin/model-settings-draft.ts src/features/admin/model-settings-draft.test.ts src/features/admin/model-channel-editors.test.tsx src/i18n/en-US.ts src/i18n/zh-CN.ts
pnpm --filter @linksense/api build
pnpm --filter @linksense/runner build
pnpm --filter @linksense/web build
git diff --check
```

Runner 中有 1 项既有 Linux 专用测试在 macOS 跳过。原生 Rust 测试与真实模型降费效果没有执行，不包含在通过项内。
