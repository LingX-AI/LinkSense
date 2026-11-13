# LinkSense 公开动态应用：Appwrite、Supabase 与独立运行时

调研日期：2026-11-13（Asia/Shanghai）。范围：LinkSense 为外部公众生成和发布动态应用，包含独立访客认证、持久化数据、后端 API 与业务逻辑。本调研没有接入动态后端、创建远程资源、安装服务或执行部署。全部外部事实依据文末官方资料；“建议”“判断”和迁移成本评级为本次分析，并非厂商承诺或实测结果。

> **2026-11-14 范围更新：用户已确认内容和服务全部自部署，不采用第三方托管云服务。** 当前选型与验收以[全自部署动态应用方案](./dynamic-app-self-hosting-2026-11-14.md)为准。本文保留原始对照资料；下文 Appwrite Cloud App Installation、Supabase Cloud Management API、Cloudflare Workers for Platforms 等托管方案不再是本次实施候选。确认自部署原则不代表已经选定产品、服务器或部署方式。

本次需求已超出“静态站点加登录和数据库”，不沿用将业务逻辑后置的旧范围。Appwrite 的基准方案应包含 BaaS、Functions，以及需要时采用 Sites 动态 SSR；官方 Sites 支持受支持框架的服务端渲染，Functions 支持自定义 HTTP 入口和异步执行。因此下文比较的是 **BaaS + 函数的受支持模型** 与 **通用容器运行时** 两条路线。[S34][S46][S47]

## 1. 最有用的结论

**Appwrite 能作为首版公开动态应用的后端，前提是接受“按请求、事件或计划运行的业务函数”。** Auth、TablesDB、Storage 与 Functions 可以组成预约审批、客户门户等完整应用；需要服务端渲染时再选 Appwrite Sites 支持的框架。LinkSense 的[现有公开发布入口](../development/web-site-sharing.md)负责静态文件分发；动态应用可以沿用对话创建和链接交付体验，但不应放宽现有同域 iframe 的隔离来实现访客登录。[S33][S34][S46][S47][S48][S49]

**如果“复杂”包括任意 Node.js/Python 服务、系统依赖、常驻进程或超出函数限制的后台任务，选一个 BaaS 不能单独完成目标。建议把问题拆成应用运行时与数据/身份服务两层。** Supabase Edge Functions 是 Deno 兼容的 TypeScript 函数；Convex 的 Node.js 环境只开放给 action；PocketBase 的内嵌 JavaScript 不是 Node.js；Workers 提供 Node API 子集，Python 采用 Pyodide/WebAssembly。这些都不能等同于接受任意后端项目后原样启动。[S03][S09][S16][S20][S21]

对 LinkSense 的建议优先级：

1. **通用完整应用：独立容器运行时 + PostgreSQL + 明确的认证方案。** Coolify/Dokploy 可以承担构建与部署；Supabase 可以作为其中的数据、Auth、Storage 服务，但不替代任意代码运行时。[S01][S02][S27][S28][S30]
2. **愿意限定生成栈：优先比较 Appwrite 与 Supabase，而不是立即替换。** Supabase 的主要优势是标准 PostgreSQL、SQL/RLS、数据库迁移工具和 Cloud 的平台管理接口；Appwrite Functions 已支持 Node.js、Python 等运行时，不应把 Appwrite 描述成只能 CRUD。[S01][S02][S05][S06][S33][S34]
3. **大量相互独立的 AI 生成应用，且愿意采用 Workers 模型：重点验证 Cloudflare Workers for Platforms。** 官方直接面向客户或 AI 编写的不可信代码，支持通过 API 部署 user Worker，并给每个 Worker 单独绑定 D1、R2 等资源。这比把任意生成程序塞入平台主 API 进程更贴合本次托管边界；认证和业务授权仍需独立设计。[S18][S19][S22]
4. **Convex 适合统一使用 TypeScript 的实时业务应用；PocketBase 适合范围受控的小应用。** 前者会改变后端编程模型；后者的单节点定位及官方生产关键应用限制，使其不适合作为此次复杂公众应用平台的默认底座。[S08][S09][S14][S15]

这些是方案建议，不是对 LinkSense 现有技术栈的迁移决定。先确定是否接受受限函数模型，再决定 BaaS，能避免选型后才发现仍缺完整运行时。

## 2. 能力边界对照

| 方案 | 实际提供的核心能力 | 能否原样托管任意 Node.js/Python 后端 | 建议的应用隔离单位 | 主要代价或限制 |
| --- | --- | --- | --- | --- |
| Appwrite | Auth、TablesDB、Storage、Realtime、Functions 与 Sites；函数支持 HTTP、事件和计划触发 [S33][S34][S46][S47][S48] | 支持 Node.js/Python 函数；不是通用常驻进程托管 | 每应用独立 Project，发布新版本不重建后端 | Cloud 优先验证组织安装令牌能否配置刚创建的 Project；自托管单独核对目标版本 [S50][S51][S52][S57] |
| Supabase Cloud | PostgreSQL、Auth、Storage、Realtime、Deno Edge Functions；Management API 可编排项目 [S01][S02][S03][S05] | 不能把 Edge Functions 当通用 Node/Python 容器；完整服务另配运行时 [S03][S04] | 默认每应用一个 Project；Cloud 每 Project 有独立 Postgres 实例 [S06] | 按项目计算资源；不能假定大量闲置 Project 自动零成本 [S05][S06] |
| Supabase 自托管 | 自托管单 Project 的服务组合 [S07] | 同上 | 每应用独立服务栈，或自行设计共享项目内的隔离 | 官方自托管没有 Cloud 的 Management API、多 Project Studio、托管备份/HA [S07] |
| Convex | TypeScript/JavaScript 查询、事务 mutation、action、实时订阅、文件存储与认证接入 [S08][S10] | Node action 可运行 Node 库；不等于常驻 Node 服务，不托管 Python 服务 [S09][S11] | 每应用独立 Project/production deployment；自托管编排另验 [S12][S13] | 编程模型耦合；自托管 FSL 适用范围需确认 [S13] |
| PocketBase | SQLite、Auth、文件、Realtime、REST API、Go/JS 扩展 [S14][S15] | 不直接提供 Node/Python 运行时；需要外部服务 [S15][S16] | 每应用独立进程与 `pb_data` | 单节点纵向扩展；v1 前不保证完整向后兼容 [S14][S15] |
| Workers for Platforms + D1 + R2 | 受限代码运行时、SQLite 语义数据库、对象存储、平台部署 API [S18][S22][S23][S25] | Workers 代码可；任意 Linux/Node/CPython 项目不保证兼容 [S20][S21] | 每应用 user Worker + 独立 D1/存储 binding [S22] | Auth 需另外选型；Workers 和 D1 有明确资源限制 [S24][S26] |
| Coolify / Dokploy + 应用自己的后端 | Dockerfile/镜像/Compose 构建、发布、环境变量、域名、持久化等部署能力 [S27][S28][S30] | 能运行正确容器化且符合目标主机条件的 Node/Python 服务 | 独立应用容器、网络、数据凭证与持久卷；具体策略由平台决定 | 不自动提供应用访客 Auth、数据权限、业务 API 或恶意租户沙箱 [S27][S30] |

表内隔离单位均是建议。Project、数据库、容器、Worker 是不同层的边界，不能把“创建了一个资源”当成所有身份、网络、密钥和数据权限都已隔离的证明。

### Appwrite 的开通方式影响选型

- **绑定已准备的项目：** 首个小样可由管理员预建 Project 并配置最小权限。Cloud 另有 Sign in with Appwrite，可让创建者同意 LS 操作已授权的项目，包含数据库、Functions 与 Sites 的项目级权限。OAuth 授权对象是创建者的管理资源，与生成应用的访客登录分开。[S51][S53]
- **LS 完全代开通：** 优先验证 Appwrite Cloud 的 **App Installation**。组织所有者一次安装后，LS 后端可以签发限于该组织、带项目及组织权限的短期令牌。官方示例中的项目授权可以是通配范围；文档没有演示用同一安装为刚创建的项目建表并部署函数的完整流程。先用最小权限验证这条链路、跨组织拒绝和撤销行为。安装密钥仅留在 LS 后端，不传给 Runner 或生成的应用。[S53][S57]
- **不要把 Partners key 当项目凭证。** 它能创建 Project，但不能配置项目内资源；旧 Project API 已废弃创建长期密钥。该限制不等于所有自动开通方案都必须手工创建项目密钥。若安装令牌方案不能闭环，Cloud 备选是 Supabase Management API；自托管须单独验证目标镜像的引导方式。本轮未实测供应商环境。[S05][S50][S51][S52][S57]

另一个值得观察的候选是 **InsForge**。其官方 CLI 提供项目与后端资源操作，Custom Compute 支持常驻服务；官方 FAQ 说明自托管的常驻计算仍要接 Fly.io，并且其托管 Site 暂无自助下线入口。若 LS 使用它，宜保留自己的访问入口和下线控制，再验证供应商原地址是否满足业务要求。[S54][S55]

## 3. Supabase：最值得与 Appwrite 正面对比的数据层

### 已确认的事实

- 每个 Supabase Project 拥有完整 PostgreSQL 数据库；Auth、Storage、Realtime 与 Edge Functions 建立在其上。因此可使用标准 SQL 和 Postgres 生态，不必把所有数据访问限定为某个 SDK 的查询接口。[S01]
- 浏览器可以使用项目的公开访问配置配合 RLS；`secret` / legacy `service_role` 属于高权限服务端凭证，具有绕过 RLS 的能力，不能放入生成网页或提供给访客。[S02]
- Edge Functions 是 TypeScript、Deno 兼容的函数环境。官方建议长时间、重型工作移出 Edge Function；托管版本仍有内存、CPU 和 wall-clock 限额。这适合 Webhook、业务 API 与外部 AI API 编排，但不是完整 Node/Python 服务托管承诺。[S03][S04]
- 官方 **Supabase for Platforms** 文档明确面向 AI Builders，提供项目创建、健康检查、Auth 配置、函数与其他资源管理方式。Cloud 每个 Project 都有独立 Postgres 实例；选型时需要把应用数量和项目计算资源一起评估。[S05][S06]
- **自托管与 Cloud 控制面有关键差异：** 官方自托管是单 Project，Studio 不支持多个组织或 Project，且没有 Cloud Management API；备份、容灾、伸缩、升级、安全加固归运营方负责。CLI 本地开发栈也不应暴露为生产服务。[S07]
- 数据库结构可用 SQL migration 跟踪并通过既定流程发布。对象文件与数据库内的 Storage 元数据分开保存，数据库导出不能代替完整文件迁移。[S17][S35]

### 对 LinkSense 的建议与相对 Appwrite 的取舍

**优先考虑 Supabase 的条件：** 目标应用存在复杂关系查询、报表、事务、数据库约束或未来交付独立代码/数据库的需求，并愿意把 Postgres migration 作为生成产物的一部分。标准 PostgreSQL 会减少数据层对专有调用方式的依赖；这不代表 Auth、Storage、Realtime 和 Edge Functions 可以零成本迁移。[S01][S17][S35]

**继续选 Appwrite 的合理条件：** 希望一套服务提供账号、权限、数据和多语言 Functions，愿意让生成应用遵循该平台模型。Appwrite 官方已提供 Node.js/Python Functions；Supabase 的 Deno 函数并不会天然扩大语言兼容范围。[S03][S33][S34]

比较超时时须看具体入口：Appwrite 官方同步 Create execution 入口为 30 秒，函数域名入口为 60 秒；异步执行受函数配置超时约束，官方函数配置文档给出的系统最大值为 900 秒。不能把函数可配置的总执行时长当成 HTTP 客户端可同步等待的时长。Supabase、Convex、Workers 的 CPU、wall-clock 与请求连接限制也应分别比较。[S04][S11][S26][S34][S47]

建议 Cloud 模式优先验证每应用一 Project 的自动配置与生命周期，再测单个应用的业务能力。不要让不同作者生成的任意应用共享整个 Project 的高权限 secret：RLS 可以隔离访客数据，但高权限服务端凭证本身就是更大的授权边界。[S02][S05][S06]

若坚持自托管，不能把 Cloud 的 `POST /v1/projects` 当成自托管能力。每应用独立 Supabase 服务栈能减少共享配置风险，但资源开销和编排工作需要实测；共享单 Project 则需要自己处理 schema/角色、Auth 用户域、Storage、函数与密钥边界。后者是架构工作，不能仅靠添加 `app_id` 字段宣称完成隔离。[S02][S07]

## 4. Convex：实时 TypeScript 应用生产率高，但生成结果绑定其模型

### 已确认的事实

- Convex 用 JavaScript API 读写 JSON 类文档，并提供关系建模；前端通过 query 订阅数据，mutation 处理数据库写入，action 调用外部服务。这不是直接暴露 PostgreSQL 给应用使用的模式。[S08][S09][S36]
- 默认 Convex runtime 运行 queries/mutations；Node.js runtime 仅用于 action，Node action 通过 `runQuery` / `runMutation` 访问 Convex 数据库。Action 有执行时间和内存限制，不能据此承诺常驻 API server、任意系统依赖或 Python 进程。[S09][S11]
- 支持 Convex Auth，也支持 OIDC/JWT 身份提供方。认证完成后，业务权限通常在每个 public function 开始处用代码检查；不应把“接了登录”当成已有数据授权策略。[S10]
- 官方 Platform APIs 面向 AI app builders，可管理多个 Project、deployment 和 deploy key，并以 CLI 完成代码打包部署。[S12]
- 可以自托管 backend/dashboard；官方部署默认使用本地 SQLite 保存状态，也描述了外接 SQL 存储的路径。底层持久化使用 SQL，并不会让应用侧 API 自动变为标准 SQL。[S08][S37]
- 自托管 backend 使用 FSL Apache 2.0 形式的 fair source 许可证，官方明确限制构建与 hosted Convex Cloud 竞争的产品，并说明代码在创建两年后转为 Apache 2.0。LinkSense 若把自托管 Convex 包装成对外后端平台，需要先确认具体业务是否被允许；本调研不作法律认定。[S13]
- 官方提供 ZIP/流式导出；因此数据可以导出，但数据导出并不自动转换已有 query/mutation/action、实时订阅和权限逻辑。[S38]

### 建议与相对 Appwrite 的取舍

如果所有生成应用采用 React + TypeScript，重视实时协作、端到端类型和代码内业务逻辑，Convex 值得做小范围验证。若目标是“用户可以生成任意 Fastify、FastAPI、Django 项目”，Convex 就不是通用承载层。[S08][S09][S10]

建议每应用独立 Project/production deployment，并保留部署身份与业务数据，不随对话或前端重新生成而重建。Cloud API 能管理这些实体，不意味着官方自托管服务自动具备同等多租户控制面；本轮未验证自托管批量编排或 hostile tenant 隔离。[S12][S37]

相对 Appwrite，Convex 更适合把业务规则全部生成为其服务端函数；迁出时通常需要重写更多调用及实时逻辑。这是基于其 API 模型的迁移成本判断，没有进行迁移性能或工时实测。[S08][S09][S36]

## 5. PocketBase：部署小，但不建议作为本次默认底座

### 已确认的事实

- PocketBase 集成 SQLite、Auth、文件、实时订阅及 REST 风格 API，支持 Go 或内嵌 JavaScript 扩展。[S14][S15]
- 官方 FAQ 定位为单台服务器运行，扩展方式为纵向扩展；没有官方托管服务。它并不支持像其他 BaaS 那样托管 cloud functions。[S15]
- 内嵌 JavaScript 使用 goja，不是 Node.js 或浏览器环境；不能因为使用 `.js` 或能够 `require` 模块，就认定 npm 生态和 Node API 可正常运行。[S16]
- 官方当前仍提醒：v1.0 前不保证完整向后兼容，不建议用于 production-critical 应用，除非接受跟进 changelog 并不时手动迁移。[S14]
- 部署需要保留 `pb_data`；官方生产文档包含备份及生产配置要求。迁移脚本和业务扩展也需要纳入交付，不能只保留单个可执行文件。[S39]

### 建议

适合可接受单节点、工作量有界、故障影响较低的独立小应用或原型。若用于 LinkSense，建议每应用独立进程和数据目录，Node/Python 业务另配服务。对复杂公众应用的默认平台而言，接受其升级与运维约束的收益不够明确，优先级应低于 Appwrite/Supabase 或专门运行时。[S14][S15][S16][S39]

## 6. Cloudflare：更贴近代码托管平台，但需要补齐应用后端产品层

### 已确认的事实

- Workers for Platforms 官方明确支持运行客户或 AI 编写的不可信代码，通过 dispatch namespace、dispatch Worker 和 user Worker 组织代码部署及路由。[S18]
- Namespace 中的 Worker 默认按 untrusted 模式运行，并为其隔离缓存。应用数据隔离还依赖资源 binding；官方明确每个 user Worker 只能访问显式附加的 binding，可给每个应用创建独立 D1/KV 等资源。[S19][S22]
- Node.js 兼容层包含已实现 API、部分实现与仅能导入的 stub；因此“能 import 成功”不等于所有 Node 运行行为可用。Python Worker 把 Python 放入 Pyodide/WebAssembly；可使用纯 Python、PyEmscripten 或 Pyodide 提供的包，不等同于任意 CPython 原生 wheel 都能安装。[S20][S21]
- D1 是 SQLite 语义的托管 serverless SQL 数据库，支持按用户/租户/项目创建独立数据库；当前付费单库上限为 10 GB，不能无限提高。结构迁移使用版本化 `.sql` 文件。[S23][S24][S40]
- R2 提供对象存储；D1/R2 是数据能力，并不自动定义注册、密码重置、邮箱验证、站点访客角色和记录权限。[S23][S25]
- 该组合需要另外确定公众应用的身份认证。Cloudflare Access 可以保护 Worker 并传递身份，但它是额外的访问控制产品，不应不加评估地当作所有公众应用所需的完整账号业务。[S41]
- 普通 Workers 的当前每 isolate 内存限制为 128 MB；HTTP 请求存活时间与 CPU 时间是不同限制。不能通过保持 HTTP 连接来替代可靠后台任务。平台还提供 Queues/Workflows、Durable Objects 等 binding，后者用于持久状态和多客户端协调；只有业务确需时才加入。[S22][S26][S42]

### 对 LinkSense 的建议与相对 Appwrite 的取舍

如果愿意定义受支持的后端模板，例如 TypeScript Worker + D1 + R2 + 选定 Auth，Workers for Platforms 是非常贴合“批量生成、独立发布、多应用隔离”的候选。它提供代码托管执行与资源绑定，LinkSense 仍负责应用归属、发布版本、配额、停用、域名、认证配置、迁移和审计。[S18][S22]

建议每应用独立 user Worker 和 D1，按实际需要使用独立 R2 bucket 或受控存储代理；只附加该应用的资源。不要给生成代码 Cloudflare 账户级 API token，再依赖生成代码自行区分租户。若共享一个资源，binding 本身只授权访问该资源，不会自动替应用执行记录级业务授权。[S22][S43]

与 Appwrite 相比，这条路线增加了平台集成工作，但更直接覆盖生成代码的托管边界。代价是要适配 Workers/SQLite 模型，以及接受 Cloudflare 运行和资源 API 的耦合。若应用必须使用标准 PostgreSQL、完整 Linux 系统依赖或常驻 Python 服务，应另配相应运行时，不能悄悄把需求缩减为 Workers 支持范围。[S20][S21][S23]

## 7. Coolify / Dokploy：可以部署完整后端，但不是另一种 Appwrite

### 已确认的事实

- Coolify 把 Git、Dockerfile、现有镜像和 Compose 定义部署为连接服务器上的 Docker 容器，提供应用配置、域名、环境变量、健康检查等能力；有 API 创建和管理部署资源。[S27][S28][S29]
- Dokploy 支持 Dockerfile、Compose 和多语言构建方案，并提供 API。正确容器化的 Node.js/Python 服务可以由这些部署方式承载；具体 Linux 架构、系统依赖和运行资源仍受目标主机限制。[S30][S31][S32]
- Coolify 明确：容器替换会丢失仅写入容器文件系统的数据，需要外部数据库、named volume 或其他持久存储；持久卷本身不是备份。[S44]
- Dokploy 也明确容器持久卷外的文件通常是临时的，数据库/文件需要正确挂载；官方支持 named volume 备份，而 bind mount 并不自动获得同样的备份能力。[S31][S45]

### 建议

它们适合充当 LinkSense 的部署执行层，可运行完整 API 服务、常驻 worker 和系统依赖；但应用访客 Auth、数据库模型、权限和业务 API 仍由应用及其后端服务实现。部署平台账号和应用访客账号是两套职责。[S27][S30]

**不要仅因“每应用一个容器”就宣布已具备安全运行任意不可信程序的能力。** 本轮只核实部署能力，没有验证此类平台在恶意租户条件下的构建隔离、主机权限、网络出口、资源耗尽与数据隔离。通用容器路线需要把这些运行约束明确设计为平台能力；此处是未验证项，不是断言 Coolify/Dokploy 无法实现隔离。

若第一版用户量有限、生成后端先限定一种框架，可以在现有部署流程中采用常规容器部署；不必为了得到一个 API 服务就迁移整套 LinkSense 运维工具。是否引入 Coolify 或 Dokploy，应由实际部署自动化缺口决定。

## 8. 长期状态与迁移成本

以下是基于官方模型的工程判断。评级只比较迁移耦合，不代表总成本，也不承诺跨平台无停机迁移。

| 方案 | 应长期保留的状态 | 结构演进与回滚关注点 | 迁出耦合判断 |
| --- | --- | --- | --- |
| Supabase | Project、Postgres 数据/用户、对象文件、Auth 配置与凭证 | SQL migration；前端/函数代码回滚不会自动撤销已写数据；Storage 文件另迁 [S17][S35] | 数据层较低；Auth/Storage/Realtime/函数中等 |
| Convex | Deployment 数据、文件、Auth 和运行配置 | 需要保持 schema 与既有文档兼容；导出不是函数和实时逻辑转换器 [S08][S38] | 中高，主要在 query/mutation/action 与订阅模型 |
| PocketBase | `pb_data`、迁移、hooks/Go 扩展 | 备份恢复与版本升级；v1 前关注人工迁移步骤 [S14][S39] | SQLite 数据较低；Auth/API/hooks 中等 |
| Cloudflare | D1 ID/数据、R2 文件、Worker binding 与身份配置 | D1 SQL migration；代码版本与数据版本分开；资源 ID 应跨发布保留 [S22][S40] | SQLite/S3 兼容数据较低；Workers/DO/队列集成中高 |
| 常规容器 + PostgreSQL | 数据库、对象存储、卷、Auth 密钥与域名映射 | 数据不写临时容器；映像回滚与数据库恢复分开 [S44][S45] | 运行时与数据较低；运维和认证迁移仍需工作 |

对所有路线的共同建议：应用身份及后端资源不随临时会话、构建目录或一次前端发布而重建。新版本先兼容旧数据；涉及删字段、变更权限和不可逆转换时，明确旧版本、现有用户与已有数据的影响。停站、删除对话、删除发布记录与删除业务数据库应是不同动作，默认不要让操作界面意外销毁长期数据。这些是本次架构建议，没有执行迁移或建立新的删除策略。

## 9. 先验证一个完整应用

**建议用一个公开预约审批应用验证 Appwrite Auth + TablesDB + Functions。** 两个独立访客账号、一个审核角色；并发提交同一时段只能有一个成功，未获授权的访客不能读取别人的预约；审核通过由后端更新记录并接收或发送测试 Webhook。TablesDB 提供行权限和事务，业务规则由服务端函数实现。[S47][S49][S56]

1. **开通：** 在隔离组织一次安装 LS，用最小权限创建 Project，再配置域名、建表、部署函数；验证重复执行不会创建第二个 Project，且凭证不能访问未授权的组织。
2. **交付：** 用独立域名打开应用，真实浏览器验证注册、登录、会话恢复和授权失败；不要只验证生成页面能渲染。
3. **上线后管理：** 保持应用 ID 和后端 Project 不变，更新代码后检查原链接、账号和数据；停站后直接访问原 API 和函数域名，验证旧凭证也不能继续访问。测试环境与已上线数据隔离。
4. **按失败原因换方案：** 若只卡在无人值守开通或 SQL 需求，用同一个样例对比 Supabase Cloud；若业务要求完整 Node/Python 服务，再验证独立容器的构建、网络、运行权限和数据隔离。不要把生成任务的临时 Runner 当作线上服务器。

LinkSense 可继续统一管理应用归属、版本、稳定链接与审计；供应商运行应用和保存业务数据。先选一个后端验证，不预先实现多供应商平台。更细的域名、数据保留和停用边界见 [Appwrite 接入调研](./appwrite-site-auth-database-feasibility-2026-11-13.md)。

## 官方资料

所有来源均于 2026-11-13 核对。本文不提供套餐报价，也不把免费额度作为批量公众应用的长期成本保证。

- [S01 — Supabase Database](https://supabase.com/docs/guides/database/overview)
- [S02 — Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [S03 — Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [S04 — Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits)
- [S05 — Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms)
- [S06 — Supabase Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk)
- [S07 — Supabase Self-Hosting](https://supabase.com/docs/guides/self-hosting)
- [S08 — Convex Database](https://docs.convex.dev/database/overview)
- [S09 — Convex Runtimes](https://docs.convex.dev/functions/runtimes)
- [S10 — Convex Authentication and Authorization](https://docs.convex.dev/auth/overview)
- [S11 — Convex Actions](https://docs.convex.dev/functions/actions)
- [S12 — Convex Platform APIs](https://docs.convex.dev/platform-apis/overview)
- [S13 — Convex Self Hosting and license](https://docs.convex.dev/self-hosting)
- [S14 — PocketBase Introduction](https://pocketbase.io/docs/)
- [S15 — PocketBase FAQ](https://pocketbase.io/faq/)
- [S16 — PocketBase JavaScript engine and limitations](https://pocketbase.io/docs/js-overview/)
- [S17 — Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [S18 — Cloudflare Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
- [S19 — Workers for Platforms Worker Isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/)
- [S20 — Cloudflare Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [S21 — Cloudflare Python Workers packages](https://developers.cloudflare.com/workers/languages/python/packages/)
- [S22 — Workers for Platforms bindings and resource isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/)
- [S23 — Cloudflare D1](https://developers.cloudflare.com/d1/)
- [S24 — Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [S25 — Cloudflare R2](https://developers.cloudflare.com/r2/)
- [S26 — Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [S27 — Coolify Applications](https://coolify.io/docs/applications/)
- [S28 — Coolify deployment methods](https://coolify.io/docs/applications/choose-deployment-method)
- [S29 — Coolify Dockerfile application API](https://coolify.io/docs/api/endpoints/applications/create-dockerfile-application)
- [S30 — Dokploy build types](https://docs.dokploy.com/docs/core/applications/build-type)
- [S31 — Dokploy Applications](https://docs.dokploy.com/docs/core/applications)
- [S32 — Dokploy API](https://docs.dokploy.com/docs/api)
- [S33 — Appwrite Functions runtimes](https://appwrite.io/docs/products/functions/runtimes)
- [S34 — Appwrite Functions configuration and execution](https://appwrite.io/docs/products/functions/functions)
- [S35 — Supabase Storage files and metadata](https://supabase.com/docs/guides/storage/management/download-objects)
- [S36 — Convex Realtime](https://docs.convex.dev/realtime)
- [S37 — Convex official self-hosted deployment guide](https://github.com/convex/convex-backend/blob/main/self-hosted/README.md)
- [S38 — Convex Data Export](https://docs.convex.dev/database/import-export/export)
- [S39 — PocketBase Going to production](https://pocketbase.io/docs/going-to-production/)
- [S40 — Cloudflare D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [S41 — Cloudflare Access on Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [S42 — Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [S43 — Cloudflare bindings as permission and API](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [S44 — Coolify persistent storage](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview)
- [S45 — Dokploy Compose persistence and volume backups](https://docs.dokploy.com/docs/core/docker-compose)
- [S46 — Appwrite Sites static and SSR rendering](https://appwrite.io/docs/products/sites/rendering)
- [S47 — Appwrite Functions synchronous and asynchronous execution](https://appwrite.io/docs/products/functions/execute)
- [S48 — Appwrite product capabilities](https://appwrite.io/)
- [S49 — Appwrite TablesDB permissions](https://appwrite.io/docs/products/databases/tablesdb/permissions)
- [S50 — Appwrite Partners project creation](https://appwrite.io/docs/partners/project/create)
- [S51 — Appwrite Project API keys](https://appwrite.io/docs/partners/project/api-keys)
- [S52 — Appwrite Partners architecture](https://appwrite.io/docs/partners/architecture)
- [S53 — Appwrite OAuth project and organization scopes](https://appwrite.io/docs/partners/apps/scopes)
- [S54 — InsForge official CLI](https://github.com/InsForge/CLI)
- [S55 — InsForge official FAQ: Custom Compute and site takedown](https://github.com/InsForge/InsForge/blob/main/docs/faq.mdx)
- [S56 — Appwrite TablesDB transactions](https://appwrite.io/docs/products/databases/tablesdb/transactions)
- [S57 — Appwrite organization installations and short-lived tokens](https://appwrite.io/docs/partners/apps/installations)
