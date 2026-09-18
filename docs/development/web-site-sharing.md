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
