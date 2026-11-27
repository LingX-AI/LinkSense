# LinkSense 公开动态应用：全部自托管的实现边界与建议

调研日期：2026-11-14（Asia/Shanghai）。**已确认约束：生成应用的内容、数据、后端服务和运行环境全部部署在自己控制的基础设施上，不采用托管云服务。** 本文是这一约束下的选型依据；[此前跨供应商比较](dynamic-app-backend-alternatives-2026-11-13.md)中的 Cloud 路线仅保留为历史比较，Appwrite Cloud App Installation、Supabase Cloud Management API 和 Workers for Platforms 均不属于本次候选。

> **2026-11-15 实施更新：用户已确认按自部署 Appwrite 开始实现。** `feat` 已加入可选后端、独立应用域网关和生成/发布工具；真实 Appwrite 2.7.2 验证已覆盖项目与受限凭证开通、访客会话、私有记录、并发唯一性、审批函数、文件权限，以及更新和停用。当前配置、升级顺序和功能边界以[站点发布开发文档](../development/web-site-sharing.md#自部署动态应用)为准。下文保留当时的研究判断；生产部署、容量、对抗隔离和备份恢复仍需按实际环境验收。

本轮读取了现有研究、站点文档、当前工作树的公开路由、发布仓储和任务删除逻辑，并核对官方文档与固定版本源代码。未安装服务、创建远程资源、启动运行环境、执行迁移或部署，也未修改产品代码。以下“建议”是待验证的方案，不代表已采用新架构或获得具体服务器、域名、部署方式的授权。

## 1. 建议先验证自托管 Appwrite，按需求增加容器运行时

**全部自托管可行。默认候选仍可选 Appwrite 自托管版：Auth、TablesDB、Storage、Functions 与 Sites 都有自托管实现，不需要把生成应用交给 Appwrite Cloud。** 其中 Functions 提供受支持运行时中的业务函数；Sites 可承载静态站点及受支持框架的 SSR。当前官方安装文档使用 Appwrite `2.7.2`，本次源代码核对也固定到该 tag，不把未锁版的 Cloud 文档或环境变量示例当成部署契约。[A01][A02][A03][A04][A05]

选择顺序建议如下：

1. **账号、CRUD、文件和有界业务函数：先验证 Appwrite 自托管。** 例如预约、审批、客户门户、Webhook 和事件处理。生成代码遵循其权限和函数模型，避免同时建设另一套完整 BaaS。
2. **需要复杂 SQL、关系查询或 PostgreSQL 原生生态：比较 Supabase 自托管。** 它是另一种数据和身份底座，不能借用其 Cloud 项目管理能力来减少自托管编排工作。[S01][S02]
3. **需要完整 Fastify/FastAPI/Django 服务、常驻 worker、特殊系统依赖或不适合函数的任务：增加独立容器运行时。** 使用自有 PostgreSQL、对象存储及明确的应用认证方案。Coolify/Dokploy 可选作交付工具；它们不自动提供访客账号、记录权限或安全运行任意恶意程序的完整边界。[C01][C02][C03]

这不是要求三种底座一起部署。先用实际目标应用验证 Appwrite；只有函数模型覆盖不了已确认需求时，再引入容器路线。运维复杂度、应用密度、延迟及成本均未进行实测。

## 2. Appwrite 自托管的能力与不能直接继承的 Cloud 能力

| 能力 | 自托管可用性及约束 | 对 LinkSense 的含义 |
| --- | --- | --- |
| Auth | 提供访客注册、会话、账号管理；验证和重置邮件仍需配置邮件基础设施。[A06][A02] | 站点访客账号与 LinkSense 发布者账号分开；不默认把平台 JWT 作为站点会话。 |
| TablesDB | 提供数据库、表、行与权限接口；表级和行级授权相加，管理 key 不遵循普通客户端的资源 ACL。[A07][A08] | 每应用 Project 内定义业务数据；启用并验证行权限，不能靠前端 `app_id`/`owner_id` 过滤证明隔离。 |
| Storage | 自托管配置支持本地与对象存储后端；固定版本也描述 S3 compatible 存储。[A02] | 使用自有持久卷或自有对象存储；LS 平台对象存储与应用 bucket 的凭证和权限分别管理。 |
| Functions | 可在受支持的 Node.js、Python 等运行时执行代码；具有构建、执行、资源和网络配置边界。[A02][A03][A04] | 可实现真实业务后端；不能据此承诺任意 Node/Python 项目可原样启动或可靠常驻运行。 |
| Sites | 自托管有 Sites 域名、运行时和执行超时配置；产品支持静态与受支持框架的 SSR。[A02][A05] | SSR 确有需要时再采用；现有静态发布无需为接数据库而统一迁走。 |
| 管理与组织 | 安装文档说明自托管单实例只有一个组织；自托管 Console profile 关闭 Cloud 多租户、组织 API key UI、项目环境等入口。[A01][A09] | 建议运营方组织下每逻辑应用一个 Project，不建议按 LS 用户批量建立组织。 |
| 备份与升级 | 持久化文件、数据库、配置与加密密钥由运营方负责；不应把 Cloud 托管备份和 PITR 视为已获得的能力。[A09][A10][A11] | 需要自己的恢复流程、升级演练及容量管理；安装成功不是运维验收。 |

同一个 Appwrite 实例可作为多个应用的服务底座；“每应用一个 Project”是逻辑身份、配置和数据作用域建议，**不是每个应用独享一套主机、数据库服务器或恶意代码沙箱**。固定版本的 Functions/Sites 执行器依赖容器，Compose 含 Docker socket 挂载，因此执行基础设施权限仍是需要单独审查的信任边界。[A04][C03]

不在本文给出生产容量数字，也不沿用 Cloud 套餐限额作为自托管承诺。固定 tag 的部分资源默认值允许不设 CPU/内存上限，生产验证必须检查实际启用的限制、并发、排队、磁盘和函数超时。[A02]

## 3. 自动开通：源码存在路径，初始凭证链路尚未闭环

**不能把 Appwrite Cloud App Installation 当成自托管引导方案。** 已核对自托管目标 tag 中的路由及认证声明：

| 固定版本源码事实 | 可以推导的方案 | 尚不能承诺的部分 |
| --- | --- | --- |
| `POST /v1/organization/projects` 存在，声明 `projects.write` 及 ADMIN/KEY/ORGANIZATION 认证类型。[A12] | 用受控管理身份创建稳定 ID 的应用 Project。 | 某个已有项目 key 是否能跨项目创建并配置新 Project，不能仅凭路由声明判断。 |
| `POST /v1/organization/projects/:projectId/keys` 存在，声明 ADMIN/ORGANIZATION 认证及组织/项目 key 写入作用域。[A13] | 管理端为新 Project 签发最小权限项目 key，再配置资源。 | 自托管如何获得可长期维护的初始组织级管理身份、如何续期及恢复，本轮未实测。 |
| 组织初始化逻辑区分 Console/admin 身份、API key 和普通项目会话；旧项目 key 路由仍存在，源码提示向组织路由迁移。[A14][A15] | 以固定版本的正式认证机制验证自动配置，适配集中留在 LS 服务端。 | 不把普通访客会话提升为管理员，不把旧路由或内部 Console 调用当成不变的公共承诺。 |
| 安装器“secret API key”对应 `_APP_OPENSSL_KEY_V1` 的配置描述是服务端加密密钥。[A02] | 保留其安全备份，作为实例恢复材料。 | 它不是已经完成项目管理凭证引导的证据，不能当作 REST 管理 key 发请求。 |

建议第一轮验证允许管理员完成一次初始化：建立实例管理员及初始项目，准备受控凭证；随后验证“新建 Project → 签发受限 key → 建表与权限 → 部署函数 → 配置站点域”的真实链路。若只能预建 Project 和 key，也可先验证单应用能力，但不得把它称为已经实现批量无人值守开通。

自动化尚未验证并不否定自托管可行性；它决定 LS 控制面的实施工作量。管理凭证只留在受控后端，模型、Runner 和生成网页不获得实例管理权。不得直接修改 Appwrite 系统数据库或自己伪造 token 来绕过引导。

## 4. 控制面和应用运行面分开

当前 [站点发布文档](../development/web-site-sharing.md)与[公开路由](../../apps/api/src/modules/web-sites/routes.ts)显示，`/web/{slug}` 仍是同域沙箱 iframe，资源使用匿名 CORS，iframe 与资源 CSP 均不授予 `allow-same-origin`。它负责分发静态快照，不运行站点后端；[公开站点查询](../../apps/api/src/modules/web-sites/repository.ts)会检查发布状态及所有者状态。不能直接在现有同域页面放宽隔离来让新应用获得正常存储与会话。

建议由 LS 控制面调用受控配置/发布执行层；公众访客经自有应用网关进入应用前端和后端，后端连接自己的身份、业务数据及文件存储。以上节点均运行在自有基础设施，管理凭证不交给生成代码。

- **LS 控制面**保留平台登录、应用归属、资源编排、版本切换、域名映射、审计和运维状态。平台现有 Fastify/Prisma/PostgreSQL 不需要因为新增 Appwrite 而替换。
- **应用运行面**使用独立 origin；建议使用与控制台不同的可注册域。Appwrite 路线建议每应用 Project、独立访客身份域；容器路线建议每应用服务、数据库角色/数据库、网络和存储凭证。相同运营方实例不等于共享高权限 key。
- **正常会话路径**需在应用顶层页面验证 Cookie、CORS、回调、刷新恢复与浏览器限制。预览可继续使用现有沙箱；不同自定义域名下的会话不能先行宣称已支持。[A16]
- **业务数据**不写入 LS 平台业务表。生成代码只持有该应用运行所需的权限；有高权限业务服务时，由服务端校验实际访客和具体资源授权。
- **发布和数据状态**分开记录。一次新页面发布不重建账号和数据库；一次 schema 变更不自动代表新代码已上线。

以上是职责与边界建议，不是要求新增一个通用云平台、数据库管理器或多供应商插件框架。

用户交付沿用现有链接卡片：发布成功后显示稳定访问地址，提供打开和复制；用户已要求自动打开且 Browser Use 扩展已配对、允许打开新页面时，再在独立窗口打开。动态应用更新仍使用原应用身份，链接交付不依赖用户查看 HTML 产物。

## 5. Supabase 自托管与完整容器服务的取舍

| 路线 | 何时有价值 | 全自托管下需要承担的工作 |
| --- | --- | --- |
| Appwrite 自托管 | 希望一套服务提供 Auth、数据、文件和多语言业务函数；应用可遵循其模型 | 固定版本配置、Project/key 引导、ACL、执行隔离、完整备份与升级。 |
| Supabase 自托管 | SQL、关系查询、RLS、事务及 PostgreSQL 生态对目标应用更重要 | 官方自托管是**单 Project**，Studio 没有 Cloud 多组织/多 Project 管理，且不提供 Cloud Management API。批量应用要自己编排独立服务栈，或自行设计共享栈内的身份、角色、schema、Storage 和密钥隔离。[S01] |
| 独立容器服务 + PostgreSQL | 应用确实需要完整后端框架、常驻任务或系统依赖 | 自有构建、镜像仓库、运行节点、数据库、Auth、授权、密钥、网络、配额、备份和升级；部署工具不代替这些职责。[C01][C02][C03] |

Supabase 的 Edge Functions 是 Deno 函数运行环境，自托管可以运行其函数服务，但它不自动变为任意 Node/Python 应用托管器；完整服务仍使用自己的容器。浏览器使用公开 key 配合 RLS，高权限 secret/service-role 凭证留在可信服务端。每应用独立 Supabase 栈通常更容易明确作用域，但所需资源未实测；共享一栈则是额外的多租户设计，不能只添加一列应用 ID。[S02][S03][S04]

容器路线建议沿用既有生产交付原则：**在独立受控构建环境生成镜像，由运行节点拉取镜像；数据库迁移作为独立受控步骤。** Coolify/Dokploy 的 Dockerfile、镜像、Compose 和 API 能力可以作为工具选项，但不视为已经批准在生产服务器上传源码并直接构建。[C01][C02]

容器默认共享宿主内核；Docker daemon/socket 权限、privileged 模式、宿主目录挂载、平台凭证、内网访问以及构建阶段都影响隔离。面向不同作者生成且可能不可信的程序，建议使用独立运行节点，按信任级别决定是否需要更强的沙箱或虚拟机边界。本轮没有验证对抗性隔离。[C03]

PocketBase 暂不进入默认验证清单。它适合单节点、范围受控的小应用；官方仍提示 v1 前的兼容性及 production-critical 使用限制。此次目标已经有 Appwrite 与标准 PostgreSQL/容器两条清晰路线，没有必要先加入第三种数据模型。[P01]

## 6. 稳定身份、停用和升级兼容

| 场景 | 建议保持的行为与验收 |
| --- | --- |
| 新版本、跨任务更新、改名或改 slug | 保留逻辑应用 ID、后端 Project/数据库、访客账号和数据。稳定运行 hostname 不跟随展示名称随意变化；资源校验失败不切换版本。 |
| 现有静态站点升级 | 无动态后端绑定的旧记录继续走原静态发布路径；旧 manifest、URL、下载、更新、停用和来源关联继续可用。不要求重建、重新导入或重新发布。 |
| 前端/镜像发布与 schema 变更 | 分开审批、记录和执行。先兼容性新增，再发布依赖它的代码；删列、改类型、权限收紧及数据转换评估旧页面和存量数据影响。回退代码不意味着数据已回滚。 |
| 停用、所有者停用、来源任务删除 | 关闭网页、API、函数域名及实际外部访问路径；确认撤销后再报告完成。部分失败要保留可恢复状态，不能只改 LS 本地 status。 |
| 恢复与永久删除 | 停用默认保留数据；恢复使用原应用身份。业务数据永久删除、账号保留和备份留存规则需单独确认，不能隐含在删网页动作中。 |
| 下载与迁移 | 现有 ZIP 仍是前端产物。完整应用交付另需服务镜像/代码、schema/migrations、数据、文件、配置和密钥恢复材料；不得把含管理密钥的包公开给访客。 |

现有[跨任务发布仓储](../../apps/api/src/modules/web-sites/repository.ts)保留站点身份和发布状态，[来源任务删除](../../apps/api/src/modules/conversations/deletion.ts)会停用关联站点并清空任务关联。动态后端必须覆盖这些已有路径，不能只在新的“取消发布”按钮里撤销。

**只隐藏 LS 网页入口不能阻止直接请求后端。** 已打开页面、脚本、旧会话、JWT、函数预览域、Storage 下载链接、Realtime 连接及公开 IP 仍需逐一处理。Appwrite 源码有项目服务开关与项目会话失效入口，可作为原生撤销能力候选，但本轮没有验证其对所有数据入口和已有连接的完整效果。[A17][A18]

建议自有网关成为生成应用的唯一公众入口，数据/执行服务处于受控网络，并禁止可绕过网关的备用域名、默认域名和直连入口；Appwrite 若共享一个内部 endpoint，还需验证请求的 Project ID 与路由绑定，防止借其他已启用应用的入口访问停用项目。若保留公共直连，则必须验证提供方原生服务关闭和会话撤销，不能由网关状态推断后端已经停止访问。已下载到访客设备的数据无法收回。

LinkSense 数据库和 Appwrite/容器编排不构成同一事务。配置、停用和删除应有持久化状态、有界恢复与幂等资源标识；这属于资源生命周期，不应增加或重放 Codex turn。

## 7. “全部自托管”要覆盖运行依赖

| 依赖 | 全部自托管的落实方式 |
| --- | --- |
| 邮件与访客认证 | 使用自己控制的 SMTP；验证邮箱验证、重置密码、投递失败和回调。外部 OAuth、SMS 和托管验证码不是默认依赖；确需时必须先解决硬约束。[A06][A02] |
| 文件与备份 | 使用自有磁盘/对象存储和独立备份位置，覆盖文件实体及数据库元数据。恢复同时需要 Appwrite 加密密钥与 LS 后端映射；仅导出表或前端 ZIP 不完整。[A02][A10] |
| 构建与镜像 | 自有构建节点和镜像仓库；固定依赖/镜像版本。外部 Git、包仓库和镜像仓库属于供应链依赖，不能误称为完全离线；若要求断网交付，应准备受控镜像和包镜像源。 |
| 页面与业务调用 | 字体、脚本、图片等发布到自有资源服务；禁止默认为生成应用引入外部 CDN、托管数据库、云函数、第三方 analytics 或运行时 AI API。 |
| 日志、统计与观测 | 日志和指标存储在自有系统，核查并关闭不需要的外发 DSN/遥测；启用自托管统计不代表已经完成所有外部请求审计。[A02][S01] |
| 运维与域名 | 自有反向代理、证书、DNS 配置和告警；公网 DNS/证书服务的网络需求与应用内容/数据托管分别列清楚。扩容、漏洞响应、版本升级和故障恢复均由运营方承担。[A11][S01] |

本轮方案覆盖生成应用的运行服务。LinkSense 生成阶段的 AI 推理及其模型接口不会因为自部署 Appwrite 自动本地化；本轮没有验证包括模型调用在内的全链路零外联。

备份、实例升级和应用数据库迁移是三种操作。实例升级先按目标版本说明在隔离副本恢复并验证；应用迁移则验证旧数据和旧应用能否继续使用。Appwrite 安装页与未锁版环境变量文档存在数据库默认值表述差异，本方案不据后者指定默认数据库；实施时以固定版本安装配置、源代码和实际升级路径为准。[A01][A02][A11]

## 8. 后续验证与证据边界

最小验证可使用一个带登录、私有记录、文件上传和审批函数的公开预约应用，在隔离环境完成以下四组检查：

1. **开通与隔离：** 管理身份引导、创建第二个 Project/key、双用户及跨应用直接 ID 越权、密钥泄漏检查；函数和容器的网络、挂载及权限检查。
2. **运行与停用：** 独立域登录和恢复、真实邮件、数据和文件持久化、函数失败；并发预约同一时段只有一个成功，管理员审批可触发自有测试 Webhook；停用后的直连 REST/函数域/下载/旧会话/JWT/Realtime，恢复及部分失败重试。
3. **发布与升级：** 更新前端保留用户和数据；代表性旧静态记录及旧 manifest 的继续使用；旧动态页面对新增 schema 的兼容，失败不切换，代码回退边界清楚。
4. **运维与外部依赖：** 从备份恢复应用、用户、文件和 LS 映射；固定版本升级；磁盘、内存、并发及配额压力；运行和构建出站请求清单。

本轮验证限于文档、固定 tag 源码和当前仓库代码阅读；没有完成上述运行检查，没有性能基准、容量结论、生产安全验收或可用性承诺。下一步是获准后验证 Appwrite 自托管样例，具体安装、服务器、域名及生产发布需按部署流程另行确认。

## 官方资料与固定版本源码

- [A01 — Appwrite 自托管安装与单组织说明](https://appwrite.io/docs/advanced/self-hosting/installation)
- [A02 — Appwrite 2.7.2 环境配置源代码](https://github.com/appwrite/appwrite/blob/2.7.2/app/config/variables.php)
- [A03 — Appwrite Functions 执行模型](https://appwrite.io/docs/products/functions/execute)
- [A04 — Appwrite 2.7.2 Compose 与执行器](https://github.com/appwrite/appwrite/blob/2.7.2/docker-compose.yml)
- [A05 — Appwrite Sites 静态与 SSR](https://appwrite.io/docs/products/sites/rendering)
- [A06 — Appwrite 邮箱密码认证与验证/恢复](https://appwrite.io/docs/products/auth/email-password)
- [A07 — Appwrite TablesDB 权限](https://appwrite.io/docs/products/databases/tablesdb/permissions)
- [A08 — Appwrite 权限模型](https://appwrite.io/docs/advanced/security/permissions)
- [A09 — Appwrite 2.7.2 Cloud/self-hosted Console 能力配置](https://github.com/appwrite/appwrite/blob/2.7.2/apps/console/src/lib/console-profiles.ts)
- [A10 — Appwrite 自托管备份](https://appwrite.io/docs/advanced/self-hosting/production/backups)
- [A11 — Appwrite 自托管更新](https://appwrite.io/docs/advanced/self-hosting/update)
- [A12 — Appwrite 2.7.2 Organization Project 创建](https://github.com/appwrite/appwrite/blob/2.7.2/src/Appwrite/Platform/Modules/Organization/Http/Projects/Create.php)
- [A13 — Appwrite 2.7.2 Organization Project Key 创建](https://github.com/appwrite/appwrite/blob/2.7.2/src/Appwrite/Platform/Modules/Organization/Http/Projects/Keys/Create.php)
- [A14 — Appwrite 2.7.2 Organization 认证初始化](https://github.com/appwrite/appwrite/blob/2.7.2/src/Appwrite/Platform/Modules/Organization/Http/Init.php)
- [A15 — Appwrite 2.7.2 旧 Project Key 路由及迁移提示](https://github.com/appwrite/appwrite/blob/2.7.2/src/Appwrite/Platform/Modules/Project/Http/Project/Keys/Create.php)
- [A16 — Appwrite 会话安全与 Cookie 行为](https://appwrite.io/docs/products/auth/security)
- [A17 — Appwrite 2.7.2 项目服务开关](https://github.com/appwrite/appwrite/blob/2.7.2/src/Appwrite/Platform/Modules/Project/Http/Project/Services/Update.php)
- [A18 — Appwrite 2.7.2 项目会话失效](https://github.com/appwrite/appwrite/blob/2.7.2/src/Appwrite/Platform/Modules/Project/Http/Project/Sessions/Delete.php)
- [S01 — Supabase 自托管边界、单 Project 与无 Management API](https://supabase.com/docs/guides/self-hosting)
- [S02 — Supabase 自托管 Docker 服务组合](https://supabase.com/docs/guides/self-hosting/docker)
- [S03 — Supabase 自托管 Edge Functions](https://supabase.com/docs/guides/self-hosting/functions)
- [S04 — Supabase API key 与高权限凭证](https://supabase.com/docs/guides/api/api-keys)
- [C01 — Coolify 应用交付与构建选项](https://coolify.io/docs/applications/)
- [C02 — Dokploy 应用与 Compose 交付](https://docs.dokploy.com/docs/core/docker-compose)
- [C03 — Docker Engine 安全、daemon 权限与容器隔离](https://docs.docker.com/engine/security/)
- [P01 — PocketBase 官方介绍与生产关键应用限制](https://pocketbase.io/docs/)
