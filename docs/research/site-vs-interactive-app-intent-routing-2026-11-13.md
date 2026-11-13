# 公开站点与交互式应用：意图分流现状、缺口与改造方案

调研日期：2026-11-13（Asia/Shanghai）。仓库：本地 `main` 工作树（`81dc5699`，产品代码无改动）。第 1–8 节记录当前代码行为与缺口；第 9–15 节给出方案比较、推荐改造、实施与验收清单。文中路径均相对仓库根目录，行号以当前工作树为准。本次只做静态阅读，未运行测试、未启动服务、未修改产品代码。

引用简写约定：同一小节重复出现的 `routes.ts`、`service.ts`、`repository.ts`、`artifact-resources.ts`、`bundle.ts`、`resources.ts` 均指 `apps/api/src/modules/web-sites/` 下的同名文件；`built-in-application-builder.ts`、`user-home-materializer.ts` 指 `apps/api/src/modules/capabilities/`；`application-create-dialog.tsx`、`application-catalog-panel.tsx`、`task-artifact-preview.tsx` 指 `apps/web/src/features/applications/` 与 `apps/web/src/features/task-artifacts/` 下的同名文件；`interactive-form-service.ts` 指 `apps/runner/src/mcp/core-services/`，`interactive-form-instructions.ts` 指 `apps/runner/src/`；`application-development.ts` 指 `packages/shared/src/`。

## 1. 一句话结论

公开站点管线和交互式应用管线都已完整存在，但两者之间没有“根据一句自然语言选择管线”的路由层：与创建相关的助手侧能力只有 `linksense-interactive-app-builder` 与 `linksense-file-service` 两个 Skill（`linksense-docs` 只提供文档检索，不创建站点），其中只有 File Service 会把 HTML 登记为可发布产物；公开站点的产品内入口只有已登记 HTML 产物的预览工具栏，且交互式应用包不会进入这条产物/发布链路。

## 2. 两条管线对照

| 维度 | 公开站点（web site） | 交互式应用（interactive app） |
| --- | --- | --- |
| 产物 | 已登记的 `conversation_files` HTML 产物；可选 `WebArtifactBundle` 目录快照（`apps/api/src/modules/files/service.ts:1029-1061`） | 交互式应用包：`manifest.json` + `index.html` + 资源目录（`apps/api/src/modules/applications/interactive-package.ts:83`）；由应用开发工程安装为 `applications` 版本 |
| 运行时 | 无服务端程序；API 只按 manifest 读对象存储并返回静态字节（`apps/api/src/modules/web-sites/artifact-resources.ts:29-44`） | 依赖 LinkSense 运行时票据与 SDK；页面从 `/api/v1/interactive-app-runtime/{ticket}/index.html` 加载（`apps/api/src/modules/applications/routes.ts:149-171`，`apps/api/src/modules/applications/routes.ts:382-413`） |
| 对内地址 | `/web/{slug}`（`apps/api/src/modules/web-sites/service.ts:62`） | `/applications/{applicationId}/run/{conversationId}`（`apps/web/src/App.tsx:420-425`），以及短时 `runtime_url` |
| 对外分发 | 任何拿到 `/web/{slug}` 的人可直接访问，无需登录（`apps/api/src/modules/web-sites/routes.ts:61-102`） | 安装在“我的应用”内使用；组织共享/应用中心授权后可被他人安装或使用；外部接入是 iframe 聊天页（`apps/api/src/modules/application-embed/routes.ts:177-236`） |
| 访问控制 | 公开读；管理接口 JWT + 服务端 owner 校验（`apps/api/src/modules/web-sites/routes.ts:22-47`） | 平台账号；运行票据；外部接入按 `app_id`、允许 origin、`required/public` 认证模式（`packages/shared/src/application-embed.ts:13-16`，`apps/api/src/modules/application-embed/service.ts:393-457`） |
| AI / 任务依赖 | 无；静态页面不能调用 LinkSense 运行时 | 有；Skill 要求加载 SDK 并通过 SDK 提交真实任务（`apps/api/src/modules/capabilities/built-in-application-builder.ts:52-54`） |
| 浏览器边界 | 同源 `/web/{slug}` 外壳 + 沙箱 iframe，无 `allow-same-origin`；资源响应也带 CSP sandbox（`apps/api/src/modules/web-sites/routes.ts:49-59,89,100`） | 运行时路由明确移除 CSP/`X-Frame-Options`，把交互式包当作可信 Web 应用运行（`apps/api/src/modules/applications/routes.ts:385-392`） |
| 版本/生命周期 | `WebSite` + 版本化 `WebSiteRelease`（发布后无更新路径），发布新版本切换 `currentReleaseId`；停用/重发/删除（`prisma/schema.prisma:1461-1502`，`apps/api/src/modules/web-sites/repository.ts:118-139`） | 开发工程 → 预览 → 发布安装版本 → 组织共享/应用中心 → 手动安装（`apps/api/src/modules/capabilities/built-in-application-builder.ts:140-159`，`docs/development/application-distribution.md:5,30-32`） |

## 3. 公开站点管线：端到端现状

### 3.1 登记与快照

- 运行器的 `register_artifact` 可选 `web_root_relative_path`；`workspace_relative_path` 是其中的 HTML 入口（`apps/runner/src/mcp/core-services/file-service.ts:17-24,273-289`）。Runner 会先整理该目录的共享读取权限，再把请求转发给 API（`apps/runner/src/mcp/core-services/file-service.ts:90-110`）。
- API 在登记产物时，如果收到 `webRootRelativePath` 且产物 MIME 为 `text/html`，调用 `captureWebBundle` 生成并上传完整目录快照；快照写入 `WebArtifactBundle.manifestJson`（`apps/api/src/modules/files/service.ts:1029-1034,1061`）。
- 捕获逻辑拒绝工作区外路径、符号链接、隐藏文件、`node_modules`、超过 1000 个目录项和深度 20；文件上限由 `webBundleLimits` 控制为 500 个文件、单文件 20 MiB、合计 50 MiB（`apps/api/src/modules/web-sites/bundle.ts:18,24-39`，`packages/shared/src/web-sites.ts:51-71`）。资源扩展名有白名单（`apps/api/src/modules/web-sites/resources.ts:14`）。
- 快照对象键为 `web-artifact-bundles/{fileId}/{path}`（`apps/api/src/modules/web-sites/bundle.ts:68`），发布引用的是这份不可变快照，不依赖 Runner 或原文件继续存在（`docs/development/web-site-sharing.md:38`）。
- 历史单文件 HTML 没有快照时，发布回退为只含 `index.html` 的单文件 manifest（`apps/api/src/modules/web-sites/artifact-resources.ts:12-21`）。若 HTML 引用了不存在的本地资源，发布校验会以 `WEB_SITE_RESOURCES_MISSING` 失败（`apps/api/src/modules/web-sites/service.ts:50-55`，`apps/api/src/modules/web-sites/resources.ts:59-61`）。
- 站点没有用户提供的 manifest；`WebBundleManifest` 由服务端在登记时生成（`apps/api/src/modules/web-sites/bundle.ts:72`），发布只接收 `file_id`（`packages/shared/src/web-sites.ts:19`）。

### 3.2 管理 API

全部挂在 `/api/v1/web-sites`，插件级 `preHandler` 使用现有 JWT 认证（`apps/api/src/app.ts:547`，`apps/api/src/modules/web-sites/routes.ts:22-23`）：

| 方法与路径 | 行为 | 代码 |
| --- | --- | --- |
| `GET /` | 仅列当前用户站点；支持 search、status、conversation_id、origin_file_id、cursor、limit | `routes.ts:24-34`，`repository.ts:15-33` |
| `POST /` | 创建站点；body 为 `conversation_id`、`file_id`、`name`、`description`、可选 `slug` | `routes.ts:35`，`packages/shared/src/web-sites.ts:6-12` |
| `PATCH /:id` | 修改名称/简介/slug/status；至少一个字段 | `routes.ts:36`，`packages/shared/src/web-sites.ts:13-18` |
| `POST /:id/releases` | 接受 `{ file_id }`，创建新发布版本并切换当前版本 | `routes.ts:37`，`packages/shared/src/web-sites.ts:19` |
| `GET /:id/sources` | 列来源任务中的 HTML 产物（最多 200） | `routes.ts:38`，`repository.ts:64-73` |
| `GET /:id/download` | 下载当前版本完整 ZIP | `routes.ts:39-42`，`service.ts:42-49` |
| `DELETE /:id` | 硬删除站点、全部版本和全部地址占用，不删除原任务资源 | `routes.ts:43-46`，`repository.ts:129-139` |

### 3.3 slug 与公开 URL

- slug 校验：去空格并转小写，3–80 位，正则为 `^[a-z0-9]+(?:-[a-z0-9]+)*$`（`packages/shared/src/web-sites.ts:3-4`）。
- 未提供 slug 时服务端使用 `randomUUID()` 作为默认 slug（`apps/api/src/modules/web-sites/service.ts:22`）。
- `WebSite.slug` 有唯一约束；`WebSiteAddress.slug` 是主键，用于在站点存在期间占用历史地址（`prisma/schema.prisma:1470,1482-1491`）。修改 slug 时先检查占用，再新增地址记录并更新站点 slug（`repository.ts:97-115`）。旧地址记录保留，但站点不再以旧 slug 匹配，因此旧链接立即失效。
- 公开入口是 `GET /web/:slug` 与 `GET /web/:slug/`；返回一个内嵌沙箱 iframe 的 HTML 外壳，iframe `src` 为 `/web/{slug}/_releases/{releaseId}/{entry_path}`（`routes.ts:87-94`，`service.ts:32-36`）。`url_path` 在投影中固定为 `/web/{slug}`（`service.ts:62`）。
- 资源地址是 `GET /web/:slug/_releases/:releaseId/*`（`routes.ts:95-102`）。资源按 manifest 精确匹配文件名；只有以 `/` 结尾的路径会补 `index.html`（`artifact-resources.ts:29-32`）。没有 SPA history 回退，也没有目录列表。
- 某个 releaseId 只要属于该站点且站点仍为 `published`、owner 账号仍为 `active`，旧版本资源地址就仍可读；`publicSite` 不要求 releaseId 等于 `currentReleaseId`（`repository.ts:41-50`）。

### 3.4 公开访问、隔离与缓存

- 公开路由没有认证 hook（`routes.ts:61-103`）；管理接口才要求 JWT（`routes.ts:22-23`）。
- 入口外壳 CSP 为 `default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'`（`routes.ts:93`）。真正网页在 iframe 中，sandbox 为 `allow-scripts allow-modals allow-downloads allow-forms`，不含 `allow-same-origin`（`routes.ts:49,89`）。
- 资源响应带 `sandbox ...`、`default-src 'none'`、`script-src 'unsafe-inline' 'unsafe-eval' https: {origin}/web/`、`connect-src https: {origin}/web/` 等 CSP，并额外设置 `access-control-allow-origin: *`、`cross-origin-resource-policy: cross-origin`（`routes.ts:50-58,98-101`）。iframe 无 `allow-same-origin`，网页无法读取平台 Cookie/localStorage。
- 公开路由移除继承的 `X-Frame-Options`，并在 `onRequest` 设置 `cache-control: no-store`、`referrer-policy: no-referrer`、`x-content-type-options: nosniff`、`x-robots-tag: noindex, nofollow`（`routes.ts:63-72`）。
- 站点 `status` 只有 `published | disabled`（`packages/shared/src/web-sites.ts:5`）。`publicSite` 只匹配 `published`，并检查 owner 账号 `active`（`repository.ts:41-45`）。创建时直接写入 `status: "published"`（`repository.ts:85-89`），没有草稿状态。
- 删除来源任务会把关联站点改为 `disabled` 并清空 `conversationId`（`apps/api/src/modules/conversations/deletion.ts:135`）。取消发布通过 `PATCH status`，保留站点、版本和地址占用；重新发布也走同一接口（`repository.ts:97-115`，`docs/development/web-site-sharing.md:10,15`）。

### 3.5 所有权与更新

- 管理接口按 `ownerId` 查询和加锁（`repository.ts:35-39,146-155`）。
- 创建时校验来源任务属于当前用户、文件是 `kind=artifact`、`status=registered`、可下载且为 HTML（`repository.ts:53-62,146-151`）。同一 owner + 同一 `originFileId` 重复创建会返回已有站点（`repository.ts:78-83`）。
- 更新发布先校验目标站点 owner，再按文件实际所属任务校验来源 owner 和完整资源包；成功后在同一事务中新建 release 并更新 `currentReleaseId`、来源任务和源文件（`service.ts:25-29`，`repository.ts:118-127`）。失败不切换当前版本。
- 地址冲突由 `WebSiteAddress.slug` 主键和 `WebSite.slug` 唯一约束兜底，Prisma P2002 转成 `WEB_SITE_SLUG_TAKEN`（`repository.ts:102-104,156-158`）。

### 3.6 部署入口

- API 注册 `/api/v1/web-sites` 与 `/web`（`apps/api/src/app.ts:547-548`）。
- 网关把 `^~ /web/` 优先转发给 API，并加 `Cache-Control: no-store`；开发网关、生产网关、release 网关都有该规则（`deploy/nginx/default.conf.template:93-108`，`deploy/nginx/production-gateway.conf.template:82-97`，`deploy/release/gateway.conf.template:55-65`）。
- Vite 开发代理同样把 `/web` 指向 API（`apps/web/vite.config.ts:118-131`）。
- 公开站点没有独立域名、独立 origin 或自定义域名映射；所有站点共享 LinkSense 主 origin 下的 `/web/` 路径。

### 3.7 与既有文档核对

- `docs/development/web-site-sharing.md:7-15,38,46,51-55,61,67` 的描述与代码一致：默认 UUID slug、无需登录、管理 JWT、改 slug 旧链接失效、删除站点释放地址、500/20MiB/50MiB 限制、沙箱 iframe、任务删除停站、nginx `/web/`。
- 唯一需要按完整前缀理解的是资源路径：文档写“资源位于 `/_releases/{releaseId}/...`”，实际完整路径是 `/web/{slug}/_releases/{releaseId}/...`（`service.ts:35`）。
- `docs/research/appwrite-site-auth-database-feasibility-2026-11-13.md:23-30` 的现状表与代码一致；它指出的“只分发静态资源、无 SPA history 回退、无 `allow-same-origin`、`connect-src` 允许 HTTPS、停站后资源拒绝访问”均可在上述代码中核实。
- `docs/development/html-preview-resources.md:35` 说“发布仍拒绝不完整资源包”，与发布前的入口资源校验一致（`service.ts:50-55`，`resources.ts:59-61`）。

## 4. 交互式应用管线：端到端现状

### 4.1 创建与开发

- 内置 Skill 名为 `linksense-interactive-app-builder`（`packages/shared/src/application-development.ts:7`），描述为“创建/修改/调试 LinkSense 交互式应用，带有自动更新预览和发布按钮；用户想要可复用的 LinkSense 应用，而不是一次性 HTML 插图或对应用开发的解释时使用”（`apps/api/src/modules/capabilities/built-in-application-builder.ts:11-13`）。
- 该 Skill 允许隐式调用（`built-in-application-builder.ts:171-172`）。它要求先调用 `inspect_application_development`；没有工程时调用 `open_application_development`，由平台创建 starter 并在聊天旁打开预览（`built-in-application-builder.ts:18-23`）。
- 开发目录必须是可运行静态产物，含 `manifest.json` 和 `index.html`（`built-in-application-builder.ts:22-23`；包校验见 `apps/api/src/modules/applications/interactive-package.ts:83`）。页面必须从 `/api/v1/interactive-app-runtime/sdk/v1.js` 加载 SDK 并 `await window.LinkSense.ready()`（`built-in-application-builder.ts:52-54`）。
- 用户侧入口：“我的应用 → 创建 → 交互式应用”进入开发任务，也可以直接在普通任务里要求助手创建交互式应用（`docs/development/interactive-application-development.md:5`）。创建弹窗的第一项是 `development`，文案为“用对话创建交互式应用 / 说出你的想法，LinkSense 帮你实现”（`apps/web/src/features/applications/application-create-dialog.tsx:21-22,78-90`，`apps/web/src/i18n/zh-CN.ts:2670-2672`）。
- 创建弹窗还提供 `standard`、`interactive`（导入已有包）、`public_knowledge`；没有“网站”类型（`application-create-dialog.tsx:21-60`，`application-catalog-panel.tsx:1284-1310`）。

### 4.2 运行

- 交互式应用运行页是 `/applications/:applicationId/run/:conversationId`（`apps/web/src/App.tsx:420-425`）；页面先用认证 API 申请运行票据，再从 `runtime_url` 加载 iframe（`apps/web/src/features/applications/interactive-application-page.tsx:156-189,216-217,535-550`）。
- 票据接口 `POST /api/v1/applications/:id/interactive-runtime-token` 返回 `runtime_url: /api/v1/interactive-app-runtime/{ticket}/index.html`（`apps/api/src/modules/applications/routes.ts:149-171`）。运行时路由用 43 位 token 匹配资源，并向页面提供 SDK（`apps/api/src/modules/applications/routes.ts:394-413`）。
- 运行时路由明确说明交互式包按“可信 Web 应用”运行，不套沙箱，并移除主应用默认 CSP、Permissions-Policy 和 X-Frame-Options（`apps/api/src/modules/applications/routes.ts:385-392`）。这与公开站点的 sandbox 边界相反。

### 4.3 发布与对外分发

- 开发面板的 Publish 按钮要求严格递增的 `x.x.x` 版本号；发布把已审阅源码快照安装到“我的应用”，不会自动共享或上架；接收方需要显式重新共享或应用中心审批并手动安装（`built-in-application-builder.ts:140-159`）。
- 分发渠道是组织内共享和应用中心上架；交互式应用只提供“在线应用服务”，不能新建副本（`docs/development/application-distribution.md:5,11,30-32`）。
- 外部接入不是“公开站点”：其标识是 `app_id`，iframe URL 为 `/api/v1/embed/frame/{appId}`，需要 `parent_origin` 且该 origin 在允许列表中（`apps/api/src/modules/application-embed/service.ts:1414-1433`，`apps/api/src/modules/application-embed/routes.ts:177-181`）。`frame` 页面启动的是 `embed-app.js`，即 LinkSense 的嵌入聊天界面（`apps/api/src/modules/application-embed/routes.ts:191-235`，`apps/web/src/embed/embed-app.tsx:52-57`）。
- 外部接入有 `required` / `public` 两种模式、允许 origin 列表（最多 50）、票据/访问令牌/续期令牌，并用 `frame-ancestors {origin}` 限制嵌入方（`packages/shared/src/application-embed.ts:5-8,13-16,66-80`，`apps/api/src/modules/application-embed/routes.ts:1001-1021`）。origin 必须是纯 http/https origin，不能带路径、查询、片段或用户信息（`packages/shared/src/application-embed.ts:18-41`）。票据 60 秒、访问令牌 2 小时、续期令牌 8 小时、会话绝对 7 天（`packages/shared/src/application-embed.ts:5-8`）。它没有 slug，也没有“公开静态站点”的地址。
- `ApplicationExternalAccess` 属于单个应用；公开 id 和 app id 都由服务端生成（`prisma/schema.prisma:710-731`，`apps/api/src/modules/application-embed/service.ts:153-166`）。

### 4.4 与公开站点的关系

- 交互式应用的发布语义是安装到“我的应用”（`built-in-application-builder.ts:146-147`）；当前未发现把它登记为 `conversation_files` HTML artifact 的代码路径，因此它不会出现在 HTML 产物预览工具栏，也不会获得 `SiteShareButton`（`apps/web/src/features/task-artifacts/task-artifact-preview.tsx:49-51`）。
- 公开站点引用的是 `WebArtifactBundle` 或单个 HTML 对象；交互式应用包依赖运行票据、SDK 和 LinkSense 任务，没有代码路径把应用包转换为 `WebArtifactBundle` 或站点 release（当前检索未发现）。

## 5. 当前缺口：从“做个喝水小助手”到公开 slug

1. **没有意图路由。** 系统提示和内置 Skill 中没有“公开站点 vs 交互式应用”的分类规则；App Builder Skill 的适用描述是“可复用的 LinkSense 应用”（`built-in-application-builder.ts:13`），File Service Skill 只说明“网站应如何登记以便后续分享”（`user-home-materializer.ts:1955-1961`），`linksense-docs` 里的发布文档只是可检索内容。模型面对“build me a water-drinking reminder”时，选择哪条 Skill 取决于模型对“可复用应用/一次性 HTML/网站”的理解，而不是平台强制路由。
2. **没有“创建网站”的 Skill 或 MCP 工具。** 内置 Skill 列表只有 browser、local-browser、document-reader、docs、file-service、image-generation、knowledge-base、skill-creator、interactive-app-builder（`packages/shared/src/capabilities.ts:11-21`）。Runner Core MCP 的工具列表中没有创建/发布站点的工具（`apps/runner/src/mcp/core-services/file-service.ts:59-62` 等）；`webSiteRoutes` 只注册为 HTTP 路由（`apps/api/src/app.ts:547`）。全仓检索未发现 runner 侧引用 `web-sites`。
3. **站点创建是 UI 后置动作。** 入口只在已登记 HTML 产物的预览工具栏（`task-artifact-preview.tsx:49-51`，`apps/docs/docs/user-guide/tasks/publish-websites.md:12-17`）和“资料库 → 我的站点”（`apps/web/src/pages/knowledge-base-pages.tsx:287-296`）。创建弹窗没有“网站”选项（`application-create-dialog.tsx:21-60`）。所以即使助手生成了 HTML，用户仍要手动打开预览、点“发布为站点”、填名称/slug 才能得到公开地址。
4. **交互式应用不能顺带变成公开站点。** 它的发布语义是安装到“我的应用”（`built-in-application-builder.ts:140-147`），产物不是 HTML artifact；公开站点管线要求 `conversation_files` 中已登记的 HTML（`repository.ts:53-57`）。两者之间没有导出/转换路径。
5. **公开站点不能承载应用运行时。** 站点是静态字节加沙箱 iframe，不运行服务端程序（`docs/development/web-site-sharing.md:55`），网页不能读取平台 Cookie/localStorage、不能注册 Service Worker，也不支持 SPA history 回退（`docs/development/web-site-sharing.md:51-55`）。交互式应用则依赖票据与 SDK 提交真实任务（`built-in-application-builder.ts:52-54`）；若需求需要 LinkSense 任务、资源或持久化交互，公开站点不是等价物。
6. **站点管线有登记前置条件。** 需要先有 HTML artifact；本地资源必须通过目录快照捕获，否则发布时被 `WEB_SITE_RESOURCES_MISSING` 拒绝（`service.ts:50-55`，`resources.ts:59-61`）。单文件自包含 HTML 可以发布（`artifact-resources.ts:18-20`，`docs/development/web-site-sharing.md:47`）。
7. **公开地址形态固定。** 只有主 origin 下的 `/web/{slug}`，没有独立 origin/自定义域名；入口是外壳页 + 沙箱 iframe（`routes.ts:87-94`）。如果“公开站点”需要独立域名、登录态或服务端 API，当前管线不提供。
8. **`request_user_form` 已具备做选择问题的能力，但没有被要求用于此路由。** 它支持单选、多选等控件（`apps/runner/src/mcp/core-services/interactive-form-service.ts:76-104`），可用于“公开网页还是交互式应用”的单选问题；但当前 Skill/系统提示没有规定在创建前先问，且 `request_user_form` 的说明要求“已有信息不要重复问”（`interactive-form-instructions.ts:15`）。另外，`optional` 等待策略会在 3 分钟后用推荐值自动作答（`interactive-form-instructions.ts:18`，`packages/shared/src/conversation-forms.ts:221-227`），这可能不适合需要明确选择的管线分流。
9. **旧 release 资源仍可访问。** `publicSite` 接受任意属于该站点的 releaseId（`repository.ts:41-50`），删除/停站才整体拒绝。当前没有按版本回收资源 URL 的代码；这是行为事实，不是缺陷判断。
10. **没有“站点 slug”在对话内的确认/创建动作。** 站点创建、slug 命名和发布全部在 UI 中完成；对话工具只能产出 artifact 或应用，没有创建站点的工具。助手无法在回答里直接给出一个新的 `/web/{slug}` 链接，除非用户先在 UI 中发布。

## 6. `request_user_form` 现有能力与适用性

### 6.1 实现位置与能力

- 工具实现在 Runner 的 Core MCP 模块 `interactive_form`，同时暴露 `request_user_form` 与 `emit_application_event`，启用模式为 `default` 和 `plan`（`apps/runner/src/mcp/core-services/interactive-form-service.ts:235-248`）。
- 支持控件：`text`、`textarea`、`date`、`date_time`、`number`、`single_select`、`multi_select`、`boolean`（`interactive-form-service.ts:25-104`）。单选/多选最多 50 个选项（`interactive-form-service.ts:76-90`）；每次最多 20 个字段（`interactive-form-service.ts:112-120`）。
- 支持 `purpose: input | approval`；approval 必须有明确的两选项决策字段和 approve/reject 值（`interactive-form-service.ts:105-111,112-160`）。
- 工具是阻塞式：工具描述写明“Show a blocking interactive form card ... and wait for the user's response”（`interactive-form-service.ts:540-547`）。调用时 Runner 注册一个 pending 请求，并发布 `linksense/form/request` 事件（`apps/runner/src/process-pool.ts:2686-2737`）；模型得到 `{ action, content }`，`decline`/`cancel` 返回 null content（`interactive-form-service.ts:322-328`）。
- 等待策略：`required` 无限等待；`optional` 需要为所有字段提供完整推荐值，3 分钟后自动采用推荐值（`interactive-form-instructions.ts:18`，`apps/runner/src/process-pool.ts:2735`）。approval 只能 `required`（`interactive-form-instructions.ts:18`）。
- 回答链路：UI 调 `POST /api/v1/conversations/:id/user-input-requests/:requestId/respond`（`apps/api/src/modules/conversations/routes.ts:576-595`）；服务端校验 owner、turn 状态、schema、等待策略，写 `conversation_user_input_requests` 并经 Runner 把答案送回当前 turn（`apps/api/src/modules/conversations/form-user-input.ts:16-123`，`prisma/schema.prisma:1112-1142`）。
- 安全语义：不能索要密码/Token；提交本身不构成授权；Plan 模式下表单不能替代 `proposed_plan` 审批（`interactive-form-instructions.ts:6-10`）。`conversationFormTextSuggestsSensitiveValue` 会在 schema 层拒绝敏感字段（`interactive-form-service.ts:132-150`）。
- 时机：已检查的实现中没有“只能在 turn 后段调用”的限制；唯一前置是当前会话有运行中的 turn（`apps/runner/src/process-pool.ts:2648-2658`）。系统提示要求“需要用户确认、澄清、选择、缺失信息或反馈时调用”，包括单个问题或 yes/no（`interactive-form-instructions.ts:1-2`）。

### 6.2 对本问题的适用性

- 技术上可以直接用一个 `single_select` 问“公开站点 / 交互式应用 / 两者都要”，选项值稳定，返回后模型可据此选择 Skill 或继续实现。表单卡片在对话内展示，不依赖 HTML 预览（`interactive-form-instructions.ts:14`）。
- 主要限制不在工具能力，而在触发与产品规则：
  - 当前没有系统规则要求“创建类请求先问管线”；模型可能直接调用 App Builder 或直接生成 HTML。
  - 如果用户已经说了“网站”“公开链接”等明确词，再问会违反“不要重复询问已提供信息”（`interactive-form-instructions.ts:15`）。
  - `optional` 的 3 分钟自动推荐会在用户未作答时替用户选一个管线；是否允许这种自动选择需要产品决定。
  - 表单只记录意图，不创建站点、不改变权限，也不能替代用户后续在 UI 中的发布操作（`interactive-form-instructions.ts:8`）。
- 结论（现状判断，不是最终建议）：`request_user_form` 足以承载一次“站点 vs 应用”的选择，但它目前是通用澄清工具，不是意图路由器；是否用它、何时用、是否允许自动推荐，均未有代码或提示词约束。

## 7. 待确认 / 不确定项

1. **“公开站点”的目标形态**：是否只要求现有同源 `/web/{slug}`，还是需要独立 origin、自定义域名、登录态或服务端 API？后者会影响是否改造公开管线，而不是只改 Skill/提问。
2. **默认行为**：对“做个喝水小助手”这类模糊请求，产品希望助手默认做交互式应用、默认做公开网页，还是先问一次？当前代码没有默认路由。
3. **发布动作归属**：站点创建/slug 是否允许由对话内工具完成，还是必须保留为 UI 的显式发布动作？当前只有 UI 路径（`task-artifact-preview.tsx:49-51`）。
4. **交互式应用与站点的关系**：是否希望把交互式应用“导出/降级”为公开静态站点？当前没有转换路径，且运行时会话、SDK、任务能力无法在沙箱站点中直接复用（`apps/api/src/modules/applications/routes.ts:385-392`，`apps/api/src/modules/web-sites/routes.ts:49-59`）。
5. **Skill 调整方式**：是在 `linksense-interactive-app-builder`/`linksense-file-service` 的描述里加入分流规则，还是新增站点 Skill，还是只在 `request_user_form` 前增加系统提示？三者影响的代码位置不同；本轮不选择。
6. **`request_user_form` 的使用边界**：是否允许在创建前阻塞提问；是否接受 3 分钟自动推荐；如何避免对明确说“网站”的用户重复提问（`interactive-form-instructions.ts:15,18`）。
7. **站点版本资源保留**：切换 release 后旧 `/web/{slug}/_releases/{old}/...` 仍可访问（`repository.ts:41-50`）。这是预期行为还是需要回收，未确认。
8. **站点能力边界**：公开站点不支持 Service Worker、持久化同源存储、服务端程序和 history 回退（`docs/development/web-site-sharing.md:51-55`）。如果“喝水提醒”需要浏览器通知/后台提醒，公开站点是否仍满足需求，需要产品确认。
9. **外部接入是否可作为公开等价物**：`/api/v1/embed/frame/{appId}` 是嵌入聊天界面，需允许 origin，且不是交互式应用包本身（`apps/api/src/modules/application-embed/routes.ts:177-235`）；它能否作为“公开站点”的替代，未验证。
10. **既有文档的路径精度**：Appwrite 调研与站点分享文档个别地方把资源写成 `/_releases/...`，实际是 `/web/{slug}/_releases/...`（`service.ts:35`）；不影响行为，但引用时需按完整前缀理解。

## 8. 本次核对边界

- 仅阅读当前工作树代码与文档；未运行 API/Runner/Web 测试，未启动服务，未修改产品代码，未执行迁移。
- 未验证生产部署版本是否与本地 `main` 一致；Nginx 规则只按仓库内模板核对。
- 未验证交互式应用能否通过外部 embed 实际运行，也未验证站点在独立 origin/登录态场景下的行为；相关项已列入待确认。

## 9. 根因判断

1. **Skill 描述就是路由器，但现在只有一个创建类 Skill 在竞争。** `linksense-interactive-app-builder` 的适用描述是“可复用的 LinkSense 应用”（`built-in-application-builder.ts:11-13`），而“喝水小助手”听起来正是可复用应用；File Service 的“网站”段落只讲如何登记静态资源以便后续分享，没有讲“发布为公开站点”（`user-home-materializer.ts:1955-1961`）。模型没有第二个可选 Skill，也没有反向约束，因此选择交互式应用是当前提示词下的合理结果，不是模型理解失败。
2. **缺少对话内发布原语。** 站点创建只在 UI（`SiteShareButton` → `SiteDialog`）里；Runner Core MCP 没有站点工具。即使模型想走站点，也只能生成 HTML artifact 然后让用户手动点“发布为站点”，无法在回答里给出新 slug。
3. **两条管线的产物不互通。** 交互式应用包不是 `conversation_files` artifact，没有转成 `WebArtifactBundle` 的路径；公开站点要求已登记 HTML（`repository.ts:53-57`）。因此“先做应用、再顺便发个外链”并不可行，必须在开始时就选对。
4. **产品入口强化了单一路径。** 创建弹窗只有普通应用、交互式应用、导入和公共知识问答，没有“公开站点”（`application-create-dialog.tsx:21-60`）。用户从“我的应用 → 创建”进入时，系统已经在暗示“应用”。
5. **站点管线的能力边界没有被讲清楚。** 当前公开站点是沙箱 iframe：`webSiteSandbox = "allow-scripts allow-modals allow-downloads allow-forms"`，不含 `allow-same-origin`（`apps/api/src/modules/web-sites/routes.ts:49`）；资源 CSP 也带 `sandbox`（同文件 50-58）。具体影响是**没有同源 localStorage/IndexedDB/Cookie、不能注册 Service Worker、不能使用浏览器通知**，也没有 SPA history 回退。对“喝水提醒”这类需要持久化或提醒的场景，公开站点并不等价于“真正的网站”。这必须在分流时说明，而不是事后才发现。

## 10. 方案比较

| 方案 | 做法 | 优点 | 缺点 | 结论 |
| --- | --- | --- | --- | --- |
| A. 只改 Skill/提示词 | 在 App Builder Skill 里加“公开站点不要用我”，在 File Service Skill 里加“生成 HTML 后提示发布为站点”，再加表单 | 改动最小；不新增服务端能力 | 模型可能选对管线，但用户仍要手动点“发布为站点”、填 slug；对话里拿不到链接 | 必要但不充分，只能作为 B 的一部分 |
| B. 新增公开站点 Skill + 对话内发布工具（推荐 v1） | 新增 `linksense-public-site` Skill；新增 `publish_web_site` 等 Core MCP 工具，复用现有 `web-sites` 服务 | 复用现有发布、版本、owner、slug 唯一约束、nginx 路由；无数据库迁移；一次对话拿到外链 | 站点仍是同源沙箱 iframe，无本地存储/通知；发布即公开；需要新增工具和测试 | **推荐**，解决“生成 slug 并外部访问”的最小完整方案 |
| C. 让交互式应用支持公开 slug | 复用运行时票据/SDK/embed，给应用一个公开地址 | 单一产物，应用能力完整 | 交互式应用依赖 LinkSense 运行时、任务、AI、资源权限；现有 external iframe 是嵌入聊天页/应用，不是独立公开站点；放开公开访问会带来 AI 成本、滥用、会话隔离问题 | 不推荐用于简单站点；保留 embed 作为另一种分发 |
| D. 独立站点 origin + 可选后端 | 站点在独立 origin（如 `https://<slug>.sites.example.com`）直接服务 static release，不再套无同源 iframe | 真正站点能力：localStorage、IndexedDB、Service Worker、通知、Cookie、后续登录/数据后端 | 需要 DNS 泛解析、证书、nginx host 路由、Cookie 作用域、CSP/CORS、旧 `/web/{slug}` 兼容/跳转；基础设施改造较大 | 如果“站点”要具备真实站点能力，尤其喝水助手要持久化/提醒，这是 Phase 3 的必选项 |

补充：方案 C 中的 `application-embed` 已经有 `required/public` 两种模式，但它是 `app_id` + 允许 origin 的 iframe，不是 slug；公开模式仍只接受允许来源，不能当作开放站点（`apps/api/src/modules/application-embed/service.ts:1414-1433`、`apps/api/src/modules/application-embed/routes.ts:177-181`）。

## 11. 推荐结论

**建议采用 B + A，并把 D 作为明确的产品决策点。**

一句话：不要只改 Skill，也不要让交互式应用承担公开站点；新增一个与 App Builder 对等的 Public Site Skill，加一个复用现有 `web-sites` 的发布工具，再用 `request_user_form` 只在意图不明确时做一次二分选择。

分三期：

1. **Phase 1（路由 + 手动发布，最小验证）**：修改 App Builder / File Service Skill 描述，加入“公开站点 vs LinkSense 应用”的路由规则和表单；用户选公开站点时，模型生成 `artifacts/<dir>/` 静态站点并用 `register_artifact` 登记，然后引导用户点击“发布为站点”。不新增工具，先验证用户是否真的需要公开站点。
2. **Phase 2（推荐 v1）**：新增 `linksense-public-site` Skill + `publish_web_site` 工具，复用 `web-sites`；一次对话完成“生成 → 登记 → 发布 → 返回 `/web/{slug}`”。同阶段加 `list_web_sites` 和 `update_web_site`，支持后续轮次修改名称、slug、描述和重新发布。
3. **Phase 3（按需求）**：独立站点 origin + 可选 Appwrite/后端，解决 localStorage、通知、登录、数据。**如果喝水小助手必须“关闭页面后仍记住进度”或“到点提醒”，Phase 3 是硬需求，不是可选项**；Phase 2 只能做页面内存状态或 URL hash 状态。

## 12. 意图分流设计

### 12.1 两个 Skill 的描述就是分类器

不需要单独训练/维护一个意图分类服务。Codex 在 `skills.include_instructions=true` 下会把已启用 Skill 的描述和说明提供给模型（`apps/runner/src/codex/runtime-config-overrides.ts:21-31`），两个互斥的 Skill 描述就是路由规则：

- `linksense-interactive-app-builder`：用于需要 LinkSense AI、任务、文件、知识库、插件、组织分发，或需要 LinkSense 登录态的应用。**明确写明不适用于公开静态站点。**
- `linksense-public-site`（新增）：用于生成一个任何人拿到链接都能打开的静态网站/网页工具，不需要 LinkSense 登录、AI 或服务端；支持自定义 slug。**明确写明不适用于需要 LinkSense AI/任务/资源的应用。**

同时把 “public site / website / 外链 / 公开访问 / 分享给朋友 / 不需要登录” 和 “LinkSense 里用 / AI / 知识库 / 任务 / 插件 / 团队共享” 写成少量正反例，放在两个 Skill 的正文里；不要让模型只靠“应用”这个词猜。

### 12.2 只在意图不明确时用 `request_user_form`

`request_user_form` 已支持 `single_select`、必答等待和默认/Plan 两种模式（`apps/runner/src/mcp/core-services/interactive-form-service.ts:76-120`、`interactive-form-instructions.ts:1-18`），适合做一次二分选择；但它不应变成每个创建请求的固定步骤。

触发规则建议：

| 用户表达 | 行为 |
| --- | --- |
| 明确说“公开网站 / 网页 / 外链 / 分享链接 / 不需要登录 / 部署到域名” | 直接走 Public Site，不再提问 |
| 明确说“在 LinkSense 里用 / 调用 AI / 知识库 / 任务 / 插件 / 团队共享” | 直接走 Interactive App，不再提问 |
| 只说“做个喝水小助手 / 做个工具 / 做个页面”，没有交付形态信号 | 先问一次，再创建 |
| 两个都要 | 说明这是两个交付物，先做用户当前明确要的那个；不要静默合并 |
| 用户已经回答过 | 不重复问（`interactive-form-instructions.ts:15`） |

表单建议（`purpose: input`，`required`，不使用 `optional` 自动推荐，避免用户不在时替用户选择公开站点）：

```json
{
  "message": "这个需求可以做成两种形态，先确认交付方式。公开站点是纯静态页面，任何人拿到链接都能打开，不能调用 LinkSense AI；LinkSense 应用在平台内使用，可以调用 AI、知识库和任务。",
  "purpose": "input",
  "waiting_policy": { "kind": "required" },
  "fields": [{
    "id": "delivery",
    "label": "交付形态",
    "control": "single_select",
    "required": true,
    "options": [
      { "value": "public_site", "label": "公开网站（外链访问，纯静态）" },
      { "value": "interactive_app", "label": "LinkSense 应用（可用 AI）" }
    ]
  }]
}
```

表单答案表示用户选择了交付形态，不替代敏感内容检查；发布前仍要检查页面没有凭据、个人隐私、内部地址和不该公开的任务内容。不要把表单提交当作其他外部动作的授权（`interactive-form-instructions.ts:8`）。

### 12.3 后续轮次

公开站点不新增“开发工程”概念：它沿用当前任务的 `artifacts/<dir>/` 和 `conversation_files`。后续在同一任务里说“把标题改一下”，模型重新生成、`register_artifact`、`publish_web_site`（带 `site_id`）即可。跨任务更新时，用 `list_web_sites` 找到站点，再发布新 artifact；站点 slug 保持不变。

## 13. 工具与后端设计

### 13.1 新增工具

在 Runner Core MCP 新增一个 `web_site` 模块（`modes: ["default"]`，Plan 模式不暴露；发布是外部副作用）：

- `publish_web_site`
  - 输入：`name`（1–240）、`description?`、`slug?`、`file_id`（来自 `register_artifact`）、`site_id?`（更新已有站点）。
  - 输出：`id, name, slug, url, url_path, status, release_id, source_file_id`。
  - 行为：创建时调用现有 `WebSiteService.create`（`create` 直接写入 `status: "published"`，`repository.ts:85-89`）；带 `site_id` 时调用 `publish` 生成新 release 并切换 `currentReleaseId`（`service.ts:25-29`）。
- `list_web_sites`
  - 输入：`search?`、`status?`、`limit?`、`cursor?`。
  - 输出：当前 owner 的站点列表；用于新任务里找到要更新的站点。
- `update_web_site`
  - 输入：`site_id`，以及 `name? / description? / slug? / status?` 中至少一个。
  - 行为：调用现有 `WebSiteService.update`；修改 slug 后旧链接立即失效（`repository.ts:97-115`）。

如果首版要更懒，只做 `publish_web_site` 也能闭环“生成 slug”；`list/update` 可以放在同一 PR 的第二小步。不要扩展 `open_application_development` 的 `kind` 参数：两条管线的产物、生命周期、权限和发布语义不同，混在一个工具里会把判断成本转给后端。

### 13.2 复用现有服务，不新建表

- API 新增内部路由 `/internal/web-sites`，使用 `runnerSharedSecret` + `x-linksense-owner-id`，模式与 `internalApplicationBuilderRoutes` 一致（`apps/api/src/modules/applications/development-routes.ts:50-60`、`apps/api/src/app.ts:614`）。
- 服务端校验：
  1. owner 账号 `active`；
  2. 当前会话存在 `running` turn（复用 `assertActiveTurn` 的思路，`development-repository.ts:176-179`）；
  3. `file_id` 属于该 owner；创建时属于当前会话；文件为 `kind=artifact`、`status=registered`、`downloadable`、MIME `text/html`（现有 `WebSiteStore.source` 已做，`repository.ts:53-62`）；
  4. `WebArtifactBundle` 存在且资源大小/校验通过（现有 `sourceBundle` 已做，`service.ts:50-55`）；
  5. `site_id` 属于该 owner；更新 slug 时检查 `WebSiteAddress` 占用（现有 `repository.ts:97-115`）。
- 发布结果使用现有 `projectSite` 投影；工具层把 `url_path` 与 `publicBaseUrl` 合成绝对 `url`，避免助手只给出相对路径。
- 错误复用/新增稳定 code：`WEB_SITE_SOURCE_UNAVAILABLE`、`WEB_SITE_BUNDLE_INVALID`、`WEB_SITE_RESOURCES_MISSING`、`WEB_SITE_SLUG_TAKEN`、`WEB_SITE_TURN_INACTIVE`、`WEB_SITE_FORBIDDEN`。这些 code 要进六语言错误资源，不要把 Prisma/内部错误直接透出。

### 13.3 slug 规则

现有 `webSiteSlugSchema`：去空格、转小写、3–80 位、`^[a-z0-9]+(?:-[a-z0-9]+)*$`（`packages/shared/src/web-sites.ts:3-4`）；未提供时默认 `randomUUID()`（`service.ts:22`），对用户不友好。

建议：

- Skill 要求模型先根据名称提出一个可读的英文 kebab-case slug（如 `water-reminder`），在回答或表单里展示；用户可改。
- 服务端保留现有校验；冲突返回 `WEB_SITE_SLUG_TAKEN`，不要静默改成随机值。模型可以再提议 `water-reminder-2`，或让用户选择。
- 中文名称不要求服务端做拼音转换；由模型提议英文 slug。若用户坚持中文拼音，作为输入校验失败处理，不引入新依赖。
- 自定义域名/独立 origin 属于 Phase 3，不改现有 slug 语义。

### 13.4 发布语义与安全

- 现有 `create` 直接 `status: "published"`，没有草稿状态。因此 `publish_web_site` 是**立即公开**的动作；工具描述必须写明这一点。
- 只有当用户明确选择“公开网站”或在首条消息里明确要求公开链接时才调用；模糊请求先走 12.2 的表单。
- 继续使用现有沙箱、CSP、`no-store`、`noindex`、`no-referrer` 和 owner 校验（`apps/api/src/modules/web-sites/routes.ts:49-102`）。
- 公开页面禁止放入凭据、Token、个人隐私、内部地址；Skill 正文要明确。
- 旧 release 资源地址仍可访问（`repository.ts:41-50`），这是现状；如果产品要求“切版本后旧资源不可读”，需要另开改动，不在本次范围。

## 14. 实施清单

### 14.1 代码触点

1. `packages/shared/src/capabilities.ts`：把 `linksense-public-site` 加入 `builtInSkillNames`；同步 built-in capability 的六语言显示名。
2. `apps/api/src/modules/capabilities/built-in-public-site.ts`（新增）：写 `SKILL.md` + `agents/openai.yaml`，内容覆盖静态站点结构、`register_artifact`、`publish_web_site`、slug、安全边界、更新流程。
3. `apps/api/src/modules/capabilities/user-home-materializer.ts`：注册新的 writer，和 `writeBuiltInApplicationBuilder` 并列；按现有 0750/0640 权限写入。
4. `apps/api/src/modules/capabilities/built-in-application-builder.ts`：在描述和正文里加“不用于公开静态站点；改用 linksense-public-site”，减少误触发。
5. `apps/runner/src/mcp/core-services/web-site-service.ts`（新增）：模块定义、工具 schema、HTTP 转发、错误映射；`core-service-registry.ts` 注册；`core-service-registry` 测试补工具名。
6. `apps/runner/src/controller/server.ts` + `apps/runner/src/event-sink.ts` + `process-pool.ts`：新增 `/internal/web-sites` 转发与 `LINKSENSE_WEB_SITE_ENDPOINT/TOKEN` 环境变量；超时沿用 60 秒档。
7. `apps/api/src/modules/web-sites/internal-routes.ts`（新增）：内部路由 + shared secret + owner header；`app.ts` 注册。
8. `apps/api/src/modules/web-sites/service.ts` / `repository.ts`：只加工具所需的查询/校验复用方法，不复制业务逻辑；不新增 Prisma 模型或迁移。
9. `apps/web`（可选但建议）：创建弹窗加“公开站点”入口；发布成功后展示链接和“我的站点”入口；六语言资源。
10. 文档：`apps/docs` 用户指南补“对话创建公开站点”；`docs/development` 补工具链路和权限说明。

### 14.2 测试

- 共享 schema：slug 校验、工具输入/输出、错误 code。
- Runner：工具注册、参数校验、超时、错误映射、Plan 模式不可用。
- API：owner/turn 校验；非 HTML/未登记/无 bundle 拒绝；slug 冲突；创建后 `/web/{slug}` 可读；停用后 404；更新 release；删除释放地址；跨用户拒绝。
- 内置 Skill：内容快照、六语言显示名、`BUILT_IN_CAPABILITY_RUNTIME_REVISION` 更新后的快照刷新测试。
- 前端（若加入口）：创建弹窗、成功链接、六语言与回退。
- 手工：在未登录窗口打开 `https://<host>/web/<slug>`，确认资源、交互和 `noindex`；确认页面不读取平台登录态；确认 localStorage/通知的实际行为（当前应为不可用），并把限制写进回复。

### 14.3 兼容与发布

- 无数据库迁移；现有 `/web/{slug}`、`WebSite`、`WebSiteRelease`、`WebSiteAddress` 行为不变。
- 新增内置 Skill 需要同步 `BUILT_IN_CAPABILITY_RUNTIME_REVISION`（`user-home-materializer.ts:61`），并在 API / Runner / Worker 一起发布；只热更新 API 不会更新已有 worker 镜像中的工具注册表（参考 `docs/development/interactive-application-development.md` 的升级说明）。
- 旧任务不会自动获得新 Skill；下一次能力快照加载后生效。交互式应用开发任务的既有行为不变，只改描述和分流提示。
- 不提交、不上架、不共享任何站点，除非用户明确要求；发布仍按现有 owner/审计/lifecycle 执行。

## 15. 待决策

1. **喝水助手是否需要持久化/到点提醒？** 如果需要，Phase 2 的同源沙箱站点不够，必须做 Phase 3 独立 origin（或接外部后端）；否则 v1 只能做页面内状态。
2. **首版是否允许对话内直接发布？** 现有 `create` 没有草稿状态，工具会立即公开。若不接受，需要先加“草稿/未发布”状态，成本更高。
3. **是否在创建弹窗增加“公开站点”入口？** 只在对话里分流也能工作，但 UI 入口能降低“我的应用 → 创建”带来的路径惯性。
4. **slug 是否要求可读英文？** 当前 schema 只接受 `[a-z0-9-]`；中文名由模型提议英文 slug，是否需要拼音/自定义域名另行评估。
5. **独立 origin 的时间表。** 它同时是 Appwrite/登录/数据方案的前置条件（见 `docs/research/appwrite-site-auth-database-feasibility-2026-11-13.md` 第 3 节），建议与站点真实能力需求一起排期，而不是等用户投诉后再补。
