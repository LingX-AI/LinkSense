# OneDrive 与 SharePoint 连接

## 使用

入口为 **插件中心 → 连接器**，位于 MCP 标签之前；**设置 → MCP** 仅管理个人 MCP。每个用户可分别连接一个 OneDrive 账号和一个 SharePoint 组织账号。OneDrive 支持个人、工作或学校账号；SharePoint 使用工作或学校账号。连接、重新连接或升级读写权限时，在新标签页打开 Microsoft 授权页，原插件中心页面保留。授权后切回原页面会刷新连接状态。卡片使用[微软产品图标资源](https://github.com/microsoft/fluentui-blazor/discussions/3045)中通过 Microsoft CDN 提供的原版彩色产品图标，不修改图标颜色或形状。

连接后直接在自己的任务中提出需求，例如：

- “在 OneDrive 中找一下上周的会议纪要并总结。”
- “阅读 SharePoint 研发团队的项目说明，整理后保存一份新文档。”
- “把任务中的报告上传到 OneDrive 的 Reports 文件夹。”

支持搜索、浏览、阅读、下载原文件，以及新建文件和文件夹、上传、更新内容、重命名、同文档库内移动、移入回收站。普通任务可读写；规划模式只提供读取，不下载到工作区、不写入云端。每次访问仍受微软账号原有文件权限限制。

文件按任务需要访问，不会自动导入资料库。阅读支持 Word、Excel、PowerPoint、文本及包含文本的 PDF；模型获得分页 Markdown 和来源链接。编辑 Office 文件时下载原始文件到任务工作区，修改后上传原格式文件。文件传输上限为 20 MiB，上传暂不支持空文件。加密文档、扫描件 OCR、远程快捷方式、跨文档库移动、共享权限管理和后台同步不在本次范围内。

新建遇到同名文件会失败；更新、重命名、移动和删除需要刚读取的文件版本标记，发生冲突后必须重新读取，不能省略版本条件强行覆盖。删除使用微软回收站。网络错误可能发生在远端已成功之后，工具会提示先检查远端状态再重试。

连接成功后默认可在本人任务中使用，无需额外开关。以前已连接但关闭过开关的账号也默认可用；断开连接则清除 LinkSense 保存的授权令牌。微软账号内已有的应用同意记录可在微软账户管理中另行撤销。任务内已经产生的引用和下载文件保留。公开应用访客不能继承发布者的连接。

## 官方工具选型

已核对微软的 [Work IQ MCP](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview)、[启用要求](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq)、[OneDrive MCP](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-onedrive-tools) 和 [SharePoint MCP](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools)。这些托管方案有组织租户、管理员配置、服务开通或预览状态等要求，不能直接用现有消费者 Microsoft OAuth 连接替换。它们的令牌受众和授权范围也与 Graph 不同。

本实现保留个人账号支持，复用项目已有的 Microsoft Graph JavaScript SDK 3.0.7、openid-client 6.8.4、MCP SDK 和 anydoc，不新增运行时依赖。SDK 负责 Graph 请求和原始文件字节上传；LinkSense 的独立插件负责工具参数、任务权限、工作区文件与返回格式适配。这是 LinkSense 官方插件，不冒充微软发布的 MCP 服务。微软的 [Graph 文件上传接口](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0)明确支持个人账号的委托读写权限，单次支持 250 MB，足以覆盖当前 20 MiB 的传输上限。

## Microsoft Entra 配置

复用 **设置 → 系统设置 → 登录方式 → Microsoft** 中的 Client ID 与 Client Secret。登录回调与连接回调、令牌和状态各自独立，不使用登录时的访问令牌。关闭 Microsoft 登录开关不会撤销单独授权的数据连接。

- 应用支持 **任何组织目录中的账号和个人 Microsoft 账号**。OneDrive 使用 `common`，SharePoint 使用 `organizations` 授权端点。
- Microsoft Graph 使用 **委托权限**：OneDrive 请求 `Files.ReadWrite`；SharePoint 请求 `Files.ReadWrite.All` 和 `Sites.Read.All`，分别用于文件读写和站点发现。两者同时请求 `openid profile offline_access User.Read`。不需要后台应用权限。
- 保留原登录回调，Web 平台登记 `${LINKSENSE_PUBLIC_BASE_URL}/api/v1/connectors/onedrive/callback` 与 `${LINKSENSE_PUBLIC_BASE_URL}/api/v1/connectors/sharepoint/callback`。正式环境使用 HTTPS，开发环境可使用已登记的 HTTP localhost。前端、API 公开地址与回调 Cookie 必须同源。
- 组织的用户同意策略与发布者验证要求继续生效。配置权限不等于授予所有组织用户同意，也不等于已完成真实账号授权验收。

本次已在现有 LinkSense Entra 应用中保存上述文件读写和站点读取委托权限，核对账号类型为“任意 Entra 租户＋个人 Microsoft 账号”，并确认 `explore.linksense.org` 与 `localhost:18172` 的登录、OneDrive、SharePoint 六个回调均已登记。未授予全组织管理员同意。

旧只读连接继续读取，页面显示“升级为读写”。用户主动升级后才请求新增权限；令牌自动刷新仅请求已经授予的范围，不暗中扩大权限。读写能力根据实际加密授权内容计算，不新增数据库字段。已失效或无法解密的授权显示为需要重新连接。

## 模块与运行链路

独立包位于 `apps/api/src/modules/connections/plugins/linksense-microsoft-files`，包含标准 `.codex-plugin/plugin.json` 与 `.mcp.json`。基础读写不需要 Skill。今后需要复杂工作流时，可在插件内添加 Skill，而不把所有服务工具塞入 Core MCP。

1. API 根据当前用户有有效授权的已连接服务发布可信插件。OneDrive 与 SharePoint 共用一个 Microsoft 文件插件，不重复注册；没有连接时不发布。用户自定义插件不能占用官方包的 ID 或名称。
2. 复用现有能力目录、原生插件安装和 Codex 工具搜索。插件仅提供 `read_files` 与 `write_files` 两个操作入口，完整参数按原生工具搜索需要提供，不修改 Codex 回合、重试或恢复语义。
3. 插件通过独立 `linksense-connection-mcp microsoft-files` 启动器运行。Graph 令牌始终在 API 内；插件只持有当前任务进程的受限代理令牌，令牌不会进入模型输入、插件文件、任务快照或审计。
4. 调用链为插件 → Runner → Controller → API → 用户委托的 Microsoft Graph。每次校验用户、任务归属、活动回合、连接状态和实际授权；写入在 MCP、Runner、API 三层限制规划模式。Controller 与 API 拒绝外部应用服务会话。
5. 下一轮执行前重新解析连接目录；断开后移除该插件。恢复已排队任务也重新检查授权，不沿用失效的快照权限。已发布应用的能力范围不自动包含发布者个人连接。

OAuth 采用 PKCE、state、nonce 和 issuer 校验；临时状态加密保存在 Redis，绑定浏览器 Cookie、发起用户及凭据失效时间，十分钟内单次消费。用户令牌复用凭据主密钥，并绑定用户与服务作为加密上下文。刷新、断开与回调通过 PostgreSQL 事务锁协调。

续页游标加密并绑定用户、服务、查询和连接 revision；Graph 续页限定同源同路径。下载使用现有地址校验和有界下载器，预授权下载请求不携带 Graph Bearer。上传通过官方 SDK 直接调用 `graph.microsoft.com` 的 `/content`，发送原始字节；禁用写请求的 SDK 重定向和自动重试。新建在 URL 指定 `@microsoft.graph.conflictBehavior=fail`，覆盖时在实际内容写入请求上携带 `If-Match`，避免预检查与写入之间的竞争。文档内容视为不可信资料，工作区上传拒绝越界路径和符号链接。

## 数据与发布

前一步新增的 `20260923090000_add_user_connections` 只创建 `user_connections` 及唯一索引，用户已确认保留全部历史数据，该迁移已在本地应用。本次标签位置与默认使用行为不修改表结构，也不修改已发布的迁移文件。表中原有 `enabled` 字段继续保留以兼容既有数据，但不再控制连接器使用；公开接口不返回此字段，旧 `PATCH /connections/:provider` 停用入口已移除。

升级需要同步更新 Shared、API、Web、Runner Controller 和 worker 镜像；worker 必须包含新的独立 MCP 启动器。开发环境使用 `pnpm dev:worker:rebuild`，应先确认没有运行中的任务。原有 Microsoft 登录、个人 MCP 和已发布应用无需重建；旧连接无需清空，新增写权限通过主动授权取得。生产环境尚未发布。

本地确认运行中任务数为零后，已执行 `pnpm dev:worker:rebuild`，重建 worker 与 Controller 并刷新运行环境，API 和 Controller 健康检查均通过。原生插件集成检查直接使用新镜像内的 Runner、启动器和依赖，没有替换镜像中的 MCP 实现。

## 验证

单元测试覆盖授权签名、刷新与权限升级、旧只读授权、失效连接、任务隔离、规划模式写入拒绝、Graph SDK 上传、版本冲突、地址约束、大请求在 API/Controller/Runner 间传递、工作区边界、文档分页、插件发布/恢复/断开，以及前端新标签页和六种语言提示。

`scripts/microsoft-connection-plugin-smoke.mjs` 在一次性 worker 容器中使用项目固定的 Codex 0.154.0、实际任务 UID、生产目录发布和原生安装流程。模型与微软请求使用回环模拟服务，不访问真实用户文档。验证初始上下文不携带完整读写参数、原生搜索发现工具、代理调用、断开后恢复任务移除工具，以及规划模式只提供官方读取工具且禁用个人插件。测试只临时替换该一次性容器的 marketplace 根路径约束。

前端仅运行单元测试和静态检查，未使用浏览器自动验收。个人 OneDrive 的上传、回读、更新和冲突保护已使用当前真实连接验证（见下方修复记录）；组织 SharePoint 的真实文件写入与断开完整流程仍需用目标账号验收，组织管理员策略属于外部前置条件。

本次验证记录：

- `pnpm --filter @linksense/shared test`：67 个文件、544 项测试通过。
- API 连接与 preflight 测试：103 项通过；原有第三方登录的协议、服务、路由测试：40 项通过。
- Runner 连接路由、Controller、进程池、事件转发、MCP、启动器等八组测试：300 项通过；补充的写入不重试用例通过，插件策略和原生安装管理的 19 项测试通过。
- Web 连接页面与设置导航：56 项通过；i18n 与错误映射：97 项通过，覆盖六语言键集合和回退。
- API、Runner 的 `typecheck` 和受影响文件 `eslint`，Web 受影响文件 `eslint`，API/Runner/Web `build` 均通过；Web 构建保留既有依赖浏览器兼容性及大分块提示。
- 插件清单校验、只新增表的迁移检查及新镜像内的六项原生 Codex 集成检查通过。未运行全仓库测试。

### 个人 OneDrive 上传失败修复

真实连接已有 `Files.ReadWrite`，失败不由权限缺失导致。原上传会话请求中的冲突注解被当前个人 OneDrive 返回 `400 invalidRequest`；微软返回的个人存储域名也未被原地址校验覆盖。进一步验证发现，省略冲突参数或移到上传会话 URL 都不能可靠阻止同名覆盖，因此移除上传会话实现，统一使用官方 Graph `/content` 接口，没有保留失效路径或自动回退。

另修复个人 OneDrive 在 `$select` 存在时遗漏下载地址的问题：读取文件内容时使用默认元数据响应，再通过已有 Schema 和投影限制输出。不会把预授权下载链接传给模型。

当前个人账号实测通过：新建中文文件名文件、回读并比较完整字节、同名新建返回冲突且原内容不变、按当前版本更新、回读更新后的字节、旧版本更新被拒绝。另上传有效的临时 `.docx` 文件并验证下载字节完全一致。所有成功创建的验证文件已移入回收站；未修改用户已有文件。修复只涉及 API 适配与测试，不更改数据库、OAuth 权限、前后端接口或插件工具契约，现有读写连接无需重新授权。

本次修复检查：`pnpm --filter @linksense/api test` 指定七个 `connections.*.test.ts` 文件，68 项通过；`pnpm --filter @linksense/api typecheck`、受影响四个 TypeScript 文件的 `eslint --max-warnings=0`、`pnpm --filter @linksense/api build` 和 `git diff --check` 均通过。开发 API 中两个适配器文件的 SHA-256 与工作区一致，`/api/v1/system/health/ready` 返回 200。本次未改动前端或 Runner，未运行全仓库测试，未发布生产环境。
