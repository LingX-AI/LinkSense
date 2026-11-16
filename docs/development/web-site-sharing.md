# 发布为站点与我的站点

“发布为站点”入口位于已登记 HTML 任务产物的预览工具栏。资料库新增“我的站点”，支持搜索、按状态筛选、访问、复制链接、编辑名称/简介/地址、发布新版本、取消发布/重新发布、下载完整 ZIP 和删除站点。

## 地址与访问

- 访问地址使用部署已有域名的 `/web/{slug}`，默认生成 UUID，也可设置 3–80 位小写字母、数字和连字符。
- 分享无需访客登录。管理接口 `/api/v1/web-sites` 使用现有 JWT 验证和服务端所有权检查。
- 修改地址后原链接立即失效，历史地址保留至站点删除。
- 删除站点会在同一事务中永久移除站点、全部发布版本与全部地址占用记录，保留操作审计和原任务文件。原用户及其他用户均可重新使用地址，新建站点拥有新的 ID 和发布版本，已删除版本的资源地址不会恢复。取消发布仍保留地址占用。

迁移 `20260918020000_hard_delete_web_sites` 会永久清理之前软删除的站点、发布版本及地址记录，并移除 `deleted_at` 字段；保留所有未删除站点（包括取消发布的站点）、任务和原文件。此数据删除由用户明确要求。部署时应停止旧版 API 写入，应用迁移后启动使用新 Prisma 客户端的 API；旧版 API 依赖已移除的字段，不能与新版混跑。
- 每个 HTML 产物重复提交创建请求会返回已有站点；数据库事务串行化来源任务写入，并用地址唯一约束处理竞争。
- 更新发布保留站点地址，只在资源校验通过后切换当前版本。未发布的站点更新内容不会自动重新发布。
- 停用、删除或账号停用后，入口与所有版本的资源地址均不可访问。资源逐次检查状态，浏览器和代理不缓存分享响应。

## 更新已有站点

发布弹窗使用统一单选器选择“新建站点”或“更新已有站点”，默认选中新建站点，下方展示对应表单；更新时未选择目标不能提交。更新目标的搜索和分页位于下拉选择器内，先展示当前任务的站点，再展示其他任务的站点，仅包含当前用户拥有的未删除站点。选中目标后展示已有链接，不修改名称、简介或地址。

`POST /api/v1/web-sites/:id/releases` 仍接受 `{ file_id }`。服务端先验证目标站点所有权，再按文件实际所属任务验证来源所有权与完整资源包；成功后，在同一事务中创建版本并更新站点的当前版本、来源任务、任务名称和源文件。原站点 ID、链接、元数据与发布状态保持不变，资源或权限校验失败时原版本继续可用。

跨任务更新后，“我的站点”的来源链接及后续更新文件列表指向新任务。删除旧任务不会停用已转移的站点；删除新来源任务仍按现有规则停用站点。原任务已删除的保留站点也可选择新任务的 HTML 更新内容，但保持未发布状态。此次调整无数据库迁移，不改变既有发布接口格式，已发布站点无需重新创建或重新发布。

## 对话内创建与发布

普通任务中的助手可以使用内置 `linksense-public-site` Skill，把静态网页成果直接发布为公开站点，而不经过任务产物预览工具栏。Skill 与 `linksense-interactive-app-builder` 平级；需要 LinkSense AI、任务、知识库、文件、插件或组织分发时仍使用后者。

- 助手先在 `artifacts/<site-name>/` 生成完整静态站点，再用 `register_artifact` 登记 HTML 入口和 `web_root_relative_path`，最后调用 `publish_web_site`。工具返回 `url` 和 `slug`，一次对话即可拿到外链。
- `publish_web_site` 支持带 `site_id` 发布已有站点的新版本；`list_web_sites` 用于在后续任务中查找站点；`update_web_site` 只修改名称、简介、slug 或发布状态。
- 工具只在 `default` 协作模式、当前用户、运行中的轮次内可用。API 内部路由 `/internal/web-sites` 使用 runner shared secret 和 owner header，复用现有 `WebSiteService` 的所有权、来源任务、资源包和 slug 唯一约束；没有新增表或迁移。
- 发布即公开。助手只在用户明确要求公开站点或通过 `request_user_form` 选择公开站点后调用；不会把交互式应用自动转换或公开。
- 对话中的站点卡片显示当前发布状态，并提供打开、复制和管理入口。源 HTML 仍可从任务产物预览或下载。刷新对话会根据已有发布记录恢复卡片，无需重新发布。
- 用户可在创建时选择发布后打开，或在对话里明确要求打开。Browser Use 扩展 0.4.6 支持在独立窗口打开当前用户拥有的已发布站点；扩展必须已配对且允许打开新页面。这个动作不会把新窗口交给助手控制。
- 当前 `/web/{slug}` 仍是同域沙箱 iframe，网页不能使用 localStorage、IndexedDB、Cookie、Service Worker 或浏览器通知。需要持久化或提醒的站点应改用 LinkSense 应用或外部后端；Skill 必须如实说明这一限制。

## 自部署动态应用

公开创建流程支持可选 Appwrite 后端，当前适配固定版本 `2.7.2`。普通静态站点继续使用原有 `/web/{slug}` 沙箱；新动态站点在独立应用 origin 托管前端，通过同源 `/appwrite/v1` 使用自己的访客账号、TablesDB、Storage 和 Node.js 24 HTTP Functions。LinkSense 平台认证、Prisma 数据库与运行器职责不变。此路线于 2026-11-15 获准实施，不使用 Appwrite Cloud。

### 配置与入口

1. 在自有基础设施安装官方 Appwrite，初始化组织与具有该组织 owner 权限的专用管理账号，启用 `node-24` runtime。Appwrite 的 API hostname 必须能从函数执行网络解析并访问，不能把函数容器自己的 `localhost` 当作 API 地址。API、执行器及原生函数域只能从受控网络访问，公众仅访问 LS 应用网关；否则直连原生接口会绕过 LS 停用状态。SMTP、对象存储、备份和监控同样由部署方提供。
2. 配置 `.env.example` 中的 `LINKSENSE_APPWRITE_ENDPOINT`、`LINKSENSE_APPWRITE_ADMIN_EMAIL`、`LINKSENSE_APPWRITE_ADMIN_PASSWORD`、`LINKSENSE_DYNAMIC_APPS_BASE_URL`。前三项是仅 API 使用的管理配置，不下发 Runner、模型或网页。管理员属于多个组织时，还要指定 `LINKSENSE_APPWRITE_ORGANIZATION_ID`；单组织自动识别。保持密码原有字符，凭据文件和部署配置按现有秘密管理要求保护。
3. 应用 base URL 使用自有域，如 `https://apps.example.net`，配置通配 DNS 和证书。公开应用必须与 LS 控制台及 Appwrite 管理端使用不同的可注册域名，不能只使用同一域名的不同子域；服务启动时使用公共后缀规则校验，避免公开页面通过父域 Cookie 影响管理端。每应用地址为 `https://<backend-id>.apps.example.net`；本地可用 `http://apps.localhost:<api-port>`。修改 base URL 会改变所有动态应用地址及浏览器 origin，不能当作普通重命名操作。
4. 生产域可采用 [Nginx 配置片段](../../deploy/production/dynamic-apps.nginx.example.conf)，通过现有 LS 网关端口的 `/api/v1/public-app-gateway/` 转发到 API，保留原始 Host。也可在受控网络直接转发全部路径到 API。应用主机空间在平台认证、CORS 和请求体解析前被处理，不能通过该域访问平台 API；平台域也不提供应用后端管理代理。

四个必填配置全为空时禁用动态能力，静态发布和已有站点管理照常工作；部分配置或不安全的应用 URL 会在启动时拒绝。Docker 仅把 Appwrite 管理配置传给 API。

### 生成、发布和维护

- 内置公开站点 Skill 继续使用稳定的能力 ID。`prepare_web_site_backend` 为当前任务创建或恢复稳定后端；同任务同名称重试复用原记录。数据库租约防止多 API worker 并发配置，项目和初始资源使用稳定 ID，失败后可重试配置而不重放 Codex turn。首次发布、替换版本和恢复发布会拒绝仍有效的配置租约；进程中断留下的租约到期后不再阻塞发布。
- 初次开通使用 Appwrite 原生 Console 登录 Cookie，选择所属组织并创建 Project 和项目 key，然后撤销这次五分钟会话。项目密钥仅在服务端加密保存，并绑定后端 ID 的加密上下文。密钥和 Web platform 的 ID 在实例内使用项目 ID，避免第二个应用与第一个冲突。实例加密密钥不是管理 API 凭据。
- `configure_web_site_backend` 支持新建表、列、索引、文件 bucket、HTTP 函数和代码部署，以及读取资源/构建状态。表和 bucket 默认私有并启用行/文件权限。审批等服务端工作流使用 `client_create: false`，由业务函数验证用户、字段和角色后写入，避免客户端直接伪造已批准记录。
- 修改现有表仅开放新增可选列；不提供删表、删列、收紧字段、变更唯一约束或清空数据的工具。索引在新表创建时声明。函数使用打包后的 `.tar.gz` 产物，包含依赖；不运行额外安装命令，构建由 Appwrite 完成，上传不自动替换当前函数。构建就绪后在获准上线时显式调用 `activate_function`，并保留旧 deployment ID 以便恢复；失败草稿不会停用已有版本。发布前检查列、索引已就绪，函数具有可用的激活版本。
- 先准备和验证后端，再通过 `publish_web_site` 的 `backend_id` 发布完整前端；恢复已停用应用时也检查后端就绪状态。更新使用现有 `site_id`，保留后端、访客账号、数据和应用地址。前端发布、函数部署和 schema 变更独立；回退前端不自动恢复函数或数据库。
- 对话卡片、站点列表和复制操作使用实际应用 URL，旧 `/web/{slug}` 入口在权限检查后跳转。Browser Use 沿用已有拥有者检查、扩展权限和独立窗口操作，跳转后打开动态应用，无需改变扩展协议。
- 网页包入口位于子目录时，应用根地址跳转到该入口并保留查询参数，使相对资源路径继续有效；带尾斜杠的目录地址读取该目录的 `index.html`。

### 生命周期与限制

公众 API 请求由网关固定 Project，并拒绝管理 key、管理员模式、跨项目参数及外部 Origin。只转发当前应用的访客 Cookie/JWT；Cookie 改为 host-only、HttpOnly、SameSite=Lax，HTTPS 下设置 Secure 并使用 `__Host-` 名称前缀，防止其他应用通过父域 Cookie 注入会话；网关向 Appwrite 转发时还原原生名称。本机 HTTP 开发使用原生 Cookie 名称。上传文件的响应使用不授予脚本或同源能力的沙箱 CSP，不能把用户上传的 HTML/SVG 当作应用脚本执行。

每次页面、资源和 API 请求检查站点发布状态及所有者状态；返回在途后端响应前再次检查。停用、来源任务删除、站点删除或所有者停用会关闭同一网关入口，历史会话也不能继续调用。已经接受执行的操作和已下载数据不能撤回。当前工具只创建无事件、无计划的 HTTP 函数，网关拒绝异步执行，单次函数最多 30 秒。

首版不提供 Realtime、OAuth/SMS、SSR、常驻服务或计划任务托管。每用户最多准备 50 个后端，包含保留资源；单个发布最多检查 100 个表和函数。永久删除站点仍仅删除发布记录，后端账号、数据、文件和密钥映射保留，永久清理需由管理员按明确的数据保留决定执行。网页 ZIP 仍仅包含前端；完整恢复还需要 Appwrite 数据/文件/配置、实例加密密钥和 LS 数据库中的绑定与凭据加密材料。

### 升级与验证

先执行新增迁移 `20261115000000_add_web_site_backends`，再更新全部 API 实例并配置入口，然后更新 Runner/Web。迁移仅新增后端表、可空绑定字段与新索引，不重建旧站点或修改其原有数据。旧 Web 客户端使用原 `/web/` 入口仍可跳转，旧静态站点不要求重新发布；启用动态应用前应完成全部 API 副本升级。

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
