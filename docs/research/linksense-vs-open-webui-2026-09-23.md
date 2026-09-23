# LinkSense 与 Open WebUI 完整能力比较报告

**调研日期：2026 年 9 月 23 日**
**用途：产品定位、竞争分析、企业选型与研发优先级讨论**

> 本报告将“OpenWenUI”理解为 **Open WebUI**。结论来自 LinkSense 当前代码、帮助文档、部署配置与测试样例，以及 Open WebUI 官方文档、发布记录和版本仓库；不是双方同环境运行的性能测评。

## 1. 核心结论

**LinkSense 更突出的方向，是把 AI 执行能力交付成组织可管理、可分发、可嵌入的业务应用；Open WebUI 更突出的方向，是覆盖多模型使用、知识检索、团队协作与工具扩展的通用 AI 工作平台。双方的 Agent 能力已有明显重叠。**

不能再使用“LinkSense 能执行，Open WebUI 只能聊天”的比较口径。Open WebUI 当前已有自动化、Skills、子智能体和任务清单；搭配 Open Terminal 可以执行命令、处理文件和运行项目。需要统一管理个人执行环境时，其 Terminals 编排组件还提供工作区生命周期和资源控制，但生产使用需要企业许可。[OW04][OW05][OW06][OW07]

| 主要维度 | 当前判断 | 对 LinkSense 的含义 |
| --- | --- | --- |
| 通用多模型入口与本地模型接入 | Open WebUI 路径更丰富 | 不宜把“支持多个模型”作为主差异点 |
| 长任务与执行控制 | 双方都有；LinkSense 的目标、计划确认、执行中引导与运行状态产品化更明确 | 应展示控制流程与完成证据，不能直接宣称成功率更高 |
| 办公文件交付与修改 | LinkSense 在成果管理、Office 预览和选区批注上更集中 | 适合销售分析、材料制作、文档修改等交付场景 |
| 业务应用开发、分发和嵌入 | LinkSense 有较完整的内置流程 | 是目前最值得强化的产品差异 |
| RAG 与知识数据接入 | 两者都有混合检索；Open WebUI 的引擎和连接器选择更广 | LinkSense 应突出引用版本、治理和应用结合，并用评测证明质量 |
| 用户执行环境 | LinkSense 正式 Docker 路径内置；Open WebUI 完整编排需要配套组件 | 差异在集成和许可成本，不能说对方没有隔离 |
| 身份与权限管理 | 各有优势；Open WebUI 的 LDAP、SCIM、权限开关更全面 | LinkSense 原生 SAML 有价值，但两种固定角色限制精细治理 |
| 成本管理 | LinkSense 已有 credits、历史价格快照和月度账单 | 相比仅统计 Token，更接近组织内部成本分摊 |
| 团队共创 | Open WebUI 的 Channels、Notes、共享文件夹更丰富 | LinkSense 的资源共享不等于多人协作编辑 |
| 轻量部署与成熟生态 | Open WebUI 的部署选择更广 | LinkSense 应控制默认运行成本、提高交付和升级可预测性 |

以上为基于功能形态的判断，不是性能、安全性或总体产品质量排名。详细证据与限定条件见后文。

## 2. 比较基线与证据口径

### 2.1 版本范围

| 对象 | 本次基线 | 不应混淆的边界 |
| --- | --- | --- |
| LinkSense | 当前工作区 `develop`，HEAD 为 `83f5c14`；根 package.json 为 `0.2.3`；Codex 运行时配置固定为 `0.154.0` | 工作区存在已有未提交修改，因此本报告描述的是“当前实现”，不能直接当作所有已发布镜像的能力清单 |
| Open WebUI | 最新正式发布 `v0.11.4`，GitHub API 返回发布时间为 `2026-09-21T19:25:21Z` | 结合调研当天官方文档；文档持续更新，本文未对每一项进行标签级运行验证 |
| Open WebUI 配套项目 | Open Terminal、Terminals、oikb 单独列出 | 不能把配套项目都计为主产品默认安装，也不能因为需要额外部署就当作不存在 |

版本依据：[LS01][LS02][OW01]。另核对了 Open WebUI v0.11.4 的 package.json 和代码树，确认 skills、automations、channels、notes、SCIM、terminals 等模块已出现在该版本中。[OW02]

### 2.2 标记含义

- **内置**：存在明确产品入口、文档或代码实现；仍可能需要管理员启用或配置服务。
- **配套**：官方独立项目或额外服务，部署和维护成本单独计算。
- **可扩展**：有工具、插件、API 或代理接入路径；不代表现成开箱即用。
- **未见同级能力**：本次检索范围内，没有确认到相同粒度的成品功能；不等于技术上不可能。
- **待实测**：功能存在，但质量、性能、容量、恢复或部署效果没有实测证据。

本次没有更改业务代码、数据库或部署；没有运行双方产品实例、浏览器验证、负载测试、渗透测试或全量测试。读取到测试用例仅表示存在相关回归设计，不表示本次执行通过。

## 3. 产品定位与工作方式

### 3.1 LinkSense：从任务到组织应用

当前实现围绕以下链路组织：

```用户 / 消息渠道 / 嵌入页面
        ↓
任务、目标、计划确认、应用入口
        ↓
权限与额度检查 → 固化本轮能力和应用版本
        ↓
Runner Controller → 用户或应用服务 Worker → Codex 执行
        ↓
文件成果、引用、交互式应用、静态站点
        ↓
组织分发、外部访问、审计与用量核算
```

这条链路的价值，是让普通用户既能发起一次任务，也能把重复工作保存成有界面、有资源约束、有版本的应用。真实执行依赖模型、Codex、工具及相应基础设施，LinkSense 本身不是模型推理引擎。[LS03][LS04][LS05]

### 3.2 Open WebUI：通用 AI 工作台与可组合执行环境

主产品提供模型接入、聊天、知识、工具和协作界面；命令与文件执行可连接 Open Terminal，工作区编排可叠加 Terminals，知识源同步可使用 oikb。这种组合覆盖面广，但不同组合的运维和许可条件不一样。[OW03][OW04][OW05][OW15]

**真正需要比较的是一项业务从输入到交付需要多少配置、维护和人工接力，而不是页面上是否出现“Agent”或“Knowledge”字样。**

## 4. 完整能力矩阵

### 4.1 模型、对话与个性化

| 能力 | LinkSense 当前实现 | Open WebUI 当前能力 | 判断 |
| --- | --- | --- | --- |
| 多渠道、多模型 | 内置统一配置、价格、排序、默认模型和可选状态 | 内置多个连接和模型选择 | 双方共有 [LS06][OW03] |
| 模型协议 | Responses、Responses 工具兼容、Chat Completions 转换；共享配置含多个服务商类别 | Ollama、OpenAI 兼容、Open Responses 等接入路径 | 不应把 LinkSense 写成只能使用 OpenAI；兼容接口仍需按模型验证 [LS06][OW03] |
| 本地模型 | 可评估通过兼容端点接入；未见完整 Ollama 管理入口 | 官方提供 Ollama、llama.cpp、vLLM 等接入指南 | Open WebUI 更适合本地模型优先场景；两者均非推理引擎 [OW03] |
| 同题并排比较模型 | 未见同级内置界面 | Multi-Model Chats | Open WebUI 明确优势 [OW08] |
| 推理强度与上下文 | 配置支持档位、默认档位、上下文用量；支持上下文压缩 | 推理模型、聊天参数和上下文相关设置 | 双方支持；档位名称不能当作模型质量等级 [LS06][OW08] |
| 流式回复与运行中消息 | 流式事件、停止、引导、待处理请求 | 流式响应、消息队列 | 双方共有，但细节语义不同 [LS03][OW08] |
| 分支、搜索、归档、分享 | 有任务分支、历史管理和分享相关实现 | 有聊天分支、历史搜索、分享、标签等 | 基础工作区功能重叠 [LS03][OW08] |
| 项目组织 | 项目任务共用项目文件；个人任务共用个人运行环境 | 文件夹支持嵌套、系统提示、知识附件与授权共享 | LinkSense 偏文件连续工作；Open WebUI 偏上下文和团队组织 [LS07][OW09] |
| 自定义指令与记忆 | 内置；记忆默认关闭，可关闭或重置，生成有范围限制 | 内置 Memory 与个性化能力 | 都不能简单标成“长期记忆无限可用” [LS08][OW30] |
| 可复用提示词 | 可通过个人指令、Skill、应用沉淀；未见同级独立变量模板库 | 独立 Prompts，支持带类型变量和斜杠调用 | Open WebUI 的纯提示词复用入口更直接 [OW10] |
| 界面语言 | 代码列出中、英、西、葡、法、日六种 | 多语言界面与资源翻译能力 | LinkSense 已超出 AGENTS.md 的双语基线；翻译完整性未逐项验收 [LS09][OW01] |
| 手机、桌面与安装入口 | Web 工作区提供 standalone manifest；未确认独立原生客户端 | 官方提供手机、平板和桌面 PWA 安装路径 | Manifest 不代表离线执行；本次未验证各端交互与通知 [LS36][OW41] |

### 4.2 Agent 执行、长任务与自动化

| 能力 | LinkSense 当前实现 | Open WebUI 当前能力 | 判断 |
| --- | --- | --- | --- |
| 执行命令和脚本 | 正式路径在 Worker 内运行，有 Python、Node 与浏览器运行时配置 | 可通过 Open Terminal 执行 | 双方都能做实际计算和文件处理 [LS04][OW04] |
| 多步骤任务 | 有过程事件、计划步骤、工具活动和成果 | 有 Task Management 结构化任务清单 | 清单存在不代表任务必然完成 [LS03][OW07] |
| 显式目标状态与预算 | 目标卡片、状态、Token 预算、暂停/恢复/清除 | 有任务清单、自动化、循环限制；未确认到完全同级的目标生命周期入口 | LinkSense 的长目标交互更明确，不能据此断言执行更可靠 [LS10][OW07] |
| 先规划后实施 | 独立计划模式，审阅、修改、跳过、退出、实施 | 可通过提示和工具组织计划；未确认同级原生审阅流程 | LinkSense 有明确产品入口 [LS11] |
| 执行中澄清 | 表单式请求、敏感输入、运行中引导 | 内置 Ask User 工具类别及问答卡片 | 双方已有交互式澄清 [LS11][OW11] |
| 子智能体 | Codex 适配层及前端活动展示已有相关实现 | 内置 Sub-agents，默认关闭，需管理员启用 | 不是 LinkSense 独占；Open WebUI 后台子智能体的工具继承有限制 [LS02][OW06] |
| 页面重连 | 同一轮次恢复与事件处理，避免把刷新当成新轮次 | 有持续聊天与流式状态管理 | 必须区分页面恢复、进程恢复和外部操作幂等；未做故障对比测试 |
| 定时自动化 | 小时/天/周/月；同一固定任务持续增加轮次 | 周期与自定义 RRULE；每次执行创建聊天，可归入文件夹 | 两种历史组织方式不同 [LS12][OW12] |
| 自动化管理 | 立即执行、暂停、恢复、到期日、通知 | 立即执行、暂停、历史记录、导入导出、数量及频率限制 | 两者均有产品化入口 [LS12][OW12] |
| 可视化业务流程编排 | 未见 DAG/流程画布式成品能力 | Tools、Functions、Pipelines 属扩展机制，不直接等于业务流程画布 | 不宜将任一方当作完整 BPM/低代码流程平台 |
| 浏览器与网站操作 | 仓库含受控浏览器服务、策略与运行时 | 可通过执行环境、工具或独立 Computer 项目扩展 | 应按实际接入组合验收；Computer 不是主产品默认组件 [LS04][OW04] |
| 原生网页搜索 | 当前 Codex 模板将原生 web_search 设为 disabled；联网检索需经已配置工具/插件等路径 | 内置可配置的 Web Search | 不能把事件类型中出现 webSearch 当作默认启用搜索的证据 [LS35][OW40] |

### 4.3 文件、办公成果与多模态

| 能力 | LinkSense 当前实现 | Open WebUI 当前能力 | 判断 |
| --- | --- | --- | --- |
| 常见附件 | 文档、表格、演示、PDF、图像、压缩包等 | 文件、图像与知识附件 | 双方共有 [LS13][OW08] |
| 生成 Word/Excel/PPT/PDF | 执行环境与能力扩展生成，登记为任务成果 | Open Terminal 可处理文档并生成文件 | 应比较成品正确性和后续修改效率，不能说对方只能输出文字 [LS13][OW37] |
| 多格式在线预览 | Office、PDF、图片、HTML、压缩包及部分音视频 | 文件浏览、预览、代码执行和 Artifacts | LinkSense 的 Office 预览流程更集中；格式保真需实测 [LS13][OW13] |
| 选区批注驱动修改 | PPT 元素、Word 内容、表格区域/图表/图片、HTML 元素可批量提交要求 | Notes 支持选区改写；未确认相同的跨 Office 文件批注链路 | LinkSense 的明确差异之一 [LS14][OW18] |
| 成果集中管理 | 资料库按任务、文件名、类型筛选，关联原任务 | 文件管理、聊天产物与终端文件浏览 | 都能管理文件；LinkSense 更突出任务交付物入口 [LS13][OW04] |
| HTML/交互式成果 | 安全预览，可进一步开发应用或发布站点 | Artifacts 支持 HTML 等预览 | “能预览”不等于“有发布与版本治理” [LS15][OW13] |
| 静态站点发布 | 内置公开 URL、更新、停用、ZIP 下载、删除 | 有网页生成与预览；未确认同级站点发布治理入口 | LinkSense 有独立站点生命周期；只支持静态和浏览器内交互 [LS15] |
| 图片生成 | 多服务商配置、成果登记、按张计费、透明背景处理边界 | 本地或云端图像生成与编辑，含 ComfyUI 等路径 | Open WebUI 本地图像工具路径丰富；LinkSense 与用量管理结合更紧 [LS16][OW19] |
| 图片理解 | 模型图片输入配置及文档图片理解链路 | 支持视觉模型和图片输入 | 依赖具体模型，不是所有模型都具有 [LS06][OW08] |
| 语音转写 | 转成可编辑草稿，需用户发送，不自动提交 | 支持语音转写 | 双方都有 [LS17][OW20] |
| TTS 与语音/视频会话 | 未见与转写入口同级的完整产品实现 | 官方列出 TTS 与免手持语音/视频通话 | Open WebUI 更全面 [OW20][OW21] |
| 图表与图形输出 | Mermaid 渲染、复制源码、PNG 导出，亦可生成图表文件 | 代码执行与图形/Artifact 输出 | 两者均可；复杂图表质量需同题检验 [LS13][OW13] |

### 4.4 知识库、检索与数据源

| 能力 | LinkSense 当前实现 | Open WebUI 当前能力 | 判断 |
| --- | --- | --- | --- |
| 内置知识库 | Full 版；Core 不含完整解析检索链 | 主产品支持知识库与 RAG | 选型必须明确 LinkSense 版本 [LS01][OW14] |
| 文档解析 | Docling、图片理解及处理流水线 | 多解析引擎，可选 Docling、Tika、OCR 等 | Open WebUI 可选范围更广；支持数量不代表效果更好 [LS18][OW14] |
| 混合检索 | Elasticsearch 向量 + BM25 + RRF，可选 Ranker | BM25 + 向量 + 重排 | 算法类别重叠，没有评测不能比较召回率 [LS18][OW14] |
| 检索权限 | 按授权知识库过滤、状态检查，候选再过滤 | 按知识库和资源访问授权 | 双方都具备授权边界 [LS18][OW16] |
| 引用与原文 | 固定回答时文档版本；可查看命中片段、可靠页码和同版本原件 | 有文档检索、来源及引用 | LinkSense 对历史版本语义描述更明确；不据此断言对方引用不可靠 [LS19][OW14] |
| 全文注入 | 普通附件可供 Agent 阅读；未见完全同级的知识附件模式切换入口 | RAG / Full Context 模式切换 | Open WebUI 对用户更直接 [OW14] |
| 向量数据库选择 | 当前正式实现以 Elasticsearch 为主 | 多种选择；官方持续维护重点是 ChromaDB、PGVector | Open WebUI 灵活度更高，非核心后端维护程度需区分 [OW22] |
| 外部知识同步 | 内置 SharePoint 连接和增量同步流程 | oikb 官方独立工具支持多种来源，也含 SharePoint | LinkSense 集成更集中；Open WebUI 来源覆盖更广 [LS20][OW15] |
| 源系统权限继承 | 本次未确认逐文档镜像 SharePoint ACL 的实现 | 官方比较说明以知识库授权为边界，不应视为源 ACL 镜像 | 同步内容不等于同步原权限，双方都需明确数据分区 [LS20][OW31] |
| 索引维护 | 系统健康、失败处理、全量重建；换 Embedding 需维护 | 可配置检索与数据服务，支持多存储部署 | LinkSense 已有操作入口，但不能承诺零停机切换 [LS21][OW22] |

**知识场景的重要边界：** LinkSense 某些经授权读取的知识图片会形成任务附件副本。后来撤销知识库共享，不会自动删除已保存在任务中的图片；原文引用访问仍检查权限。客户若要求“撤权立即清除一切已衍生内容”，当前行为不能直接满足这一表述，需要单独确定治理规则。[LS19]

### 4.5 Skills、Plugins、MCP 与应用分发

| 能力 | LinkSense 当前实现 | Open WebUI 当前能力 | 判断 |
| --- | --- | --- | --- |
| Skills | 个人 Skill、插件包、组织分发、ClawHub 来源 | Workspace 指令型 Skills；v0.11.4 另支持 Terminal Skills，加载目录及脚本/资源路径，并由终端工具读取或执行 | 双方都能使用带配套文件的 Skill；差异应比较安装、环境与治理流程 [LS22][OW23][OW01][OW45] |
| 扩展工具 | Plugins、MCP、脚本与内置服务 | Python Tools、Functions、Pipelines、MCP、OpenAPI | Open WebUI 扩展方式覆盖广 [OW24] |
| HTTP MCP | 原生配置 Streamable HTTP，支持凭据与超时 | 原生 Streamable HTTP | 双方共有 [LS23][OW25] |
| STDIO MCP | 在任务运行环境中配置和启动，环境变量加密保存 | 通常经 MCPO 桥接成 HTTP/OpenAPI | LinkSense 的个人接入路径更直接；MCPO 是额外组件 [LS23][OW25] |
| 原生 OpenAPI 工具发现 | 未见与 MCP 同级的通用导入配置入口 | 原生 OpenAPI servers | Open WebUI 明确优势 [OW24] |
| 私有扩展凭据 | 凭据绑定、运行时装配；页面不回显秘密 | 各连接/工具有认证和配置机制 | 不能仅凭 UI 不回显推断完整安全等价 [LS22][OW24] |
| 组织扩展审核 | 不可变发布快照、完整性校验、逐版本审核、停用 | 资源授权和工具导入控制；未确认同级审批发布流程 | LinkSense 的供应链治理流程更具体 [LS24] |
| 应用资源组合 | 模型、指令、Skill、插件、知识库、MCP 组成应用 | Models 可组合提示、知识、工具等预设 | 双方均能构建场景助手 [LS05][OW11] |
| 对话开发独立交互界面 | 草稿工程、即时预览、真实调试、日志、选区修改 | Artifacts 与 Terminal 能构建/预览界面 | LinkSense 将开发与应用分发接成产品流程 [LS05][OW13] |
| 应用安装包与应用服务 | 独立安装包，或调用创建者维护的资源与凭据 | 共享模型/工具等资源；未确认同级双模式应用分发 | LinkSense 差异明确，权限设计也更复杂 [LS25] |
| 应用发布和安装版本 | 草稿、正式版、组织共享版、审核上架版、已安装版有明确边界 | 资源编辑和共享；未确认同级完整版本层次 | LinkSense 更适合组织内部应用交付 [LS25] |
| 业务系统 iframe 嵌入 | 允许来源、认证/公开模式、App ID/Secret、短时 ticket、SDK | 有 API 与扩展途径；未确认同级受控应用嵌入成品流程 | LinkSense 优势是内置生命周期，不是对方不能被集成 [LS26] |
| 面向开发者的 API | 有业务 REST API、嵌入协议和交互式 SDK；未确认通用个人 API Key 产品入口 | 有个人 API Key 与公开 API 接入文档 | Open WebUI 更便于通用脚本接入；内部接口存在不等于承诺稳定公共 API [LS03][LS26][OW43][OW44] |

这里的“应用”需要区分两种对象：**配置型助手**与**带交互界面、执行资源和发布规则的业务应用**。如果仅比较第一种，两者差距小得多；第二种才是 LinkSense 最应证明价值的领域。

**Skills 补充核实（2026-09-23）：** 不能把 Open WebUI 的 Skills 概括为“只有 Markdown、不能携带脚本或资源”。Workspace 中的 Skill 主要存储指令文本；连接支持 Skills 接口的 Open Terminal 后，Terminal Skill 可以是包含 SKILL.md、scripts、references、templates、assets 的目录。v0.11.4 会将终端技能纳入选择器与按需发现，读取时提供目录和资源路径；文件通过终端工具读取，脚本通过命令执行工具运行。源码确认存在这一链路，并非仅有规划说明。[OW01][OW23][OW45][OW46]

这不意味着在 Workspace 中导入一个 Markdown 文件，就会自动上传其相对路径引用的脚本或安装运行依赖。配套文件需在终端环境中可访问，解释器、依赖与权限也需满足。比较 LinkSense 时，应评价技能包安装、资源完整性、运行环境配置、版本分发和审核，而不能以“对方不支持技能脚本”为差异点。

**上传入口也有区别：** Workspace 的创建 Skill 编辑器没有完整技能目录的脚本/资源上传流程。使用 Terminal Skills 时，可通过聊天侧栏的终端文件浏览器上传整个目录，再将其放到终端用户主目录下的 `.agents/skills/<技能名>/`；也可在已选终端且已有内容的聊天中用 `/skills:create` 让助手直接创建技能及配套文件。这是终端文件管理/生成流程，不是 Workspace 编辑器内的技能包上传。文件浏览器支持文件夹上传并保留目录结构；普通聊天附件默认进入 WebUI 文件处理，不能据此认为已经安装到终端技能目录。[OW23][OW47]

### 4.6 企业身份、协作、渠道与治理

| 能力 | LinkSense 当前实现 | Open WebUI 当前能力 | 判断 |
| --- | --- | --- | --- |
| 本地账号、OIDC、第三方登录 | 内置；有注册、启停、邮件等设置 | 内置本地账号、OAuth/OIDC | 双方共有 [LS27][OW16] |
| 原生 SAML 2.0 | 有实现；限 SP 发起，不含加密断言和跨应用单点退出 | 社区接入资料主要指向 SAML 代理 + Trusted Header | LinkSense 有直接接入路径；不可将它夸大为全规格 SAML [LS27][OW31] |
| LDAP / SCIM | 本次未见产品实现 | 内置 LDAP 与 SCIM 2.0 | Open WebUI 企业身份生命周期覆盖更广 [OW16] |
| 角色和功能权限 | 管理员/普通用户两种固定角色，用户组用于资源授权 | Admin/User/Pending，加组级功能权限和资源 ACL | Open WebUI 权限组合更细；也不宜称其为无限自定义角色体系 [LS28][OW16] |
| 管理员内容访问 | 管理权限不自动等于读取其他用户私有内容 | 存在管理员聊天访问开关 | 治理取向不同；需对照组织隐私政策 [LS28][OW17] |
| 多租户 | 用户/组/资源隔离；嵌入协议支持 external_tenant 身份维度，但未确认独立租户管理与跨租户计费体系 | 多用户/组授权；未确认完整 SaaS 租户控制面 | 两者都不能直接包装为已验证多租户 SaaS [LS26] |
| 内部群聊与团队频道 | 未见同级多人原生协作频道 | Channels、私信、线程、模型参与 | Open WebUI 明确优势 [OW26] |
| 共享笔记和内容共创 | 未见同级独立 Notes 工作区 | Notes、共享与 AI 原位修改；发布记录包含多人编辑改进 | Open WebUI 更丰富 [OW18][OW01] |
| 原生日历 | 可通过已授权外部能力访问日历；未见内置日历产品界面 | Calendar 支持事件、共享、提醒及自动化日程展示 | 外部日历工具与内置日历应分开比较 [LS12][OW42] |
| 企业 IM 入口 | 微信、飞书、企业微信、钉钉、Teams 内置渠道 | Webhooks、API、扩展可连接外部系统；未确认对应五渠道的同级原生入口 | LinkSense 有针对性优势，但支持消息类型有限 [LS29][OW27] |
| 通用事件扩展 | 有任务通知和领域接口；未见同级通用事件函数编辑机制 | Event Functions、事件与频道 Webhooks | Open WebUI 更适合广泛事件集成 [OW27][OW28] |
| 审计 | 脱敏审计、治理操作记录 | 审计日志与安全配置能力 | 不能把审计写成 LinkSense 独有 [LS30][OW29] |
| 模型评估 | 未见 Arena/ELO 等产品入口 | Arena、盲测、反馈与排行榜 | Open WebUI 明确优势 [OW32] |
| 产品问题反馈 | 内置用户反馈、图片、管理员回复及历史 | 有模型回复评价与管理员沟通能力；未确认相同工单式反馈流程 | 产品反馈与模型质量评价不是同一个功能 [LS37][OW32] |
| 用量统计 | 用户/组/应用/用途/模型，多维统计和 Excel 导出 | 消息、Token、用户、组与模型使用分析 | 两者都有分析功能，口径不同 [LS31][OW17] |
| 成本与账单 | 历史价格快照、credits、周额度、自然月账单和 PDF | 官方 Analytics 主要说明 Token 统计与费用估算；未确认同级不可变账单和 credits 体系 | LinkSense 更接近内部费用核算；非支付系统 [LS31][LS32][OW17] |
| 限额执行 | 达到周额度阻止新请求；在途任务继续完成，可能超额 | 权限、自动化数量/频率等限制；金额硬限额需额外核实 | 两者限制对象不同，不能统称“严格预算封顶” [LS32][OW12] |

**消息渠道不等于团队协作频道。** LinkSense 把外部聊天消息送入私有任务空间，当前主要返回最终文本；Open WebUI Channels 是多人和模型在产品内部共同交流的空间。两者解决的是不同问题。[LS29][OW26]

## 5. LinkSense 最有价值的差异，及其现实边界

### 5.1 业务应用的完整交付流程

LinkSense 已覆盖“用对话开发 → 预览与真实调试 → 发布 → 组织共享或应用中心审核 → 使用者安装 → 执行 → 用量归属”。外部嵌入还有来源限制、票据和外部会话管理。[LS05][LS25][LS26]

这对企业的价值，是把熟练用户的一次成功操作变成其他人能重复使用的工作入口，而不要求每位使用者重新理解提示词、资源和凭据。

需要正视的边界：

- 创建者发布，不等于组织共享版和应用中心版同时更新。
- 组织使用者通常手动安装更新；外部访问有独立的正式版更新规则。
- 运行中的任务不被强制切换版本。
- 应用服务可使用创建者维护的资源和凭据，必须验证每个调用者允许触发哪些业务动作。
- 静态 iframe 前端与 Agent 执行后端，不等于用户可任意部署服务端应用。

这些不是边缘细节，而是应用版本、授权和交付责任的核心。

### 5.2 办公成果的修改链路

“生成一份 PPT”已经不是独特能力。更有差异的演示方式是：

1. 生成 PPT、Excel 或 Word。
2. 在预览中选择具体图表、段落或单元格区域。
3. 给多处内容分别添加要求。
4. 一次提交修改，重新生成并核对成品。

LinkSense 已有跨格式批注与任务请求衔接，但批注本身不直接编辑文件。真正应衡量的是修改定位准确率、文件可打开率、排版保真和重复修改后的稳定性。[LS13][LS14]

### 5.3 内置执行环境与组织治理

正式 Docker 路径有用户/服务 Worker、个人文件和凭据边界、只读根文件系统、CPU/内存/PID 限制、能力收缩及禁止新增权限配置。它们提供了明确工程控制，但不是已经完成安全认证的证明。[LS04]

同时：

- 隔离主要按用户和应用服务环境组织，并非每条任务创建一个完全独立容器。
- 同一用户的个人任务会复用运行环境；项目共享文件是设计行为。
- 开发用 `local-process` 路径没有容器隔离，不能用来承诺生产边界。
- Worker 编排依赖 Docker 控制权限；控制器、宿主机和挂载路径都是可信基础设施。

Open WebUI Terminals 也有用户工作区管理，区别在于需要额外编排组件及生产企业许可。LinkSense 适合突出“正式部署中已集成”，不适合宣称“只有我们能安全执行”。[OW39]

**用户隔离补充核实（2026-09-23）：** Open Terminal 本身支持免费的 `OPEN_TERMINAL_MULTI_USER=true` 模式：根据 WebUI 用户 ID 创建系统账号和 `/home/{user-id}`，以各自账号执行命令。它分开个人工作区，但仍共享容器内的进程列表、网络、系统软件及 CPU/内存；官方明确不把它视为用户之间的安全边界，只适合相互信任的团队。共享单个终端且未开启此模式时，用户连账号和文件环境都共享。[OW48]

Terminals 编排服务按用户和策略创建独立容器或 Kubernetes Pod，并管理资源限制与可选持久化存储；也可进一步按聊天或自动化划分工作区。其 Docker 后端的工作区仍在同一个网络中，能够连接其他工作区开放的端口；官方针对相互不信任的用户建议 Kubernetes 后端配合 NetworkPolicy。因此“独立容器”“网络隔离”和“同一用户不同任务隔离”必须分别核实，不能合并成一个无条件的隔离承诺。[OW05][OW48][OW49]

### 5.4 成本事实与内部结算

LinkSense 对模型价格、调用事实、credits 与月度账单进行了分层：历史按调用时价格计算，调价不倒算；缺少历史价格时明确标记未计价，删除任务后必要用量事实仍可保留。[LS31]

这有利于回答“哪个应用、哪个部门、哪类工作消耗了多少”，而不仅是“哪个模型用了多少 Token”。

但要注意：

- 周额度属于新请求准入控制，不保证在途任务费用严格封顶。
- 用户组报表按查询时成员关系汇总，多组成员可能重复出现在不同组。
- 月度账单是内部模型用量结算快照，不是支付、充值或税务开票平台。
- 上游 usage 缺失或估算时，仍需核对统计精度与供应商账单。

### 5.5 本地企业渠道

微信、飞书、企业微信、钉钉与 Teams 的内置接入，能降低组织把 AI 放进现有聊天工具的成本。[LS29]

当前不能宣传为“五个平台完整双向功能对等”：

- 微信主要是扫码账号本人的文本及可转写语音。
- 飞书当前是创建者的一对一私聊文本。
- 企业微信、钉钉、Teams 有各自的允许成员及群内触发范围。
- 附件、完整过程、生成文件和过长内容通常仍需回到 Web 查看。

## 6. Open WebUI 的明确优势与 LinkSense 的短板

### 6.1 通用入口的覆盖面

Open WebUI 对本地模型、多模型比较、提示模板、模型评估、语音输出和团队协作提供了更多现成入口。这些能力使它适合“先把组织日常 AI 使用统一起来”的目标。[OW03][OW10][OW20][OW26][OW32]

LinkSense 如果争夺同一类通用门户用户，需要面对日常使用便利性和迁移成本，不能仅用执行能力说明替代价值。

### 6.2 企业身份生命周期

OIDC 登录解决“怎么进来”，SCIM 与目录集成还解决“入职如何创建、调岗如何调整、离职如何收回”。Open WebUI 在这些标准化接口上覆盖更完整。[OW16]

LinkSense 的优先短板是细粒度功能权限、模型权限和身份生命周期，而不是增加更多名称不同的固定角色。原生 SAML 已经有实现，继续投入时应针对实际客户身份系统验证缺失部分。

### 6.3 知识生态的可组合性

Open WebUI 提供多存储和解析选项，oikb 将代码仓库、云存储、Wiki 等接入知识库。oikb 是单独部署的工具，不应把它的全部连接器说成 WebUI 默认开箱能力；但它确实降低了二次集成门槛。[OW14][OW15][OW22]

LinkSense 当前可核实的内置外部知识源主要是 SharePoint。通过 MCP 临时读取一个业务系统，和持续同步、删除传播、失败重试、权限治理的正式知识源是不同能力。

### 6.4 团队共同使用与共同创作

资源共享、应用共享解决的是“让别人使用”；频道、笔记、共享文件夹解决的是“让多人共同工作”。Open WebUI 在后一类能力上更完整。[OW09][OW18][OW26]

LinkSense 是否补齐，需要服从目标客户。若定位业务应用交付，优先强化应用协作与维护责任即可，不必立即建设完整团队聊天产品。

### 6.5 大规模部署方案

Open WebUI 有多副本部署、共享存储、Redis 协调、PostgreSQL 和向量服务的正式指南；Terminals 也提供 Kubernetes 编排路径。[OW22][OW39]

LinkSense 当前注册的 Worker Provider 是 Docker 和开发用本地进程。本次未见完成的 Kubernetes Worker Provider。已有 Redis 协调和服务拆分，不能自动推出“执行层已能无缝多主机水平扩容”。[LS04]

## 7. 架构、部署和可靠性比较

| 维度 | LinkSense | Open WebUI |
| --- | --- | --- |
| 前端 | React、TypeScript、Vite、TanStack Query 等 | Svelte/SvelteKit、TypeScript、Vite 等 |
| API | Node.js、Fastify、Zod、Prisma | Python/FastAPI、SQLAlchemy 数据层；版本依赖见 [OW35] |
| 数据持久化 | PostgreSQL、Redis；对象存储接口及正式存储配置 | 单实例可用 SQLite；扩容使用 PostgreSQL、共享文件/对象存储和 Redis |
| 执行层 | 独立 Runner Controller 与 Worker，调用固定版本 Codex app-server | 主产品工具循环；真实计算可接 Open Terminal |
| 知识层 | Full 增加 Docling、Elasticsearch 和 tokenizer | 按选定解析、Embedding 与向量后端组合 |
| 正式部署入口 | Linux/macOS Docker，一键脚本与 CLI；amd64/arm64 镜像 | Docker、Compose、Python 包和 Kubernetes 等 [OW36] |
| 基础资源 | 官方建议 Core 4 vCPU/8 GiB/60 GiB SSD；Full 8 vCPU/16 GiB/120 GiB SSD | 轻量门户可更简单；加模型推理、RAG、终端后不能沿用最小安装成本 |
| 扩容边界 | API 数据层有共享状态设计，Worker 当前以 Docker 路径为主 | 官方提供主产品多副本与 Terminals 编排路径 |
| 运维诊断 | 健康页、运行槽、资源用量、索引重建、清理失败重试、CLI doctor | 官方有扩容、安全加固和可观测性配置路径 |
| 升级 | 发行升级可等待任务、备份后迁移；源码生产脚本行为不同 | 应按版本说明维护数据库与持久数据，扩容时统一版本与存储 |

技术栈依据：[LS01][LS02][LS04][OW02][OW22]。部署与维护依据：[LS21][LS33][OW22]。

网页开发的补充依据：[Open Terminal 网页构建与预览][OW38]。执行环境编排的补充依据：[Terminals 官方仓库][OW39]。

### 7.1 自托管不自动等于离线

双方是否把数据留在内网，取决于模型端点、Embedding、重排、图像/语音服务、搜索、插件、MCP 和浏览器访问的实际配置。Open WebUI 有明确本地模型路径；LinkSense 的离线完整部署需要另外验证依赖包、模型服务、镜像和工具供应链。[OW03][LS01][LS06]

### 7.2 运行状态恢复不等于业务恢复

应分别验证：

- 前端断线后能否继续显示同一轮次。
- API/Runner 重启后是否识别真实运行状态。
- 工具已完成外部写入、但结果未记账时，会不会重复发送或重复写入。
- 长目标和自动化跨重启后如何继续、暂停或提示人工处理。

本次没有这些对照实验，因此不对两者的故障恢复优劣打分。

### 7.3 现有数据升级风险

LinkSense 的发行升级与源码生产部署存在不同执行策略：前者等待运行任务；后者默认停止进行中的任务再部署，未完成及排队请求不会自动重跑。数据库迁移开始后的失败不自动回滚。[LS33]

Open WebUI 官方扩容说明明确：从 SQLite 切换到 PostgreSQL，并不是仅修改连接地址就自动迁移原有数据；多副本还需要共享向量服务、文件存储和协调机制。[OW22]

因此，正式选型应加入旧会话、已安装应用、历史引用、存量知识和外部连接的升级回归。新环境安装成功不能证明存量环境可安全升级。

## 8. 安全与权限：比较控制点，不作绝对安全排名

| 关注点 | LinkSense 需核对 | Open WebUI 需核对 |
| --- | --- | --- |
| 扩展执行权限 | Skill、插件、STDIO MCP 在 Worker 内的权限、凭据和出站范围 | Workspace Python Tools/Functions 在服务端进程执行；安装权限应严格控制 |
| 工具与源系统授权 | 应用服务使用创建者凭据时的可操作范围 | MCP/OpenAPI、工具凭据与调用者权限的对应关系 |
| 运行环境隔离 | 用户、项目、应用服务三种边界不能混淆 | 区分共享终端、单容器多账号、Terminals 独立容器；Docker 网络仍共享，跨用户网络限制需单独落实 |
| 前端生成内容 | HTML、交互式应用、公开站点的 iframe、来源与票据控制 | Artifacts 的 sandbox 与可配置 iframe CSP |
| 管理员隐私边界 | 治理权限不自动授予全部私有内容 | 管理员聊天读取等配置影响内容可见性 |
| 数据出站 | 模型、插件、MCP、浏览器、图片/语音供应商 | 模型、搜索、工具、知识解析和外部执行环境 |
| 审计与日志 | 脱敏、操作主体、内容保留和清理失败 | 审计级别、日志内容、密钥处理与外部日志平台 |
| 多租户与合规 | 未验证租户级隔离或合规认证 | 同样不能用 RBAC 或自托管替代合规结论 |

依据：[LS04][LS24][LS26][LS28][LS30][OW13][OW24][OW29]。

公开资料和代码能证明“有控制措施”，不能证明没有漏洞。Open WebUI v0.11.4 发布记录包含安全和访问控制修复；这一事实既不是“该产品不安全”的证明，也不能用来免除升级验证。[OW01]

## 9. 许可和总拥有成本

### 9.1 许可条件

| 项目 | 已核实条件 | 对选型的影响 |
| --- | --- | --- |
| LinkSense | CPAL-1.0，并有项目附加许可 | 不能按 MIT/Apache 式无限制白标理解 |
| LinkSense 内部使用 | 附加许可豁免组织纯内部部署仅因网络使用而触发的相关源码提供义务 | 该豁免不自动取消图形界面的署名要求 |
| LinkSense 白标 | 署名豁免/商业许可需另行取得 | 对外嵌入或品牌统一应核对具体用法 |
| Open WebUI 主产品 | v0.6.6+ 为带品牌条款的 Open WebUI License，官方说明不是 OSI 批准许可 | 公开源代码不代表可无条件换品牌 |
| Open WebUI 品牌例外 | v0.11.4 LICENSE：任意滚动 30 天内终端自然人数不超过 50，或另获书面许可/企业许可 | 50 人是品牌条款例外条件，不是主产品免费使用人数上限 |
| Open WebUI Terminals | 官方文档要求生产使用企业许可 | 评估多人受管执行环境时需要单独询价 |
| 配套工具和第三方模型 | 各自许可证、供应商合同和使用费用另计 | 不能把一个项目的许可套用到整套系统 |

依据：[LS34][OW33][OW34][OW05]。本节为许可原文与官方说明的事实摘要；涉及具体再分发、对外服务和品牌替换方案时，以适用版本完整许可及取得的授权为准。

### 9.2 不给出没有依据的“每年省多少钱”

应按三种相同需求比较：

| 比较方案 | LinkSense 需要计算 | Open WebUI 需要计算 |
| --- | --- | --- |
| 仅聊天与知识问答 | Core/Full 所需基础设施与维护；模型费用 | 门户、选定 RAG 组件和模型费用 |
| 文件执行与长期工作区 | Runner、Worker 活跃容量、存储、运行时维护 | Open Terminal；多人受管环境还需 Terminals 与相应许可/运维 |
| 可分发业务应用 | 开发与维护应用、资源授权、嵌入、升级回归 | 在现有模型/工具/Artifact 基础上补齐业务交付流程的开发与维护成本 |

可采用：

**总成本 = 基础设施 + 模型/检索/图片/语音调用 + 执行环境 + 存储备份 + 集成开发 + 运维升级 + 许可支持 + 失败返工。**

最有用的业务指标是“每个验收通过的交付物成本”，而非单次消息价格。没有相同硬件、模型、样本和任务成功标准，无法证明谁更便宜。

## 10. 场景选型建议

以下是基于已核实能力的条件式建议，不是采购或容量承诺。

| 业务场景 | 更值得先试点的方案 | 原因与前提 |
| --- | --- | --- |
| 个人/小团队运行本地模型 | Open WebUI | 本地接入路径直接、通用交互覆盖广；硬件另计 |
| 企业统一提供多模型聊天、知识问答和模型对比 | Open WebUI | 模型入口、模板和评估功能更丰富 |
| 定期生成可修改的经营报告、PPT、表格 | LinkSense | 重点验证成果预览、批注和修改闭环；对照 Open WebUI + Terminal |
| 把 AI 助手变成组织分发的交互式业务工具 | LinkSense | 开发、发布、审核、安装版本和资源配置已有内置流程 |
| 在已有业务系统内嵌受控 AI 应用 | LinkSense | 有明确嵌入 SDK、票据、允许来源和外部会话机制 |
| 多部门需要 LDAP/SCIM 和细粒度功能权限 | Open WebUI | 当前身份与权限覆盖更完整 |
| 强依赖 SAML SP 发起登录 | LinkSense 值得优先验证 | 有原生实现；先检查断言、退出、证书和 IdP 需求是否落在支持范围 |
| 飞书/企微/钉钉/Teams 等现有消息工具内使用 Agent | LinkSense | 原生渠道减少接入工作，先确认消息类型和身份范围 |
| 多人共同写笔记、频道讨论、共享资料上下文 | Open WebUI | 协作内容形态更丰富 |
| 多来源知识库，需要 Wiki/代码仓库/云盘同步 | Open WebUI + oikb | 连接器覆盖广，注意部署和源权限边界 |
| 需要内部 credits 和应用级费用分摊 | LinkSense | 现成统计与账单链路，需接受在途超额和统计口径 |
| 大规模 Kubernetes 执行环境 | Open WebUI + Terminals 值得先评估 | 有官方编排路径，需许可与真实容量验证 |
| 完全离线且强数据边界 | 两者都需专项 POC | 所有模型、解析、工具、依赖与数据出站必须一并核实 |

不建议仅凭功能清单全面替换现有系统。若组织已深度使用 Open WebUI，LinkSense 可先承担应用交付和文件执行场景；只有任务价值、成本和维护责任得到验证后，再决定统一还是并存。并存也会增加身份、存储、审计和知识重复治理成本。

## 11. 对 LinkSense 的产品与研发建议

### 11.1 建议产品表述

**“面向组织的 AI 执行与应用交付平台：把任务、文件和知识转化为可使用、可分发、可管理的业务成果。”**

建议围绕三个可演示的结果组织产品材料：

1. **交付成果**：从材料生成报告，再通过选区批注完成修改。
2. **沉淀应用**：把重复任务做成带交互界面的业务工具，发布给指定成员使用。
3. **组织运营**：让应用、凭据、版本、额度与用量在同一套规则下管理。

不建议使用以下表述：

- “Open WebUI 只是聊天壳。”
- “只有 LinkSense 支持 Agent、Skills、MCP 或定时任务。”
- “自托管就不会把数据发到外部。”
- “每个任务完全独立隔离。”
- “额度绝不会超支。”
- “拥有用户组就等于完整多租户。”
- “我们知识检索一定更准、任务成功率更高。”
- “开源就可以无限制白标。”

### 11.2 优先级建议

| 优先级 | 建议事项 | 理由 | 可验收结果 |
| --- | --- | --- | --- |
| P0 | 建立真实交付与稳定性基准 | 当前优势多是功能流程，需要转化为结果证据 | 同模型同材料下，记录成功率、人工介入、耗时、费用及恢复结果 |
| P0 | 梳理发布版能力与当前工作区差异 | 当前 develop 不能直接作为外部产品承诺 | 每项能力对应版本、配置条件、限制和验证记录 |
| P0 | 验证应用服务凭据与使用者权限边界 | 应用服务是优势，也是重要责任边界 | 越权、撤权、版本更新和外部会话回归通过 |
| P1 | 细粒度功能/模型权限与身份生命周期 | 直接影响中大型组织采用 | 权限策略可配置，入转离流程可验收；按客户需求评估 SCIM |
| P1 | 把应用发布更新做得更易理解 | 多种版本边界正确但认知成本高 | 用户能清楚知道谁在使用哪个版本、如何升级和失败如何处理 |
| P1 | 扩展高价值知识来源 | 当前 SharePoint 集成之外仍有明显覆盖缺口 | 按客户实际资料源逐个提供增量、删除、权限与失败处理 |
| P1 | 明确成本限额策略 | 当前周额度无法限制在途最大消费 | 展示额度语义和预计风险；若需更强约束，先评估原生执行预算与外部准入，避免另造执行重试 |
| P2 | 提供正式多主机/编排能力 | 单机 Docker 路径会影响扩容 | 完成调度、持久卷、网络、故障迁移和升级演练后再宣传 |
| P2 | 模型评估和模板能力 | 改善运营与复用，降低模型选择成本 | 业务题库、盲测、版本化模板及成本质量对照 |
| 按需 | Notes、频道、实时语音等横向扩张 | 能扩大门户吸引力，也可能稀释主线 | 以客户需求和留存证据决定，不为清单对齐而实现 |

这些是规划建议，不是已承诺开发项，也不意味着本报告已开始相应实现。

## 12. 建议开展的同条件验证

### 12.1 对照组合

至少比较：

- LinkSense Core：执行与文件交付。
- LinkSense Full：执行 + 知识库。
- Open WebUI 主产品：聊天 + RAG。
- Open WebUI + Open Terminal：文件与开发任务。
- 如评估多人执行治理，再加入合法授权的 Terminals 组合。

各组合必须记录硬件、版本、模型、工具、网络条件、配额、文档样本和运行时资源。不能用高配模型的结果评价平台本身。

### 12.2 验证样例与指标

| 样例 | 必须检查的结果 |
| --- | --- |
| 根据相同 Excel 数据生成经营报告和 PPT | 数据计算正确、文件可打开、来源可追溯、版式满足要求 |
| 修改指定三处图表/段落/单元格 | 定位准确、无意外修改、前后结果可核对 |
| 百份混合格式文档问答 | 证据支持率、引用准确率、无答案时拒答、权限过滤 |
| 文档替换及权限撤销后继续问答 | 使用版本正确、旧引用行为明确、无越权读取 |
| 开发并分发一个交互式应用 | 发布、安装、资源缺失、撤权、更新、外部身份均按预期 |
| 两个用户和两个应用服务并发执行 | 文件、凭据和任务状态不串用，资源限制可观测 |
| 页面断线、Runner/服务重启、上游超时 | 状态正确、无重复外部动作、恢复步骤清晰 |
| 同周期自动化多次触发 | 运行历史、重叠执行、权限变化和额度行为正确 |
| 含历史数据的升级 | 会话可继续、知识可检索、已安装应用可执行、备份可恢复 |
| 10/30/100 个并发活跃任务阶梯测试 | 排队时间、首个有效进展、完成时长、内存、失败率和成本 |

并发值只是建议测试档位，不是容量预测。业务指标应包括：

- 验收通过率与人工介入次数。
- 每个成功交付物的实际调用成本。
- P50/P95 完成时长及排队时长。
- 权限违规与重复外部操作次数。
- 运维工时、升级停机和恢复耗时。

## 13. 证据索引

### 13.1 LinkSense 本地证据

下列均为本次工作区真实文件。帮助文档说明产品行为；核心差异另用代码与测试样例交叉核对。

| 编号 | 文件 | 主要用途 |
| --- | --- | --- |
| LS01 | [README.zh-CN.md][LS01]、[package.json](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/package.json) | 产品、Core/Full、部署、版本与依赖 |
| LS02 | [Codex 协议适配][LS02]、[运行时版本](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/runner/src/codex/runtime-version.json) | 原生协议边界、子智能体及固定版本 |
| LS03 | [任务路由][LS03]、[创建与运行任务](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/create-and-run.md) | 目标、引导、分支、压缩等实际 API |
| LS04 | [Docker Worker][LS04]、[Provider 注册](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/runner/src/controller/worker-provider-registry.ts)、[Worker 契约测试](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/runner/test/worker-provider-contract.test.ts) | 隔离控制、运行环境与复用 |
| LS05 | [创建应用][LS05]、[运行环境更新门禁](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/src/modules/applications/runtime-gate.ts) | 开发预览、发布与更新边界 |
| LS06 | [模型设置][LS06]、[模型共享 Schema](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/packages/shared/src/model-provider.ts) | 协议、模型、价格、多模态配置 |
| LS07–LS09 | [项目][LS07]、[个性化][LS08]、[语言常量][LS09] | 文件共享、记忆、实际语言范围 |
| LS10–LS12 | [目标任务][LS10]、[计划模式][LS11]、[自动化][LS12] | 长任务交互与周期运行 |
| LS13–LS17 | [文件成果][LS13]、[文件批注][LS14]、[站点][LS15]、[图片][LS16]、[语音][LS17] | 交付物与多模态 |
| LS18–LS21 | [检索实现][LS18]、[引用行为][LS19]、[知识源][LS20]、[健康与重建][LS21] | RAG、版本与治理 |
| LS22–LS26 | [ClawHub][LS22]、[MCP][LS23]、[发布审核][LS24]、[应用分发][LS25]、[嵌入协议][LS26] | 扩展和应用生命周期 |
| LS27–LS30 | [认证][LS27]、[角色][LS28]、[消息渠道][LS29]、[审计][LS30] | 企业治理 |
| LS31–LS34 | [用量账单][LS31]、[额度][LS32]、[升级][LS33]、[LICENSE][LS34] | 成本、维护和许可 |
| LS35–LS37 | [原生功能配置][LS35]、[Web manifest][LS36]、[用户反馈][LS37] | 搜索默认状态、客户端入口和反馈 |

重点交叉核对：

- [API 注册入口](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/src/app.ts)：确认能力进入实际应用组装。
- [应用安装版本测试](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/test/application-installation-versions.test.ts)：审核版本、安装权限和缺失版本处理。
- [知识检索授权测试](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/test/knowledge-retrieval-access.test.ts)：用户/组授权、撤权和空检索范围。
- [额度测试](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/test/usage-credit-limit.test.ts)：限额准入、余额精度及停用用户。
- [应用安装服务](/Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/src/modules/applications/installation-service.ts)：安装与升级实现。

### 13.2 Open WebUI 官方证据

访问时间均为 2026-09-23。正文中的编号可直接点击进入对应官方资料。

| 编号 | 官方资料 | 用途 |
| --- | --- | --- |
| OW01 | [v0.11.4 发布记录][OW01] | 当前正式版本与发布变更 |
| OW02 | [v0.11.4 源码][OW02] | 标签级模块存在性与技术栈 |
| OW03 | [模型接入][OW03] | 本地、云端与协议范围 |
| OW04 | [Open Terminal][OW04] | 命令、文件与开发执行 |
| OW05 | [Terminals][OW05] | 个人工作区编排、部署和许可 |
| OW06–OW09 | [子智能体][OW06]、[任务清单][OW07]、[聊天][OW08]、[项目文件夹][OW09] | Agent 与对话组织 |
| OW10–OW13 | [Workspace][OW10]、[Models][OW11]、[Automations][OW12]、[Artifacts][OW13] | 复用、自动化与预览 |
| OW14–OW15 | [Knowledge][OW14]、[oikb][OW15] | RAG 与外部来源同步 |
| OW16–OW18 | [认证权限][OW16]、[Analytics][OW17]、[Notes][OW18] | 治理、统计与协作 |
| OW19–OW21 | [图像][OW19]、[音频][OW20]、[功能总览][OW21] | 多模态与功能范围 |
| OW22–OW25 | [扩容][OW22]、[Skills][OW23]、[Tools][OW24]、[MCP FAQ][OW25] | 部署与扩展边界 |
| OW26–OW29 | [Channels][OW26]、[管理与 Webhooks][OW27]、[Event Functions][OW28]、[安全加固][OW29] | 协作、事件和安全 |
| OW30–OW32 | [Memory][OW30]、[官方接入边界比较][OW31]、[Evaluation][OW32] | 个性化、SAML/ACL 边界和评估 |
| OW33–OW34 | [v0.11.4 LICENSE][OW33]、[许可说明][OW34] | 品牌条件与许可性质 |
| OW35–OW39 | [Python 依赖][OW35]、[部署快速开始][OW36]、[生成文件][OW37]、[网页开发][OW38]、[Terminals 仓库][OW39] | 技术栈、部署与执行补充证据 |
| OW40–OW44 | [网页搜索][OW40]、[PWA][OW41]、[日历][OW42]、[API Keys][OW43]、[API Endpoints][OW44] | 通用入口、日程与开发者接入 |
| OW45–OW46 | [v0.11.4 Terminal Skills 实现][OW45]、[Workspace Skill 数据模型][OW46] | 目录资源加载与纯指令记录的区别 |
| OW47 | [Open Terminal 文件浏览器][OW47] | 文件夹上传与聊天附件的存储区别 |
| OW48–OW49 | [多用户部署][OW48]、[Terminal Contexts][OW49] | 同容器账号与独立容器边界、Docker 共享网络、按聊天或自动化细分工作区 |

### 13.3 未验证项目

- LinkSense 当前工作区能力是否全部包含在最新发行镜像。
- 双方同模型、同任务的成功率、时延、Token 成本和并发容量。
- 所有模型服务商、身份系统、消息渠道及 MCP 的真实连接效果。
- 全量离线部署与所有出站依赖。
- 已安装应用、历史数据、知识引用和运行任务在实际升级中的回归结果。
- 双方针对目标组织要求的安全评估、合规和服务 SLA。
- Open WebUI 企业组件的具体报价与合同条款。
- 官方动态文档中每项细节与 v0.11.4 二进制的完全一致性。

本报告仅新增调研文档，不改动已有业务实现。后续若用于公开宣传，应先把“当前工作区实现”替换为经过发布验证的具体版本承诺。

[LS01]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/README.zh-CN.md
[LS02]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/runner/src/codex/protocol.ts
[LS03]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/src/modules/conversations/routes.ts
[LS04]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/runner/src/controller/docker-worker-provider.ts
[LS05]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/plugin-center/create-applications.md
[LS06]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/model-settings.md
[LS07]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/projects.md
[LS08]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/settings/personalization.md
[LS09]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/packages/shared/src/common.ts
[LS10]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/goal-tasks.md
[LS11]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/plan-mode.md
[LS12]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/automations/create-and-manage.md
[LS13]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/files-and-results.md
[LS14]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/file-annotations.md
[LS15]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/publish-websites.md
[LS16]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/generate-images.md
[LS17]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/tasks/voice-input.md
[LS18]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/api/src/modules/knowledge-processing/retrieval.ts
[LS19]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/knowledge-bases/use-and-citations.md
[LS20]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/knowledge-sources.md
[LS21]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/health.md
[LS22]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/plugin-center/clawhub.md
[LS23]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/mcp/connect-and-manage.md
[LS24]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/plugin-governance.md
[LS25]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/plugin-center/application-access.md
[LS26]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/developer-guide/embed-application.md
[LS27]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/authentication-settings.md
[LS28]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/roles.md
[LS29]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/user-guide/message-channels/overview.md
[LS30]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/audit.md
[LS31]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/usage.md
[LS32]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/quota-settings.md
[LS33]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/system-update.md
[LS34]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/LICENSE
[LS35]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/deploy/codex-home-template/config.toml
[LS36]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/web/public/manifest.json
[LS37]: /Users/one/Projects/Projects/RuipuProjects/lingx/linksense-oss/linksense/apps/docs/docs/admin-guide/feedback.md
[OW01]: https://github.com/open-webui/open-webui/releases/tag/v0.11.4
[OW02]: https://github.com/open-webui/open-webui/tree/v0.11.4
[OW03]: https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/
[OW04]: https://docs.openwebui.com/features/open-terminal/
[OW05]: https://docs.openwebui.com/features/open-terminal/terminals/
[OW06]: https://docs.openwebui.com/features/chat-conversations/chat-features/subagents/
[OW07]: https://docs.openwebui.com/features/chat-conversations/chat-features/task-management/
[OW08]: https://docs.openwebui.com/features/chat-conversations/chat-features/
[OW09]: https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization/
[OW10]: https://docs.openwebui.com/features/workspace/
[OW11]: https://docs.openwebui.com/features/workspace/models/
[OW12]: https://docs.openwebui.com/features/chat-conversations/chat-features/automations/
[OW13]: https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/artifacts/
[OW14]: https://docs.openwebui.com/features/workspace/knowledge/
[OW15]: https://docs.openwebui.com/ecosystem/knowledge-base-sync/
[OW16]: https://docs.openwebui.com/features/authentication-access/
[OW17]: https://docs.openwebui.com/features/administration/analytics/
[OW18]: https://docs.openwebui.com/features/notes/
[OW19]: https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/
[OW20]: https://docs.openwebui.com/features/chat-conversations/audio/
[OW21]: https://docs.openwebui.com/features/
[OW22]: https://docs.openwebui.com/getting-started/advanced-topics/scaling/
[OW23]: https://docs.openwebui.com/features/workspace/skills/
[OW24]: https://docs.openwebui.com/features/extensibility/plugin/tools/
[OW25]: https://docs.openwebui.com/faq/
[OW26]: https://docs.openwebui.com/features/channels/
[OW27]: https://docs.openwebui.com/features/administration/
[OW28]: https://docs.openwebui.com/features/extensibility/plugin/functions/event/
[OW29]: https://docs.openwebui.com/getting-started/advanced-topics/hardening/
[OW30]: https://docs.openwebui.com/features/chat-conversations/memory/
[OW31]: https://docs.openwebui.com/alternatives/onyx/
[OW32]: https://docs.openwebui.com/features/administration/evaluation/
[OW33]: https://raw.githubusercontent.com/open-webui/open-webui/v0.11.4/LICENSE
[OW34]: https://docs.openwebui.com/license/
[OW35]: https://raw.githubusercontent.com/open-webui/open-webui/v0.11.4/pyproject.toml
[OW36]: https://docs.openwebui.com/getting-started/quick-start/
[OW37]: https://docs.openwebui.com/features/open-terminal/use-cases/creating-files/
[OW38]: https://docs.openwebui.com/features/open-terminal/use-cases/web-development/
[OW39]: https://github.com/open-webui/terminals
[OW40]: https://docs.openwebui.com/features/chat-conversations/web-search/
[OW41]: https://docs.openwebui.com/getting-started/open-webui-as-app/
[OW42]: https://docs.openwebui.com/features/calendar/
[OW43]: https://docs.openwebui.com/features/authentication-access/api-keys/
[OW44]: https://docs.openwebui.com/reference/api-endpoints/
[OW45]: https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/utils/terminals.py#L247
[OW46]: https://github.com/open-webui/open-webui/blob/v0.11.4/backend/open_webui/models/skills.py#L20
[OW47]: https://docs.openwebui.com/features/open-terminal/file-browser/#uploading-files
[OW48]: https://docs.openwebui.com/features/open-terminal/advanced/multi-user/
[OW49]: https://docs.openwebui.com/features/open-terminal/terminals/orchestration/contexts/
