# 交互式应用附件上传修复（2026-09-18）

## 原因与修复

应用通过 `LinkSense.files.upload(File)` 上传并声明了 `files:write`，但 API 在写入附件时收到 PostgreSQL 的 `conversation_files_source_check` 约束错误，返回 HTTP 500 / `INTERNAL_ERROR`。代码已经使用 `interactive_application_upload` 来源，数据库仍只允许 `user_upload`、`agent_generated`、`system_generated`。此前集成测试引用的 `20260916020000_allow_interactive_application_uploads` 迁移在仓库中不存在。

新增正式前向迁移 `20260918210000_allow_interactive_application_uploads`，在单条 `ALTER TABLE` 中替换来源约束，保留全部旧来源并增加应用上传来源。没有数据清理、字段变更或历史迁移改写；Prisma 的 `source` 仍为现有字符串字段，SDK、接口及前端类型无需调整。数据库继续拒绝未知来源。

已获得保留历史数据和字段、修复本地环境的确认。部署只执行此项待应用迁移，核对迁移前后原有 238 条文件记录及 113 条历史迁移记录均未改变。其他环境需要随代码部署执行 `pnpm db:migrate:deploy`；应用包无需重新发布。写入新来源后，不应回退到无法识别该来源的旧 API。

## 验证

- 修复前：新增迁移存在性测试失败；隔离 PostgreSQL 集成测试复现来源约束错误。
- `node --test scripts/database-interactive-applications.test.mjs`：3 项通过，已纳入部署测试。
- `pnpm test:interactive-files:postgres`：通过。覆盖历史记录及字段保留、原迁移校验和保留、旧附件继续绑定轮次、来源隔离、非法来源拒绝、重复部署和全新安装。测试使用独立临时容器，已接入 CI。
- `pnpm --filter @linksense/api test test/interactive-sdk.test.ts test/interactive-files.routes.test.ts test/files.service.test.ts`：128 项通过。
- `pnpm test:deployment`：384 项通过。
- `pnpm --filter @linksense/api typecheck`：通过。
- `pnpm --filter @linksense/api exec eslint test/integration/interactive-files-postgres.ts --max-warnings=0`：通过。
- `pnpm --filter @linksense/docs test`：21 项通过；`pnpm --filter @linksense/api test test/interactive-application-docs.test.ts`：4 项通过。
- 本地 API 容器内使用 Fastify inject 和真实文件服务、权限检查、PostgreSQL、Redis、文件存储验证：应用 PNG / PDF、普通聊天 TXT 上传均返回 201，存储字节一致；列表来源隔离及移除成功，临时文件已清理。测试身份在进程内注入，未覆盖浏览器登录和 iframe 交互。
- `git diff --check`：通过。此阶段只修复上传迁移；下面记录后续任务提交问题的代码修复及验证。

## 刷新后任务提交冲突

上传修复后，2026-09-18 21:26:31（Asia/Shanghai）的首次识别请求已返回 202；启动耗时约 152 秒，原轮次在 21:29:20 完成。用户在持续等待时刷新了页面，后续点击得到 409。原请求仍在服务端执行，不能再启动一个重复轮次。

根因是任务详情遗漏了持久化的 `ConversationTurnStartIntent`：原生轮次投影尚未生成时，刷新会丢失前端缓存中的提交记录，页面看起来没有任务。此项属于平台的请求状态恢复缺陷，应用的 SDK 调用无需更改。

- 服务端详情增加 `starting_turn`，从已受理请求恢复输入、附件展示信息和原轮次身份；检查所有者、运行环境代次和已有轮次投影，只返回经过 Schema 校验的公开字段。
- 交互应用和原生聊天共用详情查询，刷新时恢复原请求与等待状态；不覆盖较新的本地提交或停止请求。
- 相同应用、输入和附件的默认资源请求再次点击时复用原受理回执，不再次 POST；不同输入、附件、显式请求标识或自定义资源选择仍拒绝在忙碌任务上并发提交。
- 原生轮次生成或完成后沿用现有投影与清理机制。没有新增轮次重试、输入重放、数据库字段或对既有任务的转换；现有应用无需重新发布。
- 开发文档随内置资源发布，因此同步更新内置资源内容指纹；保留既有内容指纹及旧快照更新测试，确保文档更新能进入已安装运行环境。

验证覆盖刷新恢复、同请求不重复发送、不同请求拒绝、原任务完成后不恢复旧请求、其他所有者/运行环境隔离、附件及内部字段脱敏，以及历史任务无待启动记录的读取。新增内容复用已有状态和双语文案，没有新增用户文案。未使用浏览器或 Playwright。

本地开发容器已自动同步修复，核对 API、共享契约和前端关键文件的 SHA-256 与工作区一致，API / 前端健康。通过容器内真实服务和数据库只读查询，确认原发票任务仍为 completed，`starting_turn` 为空，未重新运行任务。

最终验证：

- `pnpm --filter @linksense/api exec vitest run --pool=threads --maxWorkers=1 --maxConcurrency=2`：279 个文件、3,438 项全部通过。此前与前端全量和构建同时执行时，文件系统测试触发过 5 秒超时；失败项单独复跑以及最终低并发全量均通过，未放宽超时或断言。
- `pnpm --filter @linksense/web test:unit`：应用组 253 项，其余组 3,603 项，合计 3,856 项全部通过。
- `pnpm --filter @linksense/shared test`：497 项全部通过。
- API / Web 的 `typecheck`、`build`，Shared 的 `build`，受影响 API / Web 文件的 ESLint 均通过。Web 构建保留已有大分包及 `stream` 外置提示。
- `git diff --check`：通过。未运行浏览器测试、Runner 全量或整个工作区的全量流水线。

此修复恢复启动等待期间的真实状态，不改变模型或运行器的启动耗时。并发不同识别请求仍可能按现有单任务执行规则返回冲突。下面的历史迁移校验和差异仍未处理，不应将本次验证视作全部历史结构一致性验证。

## 独立的历史迁移问题

应用此次迁移前，发现本地数据库中以下历史迁移的已存校验和与当前仓库文件不同。本次未修改其文件或数据库迁移记录，新增迁移正常应用；该差异不阻断本次上传验证，但不能据此认定整个数据库没有历史结构漂移。

- `20260725210000_remove_capability_sharing`
- `20260726130000_add_knowledge_image_understanding`
- `20260727160000_add_internal_applications`
- `20260804120000_add_conversation_turn_attempts`
- `20260807110000_add_skill_usage_activity`
- `20260826190000_add_application_usage_dimension`
- `20260903170000_remove_server_conversation_drafts`
- `20260917180000_add_web_sites`

后续应比对当时实际部署的迁移版本和当前数据库结构，再决定是否需要新的前向迁移；不应直接覆盖校验和或重置数据库。
