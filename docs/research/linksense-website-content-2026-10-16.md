# LinkSense 官网内容底稿

调研日期：2026-10-16。基线：本地工作区提交 `a3fcd0d`，根 `package.json` 版本 `0.3.8`。本稿以仓库的一手文档与代码为依据；不是最新线上发行包或实机安装验证。[D01][D02]

## 产品定位与首屏文案

以下为官网编辑建议，尚未作为正式产品文案发布。事实依据来自当前仓库；示例场景不代表已经交付的客户案例。

建议定位：**面向组织、可自主部署的 AI Agent 工作平台。**

建议首屏：

> 让每个人的 AI 能力，成为整个组织的工作能力。
>
> 在自己的基础设施上，让 AI 研究资料、处理文件、交付成果。把验证有效的方法沉淀为技能和应用，连接团队的知识与系统，共享给需要的人。

首屏行动：**在线体验**、**部署 LinkSense**；GitHub 作为次级入口。演示地址与仓库链接使用 [README](../../README.zh-CN.md) 中已有的公开地址，上线前再验证可达性。

首页主线：

**个人完成任务 → 将方法沉淀为能力 → 组合为业务应用 → 授权团队使用 → 统一治理和运维。**

这条主线由现有 [组织能力说明](../../README.zh-CN.md#组织能力)、[应用分发指南](../../apps/docs/docs/user-guide/plugin-center/organization-apps.md) 和 [审核流程](../../apps/docs/docs/admin-guide/plugin-governance.md) 支撑。

## 适合官网展示的能力

| 能力主题 | 可用于官网的表达 | 当前依据与边界 |
| --- | --- | --- |
| 完成有交付物的工作 | 研究资料、分析数据、运行代码，生成 Word、Excel、PPT、PDF、图片和网页成果。 | [创建任务](../../apps/docs/docs/user-guide/tasks/create-and-run.md)、[文件与成果](../../apps/docs/docs/user-guide/tasks/files-and-results.md)。输出效果取决于模型、材料和任务；不承诺每次自动达到业务验收。 |
| 看着成果继续修改 | 在 Word、Excel、PPT、HTML 预览中选中具体内容，批量提出修改要求。 | [文件批注](../../apps/docs/docs/user-guide/tasks/file-annotations.md)。这是交给 Agent 修改的请求，不是浏览器内多人实时编辑。 |
| 复杂工作分步推进 | 先规划并确认，再实施；需要持续推进的工作使用目标模式，并跟踪步骤、工具和子智能体状态。 | [计划模式](../../apps/docs/docs/user-guide/tasks/plan-mode.md)、[目标模式](../../apps/docs/docs/user-guide/tasks/goal-tasks.md)、[任务概览](../../apps/docs/docs/user-guide/tasks/progress-and-sources.md)。计划和目标是两种不同工作方式。 |
| 项目与持续工作环境 | 按项目组织任务，让后续任务接着使用已有文件与个人工具。 | [项目](../../apps/docs/docs/user-guide/tasks/projects.md)、[Worker 边界](../../README.zh-CN.md#worker-模型)。同一用户的项目和任务不是安全隔离单元。 |
| 有来源的组织知识 | 用授权知识库回答问题，追溯引用对应的文档版本、命中内容与可验证页码。 | [引用](../../apps/docs/docs/user-guide/knowledge-bases/use-and-citations.md)、[文档处理](../../apps/docs/docs/user-guide/knowledge-bases/documents.md)、[分享](../../apps/docs/docs/user-guide/knowledge-bases/sharing.md)。完整知识处理与检索属于 Full，需配置检索模型；不能宣传“零幻觉”。 |
| 将方法沉淀为技能与插件 | 安装、创建、发布和复用 Skill、插件及 MCP 扩展，让有效方法进入组织能力目录。 | [发现安装](../../apps/docs/docs/user-guide/plugin-center/discover-and-install.md)、[个人内容](../../apps/docs/docs/user-guide/plugin-center/personal-content.md)、[审核](../../apps/docs/docs/admin-guide/plugin-governance.md)。新版本显式安装更新；第三方能力不等于平台背书。 |
| 将能力组合为应用 | 把指令、模型、知识、技能和工具组合为团队可用的工作入口。 | [应用](../../apps/docs/docs/user-guide/plugin-center/organization-apps.md)、[创建应用](../../apps/docs/docs/user-guide/plugin-center/create-applications.md)。区分使用者独立维护的应用安装包与创建者维护的应用服务。 |
| 用对话创建业务界面 | 对话开发交互式应用，边预览边调整，再共享或嵌入现有网站。 | [开发流程](../../apps/docs/docs/user-guide/plugin-center/create-applications.md)、[外部访问](../../apps/docs/docs/user-guide/plugin-center/application-access.md)、[嵌入指南](../../apps/docs/docs/developer-guide/embed-application.md)。交互式应用在受控 iframe 中运行，使用声明和授权的能力。 |
| 连接已有工作系统 | 连接 Google Docs、Gmail、Outlook、OneDrive、SharePoint；通过 MCP 继续接入组织系统。 | [Workspace 连接器](../workspace-connections.md)、[微软连接器](../microsoft-connections.md)、[个人 MCP](../../apps/docs/docs/user-guide/mcp/connect-and-manage.md)。需部署方配置 OAuth、用户授权；不是自动全盘同步。 |
| 周期性完成重复工作 | 把简报、周报和周期检查设为自动化，在同一任务中保留过程与结果。 | [自动化](../../apps/docs/docs/user-guide/automations/create-and-manage.md)。支持按小时、天、周、月的周期规则、时区、暂停、立即执行和可选到期日；不是无限制后台执行承诺。 |
| 在熟悉的消息渠道发起工作 | 从微信、飞书、企业微信、钉钉和 Microsoft Teams 发起任务，回到工作台查看完整成果。 | [渠道范围](../../apps/docs/docs/user-guide/message-channels/overview.md)。各渠道可发送的人、消息类型和网络条件不同；主要返回最终文本。 |
| 自主部署、选择模型、统一治理 | 在自有基础设施部署，配置模型渠道、用户与用户组、登录方式、额度、审核、用量和审计。 | [README](../../README.zh-CN.md)、[模型设置](../../apps/docs/docs/admin-guide/model-settings.md)、[管理员概览](../../apps/docs/docs/admin-guide/overview.md)、[用量](../../apps/docs/docs/admin-guide/usage.md)。外部模型和集成仍可能向外发送数据。 |

可放在详情或指南入口的辅助能力：

- 语音转为可编辑草稿、按配置生成图片：[语音输入](../../apps/docs/docs/user-guide/tasks/voice-input.md)、[图片生成](../../apps/docs/docs/user-guide/tasks/generate-images.md)。
- HTML 成果发布为公开静态网页，并支持更新、停用和下载网页包：[站点发布](../../apps/docs/docs/user-guide/tasks/publish-websites.md)。它不是任意后端应用托管服务。
- 自定义指令、按需开启个人记忆、上下文压缩和任务分支：[个性化](../../apps/docs/docs/user-guide/settings/personalization.md)、[上下文](../../apps/docs/docs/user-guide/tasks/context-and-drafts.md)、[分支](../../apps/docs/docs/user-guide/tasks/branch-and-organize.md)。不要将分支宣传为文件系统安全隔离。
- 主应用支持简中、英、西、巴葡、法、日六种语言；现有帮助中心只配置中英两种。以 [共享语言定义](../../packages/shared/src/common.ts)、[主应用资源](../../apps/web/src/i18n.ts)、[设置语言选项](../../apps/web/src/pages/settings-pages.tsx)、[帮助中心配置](../../apps/docs/docusaurus.config.ts) 为准。

## 演示场景与展示材料

下列是建议制作的演示脚本，尚未在本轮执行或录制。数据应使用可公开的虚构样本。

| 场景 | 用户输入与操作 | 演示要证明的结果 |
| --- | --- | --- |
| 从数据到办公成果 | 上传一份销售表格，要求分析异常、生成图表和汇报材料，再在预览中批注修改。 | 能拿到文件，能看到指定位置的修改链路。 |
| 从知识到有来源的答复 | 在 Full 中准备一份采购制度知识库，提问“这笔采购是否需要额外审批”，打开回答引用。 | 能定位到当时文档版本及依据，不把无来源回答包装为确定结论。 |
| 从个人方法到团队应用 | 创建一项审核 Skill，组合知识库和工具为采购审阅应用，授权给另一个用户安装使用。 | 方法、配置、分享与使用可以形成完整链路；不是复制一段提示词的展示。 |
| 从一次任务到重复工作 | 将公开信息汇总设置为周期自动化，展示计划、运行历史和成果。 | 重复工作可管理、可追溯；演示环境中必须预先配置所需能力。 |

主展示视频优先采用“创建与验证能力 → 发布 → 同事使用”的组织复用故事；办公成果和知识引用各用短片补充。现有 [Hero.gif](../demo/Hero.gif) 的 README 说明正是“工程师构建技能并发布、同事安装运行”。本轮只检查了其首帧，未审阅完整视频内容。

现有可用素材：

| 素材 | 位置 | 使用建议 |
| --- | --- | --- |
| 产品演示 GIF | [Hero.gif](../demo/Hero.gif) | 1920×1080，约 22 MiB；首帧带上下黑边。可作为剪辑来源，官网发布前转成合适的视频与海报，裁切和移动端可读性需重检。 |
| 正式品牌字标 | [浅底版](../../apps/web/src/assets/brand/linksense-lockup-primary.svg)、[深底版](../../apps/web/src/assets/brand/linksense-lockup-on-dark.svg) | 复用现有品牌，不重新绘制标志或任意改色。 |
| 产品图标 | [品牌图标](../brand/linksense-icon.svg) | 用于 favicon、分享图和安装入口；不与署名字标混用。 |
| 组织能力流程图 | [生命周期](../diagrams/organizational-capability-lifecycle.svg)、[能力到应用](../diagrams/capabilities-to-team-application.svg) | 为“创建、共享、复用”板块提供结构与素材依据；页面可按同一语义重排。 |
| 应用构成与业务示例 | [应用构成](../diagrams/application-composition.svg)、[财务应用](../diagrams/finance-application.svg) | 说明知识、技能、工具如何组合。财务图是产品示意，不是客户案例。 |
| 架构与执行说明 | [开放能力层](../diagrams/open-capability-layer.svg)、[系统架构](../diagrams/system-architecture.svg) | 放部署或技术详情，首页只讲用户能理解的关系。 |
| 双语帮助内容 | [帮助中心源目录](../../apps/docs/docs/)、[维护说明](../../apps/docs/README.md) | 当前中文 67 篇、英文镜像 67 篇；复用原文链接，避免维护第二套操作步骤。 |
| 连接器产品图标 | [连接器素材说明](../../apps/web/src/features/connections/assets/README.md) | 标识支持的服务；Google、Microsoft 保留商标权，不作为合作或客户背书。 |

## Cuberto 风格下的页面组织

参考已由用户选择为 [Cuberto](https://cuberto.com/)。下面是内容与设计建议，不表示页面或动效已经实现。

首版建议三个官网入口：首页、部署安装、快速上手。完整操作指南复用现有帮助中心；开发者、许可证、安全与社区入口链接到现有资料。

| 顺序 | 首页内容 | Cuberto 风格的承载方式 |
| --- | --- | --- |
| 1 | 一句话定位、简短价值说明、在线体验与部署入口 | 大字、留白，标题与说明分行揭示；保留静态可读内容。 |
| 2 | 产品完成任务并将能力交给同事的真实操作演示 | 大圆角视频；有海报、播放控制、静音和减少动态效果的替代。 |
| 3 | 完成工作 / 沉淀能力 / 交给团队 三组能力 | 克制的大字号与内容展开，用产品画面解释每组能力。 |
| 4 | 办公成果、知识引用、团队应用、周期自动化四个场景 | 错落双列展示，移动端按阅读顺序转单列；每项有输入和结果。 |
| 5 | 自有部署、模型选择、身份与权限、用量与审核 | 深色完整章节，搭配真实后台细节；不堆叠没有证明的数据。 |
| 6 | Core / Full 选择与一条安装命令的预览 | 可操作的安装入口，完整前置条件放部署页，命令始终可复制和阅读。 |
| 7 | 常见问题、文档和社区、最后一次行动入口 | 可开可关的 FAQ 与大字号页尾；保留键盘操作和清楚的链接。 |

不需要用虚构客户 Logo、虚构使用人数或未经授权的评价补齐原站的客户证明区。[ADOPTERS.md](../community/ADOPTERS.md) 目前只有待填写模板，不能充当客户证据。

后续实现的动效范围应单独验收：首屏文字、圆角演示、内容揭示、场景悬停、按钮填充、桌面上下文光标、分隔线、菜单及 FAQ 的打开与关闭；多路由时还包括出入场转场。当前阶段不宣称上述效果已完成。

## 内容与实现边界

- 已有主应用采用 [React / Vite / React Router / Tailwind](../../apps/web/package.json)，帮助中心采用 [Docusaurus](../../apps/docs/package.json)。官网实现应保留既有项目的技术选择；本轮没有创建新应用、引入框架或修改登录入口。
- 当前 [主应用根路由](../../apps/web/src/App.tsx) 指向任务工作台，并经过初始化与认证路由边界。官网上线时应明确官网和工作台入口，避免用营销首页覆盖已部署用户的工作台地址。
- [知识服务装配](../../apps/api/src/services.ts) 只在 Full 配置下创建完整知识处理服务，[API 注册](../../apps/api/src/app.ts) 同样有 Full 能力判断。Core 可以完成普通附件任务，不应被宣传成 Full 知识库的同等配置。
- 官网可以说明使用官方 Codex 运行时，但不能暗示 LinkSense 是 OpenAI 官方产品或受到 OpenAI 背书；对运行时的描述以 [项目已有说明](../../README.zh-CN.md#基于开源-codex-运行时) 为准。
- “完全离线”“所有数据绝不离开服务器”“零风险隔离”“无限免费”“生产高可用保证”“固定耗时或降本比例”均不在当前证据支持范围内。数据流取决于模型、网页、MCP、连接器和消息渠道的具体配置。
- 用户和用户组授权、应用审核、脱敏审计是可展示的现有功能；不扩写成 SCIM、任意自定义角色、多级组织架构或多人共同编辑等未经确认的能力。
- 现有个人连接器与应用服务的受控 MCP 是不同授权链路，不应宣传“应用使用者自动继承发布者的 Gmail、Outlook 或个人网盘账号”。
- 本轮素材没有证明客户部署规模、并发承载、性能提升、合规认证或 SLA。上线文案不能从功能存在推导这些承诺。

## 部署、上手与运维

### 1. 官网可以直接表达的部署价值

建议文案：**“选择 Core 或 Full，把 AI 工作空间部署在自己的基础设施上。”** Core 提供 AI 工作空间和组织能力平台；Full 在 Core 基础上增加完整文档处理与知识检索。两者是部署配置差异，不能包装成“免费版与付费企业版”。[D01][D06][D07]

| 项目 | Core | Full |
| --- | --- | --- |
| 主要用途 | AI 工作空间与组织能力 | Core + 文档解析、知识库处理与检索 |
| README 标明的 CPU 要求 | 4+ vCPU | 8+ vCPU |
| Docker Engine 实际可用内存 | 8+ GiB | 10+ GiB；目标发行清单可要求更多 |
| README 标明的可用 SSD 空间 | 60+ GiB | 120+ GiB |
| 知识处理服务 | 不启用知识处理服务 | 增加 Docling、Elasticsearch、分词资源与知识服务 |

来源：[D01][D04][D06][D07]。CPU 与 SSD 数值是 README 的部署要求，当前安装器 `preflight()` 没有对应的 CPU 核数或磁盘容量强制检查；内存则确实通过 `docker info .MemTotal` 强制检查。不要写成“自动检测所有硬件均满足要求”。上述资源也不是并发容量或处理速度承诺。[D04]

Core 仍可进行任务附件、文件处理和成果交付；其差异在于未启用完整知识处理服务。不能把“Core 没有知识检索”扩大成“Core 不能处理文件”，也不能把 Full 写成安装后无需配置模型即可检索。[D01][D07][D10]

### 2. 环境要求和安装选择器

官网安装区适合采用“操作系统 × Core / Full”的四组选项，并在复制命令旁保留简短的资源要求。[D01]

| 环境 | 仓库确认的支持范围与限制 |
| --- | --- |
| Linux | Ubuntu、Debian、Fedora、RHEL、Rocky Linux、AlmaLinux、CentOS；x86_64 / ARM64；安装脚本要求 root |
| macOS | Intel / Apple Silicon + 运行中的 Docker Desktop；使用当前账号，禁止 `sudo` |
| Docker | Linux 容器；Engine API v1.45+；Compose v2.24.4+；可访问的本地 Unix socket |
| 网络与端口 | 需要 `curl`、发行资源/镜像下载网络，默认 TCP `18081` 可用；一行安装器不支持远程 Docker context |

来源：[D01][D04]。仓库没有给出具体 Linux 发行版或 macOS 最低系统版本，不应自行补出版本承诺；当前一行安装器没有 Windows 支持路径。[D04]

Docker Desktop 的内存是虚拟机分配给 Engine 的实际可用值，不是 Mac 的物理内存。README 建议 Core 的 Docker Desktop 分配至少 10–12 GB，以满足实际 8 GiB 的门槛；Full 也需为实际 10 GiB 或发行清单中的更高要求留余量。不要只写“8 GB Mac 即可安装”。[D01][D04]

**Linux · Core**

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh
```

**Linux · Full**

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

**macOS · Core**

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh
```

**macOS · Full**

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

四组命令来自 README。[D01] 根脚本默认下载最新正式发行资源，也支持指定 `LINKSENSE_VERSION`；安装引擎校验发行清单、资源校验和与镜像摘要。这里确认的是本地脚本行为，没有访问 GitHub 确认本日最新发行资源能否下载，不能写“官网已经实测安装成功”。[D03][D04]

安装后默认打开 Linux 的 `http://<server-address>:18081` 或 macOS 的 `http://localhost:18081`。部署文件默认位于 Linux `/opt/linksense`、macOS `~/.linksense`，数据在 Docker 持久卷中；安装器会生成运行密钥并输出创建首位管理员所需的一次性初始化凭据。[D01][D04]

本地启动不强制域名或 HTTPS，公开部署应配置 HTTPS 反向代理。macOS 示例的 `localhost` 是访问方式，不是“仅本机可访问”的网络安全保证：当前 Compose 网关发布地址为 `0.0.0.0`。官网不能承诺安装器自动配置域名、证书或公网防护。[D01][D06]

### 3. 从安装到第一个可交付任务

建议官网把“安装完成”与“首次完成工作”分成两段，避免读者误以为无需模型服务即可执行任务。[D08][D09][D10]

1. **安装并创建管理员。** 安全保存终端输出的一次性初始化凭据，打开访问地址，在初始化向导填写管理员名称、邮箱和密码；完成后进入登录页。凭据只用于首个管理员，初始化后失效；首位管理员没有额外的超级管理员权限。[D04][D08][D11]
2. **连接组织选择的模型。** 登录后进入“设置 → 模型设置”，添加渠道，填写服务商、Base URL 与 API Key，再添加对话模型。可以获取服务返回的模型列表，或手动输入模型 ID。[D09]
3. **保存并验证模型。** 测试对话连接，保存首个“对话可选”模型；系统会将其设为对话默认模型和自动命名模型。测试可能产生费用，测试成功不会自动保存；获取模型列表成功也不等于调用成功。[D09]
4. **完成一个小任务。** 返回“新任务”，提供目标、材料和期望输出，检查模型和推理强度后发送；查看执行过程、生成文件并下载成果，再补充修改要求。[D10]

适合官网演示的任务示例：**“阅读这份销售表，找出三个重要变化，生成一份中文摘要和 Excel 明细。”** 这是来自用户指南的工作示例，不是本次已经执行通过的模型质量基准。[D10]

模型连接测试仅验证一次简短请求返回非空文本，不验证工具调用、长任务、图片理解或知识检索。官网的“配置完成”验收应包含真实小任务。Full 要使用知识检索还需配置 Embedding，并可选 Ranker；切换 Embedding 会让既有索引失效，必须完成全量重建后恢复检索。[D09]

成员入门可以压缩成“登录 → 选择可用模型或组织应用 → 提交任务 → 下载成果”。普通成员无可用模型时需管理员配置；邮箱注册只在管理员开放注册且认证邮件可用时显示，SSO 与 Teams 也取决于部署配置，不是默认所有登录方式同时可用。[D10][D12]

### 4. 运维能力：可以展示的具体工具

| 用户问题 | 已有入口 | 应保留的说明 |
| --- | --- | --- |
| 服务是否正常？ | `linksense status`、`linksense doctor`、网页“系统健康” | doctor 检查配置、必要卷及 readiness；网页显示脱敏诊断，不代表所有模型任务已验证 |
| 怎么启动和停止？ | `linksense start / stop / restart` | `stop` 不删除持久卷，不等于外部操作会撤销 |
| 怎么改端口？ | `linksense port 19090` | 校验端口、检查占用、更新配置；有失败恢复流程，不应改安装命令冒充端口迁移 |
| 初始化凭据丢了？ | `linksense credential` | 仅未初始化且部署需要凭据时有效；不是账号密码找回工具 |
| 查看问题或版本 | `linksense logs api`、`linksense version` | 普通日志仍由有部署权限的人员处理，不能公开复制真实敏感日志 |

来源：[D05][D13]。不带参数运行 `linksense` 可打开交互菜单；Linux 需要时会请求 `sudo`，macOS 不用 `sudo`，可能需要将 `$HOME/.local/bin` 加入 PATH。[D01][D04][D05]

网页“系统更新”只检查并展示 GitHub 正式版本，不会静默安装。网页“系统健康”也不会代替部署工具管理外部容器。适合官网文案是“提供版本检查、健康诊断和命令行管理”，不要写成“全自动运维”。[D13][D14]

### 5. 修复和升级边界

**修复**可使用 `linksense repair`，或匹配的 `repair-core.sh / repair-full.sh`。它沿用已安装的不可变发行版本、现有密钥和数据卷，重新获取资源并重建服务。缺少可信安装状态、必要密钥或数据卷时会停止；不会创建空卷伪装恢复，也不是任意数据损坏的一键恢复。[D04][D05]

**升级**可使用 `linksense upgrade`，也可按文档在 Linux 运行以下命令；macOS 去掉 `sudo`：[D01][D14]

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

升级会识别 Core / Full，拉取目标发行资源，等待运行中的工作结束，停止 API / Runner 等写入方，在迁移前创建 PostgreSQL 备份并用 `pg_restore --list` 检查可读取性，然后迁移并验证 readiness；Full 还执行知识能力探针。等待活跃任务的上限为 600 秒，超时会报错。[D04]

需要保留的边界：[D04][D14]

- 备份位置为 `volume://linksense-backups/postgres/...`；这是数据库备份，不是对象文件、用户工作区、所有配置的异地灾备，也不是一次完整恢复演练。
- 迁移开始前的部分失败可恢复旧配置；迁移开始后不会自动回滚数据库或镜像，会保留备份与 `upgrade.pending`，应先检查诊断再按指导恢复或重试。
- 安装脚本不执行升降级，也不支持 Core / Full 原地转换；升级拒绝降级，不能称为“随时无损切换版本”。旧 `v0.1.0` 安装状态只支持其原 Linux amd64 升级路径。
- 正式发行升级流程与 `deploy/production/deploy-production.sh` 的 main 分支部署流程不同；后者默认中止任务进行切换，未完成请求不会自动重跑。官网应优先呈现正式发行安装/升级路径。

### 6. 官网不可夸大的安装、隐私与许可说法

| 可以使用的表述 | 不应使用的表述或必要限定 |
| --- | --- |
| “提供 Linux / macOS 的一行安装入口” | 不承诺固定几分钟、零依赖、全平台、免 Docker；安装仍需下载镜像和后续模型配置。[D01][D04] |
| “自主部署，模型与集成由组织选择” | 不声称默认完全离线或绝无外发。私有模型、本地知识与本地 MCP 才能使相应数据留在自控设施；外部模型、网页和工具可能发起外部请求。[D01][D15] |
| “每用户的 Docker Worker 与可配置资源控制” | 不说每任务强隔离、绝对安全。用户自己的任务共享 HOME / CODEX_HOME / 工作文件；普通执行无需逐命令审批，允许互联网出站，也未默认屏蔽云元数据地址。[D01][D15] |
| “组织能力层开源，采用 CPAL-1.0 并提供内部部署额外授权” | 不写 MIT、Apache 或无任何义务。内部部署例外免除相应源码公开义务，但 GUI 仍保留 `Powered by` 与官方标志署名。[D16] |
| “可以采用自己的品牌；导出成果无需水印” | 不把自有品牌等同移除署名权；CLI / headless / API-only 没有 GUI 展示义务，完整去署名另有商业许可安排。[D16] |
| “第三方组件保留各自许可证” | 不说完整安装栈全部采用同一开源许可；Redis 7.4 与当前 Elasticsearch 官方发行物另有 source-available / ELv2 条款。[D17] |

本表是仓库文案与许可文件的事实摘录，不增加仓库之外的法律结论；官网应链接具体许可和署名文档。使用 Codex 名称时保留独立项目边界，不暗示 OpenAI 官方关联、赞助或认可。[D01][D16][D17]

### 7. 本次核对范围与待验证项

已完成：本地 README、入口脚本、安装引擎、CLI、Compose、初始化代码、用户/管理员帮助和许可文件的交叉审阅。未安装依赖、未运行安装/升级/修复、未启动 Docker 或模型任务、未访问外网、未验证发布资产可用性。本文只新增内容底稿，不修改业务代码；文档调研未运行业务测试。

正式官网上线前仍需以目标发行包验证 Linux / macOS 与两种架构安装、至少一个真实工具任务、Full 文档检索以及代表性历史版本升级。部署资源与模型效果应随实测补充，不宜现在填入吞吐量、成功率或耗时数字。

## 部署部分来源索引

以下路径均相对仓库根目录；链接相对本文件。

- [D01] [`README.zh-CN.md`](../../README.zh-CN.md)：快速开始、部署参考、隐私边界、许可和 Codex 声明。
- [D02] [`package.json`](../../package.json)：本地版本与包管理器；Git HEAD 为本次只读命令结果。
- [D03] [`install-core.sh`](../../install-core.sh)、[`install-full.sh`](../../install-full.sh)：正式发行资源入口与版本选择。
- [D04] [`deploy/release/linksense-installer.sh`](../../deploy/release/linksense-installer.sh)：`preflight`、`fetch_manifest`、`install_action`、`repair_action`、`upgrade_action`、备份及失败恢复逻辑。
- [D05] [`deploy/release/linksense-cli.sh`](../../deploy/release/linksense-cli.sh)：管理命令、诊断、端口与初始化凭据处理。
- [D06] [`deploy/release/compose.common.yml`](../../deploy/release/compose.common.yml)、[`compose.core.yml`](../../deploy/release/compose.core.yml)、[`compose.full.yml`](../../deploy/release/compose.full.yml)：共用服务、Full 服务和网关绑定。
- [D07] [`apps/api/src/config.ts`](../../apps/api/src/config.ts)、[`apps/api/src/services.ts`](../../apps/api/src/services.ts)：Core 禁用知识配置，Full 初始化知识处理服务。
- [D08] [`apps/docs/docs/admin-guide/overview.md`](../../apps/docs/docs/admin-guide/overview.md)：管理员与初始化边界。
- [D09] [`apps/docs/docs/admin-guide/model-settings.md`](../../apps/docs/docs/admin-guide/model-settings.md)：模型配置、测试范围、默认模型和知识索引影响。
- [D10] [`apps/docs/docs/user-guide/getting-started/first-task.md`](../../apps/docs/docs/user-guide/getting-started/first-task.md)：首次准备、任务步骤、文件交付和示例。
- [D11] [`apps/web/src/pages/initialize-page.tsx`](../../apps/web/src/pages/initialize-page.tsx)、[`apps/api/src/modules/auth/service.ts`](../../apps/api/src/modules/auth/service.ts)：初始化字段、一次性凭据检查及完成后的登录跳转。
- [D12] [`sign-in.md`](../../apps/docs/docs/user-guide/getting-started/sign-in.md)、[`registration.md`](../../apps/docs/docs/user-guide/getting-started/registration.md)、[`password-and-sso.md`](../../apps/docs/docs/user-guide/getting-started/password-and-sso.md)：成员登录和条件化认证入口。
- [D13] [`apps/docs/docs/admin-guide/health.md`](../../apps/docs/docs/admin-guide/health.md)：健康页能力与限制。
- [D14] [`apps/docs/docs/admin-guide/system-update.md`](../../apps/docs/docs/admin-guide/system-update.md)：版本检查、发行升级和 main 分支部署差异。
- [D15] [`SECURITY.md`](../../.github/SECURITY.md)：执行权限、文件共享、出站网络、云元数据及 Docker 控制面边界。
- [D16] [`LICENSE`](../../LICENSE)、[`LICENSE-EXCEPTIONS.md`](../../LICENSE-EXCEPTIONS.md)、[`ATTRIBUTION.md`](../../ATTRIBUTION.md)、[`TRADEMARK.md`](../../TRADEMARK.md)：CPAL、内部部署例外、署名与品牌边界。
- [D17] [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md)：第三方服务发行物、独立许可和版本来源。

## 本轮依据与未验证项

本轮以本地源码、帮助正文、安装脚本、品牌文件为一手资料，并抽查实际路由、服务装配与相关测试源码。功能表是当前工作区的内容盘点，不是线上环境的验收报告。

重点交叉核对的代码包括：[应用开发生命周期测试](../../apps/api/test/application-development-lifecycle.test.ts)、[知识引用测试](../../apps/api/test/knowledge-citations.test.ts)、[站点服务](../../apps/api/src/modules/web-sites/service.ts)、[自动化服务](../../apps/api/src/modules/automations/service.ts)、[消息渠道路由](../../apps/api/src/modules/bot-channels/routes.ts)、[连接器服务](../../apps/api/src/modules/connections/service.ts)、[连接器界面](../../apps/web/src/features/connections/connection-catalog-panel.tsx) 和 [外部应用访问服务](../../apps/api/src/modules/application-embed/service.ts)。只阅读源码，不代表运行过这些测试。

资料冲突按代码收敛：帮助中心维护说明仍写“66 篇”，当前文件清单实际为每种语言 67 篇；通用设置帮助正文仍只提中英文，而主应用语言定义、资源与选择器已经包含六种。官网不要直接复制过时描述，本轮也不顺带修改帮助正文。

未执行：实际安装、模型调用、知识检索、OAuth 授权、邮件发送、渠道登录、完整动效预览或线上链接连通性测试。演示素材只审阅 GIF 首帧，没有制作新视频，也没有从第三方网站搬运媒体。
