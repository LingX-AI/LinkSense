# DeerFlow 新机制与 LinkSense 去重复核

日期：2026-10-19；源码固定为 [`fee0cd0c180874325305e995197db99f03fa6a6f`](https://github.com/bytedance/deer-flow/commit/fee0cd0c180874325305e995197db99f03fa6a6f)。沿用上轮检出，不重新安装或运行上游代码；以下测试证据表示读过断言，不表示本次执行通过。

**2026-10-19 去重复核修正：上轮把五项的新增空间说大了。** 项目规则/材料复用、大结果读取、交付验证、外部异步作业在 LinkSense 已有相近用途或具体实现。Side Chat 也只剩组合交互的差别。第 1–6 节是上游机制记录，不代表 LinkSense 缺项；以第 7 节按入口、执行链和测试复核后的结论为准。本次仅更新笔记，未实施功能。

| 方向 | 当前实现与默认边界 | 可直接讨论的产品价值 |
| --- | --- | --- |
| Project 指令 + 文档材料架 | 项目成员会话自动获得本轮项目上下文；文档摘要生成默认关。[P1][P2] | 同一项目多次任务复用材料，避免反复上传和复制指令。 |
| Side Chat | 已实现独立隐藏会话与选区入口；首次创建需要至少一项引用。[S1][S2] | 在主任务旁边澄清细节，用户选择哪些结论带回主会话。 |
| 子 Agent 报告 + 接受条件 | 报告契约自动注入子 Agent；可执行检查仅在委派带条件时运行。[A1][A2] | 把“执行完了”和“要求已满足”分开呈现。 |
| Task continuity | 默认关，独立于长期记忆；不额外要求模型调用或 embedding。[T1][T2] | 压缩后仍可查回任务原始材料，保留失败尝试与下一步。 |
| 大工具结果与引用 | 默认有字符预算、确定性摘要与句柄 registry，详见第 5 节。 | 首次只读数据结构和摘要，需要时回取全文。 |
| 外部异步工具作业 | 默认关，需对应工具契约与 SQL，详见第 6 节。 | 远端处理继续运行，用户不必持续等待一次工具调用。 |

## 1. Project：可复用材料架，而非把所有文件塞进提示词

一次请求在 `services.start_run` 读取线程的项目归属，`resolve_project_context` 固定 `{project_id, name, instructions, shelf}`；随后同一 run 不重新选项目。项目 active/archived 都可提供指令；解析失败时本轮降为未分配项目继续，不阻断 Agent。[P1]

`DynamicContextMiddleware` 将项目指令与文档目录插在本轮真实用户消息前，只改发给模型的 request；不写历史消息或 checkpoint。下一轮使用最新项目指令，不会把多次修改不断累积为历史“更新通知”。项目指令默认写入上限 8192 UTF-8 字节，超限拒绝，不静默截短。[P2][P3]

材料架只注入 `id / 文件名 / 大小 / 修改日期 / 可选一句摘要`。目录默认最多 50 项、总共 4096 UTF-8 字节；完整条目放不下就不放，并显示总数与 `list_project_documents` 下一步。模型按 ID 读，重名文件无需猜测。[P2][P4]

正文由两个只读工具供给：`list_project_documents` 分页列表；`read_project_document(document_id, offset, limit)` 默认每次 8000 字符、最大 20000。Office/PDF 在转换开启时读转换后的 Markdown；不可转换二进制提示用户先 attach 到线程。工具仅在本轮固定项目时注册给 lead，普通子 Agent 不获得这套材料架工具。[P5]

**目录是进场时的视图，内容读取是实时的。** 工具固定项目 ID，但每次查当前材料；文档途中被移到垃圾箱会明确返回“已不在架上”，不会读取旧目录对应的陈旧内容。它没有承诺整个 run 的材料内容版本冻结。[P1][P5]

材料复用还有两个成对动作：将线程文件 **promote-to-shelf**，项目获得独立副本并保存来源；从材料架 **attach-to-thread**，线程获得独立副本、重名时不覆盖。后续修改一端不会悄悄改另一端。这适合“把本次报告变成下次项目参考材料”，不是实时共享编辑。[P6]

可以借鉴的最小交互：在成果旁加“存为项目材料”，新任务显示材料数量与可读目录；默认只读索引，实际需要时按页取正文。摘要是发现辅助，生成默认关闭，满队列会跳过，不能把“未生成摘要”解释为没有文档。[P2][P5][P6]

测试已覆盖：指令修改下一轮替换、移入/移出项目、重复修改不积累、请求注入不改变状态；正文切片、转换关闭、文件移除及跨项目读取失败；材料晋升/附加副本的独立性。[P7][P8][P9]

## 2. Side Chat：从一句话展开讨论，显式带回主任务

选中主会话文字或整条消息，可“Ask in side chat”，引用有来源消息 ID、角色与选区文本。`createSidecarThread` 创建带 `deerflow_sidecar=true`、`parent_thread_id` 的普通独立线程；主线程列表过滤掉它，打开面板时可找回最近一条旁路线程。新线程写空 checkpoint，没有复制父线程 checkpoint。[S1][S2][S7][S8]

每次旁路提问都额外构建背景：从前端**已加载**的主会话可见 user/assistant 文本取最近最多 8 条、单条最多 1200 字符、总预算 6000 字符；隐藏框架消息和 tool 消息不进入这份背景。选择的引用优先，主聊天背景用于解指代与目标，不视为最新请求。[S3]

背景以旁路线程的隐藏 HumanMessage 随本轮输入发送，后面才是用户侧问题；因此独立 thread、独立历史是真实数据关系，“主聊天背景只读”主要是提示层约束。旁路也用常规 `useThreadStream`，还可选模型/模式和上传文件，不能宣传成只会阅读、绝不调用工具的隔离执行模式。[S2][S3]

“Add to conversation”先把选中文本加入主输入框的引用附件；只有主输入框下一次发送时才带入。不会把旁路整段历史自动合并进主任务，失败上传或丢弃发送也不会先清掉引用。用户可以只带回一段明确结论。[S4]

还有两个限制值得保留：新建旁路的 API 请求只传 metadata，没有自动传父项目 ID；父背景来自当前加载窗口，不保证覆盖主线程完整历史。前端的创建去重仅是页面内并发 Promise 合并，不是跨标签页服务端唯一性。[S1][S3]

适合借鉴“选区 → 侧边提问 → 可选引用回填”的闭环，特别是主 Agent 正在长任务时，用户只想问某一步的含义。应明确显示当前引用范围，别把它伪装成主 Agent 已经接纳的新指令。

单元测试覆盖选区/整条消息、上下文裁剪与角色过滤；E2E 用例断言新 sidecar 元数据、两条输入消息、独立 thread ID 和主/旁输入框互不干扰。这些 E2E 是拦截请求的 UI 契约检查，不能当真实后端执行质量证据。[S5][S6]

## 3. 委派结果：报告仍是自述，接受条件提供有限可执行检查

`report_contract` 自动加到内置/自定义子 Agent 的系统提示中，要求给交付物路径/URL/记录 ID、说明失败和未检查项；回执开启时要求行动声明引用 `[rN tool_name]`。**没有强制子 Agent 输出固定 JSON 报告**；机器可读部分是运行时附加的 verdict，不是模型天然严格遵守的报告 schema。[A1][A2]

lead 可向 `task` 传 `acceptance_criteria`，最多 20 条、每条 500 字符。条件正文进入子任务数据消息，报告契约只提供静态说明；子 Agent 完成后，父端根据本次实际结果计算每条 `checked / holds / detail`，渲染三态：`holds`、`does not hold`、`UNVERIFIED`。[A1][A2][A3]

可判定语法有：`file:<path> exists/non-empty/json-valid`、`file:<path> csv-columns:[...]`、`file_written:<path>`、`tests_passed:<command>`。文件按共享任务目录读回，JSON 只验证语法，CSV 只验表头；测试条件匹配记录过的具体命令、成功状态和测试摘要，不在父端重跑测试。[A3]

例如“`file:../outputs/report.json json-valid` + 数据结论正确”：前者可以代码核验，后者应保留 `UNVERIFIED`。无法判定、超出读取预算、来源不明确不能自动变成“通过”；文件存在也不能证明结论正确。[A3]

关键限制：这些是辅助证据，不是完整交付硬门禁。`task_tool` 完成分支即使发现不满足条件，仍返回 `status=completed`；检查器异常时结果未核验地返回。回执校验也只确认 ID/工具锚点/成功状态，不证明邻近自然语言声明为真。[A2][A4]

值得借鉴的是**执行状态与交付条件分列**，并保留条件来源和核验范围。压缩后的委派台账继续携带未满足/未核验项，指导 lead 保留已有成果，只修复缺口，而非把 completed 当无条件重用许可；相关行为已有回归测试。[A5]

## 4. Task continuity：任务笔记 + 可回读原文，和用户长期记忆分开

默认 `task_continuity.enabled=false`。开启后增加 `task_note`、`history_search`、`history_read`，不要求开启 `memory.enabled`；目标是保住本任务约束、决定、尝试和待办，不是把临时任务内容写成用户长期偏好。[T1][T2]

`task_note` 是有名短笔记：最多 8 项，每项 750 字符和 4 个来源 ID；同键替换、空正文删除。并行添加按调用顺序预留容量，满了返回 `note_capacity`，不把已丢弃写入声称为 saved。每条笔记始终标记 `authority=model_report`；来源可读只证明来源存在，不证明笔记被来源语义支持。[T3]

自动或手动压缩成功后，保存将离开活跃上下文的 user/assistant 文本、工具调用参数/名称及工具结果文本，排除推理、系统注入、图片和二进制。线程自己的 SQLite FTS5 归档位于 sandbox 挂载目录之外；checkpoint 只持有可达 batch 引用。默认保留 32 批、每批 256 条、每条 16000 字符，超出会明确截短/淘汰。[T1][T4]

`history_search(query, role?)` 同时搜索活跃与当前 checkpoint 可达的压缩历史，支持英文词/中文双字；最多 8 个 600 字符片段，附原文字符 offset。`history_read(source_id, offset)` 每页 4000 字符，可从命中位置读回。适合“用户先说 3 副本、后来改成 5，压缩后按 user 角色找回更正原话”。[T2][T3][T4]

回滚旧 checkpoint 看不到未来批次，复制到另一用户/线程也不会获得原归档；但保留期淘汰可以使旧 checkpoint 的来源变为 `partially_expired`。归档失败不阻断原压缩，结果标 unavailable；跨主机仍需要共享线程文件系统，不能因为已有 Postgres 就声称该归档已跨节点共享。[T4][T5]

可以借鉴的契约是“摘要用于连续工作，来源用于回查，笔记属于模型自述”。搜索是词法匹配，不保证同义词召回或最新版本；历史 tool 报告也不是当前成功证明。对 LinkSense 应映射到已有 Codex 历史/压缩能力，避免另开一套争夺消息生命周期的压缩循环。

测试不仅检查字符串：`test_task_continuity.py` 用实际 `create_agent`、checkpointer 和重建图验证压缩后回读；还有旧 checkpoint 未来隔离、归档过期、失败继续、笔记来源验证、关闭时不创建归档等断言。[T5]

## 5. 大工具结果：有类型的摘要、完整数据与稳定引用分开

上游 [ToolOutputConfig](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/config/tool_output_config.py#L21-L87) 默认开启；工具结果超过 12000 字符时尝试外置全文，返回摘要和文件引用。默认豁免 read_file，避免“存为文件 → 读取又存为文件”的循环；持久化不可用时有首尾截断退路，不能承诺任何故障都能保全完整输出。

摘要并非调用另一个模型：[tool_output_synopsis.py](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/agents/middlewares/tool_output_synopsis.py#L1-L91) 用有界解析识别 JSON/CSV/TSV/YAML/XML/代码/普通文本，给出字段结构、表头、样本或代码符号；超过 5000000 字节不再完整解析。这里采用字符/字节预算，不等于精准 token 预算。

[Artifact registry](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/tools/artifact_registry.py#L1-L111) 将文件、URL 和 job ID 绑定为线程内短 handle，保存到独立状态，压缩后仍可列出；[参数解析器](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/agents/middlewares/artifact_resolution_middleware.py#L1-L112) 在执行前回填实际引用，未知/过期 handle 明确失败、不猜替代路径。默认最多保留 100 项。[配置](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/config/tool_artifact_config.py)

可借鉴的重点是：大结果先给模型“是什么、有哪些字段/数据段、如何取回”，需要计算时再读完整数据。不会仅靠聊天摘要记住某条长 URL，也不应让结果外置成为绕过当前授权的永久下载口。本轮没有实测模型回读成功率、压缩后的句柄保留率或 token 节省；LinkSense 的已有知识引用和 Codex 原生输出处理须先复用。

## 6. 外部工具作业独立于对话轮次

DeerFlow 的 [OrdinaryMcpTaskDriver](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/mcp/tasks/ordinary.py#L171-L247) 把普通 MCP 服务显式配置的 submit/status/cancel 三工具映射成作业；[McpTaskService](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/app/mcp_tasks/service.py#L296-L366) 先提交远端作业并持久化远端句柄，再由 [后台轮询](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/app/mcp_tasks/service.py#L1358-L1446) 跟踪状态。结果和取消请求各有持久化状态，更新受 lease token 约束。[作业模型](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/persistence/mcp_tasks/model.py)

这适合远程导出、长时间文档处理、仿真或媒体渲染等**外部服务本来就有异步作业接口**的情况。DeerFlow 还可在结果变化后派发通知 run；该通知恢复/重试机制属于其自有 Harness，不能直接套用在 Codex 上。[通知路径](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/app/mcp_tasks/service.py#L855-L960)

LinkSense 已有具体的异步外部作业闭环：[知识处理](../../apps/api/src/modules/knowledge-processing/pipeline.ts#L572) 会持久记录并复用 Docling 远端 task ID，在后台查询状态，记录处理进度并响应取消请求。当前 Core MCP 仍是普通 callTool 边界，只能说明未发现同样的通用 MCP 作业入口，不能推导为平台缺异步任务能力。撤回先建通用作业层的建议；具体证据及限制见第 7.5 节。

[当前配置](https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/config/mcp_tasks_config.py) 默认关闭，要求启用持久 SQL 存储与对应 task toolsets；这是 DeerFlow 定义的工具契约，不能把它说成已验证的 MCP 标准 Tasks 协议或所有外部工具都支持。第 7 节补充核对了项目固定 Codex 0.154.0 的源代码直接调用路径；不认定需要增加自定义 Codex 执行生命周期。

## 7. LinkSense 去重复核：按用户用途判断，而非按实现名字判断

复核基线仍为本地 `65fd7a7d9a168e973bc21e46b8583548fae6cc6b`。本轮把“用户已经能完成什么”“产品是否有专门入口”“是否存在同名实现”分开核查。原有采用顺序撤回：五项不能都视为 LinkSense 缺失的新能力。

| 上轮方向 | LinkSense 现状 | 去重结论 |
| --- | --- | --- |
| 1. 项目级指令和材料复用 | 同项目共享工作目录；保留原生项目 AGENTS.md；应用可配置 instructions 与知识库；知识文档可列目录/分页读；历史附件和成果可引用为独立副本 | 核心用途已覆盖。剩余是项目设置页、可视材料目录等入口整合，不能再建议新建一套项目上下文和材料存储。 |
| 2. 选区 Side Chat | 已有消息分支到新聊天、原生 fork、Office/HTML 选区批注及引用上下文 | 有独立讨论和引用基础。剩余是有限背景的选区旁聊、侧边双输入框、显式选段回填这一组合交互；不能再建议独立会话引擎。 |
| 3. 大结果摘要与回取 | 文档、Microsoft 文件、Workspace/邮件、知识正文都有分页/摘要元信息或下载落盘；Codex 0.154.0 对模型上下文执行原生输出预算 | 大部分用户用途已覆盖。未见全工具统一的类型化 synopsis 与可跨压缩短句柄目录，但不应因此加通用 registry。仅在具体工具仍有大结果问题时补适配。 |
| 4. 委派验收 | Plan 要求验收标准；原生 turn completed 与 Goal complete 分开；应用、Skill 各有实际测试/包校验流程 | 验收能力已有。未见通用逐条件 holds/UNVERIFIED 持久清单；这是可选结果表现差异，不足以支持新增验收 DSL 或验证引擎。 |
| 5. 外部异步作业 | BullMQ 知识处理已保存 Docling 远端 task ID，恢复复用，轮询、进度、取消请求与状态落库均存在 | 不能说缺异步作业能力。通用 MCP job 关联卡片尚未发现；未来有真实异步连接器时复用现有作业模式，不预建平台层。 |

### 7.1 项目规则和材料：底层能力已经存在

- [任务创建路径](../../apps/api/src/modules/conversations/service.ts#L7215) 和 [Runner cwd](../../apps/runner/src/process-pool.ts#L2010) 使项目成员任务使用同一工作区。[user-project-runtime.test.ts](../../apps/runner/test/user-project-runtime.test.ts#L24) 实际检查共享文件、删一个任务保留文件；第 61 行检查用户项目和原生指令文件不被覆盖。因此“项目 schema 没有 instructions 字段”不等于没有项目级指令能力。
- [应用 schema](../../packages/shared/src/applications.ts#L126) 已有 `instructions` 与 `knowledge_base_ids`，[上下文构造](../../apps/runner/src/context.ts#L218) 会注入实际选择；[知识 MCP](../../apps/runner/src/mcp/core-services/knowledge-service.ts#L90) 已有目录发现与分页正文，能力不限于搜索片段。
- [引用文件入口](../../apps/web/src/features/conversations/reference-file-api.ts#L51) 和 [文件服务](../../apps/api/src/modules/files/service.ts#L267) 支持从历史任务复用附件/成果，并产生独立副本；[文件服务测试](../../apps/api/test/files.service.test.ts#L113) 与 [交互测试](../../apps/web/src/test/application/reference-file.test.tsx#L19) 覆盖该流程。
- [项目设置 schema](../../packages/shared/src/projects.ts#L10) 只有名称/图标/颜色，确实未暴露 DeerFlow 那套独立资料架设置。它只证明缺特定入口和关系模型，不能抹去以上已有用途。

### 7.2 Side Chat：保留为交互候选，范围缩小

[消息菜单](../../apps/web/src/features/conversations/conversation-thread.tsx#L2619) 已能“分支到新聊天”，[页面提交处理](../../apps/web/src/pages/conversation-pages.tsx#L3806) 走 [后端原生 fork](../../apps/api/src/modules/conversations/service.ts#L6686)，继承项目/应用/知识选择。[编辑交互测试](../../apps/web/src/test/application/editing.test.tsx#L16) 覆盖入口及失败；[服务测试](../../apps/api/test/conversations.service.test.ts#L621) 覆盖幂等。

差别不可省略：[当前 fork](../../apps/api/src/modules/conversations/service.ts#L6546) 在主任务有运行轮、start intent 或 pending request 时拒绝，并复制截至目标消息的历史。现有 [Office/HTML 批注上下文](../../apps/api/src/modules/conversations/annotation-prompt.ts#L35) 则继续原任务；运行中会排到原任务后续请求，不是旁聊。[对应交互断言](../../apps/web/src/test/application/artifacts.test.tsx#L642)

因此只剩“选文字 → 普通独立会话携带有限背景 → 侧边讨论 → 用户选择引用回填”的交互组合值得单独评估。是否允许主任务运行时并行执行，仍须遵守现有并发准入；共享项目文件的会话也不具备文件系统隔离。本文不新增运行时或 native fork 策略。

### 7.3 大输出：已有覆盖面比上轮记录更广

| 现有路径 | 实际处理与证据 |
| --- | --- |
| 本地 Office/PDF 等文档 | [转换模块](../../apps/runner/src/mcp/core-services/document-conversion.ts#L24) 默认 64 KiB、最多 128 KiB Markdown 一页，后续页固定 SHA-256；[测试](../../apps/runner/test/document-conversion.test.ts#L44) 检查 UTF-8 分页和内容变化。 |
| OneDrive / SharePoint | [文件模块](../../apps/runner/src/mcp/connection-services/microsoft-files.ts#L89) 下载原件到工作区，或返回固定转换 hash 的分页正文；[测试](../../apps/runner/test/microsoft-files-service.test.ts#L81) 验证续页和拒绝版本变化。 |
| Google Workspace / Gmail / Outlook | [Workspace 模块](../../apps/runner/src/mcp/connection-services/workspace.ts#L193) 下载二进制文件到工作区，其他结果按 64 KiB 分页并带 hash/next cursor；[测试](../../apps/runner/test/workspace-connections-service.test.ts#L150) 覆盖长邮件和变更检测。 |
| 知识库 | [内部正文读取](../../apps/api/src/modules/knowledge/internal-search.ts#L349) 使用文档引用和游标，每页最大 128 KiB，并重新检查版本/权限；[引用存储](../../apps/api/src/modules/knowledge/knowledge-document-ref-store.ts#L65) 按 turn 约束且默认 24 小时过期。 |
| 原生模型上下文 | 已核对项目固定 `rust-v0.154.0` / commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340` 的 [MCP 输出路径](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/context.rs#L150-L181) 和 [预算选择](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/tools/handlers/mcp.rs#L221-L247)：进入模型历史前有 token 预算裁剪。 |

原生截断不等于“将所有完整输出另存为可回取文件”；DeerFlow 的确定性 JSON/CSV synopsis 和通用 handle registry 也不能被上述分页完整替代。因此结论是**用户用途重叠较高、剩余差异待具体样本证明**，不是“已完全同实现”或“必须补一个统一层”。

### 7.4 验收：已有计划、目标和领域校验，撤回通用引擎建议

[Plan 指令](../../apps/runner/src/context.ts#L116) 已要求验收标准；[测试](../../apps/runner/test/plan-stop-hook.test.ts#L48) 覆盖输出契约。[共享状态](../../packages/shared/src/conversations.ts#L46) 区分轮次与目标完成，Runner 的 [原生 Goal get/set/clear](../../apps/runner/src/process-pool.ts#L2981) 不以 turn 结束替代目标完成。

应用开发 [内置技能](../../apps/api/src/modules/capabilities/built-in-application-builder.ts#L46) 要求真实功能测试；[源码读取](../../apps/api/src/modules/applications/development-source.ts#L75) 直接复用包校验器拒绝无效成果，[对应测试](../../apps/api/test/application-development-source.test.ts#L67) 验证拒绝路径。Skill 创建 [内置流程](../../apps/api/src/modules/capabilities/built-in-skill-creator.ts#L36) 要求脚本代表性测试、quick_validate 和打包验证，[测试](../../apps/api/test/built-in-skill-creator.test.ts#L30) 实际检查这些步骤。

以上不证明任意业务语义都会自动验收，但足以撤回“从零补交付验证”的方向。DeerFlow 自己的逐条件清单也是辅助证据，不能把它当成缺口明显的万能验收机制。

### 7.5 异步外部作业：已有具体闭环，不能只看 MCP 入口

[KnowledgePipelineProcessor](../../apps/api/src/modules/knowledge-processing/pipeline.ts#L572) 会先读取已激活外部 task，存在则复用；否则提交转换/分块，记录远端 task ID。[Prisma state](../../apps/api/src/modules/knowledge-processing/prisma-state.ts#L374) 和 [KnowledgeBaseProcessingAttempt](../../prisma/schema.prisma#L1792) 持久保存任务种类、处理 generation、远端 ID、尝试次数与完成/失效状态。

[Docling waitForSuccess](../../apps/api/src/modules/knowledge-processing/docling.ts#L392) 在后台轮询远端状态，带截止时间、取消信号和 generation 检查；[队列调度与 Worker](../../apps/api/src/modules/knowledge-processing/pipeline.ts#L1328) 独立于聊天轮次，已有处理进度。取消会记录请求、终止本地等待及移除尚未执行的队列项，[取消路径](../../apps/api/src/modules/knowledge-processing/pipeline.ts#L1502) 不应被描述为保证远端计算立即停止。

[恢复测试](../../apps/api/test/knowledge-processing-pipeline.test.ts#L213) 检查失效远端任务才被替换、正常远端任务在重试时保留；[持久状态测试](../../apps/api/test/knowledge-processing-prisma-state.test.ts#L170) 检查当前 generation 的任务查询和取消请求。

当前 [Core MCP](../../apps/runner/src/mcp/core-service-server.ts) 仍是普通 callTool 边界；已核对固定版本 [原生 MCP client](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/rmcp-client/src/rmcp_client.rs#L794-L855) 的直接调用与 timeout。这一检索范围内未见通用远端 MCP job 卡片及关联模型；不把负面检索结果泛化成“Codex 不支持所有异步任务”。

### 7.6 修正后的采用判断

- **可以单独评估**：Side Chat 的组合交互，用现有普通会话和引用能力实现；无需新会话引擎。
- **只考虑入口整合**：项目规则和材料发现，先展示已有 AGENTS.md、共享工作区、应用知识选择、历史文件引用。
- **暂不新增通用层**：大结果 registry、验收 DSL、MCP 作业平台；已有能力先复用，只有具体连接器/交付样本证实缺口后再限定范围。

已有项目、任务、文件、知识引用和原生 history 的继续使用是后续任何入口调整的前提。本次复核没有触发实现或数据迁移。

## 8. 本轮验证范围

只读核对 LinkSense 的源码、数据契约和既有测试断言，并检出固定 Codex 0.154.0 的源代码及 app-server schema 作对照，更新本笔记。未编译或运行上游代码，未调用模型，未执行应用测试或浏览器功能检查；不宣称现有功能在任何部署均已实测通过，也没有 token 节省、旁聊质量或复杂验收有效性的测量结果。后续有具体需求时先复用已证实存在的路径，再限定必要增量。

## 证据索引（全部固定到同一提交）

[P1]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/projects/context.py#L50-L116
[P2]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/config/projects_config.py#L17-L102
[P3]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/agents/middlewares/dynamic_context_middleware.py#L733-L769
[P4]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/projects/context.py#L186-L248
[P5]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/projects/tools.py#L1-L204
[P6]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/app/gateway/routers/project_documents.py#L293-L438
[P7]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/tests/test_project_context_injection.py#L357-L425
[P8]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/tests/test_project_document_tools.py#L120-L205
[P9]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/tests/test_project_documents_promotion.py
[S1]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/src/core/sidecar/api.ts#L19-L100
[S2]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/src/components/workspace/sidecar/sidecar-panel.tsx#L300-L361
[S3]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/src/core/sidecar/context.ts#L55-L211
[S4]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/src/components/workspace/input-box.tsx#L1517-L1544
[S5]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/tests/unit/core/sidecar/context.test.ts
[S6]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/tests/e2e/sidecar-chat.spec.ts#L838-L915
[S7]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/frontend/src/core/sidecar/thread.ts#L19-L64
[S8]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/app/gateway/routers/threads.py#L950-L1029
[A1]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/subagents/report_contract.py#L32-L156
[A2]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/tools/builtins/task_tool.py#L1088-L1143
[A3]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/subagents/acceptance_checks.py#L1-L59
[A4]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/agents/middlewares/receipt_verification.py#L1-L16
[A5]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/tests/test_subagent_acceptance_followup.py#L31-L91
[T1]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/config/task_continuity_config.py#L1-L10
[T2]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/docs/task-continuity.md#L14-L53
[T3]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/agents/task_continuity/tools.py#L16-L136
[T4]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/packages/harness/deerflow/agents/task_continuity/archive.py#L35-L245
[T5]: https://github.com/bytedance/deer-flow/blob/fee0cd0c180874325305e995197db99f03fa6a6f/backend/tests/test_task_continuity.py#L49-L245
