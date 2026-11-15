# AI 富内容组件扩展调研

调研日期与一手来源抓取日期：2026-11-14。本文接续 [json-render 丰富 AI 输出的适用性调研](json-render-rich-ai-output-feasibility-2026-11-13.md)，研究常用组件模式、实际用途和边界。以下优先级、名称和字段方向均为建议，尚未成为产品决定。本轮没有安装依赖、改变运行时、实现组件或部署。

后续已实施 KeyValue、Timeline、Steps，Chart、Metric、DataTable 增强，Tabs、Details、临时 Checklist，以及 MediaGallery、ResourceList 和 Evidence 来源预览。当前实现与兼容边界见[聊天富内容](../development/rich-ai-output.md)；下文保留调研时点的候选、优先级与建议，不表示所有细节均已采用。

范围以现有 `Panel`、`Grid`、`Text`、`Callout`、`Evidence`、`Comparison`、`Metric`、`DataTable`、`Chart` 九类为起点；保留 React、TypeScript、Base UI Rhea、Tailwind 和 Recharts。当前富内容约束继续成立：声明式、只呈现受控数据，不开放任意 actions、bindings、state 或 URL。外部目录存在某种控件，不代表 LinkSense 应开放同名能力。

## 研究结论

**可以扩展，而且优先补“表达结构”和“读取效率”，比把组件总数做大更有价值。** 建议先评估 `KeyValue`、`Timeline`、`Steps` 三种展示类型，以及已有 `Chart`、`DataTable`、`Metric`、`Evidence` 的针对性增强；再考虑一种展开容器和 `Tabs`。来源、文件和图片可以成为后续卡片，但前提是复用已有引用与资源授权，不能直接接受模型给出的任意地址。

这不是因为某个竞品列出了更多组件：json-render 的官方 registry 本来就允许应用定义自己的组件目录与实现；它的 shadcn 目录覆盖通用 UI，而 Chat 示例单独定义了 Timeline、Metric、图表等回答组件。[S1][S2][S3] assistant-ui 也同时提供 Fact、Steps、Timeline、Tabs、Citation 等词汇，官方格式选择页把“扫描、比较、分步说明、事实摘要”与适合一次阅读的 Markdown 区分开。[S4][S5] 这些来源支持模式的普遍性，不能证明新增组件会自动提高 LinkSense 的回答质量或使用率。

不建议新建第二套聊天 UI 或生成式 UI runtime。json-render 的现成 shadcn 包明确使用 Radix UI；LinkSense 继续通过自己的 registry 复用 Base UI 组件。[S1][S2；后半为项目建议] AI Elements 页面目前提示将迁入 shadcn/ui，并在 2026 年 11 月底弃用当前项目；本文借鉴其 Plan、Sources、Artifact、Attachments 的信息结构，不建议为了这些展示形式新增整套依赖。[S6][S7][S8][S9]

## 当前实现与接入成本

以下是对本地 `feat` 分支、提交 `2a9dfc58` 的代码核对，不代表线上状态。成本是基于现有复用面的相对判断，未测量工时、bundle、token 或生成成功率。

| 当前实现与代码证据 | 对扩展的影响 |
| --- | --- |
| [共享目录与验证](../../packages/shared/src/rich-output.ts) 的 `richOutputComponents` 注册九类，验证完整树、逐组件 props、40 个元素和最大深度；当前只有 Panel/Grid 可带 children。 | 新增展示类型可沿用此入口。Tabs、Details 等若包含其他富组件，还要设计并校验分组与子节点归属；不能只注册一个 React 组件就视为完成。 |
| [React registry](../../apps/web/src/features/conversations/assistant-rich-output-renderer.tsx) 已实现本地展开、比较和表格排序；Chart 当前只有单序列柱状/折线。 | KeyValue、Timeline、Steps 的相对成本低；多序列图表、结构化日期/数字列和容器扩展为中等，需要同步验证数据结构与阅读语义。 |
| `components/ui/` 已有 [Tabs](../../apps/web/src/components/ui/tabs.tsx)、[Collapsible](../../apps/web/src/components/ui/collapsible.tsx)、[Checkbox](../../apps/web/src/components/ui/checkbox.tsx)、[Progress](../../apps/web/src/components/ui/progress.tsx) 和 Badge。 | 分组、临时勾选与基于已知数据的进度快照可以复用基础控件。Checklist 仍需明确刷新语义；Progress 不能映射为模型编造的原生任务运行进度。 |
| [聊天图片](../../apps/web/src/features/conversations/assistant-markdown-image.tsx)、[产物预览](../../apps/web/src/features/conversations/conversation-artifact-files.tsx) 已处理资源身份和预览时效；[Mermaid](../../apps/web/src/features/conversations/assistant-mermaid.tsx) 与 [数学插件](../../apps/web/src/features/conversations/assistant-markdown-plugins.ts) 已有独立入口。 | MediaGallery/ResourceList 的成本在资源上下文桥接，不能用模型给的 URL 替代。流程图、公式、代码和一般图片输出先沿用现有入口。 |
| [目录工具](../../apps/runner/src/mcp/core-services/rich-output-service.ts) 给模型组件 schema 与选择规则；共享文件中的 `richOutputText` / `richOutputMarkdownToText` 负责复制和文本渠道；[公开分享](../../apps/web/src/pages/shared-conversation-page.tsx) 强制富内容文本投影。 | 每个新增或增强类型都必须同时更新生成规则、文本投影及对应测试。新增数组型内容若只做 renderer，界面可见但复制/分享可能丢失明细。 |

最小改动面是共享契约与测试、Web registry 与六语言固定文案、目录工具与生成示例、文本投影、必要的 E2E 场景及开发说明。前两批纯展示和本地交互不需要换 Radix、换 Agent runtime 或新增数据库；资源桥接需按现有授权接口单独评估。

## 12 个候选：新增类型与增强能力分开看

表中“收益、优先级、最小范围”是设计判断，不是外部组件已替 LinkSense 实现的能力。P0 表示优先验证价值，P1 表示在明确需求后追加，P2 表示需要额外契约或目前收益不足。候选名称只帮助讨论，不是已经确认的 schema。

| 候选与优先级 | 常见场景与实际收益 | 与现有九类的重合；建议最小范围 | 交互、可访问性与事实边界 |
| --- | --- | --- | --- |
| **1. `KeyValue`，P0，新增展示** | 订单/文件/配置摘要、会议信息、实体属性；一眼读清“字段是什么、值是什么”。 | `Metric` 适合强调关键数字，`DataTable` 适合多行同构记录；用多个 Metric 展示字符串元数据会过重。最小范围是有序的 label/value 列表，可选简短说明。assistant-ui 的 Fact 与 HTML description list 都体现这一模式。[S4][S10] | 只展示，不把字段变成编辑表单；建议使用 `dl/dt/dd` 语义，长值换行，空值与未知值有区别。不要为了边框再新增 ProfileCard、InfoCard 等同义类型。 |
| **2. `Timeline`，P0，新增展示** | 故障复盘、项目里程碑、历史事件、行程安排；把时间与事件放在同一阅读顺序中。 | `Text` 能列事件，但缺少统一的时间/标题/说明结构；`Comparison` 不表达先后。json-render Chat 示例和 assistant-ui 都有明确 Timeline 模式。[S3][S4] | 建议首版为纵向、只读、有序列表。时间保留时区/精度；未知时点不补成精确日期。建议安排与已发生事件分清；模型写出的 completed/current 不能当成真实运行状态。 |
| **3. `Steps`，P0，新增展示** | 操作指南、迁移建议、排查步骤、实施计划；让每步的动作与完成条件容易扫描。 | 与 `Timeline` 的区别是顺序而非时间，与 `Comparison` 的区别是执行路径而非方案选择。assistant-ui 的 Steps 和 AI Elements 的 Plan 都支持分步计划这一模式。[S4][S6] | 最小范围为 title/detail 的有序条目，可选前提或注意事项；建议继续用既有 Callout 表达风险。只是建议方案时，不显示“正在执行”、虚构百分比或可点击执行按钮。短三步 Markdown 已清楚时无需强制生成富内容。 |
| **4. `Checklist`，P1，先明确状态规则** | 出行准备、发布前核对、资料收集；用户自己勾选以减轻记忆负担。 | 与 Steps 高度重叠：若只是静态的已完成/待完成提示，可作为列表/Steps 的展示变体；只有用户真需要勾选时才值得单独设计。官方目录有 Checkbox，AI Elements Task 有任务列表模式。[S1][S11] | 本地勾选只代表“我在此视图里做了标记”，不是服务器完成状态或模型收到的回答。需要约定刷新/重新打开是否保留、分享是否只读；不能默认持久化或提交。支持标签、Space 切换和可读状态。[S12] 若 AI 必须取得用户选择，仍走 `request_user_form`。 |
| **5. `Details` / `Accordion`，P1，选择一种** | 长答案的依据、计算过程、FAQ、限制说明；保留结论，按需读取细节。 | 这是容器能力，不是新的业务内容类型；与 Panel 的差别是可展开。优先一种简单 disclosure，不同时扩充 Details、Collapsible、Accordion 三个同义入口。官方目录和 Plan 都有这种模式。[S1][S6] | 建议关键结论、错误和必要风险默认可见；展开仅切换本地可见性，不发查询、不表示额外授权。按钮、展开状态、键盘和标题关系按 WAI 模式实现。[S13] 复制/纯文本/分享快照必须包含被折叠的必要内容。 |
| **6. `Tabs`，P1，受控本地容器** | 摘要/详细、图表/表格、同一数据的不同视角；减少重复面板的纵向长度。 | Panel/Grid 已能排版；Tabs 的新增价值是局部切换，不应把所有段落藏进标签。json-render 示例与官方目录都有 Tabs。[S1][S3] | 标签切换只显示已提供的数据，不能暗含远程查询或持久化业务状态。要有 tab/tablist/tabpanel、可见焦点和方向键；仅在面板可即时显示时考虑随焦点自动激活。[S14] 不适合必须同时查看两方才能判断的比较；分享/文本投影要展开所有页签。 |
| **7. 增强 `Evidence`，P0/P1，沿用已有来源体系** | 研究结论对应依据、分清支持/限制、展开原文摘录；让来源能追溯到具体论断。 | 已有 Evidence 与聊天引用，增益应是关联关系和来源信息，而非再造 SourceCard。AI Elements Sources 展示使用过的来源；Inline Citation 展示来源信息与摘录。[S7][S15] | 优先评估受控 source ID 与已有来源记录的关联；来源标题、地址、摘录应来自实际来源记录。引用卡不验证事实，不能把模型自由生成的标题/URL/“可信度”当作核验。触屏/键盘也能打开，不能只有 hover。当前 schema 不支持的引用桥接需单独设计。 |
| **8. 增强 `DataTable`，P0/P1，保留一个类型** | 分析文件、对比记录、核对明细；数字与日期正确排列后，再按需本地筛选或分页。 | 已有本地排序，不应重复新增 SortableTable。官方示例的 Table 有本地排序；通用目录另有分页组件，但这不意味着自动得到远程分页服务。[S1][S16] | 优先列类型/单位/空值/总量说明；若加入筛选或分页，仅作用于当前已授权快照，显示筛选后与原始数量，不能暗示已查全库。表格用真实表格语义、caption、可操作列头及当前 `aria-sort`；不因增加排序就改成复杂 ARIA grid。[S17] |
| **9. 增强 `Chart`，P0，优先多序列与语义** | 收入与成本、两个时期、多个类别趋势；同一坐标系下直接比较，减少并排单图的理解成本。 | 扩充一个 Chart，比新增十余个图表类型更合理。assistant-ui 词汇有多序列/堆叠；Recharts 官方示例覆盖多线、堆叠柱、面积、散点等。[S4][S18] | 建议先多序列分组/堆叠柱与多线，明确轴、单位、图例、缺失值和基准，再由场景决定面积/散点。模型不能自行“算出”没有数据支持的聚合或回归；保留数据表与文字摘要。WAI 对复杂图形要求有能传达关键内容的文本替代。[S19] 只有换颜色/加动画不算核心扩展。 |
| **10. 增强 `Metric`，P0/P1，小范围升级** | 本月与上月、实际与目标、错误率变化；避免“123”缺少统计周期和比较对象。 | 继续用 Metric，不必新增 Stat、KPI、ScoreCard。json-render Metric 示例有方向；assistant-ui Fact 还区分方向与上升是否有利。[S3][S4] 可在有明确 current/target 数据时评估进度条变体，复用现有 Progress。 | 值得评估比较周期、变化量/比例、方向和解释；涨跌不等于好坏，例如延迟/错误率下降可能更好。单位、基期、缺失数据与舍入须明确；仅有 detail 就能清楚表达时先不加字段。目标进度必须由可核对的数据产生，并标明是快照；不要自动推断盈利、评分、置信度或原生任务完成率。 |
| **11. `ResourceList` / 产物卡，P2，依赖引用桥接** | 一次交付报告、表格、网页等多项结果；用户迅速识别文件、版本和可用入口。 | LinkSense 已有产物预览，新增价值是把回答与真实交付资源关联。AI Elements Artifact 是带标题与操作区的结果容器，Attachments 提供行/网格等文件布局。[S8][S9] | 建议只收受控 artifact/resource ID，由现有授权读取解析显示信息及可用操作；当前富 schema 未开放此能力。不能照抄 Run、Regenerate、Share 等按钮：这些可能启动工具、调用模型或发布资源。权限撤回、资源删除和公开分享要有明确降级。 |
| **12. `MediaGallery`，P2，复用现有预览** | 多张生成图、截图证据、设计候选的并列阅读；标题/说明把图片与结论联系起来。 | 已有 Grid 和聊天图片预览；只有数量、关联、说明和授权引用有真实需要时才新增。官方 Attachments 有缩略图网格，Image 只负责展示已有生成结果。[S9][S20] | 用已授权 image/artifact ID，不允许任意 `src`、内联 base64、iframe 或模型新增下载地址；图像生成与检索仍调用真实工具。优先静态网格+现有预览，保留 alt/说明和键盘关闭/返回焦点；不为外观先加轮播。自动轮播另有暂停与焦点规则。[S21] 音视频播放、转码、字幕不是图库组件自动获得的能力。 |

## 三种边界应在生成规则中直接区分

| 层级 | 本次可研究的表达 | 规则建议 |
| --- | --- | --- |
| **展示块** | KeyValue、Timeline、Steps、静态 Checklist、指标、表格、图表、证据摘要 | spec 表达已经拥有的数据、建议和来源关系。AI 的计划不能提升为事实状态；缺失数据保持缺失。 |
| **组件内部的本地交互** | 展开、Tabs、已加载表格排序/筛选、图表/表格切换、个人临时勾选 | 由受控组件实现，不需要开放任意 `$state`、`$bindState`、表达式、事件或 handler。要定义文本/分享投影；临时状态不得暗中当作用户答复。 |
| **获取输入或执行操作** | 让 AI 获取答案、确认选择、发送消息、部署、删除、运行、重新生成、保存到业务库、发布/分享 | 收集用户答复继续走 `request_user_form`；业务操作继续走真实工具与已有授权流程。看起来像按钮的 schema 本身没有这些权限。文件预览和下载也必须经过既有资源授权。 |

这个区分是 LinkSense 的建议边界。第三方展示示例里出现 Button、Form、action 或用户状态，不构成将这些能力一并接入的理由；json-render 的 registry 明确把组件实现与 action handler 交给宿主，官方示例中的排序则直接在 React 内部管理。[S2][S16]

## 推荐验证顺序

1. **先做三组样例评估**：研究摘要（KeyValue + Evidence）、故障复盘/计划（Timeline 或 Steps）、真实数据分析（多序列 Chart + 既有表格）。每组同时展示现有九类能做的版本和候选版本，判断是否确实更容易找到信息。
2. **先增强同名能力再扩目录**：Chart 的数据语义、多序列和可读替代，DataTable 的列类型/单位，Metric 的比较基准，通常比新造更多卡片名更有直接收益。只有需要减少长答案滚动时才增加 Details；只有确实属于不同视角时才增加 Tabs。
3. **后评估状态与资源桥接**：Checklist 的保留语义、Evidence 来源 ID、产物与图片引用分别形成明确契约后再采用。它们涉及历史结果、资源撤权与分享，不能作为单纯视觉改动处理。

建议用可观察任务衡量：找到指定字段/事件/来源所需时间，比较错误率，是否能辨识未知值和建议状态，键盘完成率，复制/分享后信息是否丢失，以及是否发生额外模型或网络请求。这里没有预设提升百分比，也没有测量生成稳定性、token 或延迟。

## 已保存结果与交互回归

当前结果把 `version: 1` 的完整块保存在消息正文中；解析器对根对象和组件参数采用严格校验。扩展前应按以下路径验证，而不是只验证新生成的完整样例：

1. **保留旧结果可用性**：九类原有 props 和旧 Chart.points 格式继续可读、可交互、可复制。新增字段保持可选或设计明确的新版本读取方式；不要直接把新格式设为必填。新枚举值、容器和字段不能假设旧读端会忽略。
2. **先读端、后生成端**：旧读端遇到未知组件可能把整个块判为不可用，文本渠道的严格解析也可能丢弃该块。同步更新 Web、API 的文本投影与相关 Runner 代码，再允许生成新类型；回退需保留已保存新类型的读取与投影能力。普通正文仍需包含有用结论。
3. **投影保留完整信息**：折叠区和未选中的 Tabs、Comparison 选项都进入文本快照；Checklist 的临时标记不得让其他读者误认服务器已完成，资源不可访问时提供有意义的说明。当前公开分享是文本路径，不能只测私有聊天 renderer。
4. **保留阅读位置与焦点**：新增的 Tabs、Details、Checklist 和表格筛选都可能改变卡片高度。复用 `use-conversation-scroll` 已有的交互与焦点恢复机制，覆盖高低内容切换、鼠标与键盘、窄屏、正在生成和历史回答；不要假定现有 radio 回归已经覆盖全部新控件。

这些是建议验收要求，本轮未执行扩展后的升级、资源撤权或浏览器交互测试。

## 不建议为本次扩展新增的东西

- `Card`、`Section`、`Heading`、`Badge`、`Divider` 等大量低层包装：现有 Panel/Grid/Text/Callout 能覆盖时，先改善布局规则；单纯改变外观不值得增加 AI 选择负担。
- 第二套 CodeBlock、Mermaid、公式、HTML 或通用媒体引擎：先复用聊天已有能力。流程图不是多一个 json-render 类型就自动准确，复杂自由布局也不适合硬塞进受控结果块。
- 通用表单、任意按钮、地图位置查询、Kanban 拖拽、完整编辑器、实时任务进度：这些都需要更明确的数据或操作契约。尤其不要用生成式 Task/Progress 伪造原生 Codex 的运行生命周期。

## 验证范围

完成了官方文档与固定版本示例的静态研究；未运行任何第三方组件、LinkSense 浏览器样例或模型评测。外部文档的 accessibility/响应式声明是其声明，不是本轮验证结论。采用任何交互容器前仍需检查桌面与窄屏、六语言、焦点与键盘、减少动态效果、纯文本/分享、无效数据和历史 spec；资源组件还需验证授权失败与撤权。

## 一手来源

所有来源抓取日期均为 **2026-11-14**。json-render 示例固定为项目当前使用的 `v0.22.0`；在线目录与其他项目文档是当日页面，不能据此假定其最新 API 已存在于本地依赖。未把博客、演示截图或包名当作生产验证。

| 编号 | 来源 URL | 支持的事实与限制 |
| --- | --- | --- |
| S1 | https://json-render.dev/docs/api/shadcn | 官方通用目录声明 36 个组件、Radix UI + Tailwind；包含 Tabs、Accordion、Collapsible、Table、Progress、Checkbox 等。数量不是 LinkSense 扩展目标。 |
| S2 | https://json-render.dev/docs/registry | catalog 定义可生成词汇，registry 提供组件实现和 action handler；可映射自有组件。 |
| S3 | https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/chat/lib/render/catalog.ts | 固定版本 Chat 示例的 Timeline、Metric、Tabs、图表等 schema；不是标准包自动开放的业务能力。 |
| S4 | https://www.assistant-ui.com/elements/vocabulary | 当日默认词汇参考：Fact、Steps、Timeline、Tabs、Citation；Fact 有 delta/trend/upIsGood，Chart 有多序列/堆叠。仅借鉴信息模式。 |
| S5 | https://www.assistant-ui.com/docs/tools/generative-ui-formats | 官方按回答用途区分 Markdown、受控词汇生成和沙箱 widget；不能据此比较 LinkSense 实测效果。 |
| S6 | https://elements.ai-sdk.dev/components/plan | 可折叠计划/工作流内容模式；页首给出迁至 shadcn/ui 与 2026 年 11 月底弃用当前项目的提示。 |
| S7 | https://elements.ai-sdk.dev/components/sources | Sources 展示回答使用的来源；示例从消息的 source-url 部分读取，不能证明来源自动可信。 |
| S8 | https://elements.ai-sdk.dev/components/artifact | Artifact 是带标题、内容与操作区的产物容器；按钮示例不等于业务动作已接入。 |
| S9 | https://elements.ai-sdk.dev/components/attachments | 文件、图片等附件的 grid/inline/list 展示模式与 source document 信息。 |
| S10 | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dl | description list 的 term/description、元数据和键值对语义。 |
| S11 | https://elements.ai-sdk.dev/components/task | 可展开任务列表、描述与状态提示模式；文档示例不验证真实任务进度。 |
| S12 | https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/ | Checkbox 的可读标签、状态和 Space 键交互。 |
| S13 | https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/ | Disclosure 的按钮、aria-expanded、Enter/Space 交互。 |
| S14 | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ | Tabs 的语义、焦点/方向键与自动激活的延迟约束。 |
| S15 | https://elements.ai-sdk.dev/components/inline-citation | 来源信息、摘录、内联引用的交互模式；不推荐照抄其让模型生成 realistic source information 的演示方式。 |
| S16 | https://github.com/vercel-labs/json-render/blob/v0.22.0/examples/chat/lib/render/registry.tsx | 固定版本 Table 在 React 中本地排序；图表由 Recharts 实现。示例不代替项目自己的安全与无障碍约束。 |
| S17 | https://www.w3.org/WAI/ARIA/apg/patterns/table/examples/sortable-table/ | 原生表格、可排序列头按钮、当前 aria-sort；官方也注明示例需要真实辅助技术测试。 |
| S18 | https://recharts.github.io/en-US/examples/StackedBarChart/ | 官方图表示例目录与堆叠柱案例，可佐证所选引擎的表达类别；本轮未验证页面所用最新 API 与本地版本一致。 |
| S19 | https://www.w3.org/WAI/tutorials/images/complex/ | 图表等复杂图形需要概括与关键数据/关系的文本替代，可组合文字和数据表。 |
| S20 | https://elements.ai-sdk.dev/components/image | Image 消费已有图像生成结果进行显示；展示组件与图片生成服务分开。 |
| S21 | https://www.w3.org/WAI/ARIA/apg/patterns/carousel/ | 轮播的用户控制、自动轮播暂停、焦点与辅助技术限制。 |
