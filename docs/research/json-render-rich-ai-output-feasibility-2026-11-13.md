# json-render 丰富 LinkSense AI 输出的适用性调研

首版实现与兼容边界见[聊天富内容](../development/rich-ai-output.md)。以下保留初始调研结论。

调研日期：2026-11-13。范围：官方文档、官方 GitHub `v0.22.0` 源码、npm registry 元数据与 LinkSense 当前本地工作树。当前分支为 `feat`，已有其他未提交修改，本文不代表线上部署状态。本轮没有安装依赖、运行 json-render 示例、调用模型或修改 LinkSense 业务代码。另制作了与库无关的交互概念示意，不能作为库接入验证。以下“建议”是拟议的设计，不代表已经实现。

## 结论

json-render 适合充当 **AI 结果的受控呈现层**：正文继续使用 Markdown，模型或工具额外给出受约束的 JSON spec，前端用 LinkSense 自己的 React 组件渲染卡片、指标、图表、表格、时间线和详情区域。官方已提供 inline 文本与 UI 混合模式，以及无 AI、无后端的静态 spec 示例，因此不需要为了引入它而换用 AI SDK、Next.js 或新的 Agent runtime。[S1][S2][S3]

它提供的是 catalog、spec、registry、状态表达式、事件和流式 patch 工具，不是模型，也不是任意图片、视频、网页代码的生成器。模型只能组合应用公开的组件词汇；布局、图表质量、事实正确性、可访问性、数据权限和业务操作仍需要应用负责。[S1][S4][S5]

相比仅替换 `request_user_form`，这个范围更值得做接入验证。原表单分析仍见 [request_user_form 适用性调研](json-render-request-user-form-feasibility-2026-11-13.md)；其中“不建议仅为普通表单替换”的结论，不适用于用户本次提出的整个 AI 输出体验。

## LinkSense 当前输出能力与缺口

| 当前能力 | 本地证据 | 对本次选型的影响 |
| --- | --- | --- |
| 流式 Markdown、代码块、图片和引用 | `apps/web/src/features/conversations/conversation-thread.tsx:1607` 起的 `AssistantMarkdown`，第 1777 行起挂载 Streamdown；`assistant-markdown-image.tsx:54` 起管理图片预览。 | 保留解释性正文和证据链，不必把每段话都转换为 UI。 |
| Mermaid | `conversation-thread.tsx:747` 起识别 mermaid；`assistant-mermaid.tsx:38` 起渲染与导出。 | 流程、依赖、架构等图继续复用现有能力，不重复造一套。 |
| HTML 预览 | `conversation-thread.tsx:792` 起识别 html-preview；`assistant-html-preview.tsx:388` 起通过 iframe 挂载预览；`packages/shared/src/html-preview.ts:4` 定义 sandbox。 | 已有自由网页表达能力。json-render 的新增价值是原生产品组件、受控组合、统一交互及可管理的数据绑定，不能仅以“能显示卡片”作为引入理由。 |
| 文件与产物 | `apps/runner/src/mcp/core-services/file-service.ts:273` 起提供 `register_artifact`；`apps/web/src/features/task-artifacts/task-artifact-preview.tsx:18` 起提供预览与下载。 | 可以评估复用产物身份和授权读取；目前没有核实出可直接识别 UI spec 的产物 renderer，不能把 JSON 文件上传等同于富内容接入完成。 |
| 应用事件 | `apps/api/src/modules/events/service.ts:183` 起要求会话绑定交互式应用包，并校验 manifest 声明的事件；`interactive-application-page.tsx:455` 起转发给应用 iframe。 | `emit_application_event` 是既有交互式应用通道，不能直接当成普通聊天的通用 UI 发布通道。 |
| 图表组件 | `apps/web/src/components/ui/chart.tsx:40` 起封装 Recharts；`features/usage/personal-quota-chart.tsx` 和 `pages/admin-usage-page.tsx` 已使用。 | 富内容图表可复用已安装的 Recharts 与主题封装，仍需定义面向 AI 的受限组件接口。 |
| 纯文本与分享策略 | `conversation-thread.tsx:1276` 起定义 `ConversationContentPolicyContext`，代码块、图片、引用遵循 `textOnly` 等策略；设计基线说明公开分享的快照与只读语义。 | 新结果块需要文本摘要、复制/引用/分享策略，公开快照不能继承私有会话中的动作权限。 |

上表中未重复目录的 `conversation-*`、`assistant-*` 文件均在 `apps/web/src/features/conversations/`；`interactive-application-page.tsx` 位于 `apps/web/src/features/applications/`。

## 建议优先做哪些输出

以下是产品建议，不是已有功能：

1. **研究与知识回答**：正文给结论，旁边或下方给“主要发现、支持证据、限制、待确认项”；可展开依据并打开已有引用。引用必须绑定真实来源，不能让模型随意生成看起来可信的来源标记。
2. **方案比较与推荐**：比较矩阵、候选卡、选择后的取舍说明、适用场景；先做本地切换，用户决定进一步追问时才开始普通后续交互。
3. **数据分析**：从文件或工具得到真实数据，生成指标、柱/折线图与表格；切换维度或图表/表格视图。数值、聚合与单位由已验证的数据处理决定，模型负责解释与呈现选择。
4. **执行计划与事件复盘**：阶段、依赖、里程碑、检查清单和时间线。AI 建议的计划必须标注为建议；真实执行进度只能来自已验证的任务状态，不能由模型自行生成百分比。
5. **可复用结果面板**：后续评估保存、重新打开和继续调整。它与完整交互式应用仍有边界：需要独立导航、持久化业务数据、跨会话多人操作时，继续使用应用能力。

第一阶段优先支持前三类。需要问用户时仍使用现有表单；一段解释性回答无需强制生成卡片。

### 让 AI 选择表达形式

建议给模型一套小而可组合的组件目录，并说明选择依据：多个候选项使用比较；有可靠数值和维度时使用图表/表格；有顺序和时间时使用时间线；有证据和不确定项时使用可展开研究摘要。布局、强调、资源引用与展示数据分别有明确约束。模型可以组合这些组件，避免只能套用少数固定模板。

完整网页、独特视觉、自由绘图和复杂模拟继续使用已有 HTML/文件输出；需要检索或生成图片时使用对应工具，再把已授权资源引用放入结果。json-render 的丰富程度取决于组件、数据和生成规则的设计，安装依赖本身不会自动改善每次回答。

PoC 应分别记录有效 spec 率、图表数值与单位正确性、来源绑定正确性、首屏时延和用户实际使用的交互，再决定是否扩大 catalog。没有获得观测结果前，不承诺提高质量、降低 token 或减少生成延迟。

## 已有能力与适合 LinkSense 的输出

| 输出 | 已核实的官方证据 | LinkSense 的候选用途；属于建议 |
| --- | --- | --- |
| Markdown + 原生 UI 卡片 | inline mode 允许文字和 JSONL 共存；React registry 渲染自己的组件。[S2][S5] | 调研解释配“关键结论/证据/风险”卡片；保留原有正文和引用 |
| 指标、图表、数据表 | Chat 示例实际定义 `Metric`、`Table`、`BarChart`、`LineChart`、`PieChart`；registry 使用 Recharts，表格带本地排序。[S6][S7] | 文件分析、运行统计、数据对比、分布与趋势结果 |
| 时间线、洞察、分组详情 | Chat 示例有 `Timeline`、`Callout`、Tabs；不是只有表单。[S6] | 事件溯源、研究进展、任务计划、优缺点对比、来源详情 |
| 交互式结果面板 | `$bindState`、`$state`、`repeat`、visibility 和 `$computed` 均有正式文档。[S8][S9] | 选择日期/类别、切换图表/表格、展开行详情；不必每次再问模型 |
| 保存的生成式 dashboard | Dashboard 示例保存 prompt/spec 到自己的 Postgres，通过自己的 REST action 获取和修改数据。[S10] | 先保存会话结果面板，再评估独立 dashboard 工作区 |
| 图片、PDF、视频 | 官方提供 Image、React PDF、Remotion 包和示例，详见下文。[S17][S18][S19] | 导出结果图、报告、短视频是独立后续范围 |

**图表不是“安装 core 就有的内置图表引擎”。** 官方 renderer/package 列表与源码中未找到单独的官方 `@json-render/charts` 包；真实图表证据是 Chat/Dashboard 示例中自行声明 schema、实现 registry，并依赖 Recharts。标准 `@json-render/shadcn` 目录本身不包含这些图表或 Timeline。采用哪些图表、维度/单位、聚合算法、空值和缺失数据规则，需要 LinkSense 设计和实现。[S6][S7][S11][S12]

## 交互、数据与动作的边界

1. **纯本地交互**：表格排序可直接在 React 组件内部实现；筛选可以由绑定状态配应用注册的 `$computed` 函数实现；详情展开可以使用选中状态和 visibility。json-render 提供状态和组合机制，通用过滤器、任意 drilldown 查询语义不是自动得到的功能。[S7][S8][S9]
2. **服务端交互**：命名 action 的 handler 可以调用应用 API 并把返回结果写入 UI state；watch 可以在状态改变时触发 handler。它不会替应用提供鉴权、资源归属、审批、幂等性或审计。建议第一阶段只开放本地切换与已授权的读取；修改/删除等业务动作另行设计。[S5][S13]
3. **数据引用**：`{"$state":"/results/sales"}` 是针对交给 renderer 的状态对象的 JSON Pointer，既不是数据库查询，也不是自动安全的数据代理。应用可以运行时注入 state，让 spec 引用已有数据，减少模型复述整张数据表的需要。[S8]
4. **模型可见范围与浏览器可见范围要分别裁剪**：`buildUserPrompt({state})` 会把传入 state 序列化进提示词；不能因为 UI 只显示部分字段就把全量敏感记录传给它。浏览器 state 也应只含用户有权获得的数据，`visible:false` 不构成授权。建议工具先返回经过授权和脱敏的数据集/摘要，spec 只使用批准的字段和 dataset 引用。[S14；后半为设计推论]

安全建议：以 Zod 校验应用 envelope、spec、组件 props 和 action params；约束数据体积、元素数量、嵌套、媒体 URL 和可调用 action。官方 `validateSpec` 检查缺失 root/children、visibility/repeat 等结构问题；这类结构检查不能替代组件值验证、URL 策略或服务端授权。无效富结果应展示已存在的正文/结构化错误，不能为了修复 UI 自动重放完整 Codex turn。[S4][S15；安全策略为 LinkSense 建议]

## 流式生成、增量修改、保存与重放

**流式能力已发布**：SpecStream 是逐行 JSON Patch，使用 `add/remove/replace/move/copy/test`，renderer 随 spec 变化逐步呈现。`createSpecStreamCompiler` 可用于自定义 transport，接收初始 spec、持续 `push`、取得 `getResult/getPatches`；`createMixedStreamParser` 暴露 `onText/onPatch`，没有要求接入 AI SDK。[S16][S20]

**混排存在一个需要明确的语义**：官方 AI SDK 示例中，`useJsonRenderMessage` 把一条 message 中的所有 spec parts 合并成一个累计 spec。保留原 parts 顺序时，官方推荐在首个 spec 位置渲染一次累计 UI，后续 patch 更新同一处 UI；不会自动得到“正文 A → 卡片 A → 正文 B → 卡片 B”四个独立快照。LinkSense 如果需要多个独立结果块，需要应用自己的 block/artifact ID、顺序与隔离 state。[S21]

**修改现有 spec 的基础能力已发布**：core 的 `buildUserPrompt({currentSpec})` 会转入 edit 模式，支持 patch、merge、diff 策略；低层 compiler 可以从旧 spec 开始。建议 V1 使用一个明确的 patch 格式，避免同时引入多种编辑协议。[S14][S22]

**保存/重放不是 core 提供的业务服务**：Dashboard 示例在 `onComplete` 调用自己的 API 保存 JSON，然后从 `initialSpec` 恢复。建议 LinkSense 为最终 spec 和数据快照记录自己的 envelope/version/catalog revision；先保证旧结果仍可使用，再增加增量事件的回放。只存 JSON 不会自动解决未来 registry/schema 变化、数据来源消失、权限撤回或资源 URL 过期。[S10][S23；版本策略为建议]

官方示例也有两处不能直接照抄：

- Dashboard `useUIStream` 发送 `currentSpec`，widget 的编辑入口也传了 `previousSpec`，但其 generation route 只读取 `prompt/context` 并向 `buildUserPrompt` 传 `state`，没有传 `currentSpec`。因此 README 的“Edit mode”说明不能单独证明该例完整实现了精确 patch refinement；这是静态源码发现，没有运行复现。[S23][S24][S25]
- Dashboard widget 加载保存的 spec 时会自动执行 `initialActions`。历史会话的查看不应再次触发业务副作用；LinkSense 的结果重放与 action 执行需要分开设计。[S23；建议]

## 适配 LinkSense，无须替换 Codex app-server

建议按成本递进：

1. **静态验证结果面板**：应用用确定性逻辑将现有工具的受控结果映射为 spec；验证自定义 registry、主题、移动端与旧会话后再让模型选择布局。官方 no-AI 示例证明 renderer 不依赖模型或生成服务。[S3]
2. **结构化工具结果/产物**：在现有执行链允许的结果通道中发出有版本的结果 envelope（例如 `kind/spec/data/catalogVersion`），前后端按现有权限与事件契约处理。json-render 只解释已验证的 UI 数据。普通聊天发布与现有交互式应用事件需要分开，具体入口需在 PoC 时验证，不能仅复用事件名称绕过当前 manifest 检查。
3. **渐进流式 UI**：只在确有必要时，把同一现有 turn 的 UI 数据增量交给低层 compiler；native Codex turn/item/error/approval/interruption 语义保持原样。不要因为使用 `useUIStream`、示例 Agent 或推荐 repair loop 就增加自定义整轮重试、重放输入或新 lifecycle。json-render 的 renderer/compiler 本身不需要接管 Agent。

**组件复用优先**：`defineRegistry` 可以将任意 catalog 类型映射为自有 React 实现。官方 `@json-render/shadcn` 用的是 **Radix UI + Tailwind**，不是 Base UI Rhea；建议只采用 core/react，registry 复用 LinkSense 已有 Base UI/shadcn 组件和 tokens，避免引入第二套交互基础。[S5][S11]

可访问性仍由这些实际组件与组合规则决定，包括标题层级、表格语义、图表替代描述、键盘、焦点、loading/error 和 reduced motion。官方图表示例部分启用了 Recharts `accessibilityLayer`，不能据此推断生成组合全部满足要求。[S7；设计判断]

国际化方面，官方 directives 包已有 `$format` 与 `createI18nDirective/$t`，但语言词典和 locale/fallback 由应用配置；不自动提供 LinkSense 的六语言翻译，也不替代现有 i18next。建议 UI 固定操作文本由现有翻译资源提供，模型生成的研究正文/图表标题遵循会话语言，日期/数字/单位由可信 formatter 统一处理。[S26；接入方式为建议]

## 图片、媒体、演示输出的实际范围

- `@json-render/image` 用 Satori 把布局 spec 渲染为 SVG；PNG 另需 `@resvg/resvg-js`，需提供字体。标准组件是 Frame、Box、Row、Column、Heading、Text、Image、Divider、Spacer，适合结果海报/分享卡；`Image` 消费已有图片 URL。它不是扩散模型，也不从描述生成任意照片或插画。[S17；能力边界推论]
- `@json-render/react-pdf` 用 `@react-pdf/renderer` 生成 PDF buffer/stream/file，包含 Document/Page/Table/Image 等组件，适合报告和清单；它不是交互式网页面板的无损导出器。[S18]
- `@json-render/remotion` 采用 composition/tracks/clips 的独立 timeline schema，支持 TitleCard、ImageSlide、StatCard、VideoClip、音轨、转场等，消费已有媒体素材并组合视频。它与 React 元素树 spec 不是同一种格式。[S19]
- 当前官方 renderer/package 清单没有 PowerPoint/PPTX 或 Slides renderer；可以用自定义 catalog 构建网页演示卡片，但原生可编辑 PPTX 不是已核实的内置能力。不同输出目标也不是把同一 Web spec 随意换 renderer 就能完全兼容。[S12][S19；检索结论]

## 当前版本与兼容风险

截至 2026-11-13，GitHub Latest 为 **v0.22.0，发布于 2026-11-04 21:47:03 UTC**；npm `@json-render/core/react/shadcn` 的 latest 均返回 `0.22.0`。v0.22.0 新增 `@json-render/chat`，将 spec 转成 Chat SDK 的原生 Slack/Teams 等卡片；这与 LinkSense 网页 React 渲染是不同目标，不是网页集成前提。[S27][S28]

`@json-render/react@0.22.0` 的 React peer 是 `^19.2.3`；core 依赖 Zod `^4.3.6` 并声明 peer `^4.0.0`；shadcn 包的 peers 包括 Tailwind `^4.0.0`。[S11][S29][S30] 当前 `apps/web/package.json` 声明 React `^19.2.6`、Zod `^4.6.6`，从声明范围看没有这两项版本阻碍；实际安装解析、bundle 和行为兼容尚未验证。现有 React、Vite、Base UI 与 Codex 执行架构无需因本次研究而迁移。

这是仍在快速变化的 0.x 工程。迁移文档仍专门讲 v0.6.0 的破坏性改名（DataProvider→StateProvider、旧动态表达式→`$state`、旧 valuePath→`$bindState`）；更近期 v0.20.0 又把自定义桥接的 `executeAction` 入参改为 `ActionBinding`。v0.21.3 修正了 JSON Pointer 自有属性/数组索引、重复 append patch、YAML copy/move 等问题。建议锁定包版本与 catalog revision，对历史持久化 spec 做实际 render/action 禁用回归，再升级。[S31][S32；策略为建议]

A2UI 与 AG-UI 的官方集成页明确标注是 **Concept / illustrative**，需要生产适配；它们不是已经替 LinkSense 完成的 transport。MCP Apps 则确有 `@json-render/mcp` 包，方案是 MCP 工具+UI resource+HTML iframe，适合向支持 MCP Apps 的外部宿主分发界面；不等于已有 MCP tool output 会自动在 LinkSense 中变成应用，也不必为站内 React 结果层先实现 MCP Apps。[S33][S34][S35]

## 首次接入验证的边界与验收

建议先做三个完整 spec 的结果样例：研究摘要、候选方案比较、真实数据图表。第一版使用确定的完成态结果，保留正文摘要；验证布局价值后再接渐进生成。完整 spec 与 UI 局部交互已经足以回答是否改善输出体验，不必同时实现新的流式协议、独立 dashboard 或媒体导出。

开始实际接入后，应验证：

- 正常结果、空数据、无效 spec、未知组件和过大数据都能得到明确呈现；无效富内容不影响已有正文，且不自动重跑任务。
- 桌面/窄屏、浅色/深色、键盘、用户字号和六语言固定文案正确；图表有清晰的轴、单位、缺失数据提示和可阅读的表格替代。
- 排序、筛选、展开等本地动作不额外调用模型；追问与外部操作有不同入口，现有审批与资源授权继续生效。
- 普通旧会话继续可读；保存过的 spec 在 catalog 升级后仍有明确的兼容或恢复路径；查看历史结果不再次触发业务动作。
- 引用、文件、图片和数据集沿用授权读取；复制和分享提供可理解的文本或快照，不能把私有数据或可执行操作意外公开。

本轮概念示意包含三种回答形态，使用虚构业务资料，不执行任何真实任务。通过 jsdom 与 Node assert 检查了方案切换、准备项勾选、依据展开、状态保存/恢复及 DOM 唯一 ID。示意使用原生 `details/summary`，遵循 modern-web-guidance 的 `accordion` 与 `html` 指南；没有把它当作 json-render PoC。

## 尚未验证

没有运行任何 json-render 示例或 LinkSense PoC，没有测量 bundle、渲染性能、token、生成成功率、权限覆盖或六语言可访问性。没有验证已安装 Codex 的新协议接入，没有改变其生命周期或要求改用其他 SDK。没有对概念示意做真实浏览器视觉验收。当前证据足以支持“小规模结果呈现 PoC”的可行性，不能证明生产可直接采用。

## 一手来源

- [S1] https://json-render.dev/docs
- [S2] https://json-render.dev/docs/generation-modes
- [S3] https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/no-ai/README.md
- [S4] https://json-render.dev/docs/catalog
- [S5] https://json-render.dev/docs/registry
- [S6] https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/chat/lib/render/catalog.ts
- [S7] https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/chat/lib/render/registry.tsx
- [S8] https://json-render.dev/docs/data-binding
- [S9] https://json-render.dev/docs/computed-values
- [S10] https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/dashboard/README.md
- [S11] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/shadcn/package.json
- [S12] https://json-render.dev/docs/renderers
- [S13] https://json-render.dev/docs/watchers
- [S14] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/core/src/prompt.ts
- [S15] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/core/src/spec-validator.ts
- [S16] https://json-render.dev/docs/streaming
- [S17] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/image/README.md
- [S18] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/react-pdf/README.md
- [S19] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/remotion/README.md
- [S20] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/core/src/types.ts
- [S21] https://json-render.dev/docs/ai-sdk#preserving-part-order
- [S22] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/core/src/edit-modes.ts
- [S23] https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/dashboard/components/widget.tsx
- [S24] https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/dashboard/app/api/generate/route.ts
- [S25] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/react/src/hooks.ts
- [S26] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/directives/README.md
- [S27] https://github.com/vercel-labs/json-render/releases/tag/v0.22.0
- [S28] npm registry inspected directly: https://registry.npmjs.org/@json-render%2Freact/latest ; https://registry.npmjs.org/@json-render%2Fcore/latest ; https://registry.npmjs.org/@json-render%2Fshadcn/latest
- [S29] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/react/package.json
- [S30] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/core/package.json
- [S31] https://json-render.dev/docs/migration
- [S32] https://github.com/vercel-labs/json-render/blob/v0.22.0/CHANGELOG.md
- [S33] https://json-render.dev/docs/a2ui
- [S34] https://json-render.dev/docs/ag-ui
- [S35] https://github.com/vercel-labs/json-render/blob/v0.22.0/packages/mcp/README.md
