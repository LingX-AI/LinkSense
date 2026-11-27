# Agent 引擎可替换性调研：AG-UI、DSH 与 Pi

- 调研日期：2026-11-18，Asia/Shanghai。
- 范围：AG-UI 协议能力；DeepSeek Harness（DSH）与 Pi 作为 LinkSense 可选底层 Agent 引擎的可行性；设置页切换引擎的产品与技术边界。
- 方法：只读本地源码、上游 README/协议文档与 GitHub API；未安装、未接入、未运行任何引擎，未修改应用代码。
- 本文是调研与方案建议，不是已批准的实施计划。

## 0. 结论摘要

1. **AG-UI 本身不能实现“在设置里换底层 Agent”。** 它标准化的是 Agent 到用户界面的事件流，属于产品最外层协议；不提供 Agent harness 抽象，也不管理会话、凭据、授权、工具执行或持久化。
2. **目标本身可行，但接缝不在设置页，而在 Runner 的引擎适配层。** LinkSense 现在把 Codex app-server 的线程、回合、审批、目标、子代理、模型目录等语义直接做进了 `AppServerProcessPool`、事件契约、Runner 路由和数据库字段；换引擎是一项适配工程，不是加一个下拉框。
3. **DSH 的可编程接入口最完整。** 官方提供 `sdk`（stdio JSON-RPC）与 `acp`（标准 Agent Client Protocol）两种 headless profile；ACP 有取消、权限请求、模型/推理档位、会话恢复，适合作为运行控制面；SDK 事件更丰富，但当前**没有 cancel / session-close**，只能关闭运行时进程来中断。
4. **Pi 的进程外接入更简单。** `pi --mode rpc` 提供 stdio JSONL，支持 `prompt`、`steer`、`follow_up`、`abort`、会话 fork/switch、模型与推理档位；官方 SDK 可进程内嵌。但 Pi 官方明确省略 subagent 与 plan mode，也没有文档化 ACP。
5. **LinkSense 的实际迁移成本集中在产品语义与历史数据。** `codexThreadId` 在 `apps/api/src` 的 28 个文件中出现约 531 次；`conversation_turns` 以 `codex_thread_id + codex_turn_id` 作为幂等/唯一键；旁聊、分叉、目标、子代理、计划模式、审批表单、模型网关、桌面打包都带 Codex 假设。
6. **建议路径**：先抽出 `AgentEngine` 边界（Codex 实现原样保留）→ 用 Pi RPC 做一个会话级 PoC → 用 DSH ACP 做第二个 PoC → 再补设置页、能力声明与会话绑定 → 最后评估是否需要在 API 边缘增加 AG-UI 网关。
7. **不建议让旧会话原地换引擎。** 旧会话继续由原引擎解释原生历史；跨引擎采用新会话/新分支导入上下文，避免伪造 `codexThreadId` 或 Codex 原生事件。
8. **AI SDK 可以作为“LinkSense Native”引擎的地基，但它本身不是 harness。** `ToolLoopAgent` 提供模型-工具循环、审批、上下文裁剪与流式输出；Vercel Academy 的 harness 教程也明确“harness 是你要自己拥有的代码”。直接替换 Codex = 自建一套 harness，而不是换一个库。详见 §10。

## 1. 先分清三个层次

| 层次 | 代表 | 负责什么 | 是否本次讨论的“换引擎” |
| --- | --- | --- | --- |
| Agent ↔ UI 协议 | AG-UI、AGP、各产品私有 SSE | 把 Agent 运行过程表达成客户端可渲染的事件 | 否。它让“任何客户端渲染任何 Agent”，不让“同一个产品换任何 harness”。 |
| Agent harness / 引擎 | Codex app-server、DSH、Pi | 模型循环、提示词、工具调用、会话、审批、压缩、子代理 | **是。** LinkSense 当前绑定在这一层。 |
| 执行环境 | Docker Worker、本地进程、桌面设备 | 文件、Shell、浏览器、桌面操作实际在哪里执行 | 否。它与引擎可组合，但不是同一个选择。 |

AG-UI 的 README 明确它“standardizes how AI agents connect to user-facing applications”，并把自己定位为 MCP（工具/上下文）与 A2A（Agent 间通信）的补充。它不描述 harness 生命周期，也不替应用保存会话。

## 2. AG-UI：能做什么，不能做什么

### 2.1 已核实事实

- 官方定位：开放的、轻量的事件协议，用一条双向事件流把 Agent 与 Web、移动端、终端、Slack、Teams 等客户端连接起来；1.0 规范已冻结，带 JSON Schema 与 TypeScript / Python / .NET SDK，MIT 许可。
- 1.0 定义 31 种事件、8 个家族：run 生命周期、文本消息、工具调用、共享状态、推理、activity、子代理、透传/自定义。
- 客户端发送 `RunAgentInput`（`threadId`、`runId`、`messages`、`tools`、`context`、`state`、`forwardedProps`、`resume`），Agent 流式返回事件；只有 run 生命周期是必需事件。
- 传输与绑定无关：HTTP + SSE、HTTP + Protobuf；自定义 Agent 只需实现 `run(input) -> Observable<BaseEvent>`，或提供“接受 `RunAgentInput`、流式返回事件”的 HTTP 端点。
- **1.0 有正式的 interrupt/resume 机制**：`Interrupt`、`ResumeEntry`、以 interrupt 结果结束的 `RUN_FINISHED`，以及 `RunAgentInput.resume`；能力协商里有 `interrupts`、`approveWithEdits` 标志。概念文档没有展开它，实际支持度取决于各集成实现。
- 官方集成覆盖 LangChain、CrewAI、Microsoft Agent Framework、Google ADK、AWS Strands、Mastra、Pydantic AI、LlamaIndex、Agno、AG2、Claude Agent SDK/Managed Agents、OpenAI Agents 等。
- 本轮在 GitHub 上**没有找到** Codex、DSH 或 Pi 的官方/成熟 AG-UI 适配器（仓库搜索 2026-11-18）。

### 2.2 它解决什么

如果 LinkSense 希望把某个 Agent 暴露给**第三方客户端**（别人的聊天 UI、其他 Agent 平台、录制/回放工具），或者在自己的 UI 里**消费第三方 AG-UI Agent**，AG-UI 是合适的边缘协议：事件有公开规范、有多语言 SDK、避免为每个客户端写一套私有 SSE。

### 2.3 它不解决什么

- 不抽象 harness：DSH、Pi、Codex 的会话创建、中断、审批、模型选择、目标、子代理仍各说各话。
- 不提供持久化：`threadId` 由调用方生成，规范不规定服务端如何存历史；LinkSense 已有 `Conversation`/`ConversationTurn`/`ConversationEvent`，不需要第二套。
- 不处理多租户授权、凭据注入、工具执行策略、审计与计费；这些正是 LinkSense 在 Runner/API 里已有的职责。
- 不是“引擎协议”：即使所有引擎都套一层 AG-UI，LinkSense 仍要分别实现 DSH/Pi/Codex 的适配器与事件映射。

### 2.4 对 LinkSense 的判断

**工程判断**：把 AG-UI 当作内部引擎抽象会引入第三套事件词汇：底层引擎事件 → AG-UI 事件 → LinkSense 事件。当前链路已经是 Codex 原生事件 → `runnerCodexEventSchema` → API 投影；再插一层只会增加映射面与信息损失，且 `runnerConversationEventSchema` 已经是被持久化、被历史数据依赖的契约。

**可选位置**：在 `apps/api` 边缘增加一个 AG-UI 网关（`RunAgentInput` → LinkSense 会话/回合 → 事件流），用于未来的外部客户端或 Agent 互操作；不进入 Runner，也不替换内部事件契约。是否值得做取决于是否真的有第三方客户端需求。

## 3. LinkSense 当前的 Codex 耦合面

### 3.1 启动与执行

| 位置 | 现状 | 对换引擎的影响 |
| --- | --- | --- |
| [Runner 启动](../../apps/runner/src/index.ts#L94) | 启动时 `assertCodexRuntimeVersion`，版本锁定在 [0.168.0](../../apps/runner/src/codex/runtime-version.json) | 非 Codex 引擎不应通过该检查；版本约束应收敛到 Codex 适配器内部 |
| [AppServerProcessPool](../../apps/runner/src/process-pool.ts#L843) | 8478 行，直接实现 thread/turn/steer/interrupt/fork/goal/subagent/model catalog/MCP probe/prewarm/reconcile | 需要接口化，而不是让 DSH/Pi 去模拟这些方法 |
| [事件映射](../../apps/runner/src/codex/event-mapper.ts#L144) | 2268 行，把 Codex notification/server request 映射为 `runnerCodexEventSchema` | 新引擎需要自己的映射，不能伪造 `thread/started`、`turn/completed` 等方法名 |
| [共享事件契约](../../packages/shared/src/events.ts#L1552) | `runnerCodexEventSchema` 直接使用 Codex 原生 method 与参数；`runnerConversationEventSchema` 是历史事件与 Codex 事件的联合 | 换引擎要么扩展中性事件，要么让 UI 学会“没有 Codex 方法名”的事件 |

### 3.2 数据与产品语义

| 位置 | 现状 | 影响 |
| --- | --- | --- |
| [Conversation](../../prisma/schema.prisma#L909) | `codex_thread_id` 唯一；会话还保存 `execution_target`、`runtime_generation`、分叉/旁聊字段 | 需要新增 `agent_engine`（会话级绑定）；原生线程 ID 的列名与唯一约束要重新定义 |
| [ConversationTurn](../../prisma/schema.prisma#L1069) | `codex_thread_id`、`codex_turn_id` 必填，并有 `(conversation_id, codex_turn_id)` 唯一约束 | 回合幂等、重放、恢复都依赖 Codex ID；新引擎需要等价的稳定 ID 或新的幂等键 |
| `apps/api/src` | `codexThreadId` 出现在 28 个文件、约 531 处 | 旁聊、引用、分叉、目标、子代理、事件投影都直接读这个字段 |
| [Runner 路由](../../apps/runner/src/server.ts#L1764) | start/steer/interrupt/fork/goal/subagent/runtime prewarm/close/model-catalog 等路由直接调用 pool 的 Codex 方法 | API↔Runner 契约需要按能力声明降级，而不是假定所有引擎都有 goal/fork/subagent |
| [模型网关](../../apps/runner/src/process-pool.ts#L7919) | `StartTurnInput` 注入 `modelProvider`（baseUrl、protocolMode、apiKey、context window、pricing） | DSH/Pi 需要自己的模型路由与每轮凭据注入、用量回传；Codex 的 Responses 转换不能直接复用 |
| [桌面资源](../../scripts/desktop-resources.mjs) | 桌面包固定包含 `node`、`codex`、`agent-desktop` 等资源 | 本地引擎若增加 DSH/Pi，需要扩展资源清单、版本锁定、许可与体积评估 |
| [双模式方案](./linksense-desktop-dual-mode-plan-2026-11-16.md) | `execution_target = local/cloud` 已经是会话级选择，并采用“显式确认 + continuation”切换 | 可作为 `agent_engine` 的产品先例：会话级绑定、默认值只影响新会话 |

### 3.3 结论

换引擎的难点不是“起一个进程”，而是以下四类语义：

1. **回合控制**：开始、流式、steer、interrupt、恢复、幂等、重连。
2. **人机交互**：审批、表单、用户问题、计划评审、暂停/继续。
3. **产品能力**：旁聊、分叉、目标、子代理、计划模式、技能/插件、用量与计费。
4. **历史兼容**：旧会话、旧事件、旧 `codex_*` 字段、侧栏与分享。

DSH/Pi 都能覆盖 1 的一部分，但没有一个能原样覆盖 2–4；因此必须做能力声明与差异化 UI，而不是假装功能等价。

## 4. DSH（DeepSeek Harness）调研

### 4.1 定位与成熟度

- 仓库：`deepseek-ai/deepseek-harness`，MIT，TypeScript；官方描述 “Everything is a Plugin”，基于 Cordis 插件框架。
- 运行形态：`npx @deepseek-ai/dsh web` 启动 Web UI（默认 `127.0.0.1:3080`）；官方 profile 包括 `web`、`headless`、`sdk`、`sdk-minimal`、`acp`。
- **开发预览**：README 明确会有破坏性变更（“THERE WILL BE COMPATIBILITY-BREAKING CHANGES”），SDK 协议也没有版本协商（`serverInfo.version` 为 `0.0.1`，客户端不校验）。这对 LinkSense 的生产依赖是实质风险。
- 模型层：`llm-pi-ai` 使用 pi-ai 路由多个 provider、OpenAI 兼容网关与自托管服务；支持自定义 OpenAI 兼容端点、每请求解析 profile/凭据。Pi 与 DSH 在模型接入层有共用基础，这对 LinkSense 的模型网关适配是一个有利因素（待实测）。
- 能力面：插件化工具、MCP、sandbox、subagent、session 持久化、goal、plan、skills、ACP/SDK 等；具体行为按版本与 profile 不同。

### 4.2 可用的程序化接入口

**A. SDK（`dsh --profile sdk`）**

- 传输：换行分隔的 JSON-RPC 2.0，stdio；TypeScript client 与 Python SDK 共用协议。
- 客户端→服务端：`initialize`、`session/prompt`、`session/query`、`session/resume`、`session/wait`、`session/working-directory/get|set`、`shutdown`。
- 服务端→客户端：`approval/request`（可选，允许一次/拒绝/取消）、`user-question/ask`、`session.event`、`session.status`、`session.query.completed`、`subagent.started`、`subagent.finished`。
- 模型：`initialize` 可带 provider/model 路由、`reasoningEffort`、`maxTokens`；路由在初始化时解析，缺适配器/模型/档位会拒绝。
- **关键限制**：没有 cancel 与 session-close；客户端只能关闭运行时进程来放弃回合。用户问题等待是进程本地的，重启后不能凭 request id 继续回答。

**B. ACP（`dsh --profile acp`）**

- 标准 ACP v1，JSON-RPC stdio；一个连接可并发多个独立会话。
- 客户端可调用：`initialize`、`authenticate`、`session/new`、`session/list`、`session/resume`、`session/close`、`session/set_config_option`（模型/推理档位）、`session/prompt`、`session/cancel`、`session/request_permission`，以及 `session/update` 通知；支持 stdio 与 Streamable HTTP MCP。
- 持久化支持跨进程重启的 list/resume/close；明确不支持 `session/load`、删除、**fork**、额外目录、modes、commands、plans、terminals、客户端文件系统、elicitation，也不暴露 DSH 专有的计划/标题/待办/终端等展示数据。
- 官方把它定位为“automation-only”：适合脚本、测试、外部 subagent 控制器，不适合需要 DSH 原生交互卡片的场景。

**C. Web API Gateway**

- DSH 的 Web 客户端通过 `@Remote`/WebSocket `/api` 网关调用业务服务；这是其自家前端的内部契约，不是面向第三方的稳定 SDK。不建议 LinkSense 依赖它。

### 4.3 与 LinkSense 的映射

| LinkSense 能力 | DSH ACP | DSH SDK | 判断 |
| --- | --- | --- | --- |
| 会话创建/恢复 | `session/new`、`session/list`、`session/resume` | `session/prompt` 首次创建、`session/resume` | ACP 更接近；SDK 的 resume 只恢复原会话，不能自动建新会话 |
| 回合开始 | `session/prompt`（同一会话一次一个） | `session/prompt` / `session/query` | 两者都可；注意“接收 ≠ 完成”，要等完成通知/停止原因 |
| 中断 | `session/cancel` | 无；只能关进程 | ACP 明显更适合聊天产品的“停止”按钮 |
| 审批 | `session/request_permission`（一次性 allow/reject） | `approval/request`（allowed-once/rejected/cancelled） | 都能接；但 LinkSense 的交互表单比一次性审批更复杂 |
| 用户问题/表单 | ACP `elicitation/create`（客户端可选） | `user-question/ask`（结构化问题） | SDK 更接近 LinkSense 的 `request_user_form`；ACP 需客户端实现 elicitation |
| 模型/推理档位 | `session/set_config_option` | `initialize` 路由 + `reasoningEffort` | 都可映射到 LinkSense 的模型设置，但需要 provider/model 目录对齐 |
| MCP | stdio / HTTP MCP | 需按 SDK 版本确认 | 都可复用 LinkSense 的 Core MCP，但授权/审批语义要映射 |
| 分叉 | 不支持 | 不支持 | LinkSense 的 `forkThread` 需降级或另建会话 |
| 子代理 | 不暴露专有语义 | `subagent.*` 通知 | SDK 更丰富；ACP 只有通用工具生命周期 |
| 目标/计划 | 不暴露 | 不暴露（session 内部有 goals，但协议未开放） | LinkSense 的 Goal/Plan 功能在 DSH 路径下需隐藏或另做 |
| 历史/事件 | `session/update`（提交后的消息/思考/工具/用量） | `session.event`（完整会话事件） | SDK 更丰富，但无 cancel 是硬伤 |

### 4.4 DSH 的工程判断

- **最适合的接法**：以 **ACP 作为运行控制面**（会话、取消、权限、模型配置、恢复），把 DSH 当作一个“标准的、可中断的 coding agent”；LinkSense 侧保留自己的会话/回合/事件表，`native_session_id` 存 DSH 的 session id。
- **SDK 只作为补充**：如果确实需要 DSH 的 subagent 通知或更细的会话事件，再评估“ACP 控制 + SDK 事件”的双连接；但这会引入两套状态，复杂度高，不建议首期做。
- **风险**：开发预览、无协议版本协商、ACP 明确不支持 fork/plan/terminals/elicitations；DSH 的插件与 profile 组合可能让“同一个二进制”的行为随配置变化，LinkSense 需要固定 profile 与 patch 版本。
- **有利因素**：MIT；标准 ACP 已被 Zed 等编辑器生态采用；模型层与 Pi 共用 pi-ai；MCP、sandbox、subagent 等能力是内建 seam，未来可在 DSH 侧扩展而不必改 LinkSense 协议。

## 5. Pi 调研

### 5.1 定位

- 仓库：`earendil-works/pi`，MIT；Node.js 22.19+；官方定位“minimal, extensible agent harness”，通过 extensions、skills、prompt templates、themes 扩展。
- 明确省略 subagent 与 plan mode；不提供 ACP（本轮文档未列出，未发现官方 ACP server）。
- 模型层是 pi-ai；DSH 的 `llm-pi-ai` 也使用它。

### 5.2 程序化接口

**A. TypeScript SDK（`@earendil-works/pi-coding-agent`，进程内）**

- `createAgentSession()`、`prompt()`、`getLastAssistantText()`、`session.dispose()`；可注入 model runtime、model、thinking level、settings、session manager、resource loader、tools/customTools。
- 事件：`message_update`（`text_delta`）、`message_end`（权威完成消息）、`agent_end`（一次低层运行结束，之后可能还有恢复/排队工作）、`agent_settled`（Pi 不会再自动继续）。
- 控制：`abort()`、`steer()`、`followUp()`、`waitForIdle()`；`SessionManager` 管理持久历史与分支。
- 适合把 Pi 嵌进 Node 进程；但 LinkSense 的 Runner 已有进程池与租约模型，进程内嵌会把 Pi 的生命周期绑到 Runner 进程，隔离与升级不如进程外。

**B. RPC（`pi --mode rpc`，stdio JSONL）**

- 一行一个 JSON 对象；命令可带 `id` 关联响应；事件无命令 ID。
- 命令覆盖：`prompt`（`streamingBehavior: steer | followUp`）、`steer`、`follow_up`、`clear_queue`、`abort`、`abort_retry`、`abort_bash`；`new_session`、`switch_session`、`fork`、`clone`、`get_entries`、`get_tree`、`get_messages`、`compact`、`export_html`；`set_model`、`get_available_models`、`set_thinking_level`、`cycle_thinking_level`；`bash`；`get_commands`。
- 完成语义：`prompt` 响应只表示“已接受/排队/开始”，必须继续消费事件到 `agent_settled` 才能判定完成。
- 官方提供 `RpcClient`（启动子进程、关联请求、投递事件），适合 LinkSense 作为进程外适配器。
- 扩展 UI 请求在 CLI 文档中提到，但 RPC 命令参考没有完整列出；Pi 的审批/交互如何映射到 LinkSense 的表单需要按版本核实。

**C. JSON / print 模式**

- JSON 模式输出 session header + 事件流（JSONL），但不接受后续命令；适合一次性任务，不适合聊天产品的多轮/中断。

### 5.3 与 LinkSense 的映射

| LinkSense 能力 | Pi RPC | 判断 |
| --- | --- | --- |
| 会话创建/恢复 | `new_session`、`switch_session`、`get_entries` | 可映射；Pi 的 session 文件是权威历史 |
| 回合开始 | `prompt` | 可映射；需把“接受”与“完成”分开 |
| 中断 | `abort` | 可直接映射“停止” |
| 运行中追加 | `steer`、`follow_up` | 比 Codex 的 steer 更明确 |
| 分叉 | `fork`、`clone` | 可映射 LinkSense 的分叉（但分支语义是 Pi 的 entry tree） |
| 审批/表单 | 扩展 UI 请求（未完整文档化） | **待验证**；LinkSense 的 `request_user_form` 需要适配层 |
| 模型/推理档位 | `set_model`、`set_thinking_level` | 可映射；模型目录需与 LinkSense 模型设置对齐 |
| MCP | 扩展（`mcp.md`） | 可复用 Core MCP，但需扩展安装/配置 |
| 子代理/计划 | 无 | LinkSense 对应功能需隐藏或降级 |
| 目标/用量 | `get_session_stats`（token/费用/上下文） | 可回传用量；定价/计费仍需 LinkSense 侧计算 |

### 5.4 Pi 的工程判断

- **最适合的接法**：`PiEngine` 作为进程外引擎，Runner 通过 `RpcClient`/等价 JSONL 客户端驱动；一个会话一个 Pi 子进程（或按租约复用），中断用 `abort`，分叉用 `fork`。
- **优点**：协议简单、取消/steer/fork/模型选择齐全、会话持久化明确；比 DSH 的 preview 风险低（但仍需锁版本）。
- **缺口**：无 subagent/plan；审批/表单接口未完整文档化；MCP 通过扩展；自定义 provider 的“每请求凭据”需要 provider extension，而 LinkSense 的模型网关是每轮注入 token 的。
- **模型接入**：Pi 的 `models.json` / provider extension 支持 OpenAI 兼容 `baseUrl` 与静态/环境凭据；若要每轮动态 token，需要写一个受信任的 provider extension，并确保不记录 token。

## 6. 接入方式对比

| 维度 | Codex app-server（现状） | DSH ACP | DSH SDK | Pi RPC | AG-UI |
| --- | --- | --- | --- | --- | --- |
| 协议 | JSON-RPC over stdio | ACP v1 over stdio | JSON-RPC/JSONL over stdio | JSONL over stdio | HTTP+SSE / Protobuf |
| 会话持久化 | Codex thread | DSH session list/resume/close | DSH session resume | Pi session 文件 | 规范不规定 |
| 中断 | `turn/interrupt` | `session/cancel` | **无**（关进程） | `abort` | interrupt/resume（Agent 需实现） |
| 审批 | server request / user input | `session/request_permission` | `approval/request` | 扩展 UI（待核实） | interrupt 协议（可选） |
| 模型选择 | app-server model catalog + 网关 | `set_config_option` | `initialize` 路由 | `set_model` | 规范不规定 |
| MCP | 原生 + 代理 | stdio/HTTP | 待核实 | 扩展 | 不涉及 |
| 分叉 | `thread/fork` | 不支持 | 不支持 | `fork`/`clone` | 不涉及 |
| 子代理 | 原生 | 不暴露专有语义 | `subagent.*` | 无 | `SUBAGENT_*` 事件 |
| 目标/计划 | 原生 goal/plan | 不暴露 | 不暴露 | 无 | 不涉及 |
| 标准化程度 | Codex 私有 | 标准 ACP | DSH 私有 | Pi 私有 | 公开规范 |
| 对 LinkSense 的定位 | 现有基线 | **首选运行控制面** | 补充事件面 | **首个 PoC 候选** | 可选外部边缘 |

## 7. 可行性判断与推荐架构

### 7.1 判断

- **“设置里换引擎”可以实现，但前提是先有引擎抽象。** 设置页只是选择器；真正的可行性取决于 Runner 是否能以统一接口表达“开始回合、流式事件、中断、审批、恢复、模型选择、关闭”，以及 API/数据库是否接受“非 Codex 原生 ID”。
- **AG-UI 不是这个抽象。** 它无法替你适配 DSH/Pi；把它放进内部链路只会多一层映射。
- **DSH 与 Pi 都不是 Codex 的功能超集。** 计划模式、目标、子代理、原生插件、旁聊、分叉等功能在 DSH/Pi 路径下需要隐藏、降级或另做；这必须在产品上显式声明为“该引擎不支持”，而不是静默失败。
- **首期不建议在桌面本地运行时切换引擎。** 桌面包当前固定 Node + Codex；先把服务端 Runner 的引擎抽象跑通，桌面本地引擎继续用 Codex，等抽象稳定后再评估打包 DSH/Pi。

### 7.2 `AgentEngine` 边界（建议）

不要把接口照抄成 Codex 的 thread/turn 方法，而是按 LinkSense 已存在的产品操作定义：

```ts
interface AgentEngine {
  readonly id: "codex" | "dsh" | "pi"
  readonly capabilities: EngineCapabilities
  ensureSession(input: SessionBinding): Promise<NativeSession>
  startTurn(input: EngineTurnInput): Promise<EngineTurnReceipt>
  steer(input: EngineSteerInput): Promise<EngineTurnReceipt>       // optional
  interrupt(input: EngineInterruptInput): Promise<void>
  respond(input: EngineResponseInput): Promise<void>               // 审批/表单/用户问题
  fork?(input: EngineForkInput): Promise<NativeSession>            // optional
  goal?: { get, set, clear }                                       // optional
  subagents?: { summaries, read }                                  // optional
  listModels?(): Promise<EngineModelCatalog>                       // optional
  closeSession(input: EngineCloseInput): Promise<void>
  prewarm?(input: EnginePrewarmInput): Promise<void>               // optional
}
```

配套：

- `EngineCapabilities`：`steer`、`interrupt`、`fork`、`goal`、`plan`、`subagents`、`forms`、`mcp`、`modelSelection`、`usage`、`resume` 等布尔/枚举；UI 与 API 路由据此启用或隐藏功能。
- `NativeSession`：`engine` + `nativeSessionId` + `createdAt`；不要求是 Codex thread。
- 事件：保留 `runnerConversationEventSchema` 作为持久化契约；新增引擎中性事件（如 `turn/started` 的 LinkSense 版本）或在不改变 Codex 事件语义的前提下扩展现有联合。**不要**让 DSH/Pi 发出伪造的 Codex method。
- 现有 `AppServerProcessPool` 原样包成 `CodexEngine`，先零行为变更地接入；这是整个改造的回归基线。

### 7.3 会话级绑定与设置页

- 新增 `Conversation.agentEngine`（默认 `codex`），在创建会话时写入；新会话使用默认值，旧会话保持原值。
- 设置分三层，和现有模型设置一致：
  1. **管理员设置**：启用哪些引擎、每个引擎的可用性/健康检查、模型映射、默认引擎、资源限制；不在这里填用户凭据。
  2. **个人设置**：我的默认引擎（仅限管理员已启用）。
  3. **新建任务**：为本次会话选择引擎；创建后不可原地切换，除非走“新会话/新分支导入”的显式迁移。
- UI 先复用 `executionTarget`（本地/云）的选择与确认模式：会话级、显式、只影响新会话。
- 设置页的“已保存”不等于“可用”：引擎需要健康探测（二进制/运行时存在、版本匹配、模型目录可读），失败时显示具体原因，而不是允许选择后运行时才报错。

### 7.4 事件与持久化

- 短期：保留 `codex_thread_id` / `codex_turn_id` 作为**当前绑定引擎的原生 ID**，在代码与文档中明确其“Codex 专用名字、通用语义”；新增 `agent_engine` 消除歧义。
- 中期：在不破坏历史的前提下，评估新增 `native_session_id` / `native_turn_id` 或复合唯一键 `(engine, native_id)`；任何列重命名/删除/约束变更都属于可能影响历史数据的迁移，需按项目规则单独确认，不能与本次调研一起做。
- 旧会话：原引擎继续解释；跨引擎优先新建会话/分支，导入明确上下文与文件，保留来源引用；不伪造原生 ID，不把“能显示历史消息”当作“能续跑原生会话”。

### 7.5 模型网关

- Codex 路径继续使用现有 per-turn `modelProvider` 注入（baseUrl、protocolMode、apiKey、context window、pricing）。
- DSH/Pi 路径建议暴露 LinkSense 的 **OpenAI Chat Completions 兼容端点**（每轮 token、模型 ID、推理档位），让 DSH 的 `llm-pi-ai` 与 Pi 的 provider extension 指向它；这样模型授权、计费、审计仍由 LinkSense 控制。
- 需要分别验证：工具调用/流式兼容性、推理档位映射、上下文窗口与自动压缩、用量回传（DSH ACP 有 context usage；Pi 有 `get_session_stats`）、错误码与重试语义。
- 不要在引擎侧保存长期凭据；每轮凭据通过受控配置/进程环境或扩展注入，并确保日志脱敏。

### 7.6 工具与 MCP

- LinkSense 的 Core MCP（文件登记、站点发布、知识检索、浏览器、自动化等）应尽量通过 MCP 复用，而不是为每个引擎重写工具。DSH 有 MCP 包；Pi 有 MCP 扩展。
- 工具调用的授权仍由 LinkSense 的服务端 token/owner/conversation 校验；引擎的审批只负责“是否允许这次调用”，不能替代资源授权。
- 交互表单：DSH SDK 的 `user-question/ask` 与 LinkSense `request_user_form` 最接近；ACP 的 `elicitation/create` 需要客户端实现。Pi 的扩展 UI 请求待核实。首期可以只支持“审批/确认”，复杂表单在 DSH/Pi 路径下先降级为普通消息，能力声明中标记不支持。

### 7.7 桌面

- 当前桌面包固定包含 Node、Codex、`agent-desktop`，并锁定版本与哈希（[desktop-resources.mjs](../../scripts/desktop-resources.mjs)）。增加 DSH/Pi 会扩大安装包、许可清单与升级面。
- 建议首期只允许**服务端 Runner**选择 DSH/Pi；桌面本地引擎继续 Codex。等引擎抽象稳定后，再决定是否把 DSH/Pi 作为桌面可选组件（届时需要新的资源清单、版本锁定、健康检查与回滚）。

### 7.8 AG-UI 的位置

- **不作为内部引擎抽象**；不替换 `runnerConversationEventSchema`；不作为设置页切换机制。
- 如果未来需要外部客户端/Agent 互操作，在 `apps/api` 增加 AG-UI 网关：`RunAgentInput` → LinkSense 会话/回合 → 事件流；鉴权、限流、审计仍由 API 负责。
- 如果未来需要接入第三方 AG-UI Agent（而不是 DSH/Pi），可以把 AG-UI 作为一种“外部引擎适配器”，与 DSH/Pi 适配器并列；这仍然需要引擎接口，而不是替代它。

### 7.9 三引擎可选（Codex / DSH / Pi）的实施评估

这是“适配器路线”，不是“自建 harness 路线”。总体判断：**属于平台级改造，但范围是可控的；主要工作量在引擎适配、事件映射和能力声明，不在设置页。** 它比替换 Codex 小一个量级，但也不是一个周末功能。

实现形状：

1. **引擎接口**：`AgentEngine` + `EngineCapabilities`；`CodexEngine` 先原样包装现有 `AppServerProcessPool`，保证零行为变化。
2. **两个新适配器**：`PiEngine` 用 RPC（`prompt`/`abort`/`fork`/`set_model`）；`DshEngine` 用 ACP（`session/new`/`prompt`/`cancel`/`request_permission`/`resume`/`set_config_option`）。
3. **选择落点**：新增 `Conversation.agentEngine`（默认 `codex`），创建会话时写入；`RunnerStartInput` 增加 `engine`；Runner 路由按引擎分派。`executionTarget` 的会话级选择与确认模式可以复用。
4. **事件**：保留现有 Codex 事件；Pi/DSH 映射到 LinkSense 已有事件或新增引擎中性事件，不伪造 `thread/*`、`turn/*` 等 Codex method。
5. **能力声明**：API 在会话/引擎信息里返回能力矩阵；UI 对 `goal`、`plan`、`subagents`、`fork`、`forms` 等按引擎隐藏或禁用，而不是运行时才报错。
6. **模型映射**：Codex 走 app-server 模型目录；DSH 走 ACP config option；Pi 走 `get_available_models`。LinkSense 模型设置需要一张“本平台模型 ID → 引擎 provider/model”的映射表，而不是假定三者模型 ID 相同。
7. **MCP/工具**：Core MCP 通过各引擎的 MCP 接入（DSH 原生、Pi 扩展），授权仍由 LinkSense token/owner/conversation 校验。
8. **设置与运维**：管理员启用/健康检查/默认引擎；个人默认；新建任务选择；六语言；引擎不可用时禁止创建会话。
9. **桌面**：首期不做本地 DSH/Pi，服务端 Runner 先支持。

相对工作量（S/M/L，仅表示范围，不是工期）：

| 区域 | 规模 | 说明 |
| --- | --- | --- |
| `AgentEngine` 抽取 + Codex 包装 | M | 8.5k 行 process pool 不改逻辑，只收敛调用面；先零行为回归 |
| Pi RPC 适配器 | M | 协议清晰；审批/表单接口待核实 |
| DSH ACP 适配器 | M–L | ACP 标准面清晰；会话恢复、权限、模型配置需逐项验证 |
| 事件映射与 DB 投影 | M | 每个引擎一套；避免伪造 Codex 事件 |
| 会话绑定与迁移 | S–M | 新增 `agentEngine`；`codex_*` 列暂不改名，明确通用语义 |
| 审批/表单 | M–L | LinkSense 表单比 ACP 一次性权限更复杂；Pi 待核实 |
| 模型网关/目录/用量 | M | 每轮凭据、模型映射、usage/计费 |
| 设置 UI + i18n + 能力门控 | S–M | 复用现有设置与 `executionTarget` 模式 |
| 测试矩阵 | M–L | 3 引擎 × 开始/流式/取消/恢复/审批/模型切换 |
| 桌面本地引擎 | L | 首期延后 |

最容易低估的三点：

- **会话身份**：旁聊、分叉、引用、Side Chat 都直接依赖 `codexThreadId`；引擎换了以后这些功能要么按能力降级，要么重做。
- **审批语义**：Codex 的 server request、DSH ACP 的 `request_permission`、Pi 的扩展 UI 请求不是同一种交互；LinkSense 的 `request_user_form` 不能假定每个引擎都能表达。
- **模型与凭据**：三个引擎的模型选择面不同；LinkSense 的每轮 token/价格/协议转换需要逐引擎适配，不能用一套 Codex 网关配置覆盖。

可行的加速方式：用 AI SDK 的 `HarnessAgent` + `harness-codex` / `harness-pi` / `harness-acp` 做一次技术验证，确认统一 session/stream 形状；但它全部是 experimental，且假设 Vercel 式 sandbox，不适合直接作为 LinkSense 的生产底座。更稳的做法仍是自研三个适配器。

## 8. 建议的验证顺序

| 阶段 | 工作 | 验收重点 |
| --- | --- | --- |
| 0. 定义边界 | 抽出 `AgentEngine` 与 `EngineCapabilities`；Codex 原样包装；不改数据库、不改 UI | 现有 Codex 路径全部回归通过；无行为变化；事件与历史一致 |
| 1. Pi PoC | 单会话、进程外 RPC；start/stream/abort/steer/fork/模型选择 | 能在测试会话完成一轮真实任务；停止可靠；重连不重放；用量可回传 |
| 2. DSH PoC | 单会话、ACP；session/new、prompt、cancel、request_permission、resume、set_config_option | 权限弹窗可回答；取消可靠；重启后能 resume；模型/推理档位生效 |
| 3. 会话绑定 | `agentEngine` 字段、创建时选择、默认值、能力声明 | 旧会话不受影响；新会话按选择启动；能力缺失时 UI 明确禁用 |
| 4. 设置与运维 | 管理员启用/健康检查、个人默认、失败原因、审计 | 保存 ≠ 可用；引擎不可用时不能创建会话；日志/指标可定位 |
| 5. 外部边缘（可选） | AG-UI 网关 | 第三方客户端可运行/恢复/中断；不泄露内部事件与凭据 |

每个阶段都以“真实回合”为门槛：读文件、执行命令、流式事件、取消、恢复；不要用回显桩或只读历史代替。

## 9. 风险与未决问题

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| DSH 预览不稳定 | 官方明确会有破坏性变更；SDK 无协议版本协商 | 锁定 DSH 版本与 profile/patch；适配器隔离；升级前跑兼容测试 |
| DSH SDK 无 cancel | 只能关进程 | 首期用 ACP 作为控制面；SDK 仅作补充（如确有必要） |
| Pi 功能缺口 | 无 subagent/plan；审批接口未完整文档化 | 能力声明中标记不支持；首期只做核心对话/工具/中断 |
| 历史数据 | `codex_thread_id` 遍布 28 个 API 文件、531 处；回合唯一键依赖 Codex ID | 新增 `agentEngine`；原生 ID 语义化；列重命名/约束变更单独评估 |
| 模型网关 | 每轮凭据、协议转换、用量/计费 | 统一暴露 OpenAI 兼容端点；逐引擎验证工具调用与用量 |
| 旁聊/分叉/目标/子代理 | 直接依赖 Codex thread/goal/subagent | 按引擎能力降级；跨引擎用新会话导入 |
| 桌面打包 | 安装包体积、许可、版本锁定 | 首期桌面仍用 Codex；服务端先支持 |
| 许可与商标 | DSH/Pi/AG-UI 均为 MIT；Codex 适配器另有许可 | 更新 THIRD_PARTY_NOTICES；不把上游品牌当作 LinkSense 能力承诺 |

未决问题：

1. LinkSense 首期需要 DSH/Pi 覆盖到哪一层：只覆盖普通对话 + 工具 + 中断，还是必须覆盖审批表单、旁聊、分叉、目标？
2. 引擎选择是“管理员统一启用”还是“用户自选”？是否允许同一用户混用多个引擎？
3. 旧会话是否提供“迁移到新引擎”的显式路径，还是永久保持原引擎？
4. 模型网关是否统一走 OpenAI Chat Completions 兼容端点，还是为每个引擎保留原生协议？
5. 桌面本地引擎是否进入首期，还是仅服务端 Runner 可选？

## 10. 补充：用 AI SDK 直接实现底层 Agent（替代 Codex）

本节回应“能否直接用 AI SDK（以及 Vercel Academy 的 harness 教程）实现底层 Agent，甚至替换 Codex”。

### 10.1 LinkSense 已有的 AI SDK 基础

- `apps/api` 已依赖 `ai@7.0.173` 与 Alibaba、Anthropic、Azure、DeepSeek、Google、OpenAI、OpenAI-compatible 等一批 `@ai-sdk/*` provider。
- 现有用法是 `generateText` / `streamText` 的单次调用：任务标题、浏览器意图判断、图片理解、模型连接探测等；**没有** `ToolLoopAgent`、工具循环或 Agent 会话。
- 结论：模型接入、渠道/密钥、价格与探测已经存在；缺的正是 harness（循环、工具、审批、会话、沙箱、恢复）。

### 10.2 AI SDK 7 提供的相关能力

| 模块 | 已核实能力 | 边界 |
| --- | --- | --- |
| `ToolLoopAgent`（`ai`） | 封装 model/instructions/tools/output/toolChoice/`stopWhen`/`runtimeContext`/`toolsContext`/`toolApproval`；默认 20 步；`prepareStep` 可逐步调整模型、activeTools、messages、sandbox；`agent.generate` / `agent.stream`；生命周期回调；`pruneMessages` 做上下文裁剪；可生成 UI message stream | 只是循环与调用封装；不提供会话持久化、恢复、沙箱强制、审批策略、子代理编排 |
| `toolApproval` | `'not-applicable'`、`'approved'`、`'denied'`、`'user-approval'` 四种结果；手动审批需两次调用并回填 `tool-approval-response`；`experimental_toolApprovalSecret` 用 HMAC 绑定审批，防客户端伪造 | provider 端执行的工具不经过 AI SDK 审批；subagent 工具不能用 `toolApproval`；历史缺原始输入会被拒绝 |
| MCP（`@ai-sdk/mcp`） | `createMCPClient`；HTTP/SSE/stdio transport；OAuth、资源绑定、工具发现、`outputSchema`、elicitation、工具漂移检测 | 不提供自动会话持久化、可恢复流、通知；stdio 仅适合本地；工具 annotations 不可信 |
| `HarnessAgent`（`@ai-sdk/harness`，experimental，npm `1.0.187`） | 用统一 API 运行完整 harness；session 持有 runtime、sandbox、工作目录、原生历史、待审批；`generate`/`stream` 返回 AI SDK 结果；`detach`/`stop`/`destroy`；可持久化 resume state；流可转 `useChat` | **experimental**，会破坏性变更；需要 sandbox session；与 LinkSense 的 Docker Worker/桌面设备模型不同 |
| `@ai-sdk/harness-codex` | 在 sandbox 内跑 Codex app-server，通过 sandbox 暴露的 WebSocket 桥接；支持 bash/webSearch/apply_patch/view_image、reasoningEffort、MCP、结构化输出 | Codex 目前没有内建工具审批；冷恢复会丢失 `apply_patch`/`view_image` 原始事件；无法禁用仓库自带 `.codex/config.toml` |
| `@ai-sdk/harness-pi` | Pi 在宿主 Node 进程内运行，sandbox 只作为远程文件系统 + Shell；无需桥接进程 | experimental；Pi 自身的功能缺口（无 subagent/plan）仍在 |
| `@ai-sdk/harness-acp` | 通过 sandbox 内桥接驱动 ACP v1 agent；支持 model mapping、instructions、permission mode、凭据代理 | experimental；需要 network sandbox 与端口；适配器行为取决于 ACP agent |
| `workflow-harness` | 把 `HarnessAgent` 作为持久化 Workflow 运行，按时间片/步骤推进 | 引入 Workflow DevKit 与新的持久化执行体系 |
| Sandbox 适配器 | `@ai-sdk/sandbox-vercel`、`sandbox-just-bash` 等；`experimental_sandbox` 需工具显式使用 | “传入 sandbox”不等于“工具自动被沙箱隔离” |

Vercel Academy 的《Build an AI Agent Harness》把 harness 拆成：Agent 循环与工具、工具设计、审批与安全、系统提示词、Sandbox 抽象、上下文管理、子代理、人机交互、生命周期与持久化、扩展面。它用 `ToolLoopAgent`、`tool()`、`isStepCount`、`pruneMessages` 和 AI Gateway 构建了一个教学级 harness（TeensyCode），并反复强调：**“A tool loop with three tools is a demo”**，harness 是你要自己拥有的代码。

### 10.3 关键判断：AI SDK 是零件，不是整车

- AI SDK 能给你：模型循环、工具定义与执行、流式输出、审批原语、MCP 客户端、上下文裁剪、沙箱接口、UI 流与可选的 durable workflow。
- AI SDK 不给你：会话/回合的持久化与恢复、LinkSense 的事件契约与数据库投影、权限策略与审计、沙箱的实际隔离与工具强制执行、子代理编排、计划/目标、技能/插件、模型目录与每轮凭据、用量计费、评测。
- 因此“直接用 AI SDK 实现底层 Agent”成立的前提是：**LinkSense 自己成为 harness 的维护者**。这与“接一个 DSH/Pi 适配器”是两种量级不同的承诺。

### 10.4 直接替换 Codex 的差距表

| 能力 | 当前 Codex 路径 | AI SDK 提供 | LinkSense 需自建/验证 |
| --- | --- | --- | --- |
| 模型循环 | app-server turn | `ToolLoopAgent` / `streamText` | 系统提示词、工具装配、停止条件、重试/取消 |
| 会话与回合 | Codex thread/turn + DB | 仅 messages | 原生会话状态、回合幂等、恢复、迁移 |
| 流式事件 | app-server notification → mapper | AI SDK stream parts | 映射到 `runnerConversationEventSchema` 与 DB 投影 |
| 审批/表单 | server request / user input | `toolApproval` + HMAC secret | 权限策略、表单协议、UI、审计、防伪造 |
| 沙箱 | Codex 原生沙箱 / Docker Worker | `experimental_sandbox` 接口 | Docker/桌面适配、工具强制执行、越界测试 |
| 上下文 | Codex 自动压缩 | `pruneMessages` + `prepareStep` | 压缩策略、AGENTS.md/技能/记忆/知识注入、缓存 |
| 子代理 | Codex 原生 | 无 | 隔离会话、工具白名单、事件与取消 |
| 计划/Goal | Codex 原生 | 无 | 产品层状态机与事件 |
| MCP/工具 | 原生 + Core MCP | `@ai-sdk/mcp` | 工具目录、授权、结果预算、漂移处理 |
| 模型目录/网关 | app-server + 模型网关 | provider adapters | 目录映射、每轮凭据、协议转换、用量回传 |
| 用量/价格 | token usage 事件 | `usage` 结果 | 价格快照、计费、审计 |
| 恢复/预热 | reconcile/prewarm | 无 | 状态机、outbox、租约、超时 |
| 技能/插件/Hook | 原生 | 无 | 自建或明确舍弃 |
| 桌面 | 打包固定 Codex | 无 | 运行时/打包/体积/更新 |
| 安全 | Codex 审批 + 沙箱 | 原语 | **全部责任转移到 LinkSense** |
| 评测 | 现有行为基线 | 无 | 任务评测集、回归、成本/延迟基线 |

### 10.5 三条路线对比

| 路线 | 控制力 | 首个可用版本 | 功能对齐 | 依赖风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| A. 自建 LinkSense Native（`ToolLoopAgent`） | 最高 | 慢 | 需逐项自建 | 低（Apache-2.0，库稳定） | **唯一能真正移除 Codex 的路线**；按新产品引擎对待 |
| B. AI SDK `HarnessAgent` + 适配器 | 中 | 快 | 取决于上游适配器 | 高（experimental、sandbox 模型不匹配） | 适合做原型/过渡，不建议作为生产底座 |
| C. 自研 `AgentEngine` + DSH/Pi 适配器 | 中 | 中 | 取决于引擎 | 中（DSH preview、Pi 缺口） | 不能移除 Codex；适合“多引擎”而非“替换” |

### 10.6 如果决定替换 Codex：建议路线

1. **先定义契约**：`AgentEngine` + `EngineCapabilities` + 引擎中性事件；Codex 继续作为默认实现。没有这层，自建引擎会把 Codex 耦合复制一遍。
2. **v1 只做核心闭环**：普通对话、流式、工具调用（Core MCP + 读写/命令）、中断、审批、恢复、用量。计划/Goal/子代理/Hook/原生插件/分叉先标记为不支持。
3. **循环**：`ToolLoopAgent` + `stopWhen` + `prepareStep`；系统提示词、AGENTS.md、技能、记忆、知识按现有装配逻辑注入。
4. **工具与沙箱**：先让工具调用经过 LinkSense 的沙箱接口（Docker/桌面），再谈 `experimental_sandbox`；不要依赖“传了 sandbox 就自动隔离”。
5. **审批**：`toolApproval` + `experimental_toolApprovalSecret` + LinkSense 权限策略/审计；高-risk 工具默认 `user-approval`。
6. **持久化与恢复**：回合状态、事件 outbox、幂等键、租约；优先复用现有 PostgreSQL/Redis/BullMQ，不轻易引入第二套 workflow 引擎。
7. **上下文**：`pruneMessages` + 自定义压缩；工具输出上限、缓存、图片卸载。
8. **子代理/计划**：等核心闭环稳定后再做；注意 AI SDK 文档明确 subagent 工具不能用 `toolApproval`。
9. **评测**：用真实任务建立基线（成功率、工具调用正确性、上下文、成本、延迟），与 Codex 同题对比。
10. **发布**：新会话可选 “LinkSense Native (beta)”，默认仍 Codex；达到验收后再切换默认。**不要先删 Codex。**

### 10.7 风险

- **实验性 API**：`ToolLoopAgent` 在类型导出里仍以 `Experimental_Agent` 别名出现；`@ai-sdk/harness*` 全部标注 experimental，升级可能破坏。自建引擎也会随 AI SDK 大版本演进。
- **安全责任转移**：现在 Codex 的审批/沙箱是安全边界；替换后，提示词注入、工具越权、沙箱逃逸、审批伪造、密钥泄露都由 LinkSense 负责。
- **沙箱模型不匹配**：AI SDK 的 harness 示例围绕 Vercel Sandbox；LinkSense 是 Docker Worker + 本地桌面设备，需要自己的 sandbox 适配与强制点。
- **功能对齐与评测成本**：Codex 的计划、目标、子代理、Hook、插件、压缩、审批语义不是“再写一个循环”就能等价；没有评测集就无法判断替换是否成功。
- **模型/工具兼容性**：不同 provider 的工具调用、推理档位、上下文窗口、缓存行为差异大；现有模型网关需要逐项验证。
- **维护成本**：自建 harness 意味着长期维护一套 Agent 运行时，而不是跟随上游升级。

## 11. 证据与来源

### 11.1 本地源码

- [Runner 启动与 Codex 版本检查](../../apps/runner/src/index.ts#L94)、[版本锁定](../../apps/runner/src/codex/runtime-version.json)
- [AppServerProcessPool](../../apps/runner/src/process-pool.ts#L843)、[startTurn](../../apps/runner/src/process-pool.ts#L1476)、[interrupt](../../apps/runner/src/process-pool.ts#L2531)、[forkThread](../../apps/runner/src/process-pool.ts#L2941)、[goal](../../apps/runner/src/process-pool.ts#L3067)、[subagents](../../apps/runner/src/process-pool.ts#L3269)
- [Codex 事件映射](../../apps/runner/src/codex/event-mapper.ts#L144)、[共享事件契约](../../packages/shared/src/events.ts#L1552)
- [Runner 路由](../../apps/runner/src/server.ts#L1764)（start/steer/interrupt/fork/goal/subagent/runtime）
- [Conversation](../../prisma/schema.prisma#L909)、[ConversationTurn](../../prisma/schema.prisma#L1069)
- [桌面资源清单](../../scripts/desktop-resources.mjs)、[双模式方案](./linksense-desktop-dual-mode-plan-2026-11-16.md)
- [既有 Pi 调研](./deer-flow-pi-sandbox-desktop-conversation-summary-2026-10-21.md)（本文不重复其沙箱/桌面细节）

### 11.2 上游文档

- AG-UI：[README](https://github.com/ag-ui-protocol/ag-ui)、[架构](https://docs.ag-ui.com/concepts/architecture)、[Agent 概念](https://docs.ag-ui.com/concepts/agents)、[1.0 类型定义](https://github.com/ag-ui-protocol/ag-ui/blob/main/sdks/typescript/packages/core/src/generated/types.ts)
- DSH：[仓库](https://github.com/deepseek-ai/deepseek-harness)、[架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[SDK 协议](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/protocol/README.md)、[ACP](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)、[模型路由](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md)
- Pi：[仓库](https://github.com/earendil-works/pi)、[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[CLI/RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli-integration.md)、[RPC 命令](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md)、[自定义 provider](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
- ACP：[协议概览](https://agentclientprotocol.com/protocol/overview)、[Codex ACP 适配器](https://github.com/agentclientprotocol/codex-acp)
- AI SDK：[官网](https://vercel.com/ai-sdk)、[简介](https://ai-sdk.dev/docs/introduction)、[构建 Agent](https://ai-sdk.dev/docs/agents/building-agents)、[循环控制](https://ai-sdk.dev/docs/agents/loop-control)、[工具审批](https://ai-sdk.dev/docs/agents/tool-approvals)、[MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)、[HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses)、[Harness 架构](https://github.com/vercel/ai/blob/main/architecture/harness-abstraction.md)、[Vercel Academy: Build an AI Agent Harness](https://vercel.com/academy/build-ai-agent-harness)

## 12. 本轮完成与未验证

已完成：核对 AG-UI 1.0 事件与 interrupt 类型；核对 DSH 的 SDK/ACP/profile 与限制；核对 Pi 的 SDK/RPC 命令与功能缺口；核对 LinkSense 的 Codex 耦合面与现有会话级 `executionTarget` 先例；核对 AI SDK 7 的 `ToolLoopAgent`、`toolApproval`、MCP、`HarnessAgent` 及其 Codex/Pi/ACP 适配器；给出引擎边界、会话绑定、设置页、模型/MCP/桌面、自建 harness 与分阶段验证建议。

未验证：未安装或运行 DSH/Pi/AG-UI/AI SDK harness 包；未做真实回合、取消、恢复、审批、模型网关、MCP、沙箱、桌面打包的集成测试；未编写或运行 `ToolLoopAgent` 原型；未评估性能、资源占用与安装包体积；未确认 DSH ACP 的 `session/set_config_option` 是否属于标准 ACP v1 还是 DSH 扩展；未确认 Pi 扩展 UI 请求与 LinkSense 表单的映射；未确认 `@ai-sdk/harness` 系列在 LinkSense 的 Docker Worker/桌面环境中的可运行性；未检查所有上游版本的最新变更。任何实施决定都需要以锁定版本的真实集成测试为准。
