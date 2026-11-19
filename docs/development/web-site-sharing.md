# 发布为站点与我的站点

“发布为站点”入口位于已登记 HTML 任务产物的预览工具栏。个人账号和组织账号都可在“应用与工具 → 应用 → 我的站点”管理自己的站点。旧管理书签 `/knowledge-bases?tab=sites` 会跳转到 `/capabilities?section=application&app_scope=sites`，保留站点搜索和状态筛选。公开链接与已有发布记录不受影响。应用页只在打开“我的站点”时请求站点列表。

“我的站点”统一展示静态网页和已连接数据服务的 Web 应用，列表显示当前 `/web/{slug}` 自定义链接路径，复制按钮复制完整公开地址；“访问”继续打开稳定入口或历史独立域名。点击站点名称打开详情，查看完整自定义链接、稳定链接、数据服务绑定、来源任务、资源数量与大小及发布/修改/创建时间。未发布状态明确说明链接暂不可访问，来源任务删除后仍显示保留站点的信息。详情复用列表数据，不额外查询后端或嵌入运行网页；可在详情内编辑，保存后同步更新列表与当前详情，关闭时返回触发按钮。

管理接口的列表、创建、编辑和发布结果返回绝对 `url` 与可选 `alias_url`。`url` 保留现有稳定入口或历史独立 origin，`alias_url` 由 API 使用 `publicBaseUrl` 和当前 slug 生成，避免桌面客户端或独立 origin 应用错误拼接域名。新增字段不持久化，不需要迁移或重新发布；新客户端仍接受未返回 `alias_url` 的旧 API，显示原链接和单独的链接名称。上线时先更新 API 再更新 Web，才能显示完整自定义链接。

## 地址与访问

- 静态页面和沙箱动态应用统一使用主域稳定入口 `/app/s/{site-id}`，复用现有站点 UUID。标题、链接名称、后端别名和静态增加后端都不改变此入口；历史独立 origin 应用保持原地址。`/web/{slug}` 和 `/app/{backend-address}` 保留为别名，不新增 DNS、证书或迁移。
- 分享无需访客登录。管理接口 `/api/v1/web-sites` 使用现有 JWT 验证和服务端所有权检查。
- 修改链接名称后旧 `/web/{slug}` 仍可访问同一应用；沙箱后端旧别名跳转到稳定入口并保留查询参数。地址保留期间不能被其他应用接管。
- 删除站点会在同一事务中永久移除站点、全部发布版本与全部地址占用记录，保留操作审计和原任务文件。原用户及其他用户均可重新使用地址，新建站点拥有新的 ID 和发布版本，已删除版本的资源地址不会恢复。取消发布仍保留地址占用。

迁移 `20260918020000_hard_delete_web_sites` 会永久清理之前软删除的站点、发布版本及地址记录，并移除 `deleted_at` 字段；保留所有未删除站点（包括取消发布的站点）、任务和原文件。此数据删除由用户明确要求。部署时应停止旧版 API 写入，应用迁移后启动使用新 Prisma 客户端的 API；旧版 API 依赖已移除的字段，不能与新版混跑。
- 每个 HTML 产物重复提交创建请求会返回已有站点；数据库事务串行化来源任务写入，并用地址唯一约束处理竞争。
- 更新发布保留站点地址，只在资源校验通过后切换当前版本。未发布的站点更新内容不会自动重新发布。
- 停用、删除或账号停用后，入口与所有版本的资源地址均不可访问。资源逐次检查状态，浏览器和代理不缓存分享响应。

## 更新已有站点

发布弹窗使用统一单选器选择“新建站点”或“更新已有站点”，默认选中新建站点，下方展示对应表单；更新时未选择目标不能提交。更新目标的搜索和分页位于下拉选择器内，先展示当前任务的站点，再展示其他任务的站点，仅包含当前用户拥有的未删除站点。选中目标后展示已有链接，不修改名称、简介或地址。

`POST /api/v1/web-sites/:id/releases` 接受 `{ file_id, backend_id? }`，旧客户端可省略后端字段。服务端先验证目标和来源的所有权及完整资源包，随后在事务中创建版本并更新来源。静态增加后端时先验证同一用户的 sandbox 后端及资源就绪，持有后端租约并锁定站点，确认未绑定其他应用后，同时切换发布版本与后端绑定。禁止替换已有后端或把旧 origin 后端作为原地增强目标。失败回滚，原页面、ID、别名和发布状态保持可用；复用现有可空字段，无新增数据库迁移。

跨任务更新后，“我的站点”的来源链接及后续更新文件列表指向新任务。删除旧任务不会停用已转移的站点；删除新来源任务仍按现有规则停用站点。原任务已删除的保留站点也可选择新任务的 HTML 更新内容，但保持未发布状态。此次调整无数据库迁移，不改变既有发布接口格式，已发布站点无需重新创建或重新发布。

## 访问统计

公开站点可选开启访问统计，静态和动态站点都适用；只有已发布站点能开启。统计服务使用自部署的 [tinytraffic](https://github.com/egoist/tinytraffic)，与 Appwrite 的 Docker Compose 部署在同一台开发服务器，数据保存在独立卷中。

- API 配置 `LINKSENSE_TINYTRAFFIC_URL` 和 `LINKSENSE_TINYTRAFFIC_API_KEY`，两项必须同时设置；密钥只由 API 使用，不下发 Runner、模型或网页。未配置时开启统计返回 `WEB_SITE_ANALYTICS_NOT_CONFIGURED`，其他站点功能不受影响。
- 每个站点在 tinytraffic 中对应一个以站点 UUID 生成的合成域名（`<site-id>.linksense.invalid`），不随 slug 或名称变化。远端站点的名称为站点名并设为公开可读，详情中的统计链接无需再次登录。
- 对话中通过 `update_web_site` 的 `analytics: true|false` 开启或关闭；Web 端在站点编辑弹窗中切换。关闭只停止采集，保留历史数据。
- 开启后，发布版本的 HTML 文档在响应时注入 tinytraffic 跟踪脚本；JS、CSS、图片等资源不注入。发布资源 CSP 放行配置的统计服务 origin，开发环境可使用 HTTP 地址；生产环境应使用 HTTPS，避免混合内容。
- 统计链接由服务端按 `LINKSENSE_TINYTRAFFIC_URL` 和远端站点 ID 生成，客户端和助手不得自行拼接。
- tinytraffic 的浏览器跟踪器会跳过 `localhost`、`127.0.0.1`、`::1` 和 `file:` 页面，因此本地回环地址上的站点不会产生统计；可通过事件接口验证接入，或使用非回环地址访问站点。
- tinytraffic 使用 DuckDB 单文件存储，同一数据卷只能有一个进程写入；更新或迁移时使用 `stop-first`。

## 对话内创建与发布

用户可在普通对话描述目标，或通过“用对话创建应用”入口只填写目标；不预选 builder，不默认公开或启用计划。普通对话和两种 builder 共享意图指令：复用已有答案，只问下一项影响结果的未知需求，选项表达使用效果。静态和动态统一为 Web 应用，后端按需开通；需要平台 AI、知识库、身份或组织分发时使用 LS 应用。页面和自动化可组合，分别报告页面、数据和提醒状态。卡片显示页面及后端配置；提醒须以实际计划和渠道结果为准。“创建 Web 应用”保留为明确创建并发布的快捷流程。

- 助手先在 `artifacts/<site-name>/` 生成完整静态站点，再用 `register_artifact` 登记 HTML 入口和 `web_root_relative_path`，最后调用 `publish_web_site`。工具返回 `url` 和 `slug`，一次对话即可拿到外链。
- `publish_web_site` 支持带 `site_id` 发布已有站点的新版本；`list_web_sites` 用于在后续任务中查找站点；`update_web_site` 修改名称、简介、slug、发布状态、访问密码和访问统计；`delete_web_site` 只在用户明确要求删除具体站点时使用，须先确认站点名称和公开地址，删除后发布版本、地址和后端绑定一并移除，地址可被他人复用。
- 修改已有动态应用前先查询站点并检查其 `backend_id`，跨对话复用原后端。静态应用增加数据能力时，使用原 `site_id` 和新的 sandbox `backend_id` 发布，保持身份、稳定入口和旧别名。
- 工具只在 `default` 协作模式、当前用户、运行中的轮次内可用。API 内部路由 `/internal/web-sites` 使用 runner shared secret 和 owner header，复用现有 `WebSiteService` 的所有权、来源任务、资源包和 slug 唯一约束；没有新增表或迁移。
- 发布即公开。用户明确要求发布或公开链接才执行；选择交付形态本身不授权发布或启用自动化。已有明确授权不重复确认，不把 LS 交互式应用自动转换或公开。
- 用户只要求预览时保持未发布。动态应用的 HTML 产物仅提供 UI 预览，不能验证实际登录和后端调用；通用 HTML“发布为站点”首次创建不携带动态后端绑定。用户后续可在原对话要求发布，助手复用已准备的 `backend_id` 通过发布工具完成绑定。
- 对话中的站点卡片显示当前发布状态，并提供打开、复制和管理入口。源 HTML 仍可从任务产物预览或下载。刷新对话会根据已有发布记录恢复卡片，无需重新发布。
- 用户可在创建时选择发布后打开，或在对话里明确要求打开。Browser Use 扩展 0.4.6 支持在独立窗口打开当前用户拥有的已发布站点；扩展必须已配对且允许打开新页面。这个动作不会把新窗口交给助手控制。
- 静态站点的 `/web/{slug}` 仍是同域沙箱 iframe，网页不能使用 localStorage、IndexedDB、Cookie、Service Worker 或浏览器通知。需要独立访客账号、持久化数据或接口时使用下节的自部署动态后端；页面关闭后仍须执行的提醒应按现有定时通知工作流另行处理。

## 自部署动态应用

公开创建流程支持可选自部署 Appwrite `2.7.2` 后端。静态页面和新沙箱动态应用共用稳定入口；动态应用仍使用可信外壳、opaque-origin iframe、LinkSenseApp SDK，以及服务端加密的访客会话，提供账号、TablesDB、Storage 和 Node.js 24 HTTP Functions。历史独立 origin 的模式、地址、会话及部署配置保留。平台认证、数据库和运行器职责不变，不使用 Appwrite Cloud。动态后端于 2026-11-15、沙箱及对话与地址增强于 2026-11-17 获准实施。

### 配置与入口

1. 在自有基础设施安装官方 Appwrite，初始化组织与具有该组织 owner 权限的专用管理账号，启用 `node-24` runtime。Appwrite 的 API hostname 必须能从函数执行网络解析并访问，不能把函数容器自己的 `localhost` 当作 API 地址。API、执行器及原生函数域只能从受控网络访问，公众仅访问 LS 应用网关；否则直连原生接口会绕过 LS 停用状态。SMTP、对象存储、备份和监控同样由部署方提供。
2. 配置 `.env.example` 中的 `LINKSENSE_APPWRITE_ENDPOINT`、`LINKSENSE_APPWRITE_ADMIN_EMAIL`、`LINKSENSE_APPWRITE_ADMIN_PASSWORD`。三项是仅 API 使用的管理配置，不下发 Runner、模型或网页。新沙箱应用复用 `LINKSENSE_PUBLIC_BASE_URL`、现有入口和证书，无需新增 DNS、泛域名或证书。仅在仍有历史独立 origin 应用时保留 `LINKSENSE_DYNAMIC_APPS_BASE_URL` 及其原有入口。管理员属于多个组织时，还要指定 `LINKSENSE_APPWRITE_ORGANIZATION_ID`；单组织自动识别。保持密码原有字符，凭据文件和部署配置按现有秘密管理要求保护。
3. 发布工具返回 `<LINKSENSE_PUBLIC_BASE_URL>/app/s/<site-id>`。准备后端时尚无站点，返回的 `/app/<address>` 只是别名；address 可选，3–30 位小写标签，默认后端 UUID 的前 12 位十六进制。改名与配置、发布共用租约，旧别名归属保留、账号和数据不变。历史独立 origin 继续使用 `<backend-host>.<apps-base>`；保持原 DNS、TLS、不同可注册域名和原生平台域名同步规则，不通过改名转换运行模式。
4. 主站网关须把 `/app/` 与 `/web/` 都转发给 API，仓库提供的 Nginx 模板和 Vite 开发代理已包含这两个入口。保留原始 Host（含端口），使用匹配的 `LINKSENSE_PUBLIC_BASE_URL`。历史应用仍可采用 [独立域名 Nginx 配置片段](../../deploy/production/dynamic-apps.nginx.example.conf)，通过 `/api/v1/public-app-gateway/` 转发。两类网关都在平台认证、CORS 和请求体解析前处理，不转发平台令牌或提供管理代理。

三项 Appwrite 管理配置及历史应用 base 全为空时禁用动态能力，静态发布和已有站点管理照常工作；部分配置或不安全的历史应用 URL 会在启动时拒绝。Docker 仅把 Appwrite 管理配置传给 API。

### 沙箱 SDK 与会话边界

后端投影返回 `runtime_mode: sandbox`、`url`、`endpoint` 和 `sdk_url`。生成网页用经典 `<script src="返回的 sdk_url"></script>` 加载 SDK，等待 `LinkSenseApp.ready()`，再通过 `account`、`tables`、`storage`、`functions` 调用当前应用。方法与参数以[内置公开站点 Skill](../../apps/api/src/modules/capabilities/built-in-public-site.ts)为准；数据库固定为 `app`，普通数据操作使用访客会话和 Appwrite 原生资源权限。

可信外壳不允许被嵌入，只允许加载当前应用的发布版本。生成页面始终受 iframe 和资源响应 CSP sandbox 双重限制，不授予 `allow-same-origin`。MessageChannel 绑定具体 iframe，文档导航时关闭旧通道；消息不能选择应用、访客、Project、外部 URL 或管理请求头。RPC 必须来自主站精确 Origin，携带与当前应用、站点及 HttpOnly 访客 Cookie 绑定的加密能力；`Origin: null`、其他访客或其他应用的能力均拒绝。上游错误映射为现有稳定错误码，原生会话/OAuth secret 不返回生成页面。Redis 会话使用原子比较写入，避免并发登录或退出覆盖新会话。

浏览器访客标识与能力最长 30 天；Appwrite 会话仍受自身过期与撤销规则约束。Redis 会话丢失需要访客重新登录，Appwrite 账号、表与文件不受影响。主站 HTTPS 使用 Secure、HttpOnly、SameSite=Lax 和 `__Host-` Cookie；主站使用 HTTP 时仍是明文传输，沙箱不能补足 TLS。平台管理员会话与访客会话分开。

沙箱不提供原生 localStorage、IndexedDB、Service Worker、Realtime、OAuth/SMS 或 SSR；持久化业务数据放入 Appwrite。上传经过受控网关，单文件至多 20 MiB，并受 bucket 更低限制约束；下载以 Blob 返回 iframe，不返回带凭据的直连地址。HTML 产物预览没有可信外壳，SDK 不就绪时应展示明确的本地化预览/错误状态，不能声称已验证后端。

### 生成、发布和维护

- 内置公开站点 Skill 继续使用稳定的能力 ID。`prepare_web_site_backend` 为当前任务创建或恢复稳定后端；同任务同名称重试复用原记录。数据库租约防止多 API worker 并发配置，项目和初始资源使用稳定 ID，失败后可重试配置而不重放 Codex turn。首次发布、替换版本和恢复发布会拒绝仍有效的配置租约；进程中断留下的租约到期后不再阻塞发布。
- 初次开通使用 Appwrite 原生 Console 登录 Cookie，选择所属组织并创建 Project 和项目 key，然后撤销这次五分钟会话。项目密钥仅在服务端加密保存，并绑定后端 ID 的加密上下文。密钥和 Web platform 的 ID 在实例内使用项目 ID，避免第二个应用与第一个冲突。实例加密密钥不是管理 API 凭据。
- `configure_web_site_backend` 支持新建表、列、索引、文件 bucket、HTTP 函数和代码部署，以及读取资源/构建状态。表和 bucket 默认私有并启用行/文件权限。审批等服务端工作流使用 `client_create: false`，由业务函数验证用户、字段和角色后写入，避免客户端直接伪造已批准记录。
- 修改现有表仅开放新增可选列；不提供删表、删列、收紧字段、变更唯一约束或清空数据的工具。索引在新表创建时声明。函数使用打包后的 `.tar.gz` 产物，包含依赖；不运行额外安装命令，构建由 Appwrite 完成，上传不自动替换当前函数。构建就绪后在获准上线时显式调用 `activate_function`，并保留旧 deployment ID 以便恢复；失败草稿不会停用已有版本。发布前检查列、索引已就绪，函数具有可用的激活版本。
- 先准备和验证后端，再通过 `publish_web_site` 的 `backend_id` 发布完整前端；恢复已停用应用时也检查后端就绪状态。更新使用现有 `site_id`，保留后端、访客账号、数据和应用地址。前端发布、函数部署和 schema 变更独立；回退前端不自动恢复函数或数据库。
- 对话卡片、站点列表和复制操作使用实际应用 URL，旧 `/web/{slug}` 入口在权限检查后跳转。Browser Use 沿用已有拥有者检查、扩展权限和独立窗口操作，跳转后打开动态应用，无需改变扩展协议。
- 网页包入口位于子目录时，应用根地址跳转到该入口并保留查询参数，使相对资源路径继续有效；带尾斜杠的目录地址读取该目录的 `index.html`。
- 不要求制作前先命名地址。主地址仅依赖站点 ID，address 与 slug 是可选别名；沙箱代码始终使用 SDK。旧 origin 网页继续从页面 origin 解析 `/appwrite/v1`；改名不会转移该模式的 Cookie/localStorage/IndexedDB。若原生前端写死 endpoint，改名仍需同步发布并处理访客重新登录。
- 改名请求超时或响应丢失时，不能假定 Appwrite 没有执行更新。此时保留新旧地址的归属并把域名标记为待核验；下次读取在租约内检查原生平台的实际域名，只接受当前后端保留的地址并同步映射。不能把失败响应当作已经回滚原生平台的证明。

### 生命周期与限制

公众 API 请求由网关固定 Project，不提供管理 key、管理员模式或跨项目调用。沙箱应用使用上节的服务端访客会话；历史独立 origin 网关只转发当前应用的访客 Cookie/JWT，Cookie 改为 host-only、HttpOnly、SameSite=Lax，HTTPS 下设置 Secure 并使用 `__Host-` 名称前缀，转发到 Appwrite 时还原原生名称。本机 HTTP 原生应用继续使用原生 Cookie 名称。上传文件响应使用不授予脚本或同源能力的沙箱 CSP，不能把用户上传的 HTML/SVG 当作主站脚本执行。

每次页面、资源和 API 请求检查站点发布状态及所有者状态；返回在途后端响应前再次检查。停用、来源任务删除、站点删除或所有者停用会关闭同一网关入口，历史会话也不能继续调用。已经接受执行的操作和已下载数据不能撤回。当前工具只创建无事件、无计划的 HTTP 函数，网关拒绝异步执行，单次函数最多 30 秒。

首版不提供 Realtime、OAuth/SMS、SSR、常驻服务或计划任务托管。每用户最多准备 50 个后端，包含保留资源；单个发布最多检查 100 个表和函数。永久删除站点仍仅删除发布记录，后端账号、数据、文件和密钥映射保留，永久清理需由管理员按明确的数据保留决定执行。网页 ZIP 仍仅包含前端；完整恢复还需要 Appwrite 数据/文件/配置、实例加密密钥和 LS 数据库中的绑定与凭据加密材料。

### 升级与验证

2026-11-17 的稳定地址与原地增强不新增迁移。先更新所有 API，再更新 Runner/Web 与内置 Skill；旧客户端的 `{ file_id }` 继续有效，旧静态、沙箱别名和 origin 应用无需重建。混跑旧 API 时新入口可能 404、原地增强会冲突，不可启用新流程；回退 Web/Runner 时保留支持稳定入口的 API。若必须回退旧 API，需先停止新入口流量并恢复受支持的旧入口，不能声称新稳定链接在旧网关仍可用。

本轮本地验证：API 全量 5,066 项通过；Runner 的普通新建/历史对话、上下文、创建与发布工具相关 290 项通过，启动文本仍在原有 1,300 token 预算内；Web 相关六语言与交互专项 373 项通过；帮助文档 23 项通过。API、Runner、Web 类型检查、lint 和生产构建通过，帮助站中英文构建通过；Web lint 保留两条既有虚拟列表警告。内置 Skill 的生成摘要与旧任务快照刷新测试均通过。

Chrome 通过 6 项专项：普通新建/历史对话不选 Skill 的应用请求提交、桌面和 390px 创建表单及 Axe、稳定入口的 SDK 登录与刷新、上传下载、函数调用、跨应用隔离与撤销。浏览器用 Appwrite 测试替身，不等同于真实模型生成或真实 Appwrite 的端到端验收。隔离 PostgreSQL 测试验证旧记录迁移保留、原地增强、重命名别名、失败事务回滚、竞争绑定与停用。测试基础设施已清理。

Web 全量应用测试仍有与本次无关的 `sidebar.test.tsx:2041` 失败：断言 24 个设置链接，现有隐私脱敏入口加入后实际为 25；未改写该断言。真实模型的自然语言选择质量、真实 Appwrite `2.7.2`、锁屏提醒、专用应用域与自定义域未在本轮验证。未部署、推送或改动生产数据。

沙箱功能须先等待使用旧版 Skill 的在途生成/发布结束，再执行追加迁移 `20261117180000_add_web_site_backend_runtime_mode`，更新全部 API/网关及 Runner/Web 后恢复新应用生成，避免混用两种运行约定。迁移只增加可空 `runtime_mode` 和检查约束：全部历史记录保持 `NULL`，不改变账号、数据、地址或加密凭据；新 API 显式给新记录写入 `sandbox`。已发布独立域名应用不会自动转换，旧 Project key 不增加 scope，访客操作继续通过原生会话完成。保留新列后可回退 API，但回退期间旧二进制不能执行新创建的 SDK 应用；恢复新版后继续使用。不能把旧应用改模式或要求批量重建/重新发布来完成升级。

先执行新增迁移 `20261115000000_add_web_site_backends`，再更新全部 API 实例并配置入口，然后更新 Runner/Web。迁移仅新增后端表、可空绑定字段与新索引，不重建旧站点或修改其原有数据。旧 Web 客户端使用原 `/web/` 入口仍可跳转，旧静态站点不要求重新发布；启用动态应用前应完成全部 API 副本升级。

地址功能还需要依次应用 `20261117120000_add_web_site_backend_host_label`、`20261117160000_reserve_web_site_backend_addresses` 和 `20261117163000_resolve_existing_web_site_backend_hosts`，然后更新全部 API 实例。后两条只增加地址保留表和原生域名核验标记，保留后端项目、账号、数据、文件和加密凭据。历史 `host_label = NULL` 可能来自 UUID 域名版本，也可能来自未持久化短域名的开发版本；首次访问或读取地址时，在租约内读取一次既有 Appwrite Web 平台域名并持久化结果，不修改其原生平台或强制重新发布。首次核验需要 Appwrite 可达；失败会释放租约，恢复后重试即可。不能通过批量截断所有历史 UUID 来完成升级。

`LINKSENSE_TEST_DATABASE_URL=postgresql://.../linksense_backend_addresses_test pnpm --filter @linksense/api exec tsx test/integration/web-site-backend-addresses-postgres.ts` 使用显式指定的、空的本机测试数据库验证升级和地址竞争，不需要 Appwrite；脚本拒绝非本机或已有表的数据库。真实 Appwrite 的完整验证仍使用下方脚本。

从本功能早期开发版本升级时，共用 LS 控制台或 Appwrite 管理端可注册域名的应用配置会被拒绝，需在部署前选择隔离域名。HTTPS 下原先没有 `__Host-` 前缀的访客 Cookie 不再接受，访客重新登录即可恢复；账号、数据和文件保留。本机 HTTP 会话格式不变。

`apps/api/test/integration/web-site-backends-appwrite.ts` 使用已有的、本机测试专用 Appwrite 实例，并创建可自动清理的 PostgreSQL/Redis。测试凭据通过权限受限 JSON 文件引用传入，不读取项目 `.env`，不向命令行或日志写入密码/密钥。文件包含 `endpoint`、`email`、`password`，endpoint 必须是本机地址，组织应已初始化。

```sh
LINKSENSE_TEST_APPWRITE_CREDENTIALS_FILE=/path/to/private/test-operator.json \
  pnpm --filter @linksense/api exec tsx test/integration/web-site-backends-appwrite.ts
```

`--serve` 可保留样例供浏览器验证；输出的 fixture 文件含虚构测试账号，权限为 `0600`，中断后随测试目录清理。测试覆盖旧 schema 升级与静态站点继续使用、真实开通与访客会话、私有记录、并发唯一性、审批函数、更新保留数据、停用/恢复及所有者停用。测试结果以实际执行记录为准；这些检查不代替生产容量、容器对抗隔离、邮件投递或备份恢复验收。

## 网页包

运行器的 `register_artifact` 增加可选 `web_root_relative_path`，明确指定任务工作区内专门用于公开的目录；`workspace_relative_path` 指向其中的 HTML 入口。例如：

```json
{
  "workspace_relative_path": "artifacts/journal/index.html",
  "web_root_relative_path": "artifacts/journal",
  "display_name": "山海集.html",
  "mime_type": "text/html"
}
```

运行器会整理目录的共享读取权限。API 在登记任务产物时保存目录快照及校验清单，网站发布引用不可变快照，不依赖运行器或原始文件继续存在。

使用现有对象存储接口，兼容生产 MinIO 和开发环境文件存储。新增直接依赖复用工作区已有版本：parse5 处理 HTML，PostCSS 与 postcss-value-parser 处理 CSS，es-module-lexer 处理模块引用，srcset 处理响应式图片，mime-types 确定响应类型；ZIP 使用已有 JSZip，并发上传使用已有 p-limit。

- 支持 HTML、CSS、JS/MJS、JSON、常见图片/字体/音视频、Wasm、文本、CSV、PDF。
- 保持目录结构；转换 HTML、CSS 和可静态识别的模块根路径引用，检查本地依赖是否齐全。HTML 输出统一 UTF-8。
- 运行时拼接的 URL、`fetch()` 参数等应由网页使用相对路径。前端项目需要先构建成静态输出。
- 外部 HTTPS 资源保留为浏览器请求，不在服务端抓取。外部服务可用性和 CORS 限制仍适用。
- 限制为 500 个文件、单文件 20 MiB、合计 50 MiB、目录深度 20。拒绝整个工作区、符号链接、隐藏文件、node_modules、源码和 source map。
- 单个自包含或仅引用外部资源的历史 HTML 可以直接发布；历史记录没有保存的本地配套文件，需要回到原任务重新登记完整网页包。

## 同域脚本隔离

`/web/{slug}` 是平台生成的简单展示外壳。网页实际位于沙箱 iframe 内，允许脚本但不授予 `allow-same-origin`。所有资源响应同时设置 CSP sandbox，直接打开 HTML 或 SVG 地址也不获得主应用同源权限。模块、字体和数据资源使用无凭据的匿名 CORS。

公开入口、发布版本资源及错误页允许被 iframe 嵌入，不下发 `X-Frame-Options` 或 CSP `frame-ancestors` 限制。公开路由在全局响应头处理之后移除继承的 `X-Frame-Options`；管理接口仍使用主应用的响应头。已有发布版本直接生效，无需重新发布，也不涉及存储结构或数据库迁移。

网页不能读取平台 Cookie/localStorage、父页面或注册 Service Worker。此功能托管静态网页与浏览器交互，不运行服务端程序，不代理平台登录态或提供跨站表单提交权限。依赖持久化同源存储、服务端接口或单页路由服务器回退的应用需要另外适配。

## 存储与删除

新增四张无外键的表：`web_artifact_bundles`、`web_sites`、`web_site_addresses`、`web_site_releases`。仅新增表和索引，保留现有任务与文件结构，不执行历史数据清理。

删除站点会停止访问并清除发布版本，原任务和原始产物不受影响。删除任务遵循现有产物保留策略，同时将对应站点停用并清空来源任务关联，站点管理记录和已保存资源仍可由所有者下载。保留的目录快照属于原始产物，其原任务 ID 仅用于追溯。

## 部署和验证

跨任务更新验证（2026-09-17）：前端站点及资料库相关 51 项测试、API 站点相关 31 项测试通过，前后端相关 ESLint 和类型检查通过。隔离 PostgreSQL/Redis 集成脚本验证了从其他任务登记完整网页包后替换原站点、保持链接和元数据、来源归属更新、双侧所有权、失败不切换版本、旧任务删除隔离，以及原任务已删除的站点重新关联新来源后仍保持未发布。此次 UI 调整未运行浏览器自动验证。

按项目正常发布流程执行 `pnpm db:migrate:deploy`，更新 API、Runner、Web 及 Nginx。Nginx 的 `/web/` 路由优先于静态资源和 SPA 路由，转发到 API，并保留 API 的网页专用 CSP。最终用户无需配置域名。

相关验证：

```sh
pnpm --filter @linksense/shared test tests/web-sites.test.ts tests/audit-i18n.test.ts
pnpm --filter @linksense/api exec vitest run test/web-sites.resources.test.ts test/web-sites.service.test.ts test/web-sites.routes.test.ts test/files.service.test.ts test/conversations.service.test.ts
pnpm --filter @linksense/runner exec vitest run test/web-site-registration.test.ts test/file-service-server.test.ts test/event-sink.test.ts test/process-pool.test.ts
pnpm --filter @linksense/web exec vitest run src/features/web-sites/web-sites.test.tsx src/features/task-artifacts/task-artifact-library.test.tsx
node --test scripts/web-sites-deployment.test.mjs
pnpm --filter @linksense/api exec tsx test/integration/web-sites-postgres.ts
```

集成脚本自动创建和清理独立 PostgreSQL/Redis 容器，验证旧数据升级、真实登记与存储、所有权、并发创建、发布更新、停用、恢复、地址修改、下载和删除。`--serve` 可保留测试应用供浏览器验证，监听 API 19541，前端代理目标使用该端口并在 19542 启动；临时登录资料仅写入系统临时目录的权限受限文件。

### 2026-09-17 验证记录

- API 相关 5 个测试文件共 440 项通过；Shared 24 项通过；Runner 文件服务、事件转发共 35 项和产物登记/任务隔离回归 3 项通过。
- 最终界面及共用弹窗回归 63 项通过，包含中英文文案、关闭、表单校验、重复地址错误、更新版本、取消/重新发布、删除，以及未发布站点的更新提示。
- API、Runner、Web 类型检查通过；新增模块和最终界面 ESLint 通过；API、Runner 和 Web 构建通过。Web 构建保留现有大资源分块提示。
- 隔离 PostgreSQL/Redis 集成验证通过：旧任务/文件记录迁移前后保持一致，真实目录登记、版本快照、所有权与匿名访问、并发发布、资源撤销、删除原任务后保留站点下载。
- 实际浏览器验证了网页 JS 交互、CSS、图片、字体、模块与 JSON、中文子页面、沙箱隔离、从任务产物发布、地址修改、更新、取消/重新发布、ZIP 下载和删除。工具栏文字与图标均为 12px；390×844 视口下弹窗宽 358px、左右留边 16px，无横向溢出。更矮视口切换的即时检查未完成稳定状态复核；截图捕获超时，未形成截图对比记录。
- 首次功能验证未执行现有开发/生产数据库迁移，也未部署生产服务；测试基础设施已清理。

## 永久删除修复验证

- API 站点仓储、服务、路由、资源与任务删除相关单元测试共 336 项通过；前端站点交互与中英文文案测试 20 项通过，相关 ESLint 和前后端类型检查通过。
- 隔离 PostgreSQL/Redis 测试验证历史软删除记录清理、已发布/取消发布站点升级后的访问与管理、本人及其他用户复用地址、历史地址释放、并发发布唯一性、已删除版本不可访问，以及任务删除和跨任务更新回归。
- 已在当前本地开发库应用 `20260918020000_hard_delete_web_sites`，清理原有一条已删除的 `test` 站点记录。确认 `test` 的站点记录与地址占用均为零，无孤立地址、孤立发布版本或过时的软删除字段。
- 本地 API 镜像重新构建并启动，使用更新后的 Prisma 客户端，服务就绪检查通过。未部署生产环境，未进行浏览器自动验证。

扩展回归中发现工作区其他应用开发改动仍有 3 项失败：`src/i18n.test.ts` 中的应用开发文案术语、Runner 的 `core-service-registry.test.ts` 模块清单，以及 `process-pool.test.ts` 的应用开发用例重复使用已关闭的进程池。本次未修改这些业务行为或跳过断言，不能据此宣称整个工作区全量回归通过。
