# AGENTS 指南中的候选库与 LinkSense 的适配性

调研日期：2026-11-13，Asia/Shanghai。本文核查本地源码、官方文档及官方源码，区分事实、工程判断和待验证项。当前工作树为 `feat`，表单与站点等功能已有未提交修改；本地观察不代表线上版本。本轮仅新增本文，没有安装依赖、运行包、接入模型或变更应用。

## 结论与适用范围

这些库能解决不同层次的问题，功能存在不等于 LinkSense 当前存在对应缺口。优先判断增量收益，再判断兼容性。

调研范围是 AGENTS.md 引用的个人指南 `~/.codex/instructions/integrations.md` 中的五项候选，以及 `instructions/web.md` 中的 Uppy。项目根 AGENTS.md 的既有 Fastify、Prisma、JWT、React Router 等选择继续保留。

当前项目是 React/Vite SPA + Fastify，Codex app-server 承担 Agent 执行，BullMQ/Redis/PostgreSQL 承担多类调度和业务状态。按当前需求的接近程度，优先候选是 **json-render 的对话内结果卡片**；Uppy 在大文件传输需求下值得评估，Flags 在实际灰度需求下评估。Workflow、Just Bash、Eve 暂时保留为特定场景候选。

| 候选 | 官方定位 | 当前栈及自托管边界 | 对现有系统的条件性判断 |
| --- | --- | --- | --- |
| json-render | catalog 约束的 JSON UI，registry 映射自有组件。[J1] | React 渲染可嵌入现有页面；当前安装要求 React 19、Zod 4；预制 shadcn 包基于 Radix。[J2][J3] | 最贴近表单/对话卡片；普通扁平表单重合较多，条件显隐、字段联动、组合卡片才更可能有增益。 |
| Flags SDK | 功能开关、灰度及实验，支持任意 provider 或无 provider。[F1] | 主要框架配套为 Next.js/SvelteKit；有通用导出及 React 辅助组件，不能断言不支持 SPA，也不能视为 Fastify 即插即用。[F2][F3] | 有真实定向灰度/实验需求再评估；少量固定开关不必因此引入完整开关体系。 |
| Workflow SDK | 可暂停、恢复的持久化 TypeScript 执行。[W1] | 当前有 Fastify/Vite 指南；Fastify 指南引入 Nitro 编译；Worlds 可自托管，官方 Postgres World 使用 graphile-worker。[W2][W3] | 新的跨系统长流程可能受益；当前回合、队列、持久化等待已有体系，重叠和迁移成本较大。 |
| Just Bash | TypeScript 实现的模拟 Bash 与虚拟文件系统。[B1] | 可在 Node 自托管；浏览器仅支持部分能力；非完整 OS/任意二进制运行环境。[B1][B2] | 适合受限文本/JSON/文件处理能力；不能直接替代真实开发执行环境或隔离基础设施。 |
| Eve | 含工具、频道、子代理、调度及持久化的 Agent 框架。[E1][E2] | 支持 React/Vite 和独立 Node 自托管；底层有 Workflow World、sandbox、模型及认证等后端选择。[E3][E4] | 更接近另一套 Agent 产品骨架；对已使用 Codex 的主执行链，不能按普通辅助库接入来估算收益。 |
| Uppy | 模块化浏览器上传器，含 React 组件、headless 组件及 hooks。[U1] | Tus 要服务端协议支持；S3 插件支持 MinIO、分片直传和服务端签名。[U2][U3] | 当前队列/进度已有实现；增益应集中在大文件分片、失败恢复或远程来源，需同时评估后端。 |

这些判断是选型优先级，不是接入验收或改造授权。

## 本地实现对照

| 已有能力 | 本轮源码证据 | 对选型的影响 |
| --- | --- | --- |
| 受限 JSON 表单 | [共享字段与答案 schema](../../packages/shared/src/conversation-forms.ts)、[MCP 输入和工具](../../apps/runner/src/mcp/core-services/interactive-form-service.ts)、[React 渲染](../../apps/web/src/features/conversations/conversation-structured-user-input-form.tsx) | 已有文本、选择、日期、数字等控件，最多 20 字段、每组 50 选项；当前答案是扁平字段映射，没有通用布局树或显隐表达式。json-render 应证明新增表达能力。 |
| 表单持久化、等待和审批 | [表单事件保存](../../apps/api/src/modules/events/service.ts)、[答案接收与投递](../../apps/api/src/modules/conversations/form-user-input.ts)、[等待规则](../development/interactive-form-waiting.md) | 已有归属和回合状态检查、答案校验、事务及原请求投递；等待连接丢失的恢复仍有明确限制，不能声称现有机制覆盖任意持久化流程。渲染库不承担这些职责。 |
| 上传队列和业务进度 | [上传队列](../../apps/web/src/features/knowledge-bases/knowledge-upload-session.ts)、[上传对话框](../../apps/web/src/features/knowledge-bases/knowledge-upload-dialog.tsx)、[XHR/FormData 上传](../../apps/web/src/features/knowledge-bases/knowledge-base-api.ts) | 已有批量/目录、取消、JWT 刷新、去重冲突及处理进度；不为队列或进度条本身换库。新协议仍须保留这些业务语义。 |
| MinIO 与本地存储 | [对象存储适配器](../../apps/api/src/adapters/object-storage.ts) | 当前接口提供服务端写入和签名下载，没有上传签名或分片管理接口；Uppy 直传需要补齐后端，并处理 `local-filesystem` 模式。 |
| 队列和持久业务投递 | [BullMQ 自动化调度](../../apps/api/src/modules/automations/scheduler.ts)、[持久状态扫描调度器](../../apps/api/src/lib/durable-work-dispatcher.ts) | Workflow 会增加另一套执行和排队机制；已有队列不等于通用工作流，但当前也没有证据要求迁移。 |
| 真实 Agent 执行环境 | [WorkerProvider](../../apps/runner/src/controller/worker-provider.ts)、[Docker worker](../../apps/runner/src/controller/docker-worker-provider.ts)、[app-server 进程与 JSON-RPC](../../apps/runner/src/codex/json-rpc-client.ts) | 已有 Docker 与本地进程两类 provider；本地进程的隔离能力明确为 `none`。Just Bash 只适合另有需求的受限数据处理，Eve 则与现有执行平台有较大重合。 |

已检查根目录、Web、API、Runner 的 package.json 及 pnpm-lock.yaml；这些候选没有作为现有依赖出现。Web 声明 React `^19.2.6`、Zod `^4.6.6`，满足 json-render 文档中的主版本 peer 要求；这不构成实际依赖解析或集成验证。项目已有 AI SDK 7、多供应商适配器、TanStack Query、Zod 和 Recharts，应优先复用。

阅读了表单共享契约和交互测试，能看到推荐答案、审批、必填校验、日期、提交后历史状态等覆盖；本轮没有执行这些测试，不能引用它们为当前工作树已通过的证据。

## json-render：局部 UI 能力最贴近

**已核实事实**

- catalog 定义模型可选组件及动作，模型输出 JSON spec；registry 映射真实组件，React Renderer 渲染结果。它支持状态绑定、条件显隐及渐进式渲染。[J1]
- React 核心安装不要求迁移为 Next.js；官方示例展示核心包加 React renderer。当前 peer 要求是 `react ^19.0.0` 与 `zod ^4.0.0`，项目声明满足这两个主版本要求。[J2]
- `@json-render/shadcn` 是可选预制包，官方明确基于 Radix UI + Tailwind；“都叫 shadcn”不代表与项目的 Base UI/Rhea 控件相同。[J3]
- 源码仓库许可为 Apache-2.0。[J4]

**工程判断**

可复用项目组件，适合受控的表单、预览和组合卡片。由纯 JSON 驱动的渲染本身不产生托管服务依赖；生成 spec 的模型、业务数据存储及调用动作的服务仍由应用决定。[J1][J2]

对现有受限表单，应按“新增表达能力”评估。详情沿用同日专题，避免重复其完整分析：[json-render 与 request_user_form](./json-render-request-user-form-feasibility-2026-11-13.md)。

**待验证**

实际依赖解析、真实 spec 成功率、客户端体积、六语言及无障碍效果；UI spec/历史表单的版本兼容，客户端规则与服务端 Zod 的一致性。没有证据支持“换库即可改善所有表单”。

**最小验证建议**

先选一个真实分析场景，验证对话内的只读结果卡片：摘要、数据表、图表和来源。用 `@json-render/core`、`@json-render/react` 的 catalog/registry 映射已有 Card、Table 和 Recharts；先限制组件和数据大小。这个实验可以检验 AI 组合内容的收益，不要求先扩展表单答案或审批协议。[J1][J2]

若随后需要条件表单或业务按钮，再单独确定服务端规则、动作白名单和版本化合同。至少验证旧表单仍能显示、提交和保存结果，新 spec 的非法组件/动作被拒绝，六语言和无障碍有效，并记录真实生成成功率与包体积。公开站点和独立交互应用继续沿用现有产物机制，其用途和约束另见[交付意图研究](./site-vs-interactive-app-intent-routing-2026-11-13.md)。

## Flags SDK：灰度有价值，SPA 接入成本需单独看

**已核实事实**

- 官方把 Flags SDK 定位为免费开源的 Next.js/SvelteKit 功能开关工具，支持任意开关 provider，也允许自行实现决定逻辑、不使用 provider。[F1]
- 当前 `flags` 包公开 `flags`、`flags/next`、`flags/react`、`flags/sveltekit` 等入口；源码没有 `flags/core` 导出。API 文档 URL 中的 `core` 不是包入口名。[F2]
- `flags/react` 的 `FlagValues`、`FlagDefinitions` 主要输出带正确转义及属性的 script，供 Flags Explorer、Web Analytics 或 Vercel Toolbar 读取；这不是客户端完整开关判定引擎。[F3]
- `flags` 根入口提供发现端点校验、值/定义加解密等能力；官方许可是 MIT。[F2][F4]

**工程判断**

不能因框架主路径是 Next.js/SvelteKit 就断言 SPA 不可用；但现有 SPA+Fastify 需要明确服务端判定、用户/组织上下文、向客户端传值及覆盖行为。官方框架集成可提供多少现成收益，仍需验证。

SDK 不强制购买某个开关服务。[F1] 若选云 provider、Vercel Flags、Toolbar 或分析服务，应分别评估其服务条款、数据流及费用；“SDK 免费”不等于整套实验平台免费。

**待验证**

当前真正需要的定向规则、灰度一致性、紧急关闭、实验指标与权限边界；provider 缓存、失联回退、自托管配置及费用。不应以功能开关替代后端授权。

## Workflow SDK：支持自托管，也带来第二套执行状态

**已核实事实**

- 通过 workflow/step 语义获得暂停、恢复、持久化及可观测性；当前官方文档为 v5，并列出 Fastify、Vite 等入口。[W1][W2]
- 官方 Fastify 指南使用 Nitro 处理 workflow 编译及开发/生产构建，并非仅在原生 Fastify 项目加一段运行时代码。[W2]
- Worlds 抽象处理存储、排队和通信。可用 Vercel World，也可选择官方维护的 Postgres World 或社区 World；不是必须部署到 Vercel。[W3][W4]
- Postgres World 用 PostgreSQL 存储 runs/events/steps/hooks，以 graphile-worker 排队；它不使用项目现有 BullMQ 队列。[W3]
- 当前 Postgres World 文档明确：驱动执行的 flow HTTP 路由不会自动鉴权，生产部署需限制网络入口；部分 webhook 仅靠 URL token 授权。[W3]
- 源码许可为 Apache-2.0。[W5]

**工程判断**

自托管可以避免强制购买 Vercel 托管执行，但仍需承担 PostgreSQL、执行服务、存储/队列清理、恢复、安全及观测的成本。[W3][W4]

对已经有 BullMQ、持久化等待及 Codex 原生回合语义的系统，其价值更可能在新增且独立的业务长流程。不能把 SDK 的重试、恢复叠加到 Codex turn 上，推定为无成本的可靠性增强。

**待验证**

流程的副作用幂等性、至少一次投递、部署后旧执行版本能否继续、历史事件升级、双队列运维及与既有 shutdown 的兼容。官方框架指南不构成 LinkSense 既有构建兼容证明。

## Just Bash：能力受限的执行器，不是完整开发机器

**已核实事实**

- 核心是模拟 Bash、虚拟文件系统及注册的命令实现；网络默认关闭，可显式配置 URL/method 白名单。[B1]
- 核心 shell 可在浏览器运行；Python、sqlite3、js-exec 及接触真实文件系统的 OverlayFs/ReadWriteFs 需要 Node。[B1]
- 当前包有 browser/Node 入口，Node engine 为 `>=20.19`；包 README 标明 Apache-2.0。[B1][B2]
- 官方威胁模型把 embedding host、Node/V8/OS、主机提供的 fs/fetch/customCommands 等视为信任基础。它不运行真实子进程，也不提供完整 OS 兼容性。[B3]
- README 指出，启用的 CPython/sql.js WASM 内存不能仅靠 Node worker resourceLimits 可靠约束；强内存隔离仍需进程/容器等边界。[B1]

**工程判断**

如果业务需要“只允许检查、检索、变换一组受控数据”，它可能减少暴露真实 shell 的必要。前提是允许的命令、挂载、网络与宿主 hooks 本身受控。

对于已有真实 worker 环境的代码生成、构建、安装及系统工具执行，命令兼容性差异可能比新增收益更大。不能仅凭“sandbox”名称就把它当现有隔离方案的替代品。

**待验证**

目标命令覆盖、CPU/内存上限、挂载/并发行为、取消与结果截断、宿主 hooks 和实际部署隔离。无需 Vercel 服务不代表零执行资源或零安全维护成本。

## Eve：框架级重合，保留为架构参考

**已核实事实**

- Eve 是以文件系统组织的 Agent 框架，覆盖 instructions、tools、skills、channels、subagents、schedules 等；产品页当前标为 Beta/1.0 RC，许可 Apache-2.0。[E1][E2]
- 官方支持独立 Node 自托管，也支持与 Vite/React 等前端一起部署；React hook 可通过自定义 baseUrl 及 bearer headers 连接。[E3][E4]
- Eve 的持久化执行依赖 Workflow SDK。自托管后端可选 Local/Postgres 等 World；sandbox 默认可用 Docker；模型可走 AI Gateway 或 AI SDK provider。[E3]
- 字符串模型 ID 默认走 Vercel AI Gateway，需要对应凭据；直接 provider model 使用该 provider 包及 API key。因此“必须使用 Vercel Gateway”并不准确。[E3]
- 生产浏览器流量需要配置 route policy；自有 bearer token 可以传入 hook，但仍需 Eve 服务端验证应用身份。[E3][E4]

**工程判断**

它可以帮助了解频道、调度、可恢复执行及前端会话的整体产品组织。但对于已选择 Codex app-server 的 LinkSense，引入 Eve 不是单独补一个 UI 或持久化工具；需解释两套会话、执行、权限和持久化如何相处。

自托管仍需持续运行服务、持久化 World、隔离后端、模型凭据及观测；选择托管后端会产生相应服务依赖。[E3][E5] 现有 JWT/Argon2 不是可自动跳过的重复功能。

**待验证**

当前 Beta/RC API 稳定性、模型/沙箱供应商切换、历史会话升级、资源归属、审计与 Codex 协议一致性。本轮没有找到足以证明其可原样替换现有 Codex app-server 适配层的证据。

## Uppy：恢复能力取决于上传协议和服务端

**已核实事实**

- React 集成提供预制 UI、headless 组件和 hooks，可将上传逻辑接到自有 UI，而非必须采用整套 Dashboard。[U1]
- `@uppy/tus` 封装 tus-js-client；断点续传需要 Tus 客户端与 Tus 服务端，服务端可自托管，也可用托管服务。[U2]
- `@uppy/aws-s3` 支持浏览器直传 S3 或 MinIO 等兼容服务；大文件分片可重试失败部分，但增加创建、签名、完成等请求开销。[U3]
- 当前 S3 插件要求从临时凭据、自有签名 endpoint、Companion 中选择一种授权模式。使用自有签名 endpoint 时，长期凭据留在服务器。[U3]
- Uppy 是 MIT 开源项目，官方说明自 2016 年免费；Transloadit 托管处理/Tus、远程来源和对象存储的服务费用需分别核算。[U2][U4]

**工程判断**

若目前缺的是大文件失败后的恢复和直传，Uppy 比重写传输状态更值得评估。但仅更换前端上传组件不会把现有 FormData endpoint 变成 Tus/S3 Multipart。

本地存储模式可以考察 Tus 自托管服务端；MinIO 模式可以考察签名直传。两者的授权、上传完成入库、配额、重复文件与孤儿分片清理均仍属应用职责。

**待验证**

当前后端协议、JWT 刷新、CORS、重载后文件恢复、目录/批量上传、既有冲突去重语义、对象可见性及本地存储模式。上传队列与百分比本身不足以证明更换收益。

## 官方来源

- [J1 Introduction](https://json-render.dev/docs)；[J2 Installation](https://json-render.dev/docs/installation)；[J3 shadcn API](https://json-render.dev/docs/api/shadcn)；[J4 官方仓库与许可](https://github.com/vercel-labs/json-render)。
- [F1 官方首页](https://flags-sdk.dev/)；[F2 package.json 与 exports](https://github.com/vercel/flags/blob/main/packages/flags/package.json)；[F3 flags/react](https://flags-sdk.dev/docs/api-reference/core/react)；[F4 flags API](https://flags-sdk.dev/docs/api-reference/core/core)。
- [W1 官方首页](https://workflow-sdk.dev/)；[W2 Fastify 指南](https://workflow-sdk.dev/docs/getting-started/fastify)；[W3 Postgres World](https://workflow-sdk.dev/worlds/postgres)；[W4 Deploying](https://workflow-sdk.dev/docs/deploying)；[W5 官方仓库与许可](https://github.com/vercel/workflow)。
- [B1 包 README](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/README.md)；[B2 package.json](https://github.com/vercel-labs/just-bash/blob/main/packages/just-bash/package.json)；[B3 Threat Model](https://github.com/vercel-labs/just-bash/blob/main/THREAT_MODEL.md)。
- [E1 产品页与发布状态](https://vercel.com/eve)；[E2 官方源码与许可](https://github.com/vercel/eve)；[E3 Deployment](https://eve.dev/docs/guides/deployment)；[E4 Frontend Frameworks](https://eve.dev/docs/guides/frontend)；[E5 Self-hosting](https://eve.dev/docs/guides/deployment/self-hosting)。
- [U1 React](https://uppy.io/docs/react/)；[U2 Tus](https://uppy.io/docs/tus/)；[U3 AWS S3](https://uppy.io/docs/aws-s3/)；[U4 官方仓库与许可](https://github.com/transloadit/uppy)。

## 验证边界

本轮只做本地源码与官方资料核查；未安装、测试、构建、压测或验证部署。除 Eve 的官方 Beta/RC 标识、各仓库许可及文档列出的限制外，没有用 star 数或“官方出品”推断生产成熟度。

没有提出替换既有认证、执行引擎、队列、数据库或部署方式的实施要求。任何引入决定仍需以真实缺口、现有版本兼容、历史资源可继续使用及可测收益为依据。
