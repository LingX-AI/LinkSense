# 交互式应用在线开发

## 使用方式

从「插件中心 → 我的应用 → 创建 → 交互式应用」进入开发任务，也可以直接在普通任务中要求助手创建交互式应用。内置 `linksense-interactive-app-builder` Skill 使用 `linksense_core.open_application_development` 打开工程，使用 `inspect_application_development` 检查源码和调试日志。

左侧任务负责开发，右侧预览使用独立的业务任务调用真实 SDK。预览可切换显示聊天、配置已声明的资源、查看调试日志。安装按钮保存当前已预览的版本；继续修改草稿不会改变已安装版本。已有个人交互式应用可以从菜单继续开发。

开发页中间的分隔线支持左右拖动，也可聚焦后使用方向键调整宽度。两侧保留最小可用宽度，窗口变窄时上下排列。调整宽度不会清空输入草稿或重新加载应用预览；在当前工作台内改变窗口或侧栏宽度时，会按已选比例调整。

应用开发任务和预览测试任务在名称左侧显示代码图标，悬停时分别提示「应用开发任务」和「应用测试任务」。开发任务在侧栏、任务标题、搜索结果和归档列表使用同一标识。预览测试任务只在开发界面中查看，普通任务列表、搜索、归档及归档计数均排除测试任务；正式使用任务继续显示应用图标。

开发工作台默认选择「LinkSense 交互式应用开发」。该 Skill 显示锁定标记，无移除按钮，菜单和键盘选择不能取消；提交后和重新打开时仍保留。其他插件和 Skill 可以正常选择或移除。

开发任务按「开发 应用名称」命名，例如「开发 调研报告生成器」；英文为「Develop Application Name」。创建、对话中开始开发和继续开发均使用此规则。源码中的应用名称变化时，开发任务名称随预览同步更新。旧开发任务在重新打开并同步后更新名称，保留任务、源码和测试记录。应用自身和普通使用任务的名称保持原样。

命名复用后端 i18next、现有任务重命名接口及标题长度限制。名称未变时不重复写入；前端在首次成功同步和应用改名后刷新任务标题及侧栏，常规轮询不会持续刷新对话历史。该调整不新增数据库字段、迁移或依赖。

「我的应用」默认显示全部个人应用，包括尚未安装的开发草稿。搜索栏右侧的筛选支持「全部应用 / 开发中 / 普通应用 / 交互式应用」，可与关键词搜索组合使用；筛选写入页面地址，刷新后保留。未安装草稿显示「开发中」和「开发」入口。有未安装改动的已安装应用也显示「开发中」，保留已安装版本的使用入口。

同一个开发工程及其已安装应用合并为一张卡片，内部预览应用不会单独出现在列表中。没有成功生成预览的工程仍可被找到。状态由是否安装、源码摘要是否与安装摘要一致及源码错误决定，不需要新增数据字段。安装当前草稿后自动恢复为普通应用卡片；「更多 → 继续开发」始终保留。

开发任务的项目在打开工程时固定。迁移开发任务或删除其所在项目会被服务端拒绝，避免改变工作目录后遗失源码。归档或删除开发任务均保留应用、源码和测试记录；工程单独保存 workspace_rel_path 和 project_id，解除任务关联后仍受项目删除保护。

## 实现边界

- 使用已有 JSZip 打包和应用包校验器，使用已有 parse5 注入仅限开发预览的错误收集脚本，没有增加第三方依赖。
- 工程目录保存可运行的静态 HTML、JavaScript、CSS 和资源。框架项目应在工程目录之外编译，将静态结果写入工程目录。
- 打开开发面板时每 1.5 秒检查源文件；文件尚未写完或不合法时保留最后有效预览。安装校验用户看到的源码摘要和预览版本，拒绝安装未预览的改动。
- 预览包与安装包均为不可变版本。正在运行的调试任务保留原版本，结束后再切换到最新预览。
- 应用源码路径、体积、符号链接及文件稳定性均被校验；预览错误限量并脱敏。工具调用需要当前用户、开发任务和运行中的投影 turn 共同授权。
- API、Runner controller、worker 和 Core MCP 完整转发工程打开、诊断检查和测试记录检查三项开发工具。Plan 模式和已发布应用的服务环境不允许调用这些开发工具。
- 继续沿用原生 Codex turn 生命周期，没有增加自动重放或额外执行尝试。
- 所有新增界面及错误支持 zh-CN / en-US。工作台分隔线使用 `--app-border`，桌面左右分栏、窄屏上下分栏。

## 升级

增量迁移 `20260917210000_add_application_development` 新增开发工程表与 `applications.development_only`（默认 false），不删除现有表、字段或数据。旧应用仍沿用原应用包与运行入口。

先执行正式 Prisma 迁移，再部署同一版本的 API、Runner controller、worker 和 Web。开发环境还需运行 `pnpm dev:worker:rebuild` 更新 worker 镜像；仅热更新 API 不会更新已有 worker 镜像中的工具注册表。该命令会回收开发 worker，应在任务空闲时执行。

内置 Skill 的目录权限为 0750、文件为 0640。内置内容更新需同步 `BUILT_IN_CAPABILITY_RUNTIME_REVISION`。运行前通过包含内置版本的快照目录索引校验缓存，升级后自动生成新快照，原有资源无需重新导入。

## 验证

本次运行并通过：

- API 源文件校验、开发服务、认证路由、诊断、清理及任务回归：349 项。
- 开发工作台、交互运行页、应用列表组件：40 项；输入框与固定 Skill、开发工作台：106 项（包含前述工作台测试）；中英资源与回退：51 项。
- 新共享开发契约与诊断脱敏：10 项；此前也运行了共享包全量测试。
- Runner 工具、执行池及事件回传相关测试：246 项；controller 授权与转发包含在其中。新增 worker HTTP 鉴权回归与工具、健康路由测试共 33 项，验证实际路由接受任务专用凭证并拒绝缺失凭证、越权和非法输入。
- 能力发布与升级缓存回归：74 项；内置 Skill 及项目约束相关测试。
- `pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts`：独立 PostgreSQL 容器先执行旧迁移并写入旧应用，再执行增量迁移。覆盖旧数据保留、旧应用运行解析、源码同步、并发更新、安装隔离、续编、授权和删除后的完整性。并发竞争中预期的唯一约束冲突会被转化为读取胜出版本。
- API、Runner、Web 类型检查与构建；涉及文件的 ESLint；worker 镜像中 Default / Plan 模式 Core MCP 注册表检查。

浏览器验收使用独立的测试开发任务。桌面分隔线计算颜色为 `rgba(32, 32, 32, 0.1)`；390px 窄屏切换为顶部 1px 分隔线、左侧 0px，页面无横向溢出。

实测完成对话修改计数器页面、自动预览、中英文切换、计数交互，以及 `open_application_development` / `inspect_application_development` 的原生工具调用。临时脚本错误在工作台显示，并能被助手读取；移除错误后预览自动更新，调试日志恢复为 0。预览通过真实 SDK 提交独立业务任务，成功返回「调试成功」。

从「我的应用 → 继续开发」重新进入同一开发任务，内置 Skill 自动选中并显示锁定标记，无删除按钮；安装状态正确保留。

一键安装后应用显示在「我的应用」。再次通过对话修改标题时，已安装包仍为 `1.1.0+build.1`；点击更新后，同一应用切换到新的不可变包 `1.1.0+build.2`。从应用列表点击使用，确认新标题、计数器与语言切换正常，并通过真实 SDK 提交任务，成功收到「安装后运行成功」。

关键复现命令：

```sh
pnpm --filter @linksense/runner test test/application-builder-route.test.ts test/application-builder-service.test.ts test/health.test.ts
pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts
pnpm --filter @linksense/web exec vitest run src/features/conversations/conversation-composer.test.tsx src/features/applications/application-development.test.tsx
pnpm --filter @linksense/runner typecheck
```

没有在本次变更后重新执行整个仓库的全量测试；验证范围为受影响模块及上述集成、浏览器流程。

## 我的应用列表与状态筛选

新增 `GET /applications/catalog`，只查询当前用户的正式应用和开发工程，按创建时间及稳定键分页。服务端合并已安装工程，先搜索和筛选，再分页；复用原有应用详情投影。共享应用、应用中心及原应用列表接口保持各自的权限边界。该调整没有数据库迁移或依赖变更。

本次追加验证：

- 共享契约 6 项、API 目录投影、认证路由与应用服务回归 45 项、前端应用列表和关联页面及中英资源 161 项通过。
- PostgreSQL 集成覆盖历史应用、尚无预览的草稿、安装去重、安装后再修改的状态变化、中文及字面关键词搜索、分页、所有权和失联任务排除。
- API、Web 类型检查与构建、涉及文件的 ESLint 通过。Web 构建仍有现有的大体积资源块提示。

## 开发分栏与任务标识

开发分栏复用 `SidebarResizer` 及已有宽度约束，默认对话占 40%；对话最小 320px，预览最小 480px，容器宽度不超过 800px 时改为上下分栏。拖动期间屏蔽内嵌预览的指针事件，松开或取消后恢复，避免跨越预览时中断拖动。

任务 API 的 `application_development_role` 是只读展示信息：开发工程关联的任务为 `development`，`developmentOnly` 应用关联的任务为 `preview`，其他任务为 null。列表按页批量查询并检查所有者，详情、重命名及分支结果使用同样的投影；不新增数据库字段或迁移。依据预览应用识别所有版本的测试任务，软删除后已归档的测试任务也保留标识。

验证结果：API 相关 424 项、共享契约 513 项、前端相关 150 项测试通过；覆盖拖动、键盘、宽度限制、取消拖动、窄屏切换、草稿与预览保留、各任务入口图标及中英文与缺失翻译回退。PostgreSQL 独立测试库验证历史应用、当前及旧版本预览、所有者隔离和归档记录。类型检查、涉及文件 ESLint、API 与 Web 构建通过，Web 保留已有资源块大小提示。按项目约定没有运行浏览器自动化或全仓库全量测试。

可复现的主要命令：

```sh
pnpm --filter @linksense/web exec vitest run src/pages/conversation-workspace.test.tsx src/components/shell/conversation-development-icon.test.tsx src/components/shell/sidebar-resizer.test.tsx src/features/applications/application-development.test.tsx src/test/application/sidebar.test.tsx src/components/shell/conversation-search-dialog.test.tsx src/pages/conversation-pages.test.tsx src/pages/archived-conversation-list-layout.test.ts src/i18n.test.ts --maxWorkers=3
pnpm --filter @linksense/api test test/conversations.service.test.ts test/conversations.routes.test.ts test/application-development.service.test.ts test/application-development.routes.test.ts test/applications.service.test.ts test/applications.routes.test.ts
pnpm --filter @linksense/shared test
pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/web build
pnpm --filter @linksense/api build
```
- 本次列表调整未运行浏览器自动化；组件交互通过 Vitest 验证。

```sh
pnpm --filter @linksense/shared test tests/application-catalog.test.ts
pnpm --filter @linksense/api test test/application-catalog.test.ts test/applications.routes.test.ts test/applications.service.test.ts
pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts
pnpm --filter @linksense/web exec vitest run src/features/applications/applications-workspace-panel.test.tsx src/features/applications/application-card.test.tsx src/features/applications/application-development.test.tsx src/features/applications/application-center.test.tsx src/features/applications/application-external-access-page.test.tsx src/pages/capability-marketplace.test.tsx src/i18n.test.ts
```

## 创建入口弹窗优化

创建方式选择拆为独立的 `ApplicationCreateDialog`，复用现有 shadcn Dialog、Button、Badge 和 Separator。顶部突出“用对话创建交互式应用”，使用随主题适配的蓝色背景、推荐标记和对话预览示意；下方按行显示普通应用与导入入口。窄屏隐藏装饰示意，保留全部操作；弹窗正文可滚动，标题与关闭按钮固定。选择页只保留面向用户的简短说明，应用包格式要求放到导入步骤。

“资源声明清单”移至导入弹窗，通过原有嵌套 Dialog 行为返回，保留已选文件与导入状态。创建、配置、导入的后端接口及数据结构不变，无数据库迁移或新增依赖。中英文用户指南同步更新入口路径。

本次验证：9 个测试文件共 219 项通过，覆盖三个入口、键盘顺序及关闭、移动端布局约束、中英文及中文回退、导入返回时文件保留和相关页面回归；类型检查、涉及文件的 ESLint、Web 生产构建、`git diff --check` 均通过。构建保留既有的超过 500 kB 资源块提示。按项目要求未运行浏览器自动化；未执行整个仓库的全量测试。

```sh
pnpm --filter @linksense/web exec vitest run src/features/applications/application-create-dialog.test.tsx src/features/applications/applications-workspace-panel.test.tsx src/features/applications/interactive-dependencies-dialog.test.tsx src/features/applications/interactive-declaration-dialog.test.tsx src/features/applications/application-development.test.tsx src/pages/capability-marketplace.test.tsx src/i18n.test.ts src/frontend-design-regressions.test.ts src/components/ui/dialog-layout.test.ts
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/web exec eslint src/features/applications/application-create-dialog.tsx src/features/applications/application-create-dialog.test.tsx src/features/applications/application-catalog-panel.tsx src/features/applications/applications-workspace-panel.test.tsx src/pages/capability-marketplace.test.tsx src/i18n.test.ts src/i18n/zh-CN.ts src/i18n/en-US.ts
pnpm --filter @linksense/web build
git diff --check
```

## 应用卡片状态与开发图标

最新调整验证：状态移至类型/版本行，以灰色小分隔点「·」连接。上述 9 个相关测试文件共 191 项通过，涉及的 4 个前端文件 ESLint 与 `git diff --check` 通过。`pnpm --filter @linksense/web typecheck` 当前被本次未修改的 `application-development.test.tsx:219` 阻塞：`getByRole` 的选项不支持 `exact`。此次纯展示调整未运行浏览器、全量测试或生产构建。


卡片名称下方与应用类型、版本同一行展示开发状态与启停状态，统一使用辅助文字色，无底色或边框，各项信息之间统一使用与类型/版本相同的小分隔点「·」，分隔点两侧使用 8px 间距。未安装草稿只有开发状态；已安装且继续修改的应用同时显示两种状态。窄卡片允许状态换行，长名称支持两行，并保留完整可访问标签及悬停文本。

开发图标在原图右下角覆盖半透明代码角标，不再使用施工标记或整块遮罩，不替换原图标，不截获鼠标事件，也不重复朗读名称下方的状态。模型信息独立保留在资源区域，移除正文中的重复状态。状态仍来自既有接口的 `status` 和 `has_changes`，无后端接口、数据结构、迁移或依赖变更。

本轮简化验证通过：9 个测试文件共 191 项、涉及文件的 ESLint、Vite 资源构建及 `git diff --check`。测试覆盖草稿、已安装应用继续开发、正常启用、停用、紧凑状态、代码角标、长名称两行显示、原有操作、中英文与回退。

完整类型检查受到另一处并行变更阻塞：`apps/web/src/features/applications/application-test-history.tsx:101` 将 `i18n.resolvedLanguage`（`string | undefined`）传入要求 `"zh-CN" | "en-US"` 的 `formatDateTime`。本轮未修改该组件，也未将单独的 Vite 构建视为完整 `pnpm build` 通过；修复后需重新运行类型检查及完整构建。资源构建仍有既有的大资源块提示；本次未运行浏览器自动化或整个仓库的全量测试。

```sh
pnpm --filter @linksense/web exec vitest run src/features/applications/application-card.test.tsx src/features/applications/application-details-dialog.test.tsx src/features/applications/applications-workspace-panel.test.tsx src/features/applications/application-center.test.tsx src/features/applications/application-external-access-page.test.tsx src/pages/capability-marketplace.test.tsx src/i18n.test.ts src/components/ui/card.test.tsx src/frontend-design-regressions.test.ts
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/web exec eslint src/features/applications/application-card.tsx src/features/applications/application-card.test.tsx src/features/applications/application-details-dialog.tsx src/components/ui/badge.tsx
pnpm --filter @linksense/web exec vite build
git diff --check
```

## 试运行记录与删除清理

- 普通任务列表在数据库分页、搜索和计数之前排除当前用户的 `development_only` 应用任务。现有测试记录通过原有应用关联识别，无需新增字段或数据迁移。
- `GET /application-developments/:id/test-sessions` 在分页前筛选有轮次、启动意图、待处理请求或用户消息的会话，旧版本产生的空记录也不再展示。`POST /:id/test-sessions/restart` 校验页面上的版本及当前会话；尚未提交过的会话直接复用，已经提交过则创建新会话并归档上一轮。`DELETE /:id/test-sessions/:conversationId` 只允许删除所属工程的非当前空闲记录。
- 代码更新在数据库行锁内复用尚未提交过的预览会话并更新应用包引用，不额外准备运行环境或登记任务。已提交过的会话保留原始快照；源码仍通过不可变包提供实时预览，测试界面不展示内部 `dev.n` 版本号。前端在同一会话的预览更新后刷新包信息；重新开始测试会重置预览表单，即使复用了未使用会话。
- 创建、切换测试会话与删除工程使用数据库行锁。当前会话切换和新会话记录在同一事务中保存。轮次提交沿用原生 Codex 生命周期，在原有任务行锁下拒绝过期测试会话和已被更新的预览包；不增加重放、重试轮次或自定义运行状态。
- 新测试使用应用专用运行目录；重新开始测试清空对话上下文，保留应用工作文件。旧测试按原有路径清理，不删除用户共用工作目录。
- 删除开发任务只将工程 conversation_id 置空，应用、草稿、源码位置及全部测试记录仍由工程持有。应用目录查询和测试运行准入不再要求原开发任务存在。仅从应用列表删除应用，才在同一事务删除工程和测试数据，并为每个测试保存 RuntimeCleanupOutbox。后台清理仍由现有任务调度恢复。孤立预览的判定依据是工程是否存在，而非开发任务是否存在。
- 删除仍在运行、有启动意图或待处理请求的测试会被拒绝，提示先从试运行记录中停止或处理待办。不会在运行尚未结束时强行删除数据。
- 正式安装应用和正式使用任务保留。产物继续遵循已有留存审计策略，应用包继续遵循现有应用删除策略；不额外清空 MinIO 或共享目录。
- `inspect_application_tests` 仅在当前开发任务的有效执行轮次中开放，可分页查询测试会话或读取选定会话最近 40 条输入输出，单条最多 8000 字符并标明截断。测试输出按不可信数据处理。
- 本次没有新增依赖或数据库结构变更；前端使用现有 Tabs、Dialog 和任务详情，旧记录只读，当前测试可停止运行和处理待办。

本轮验证（2026-09-17）：API 9 个文件 388 项、Web 4 个文件 117 项、Runner 4 个文件 218 项、共享契约 13 项、部署检查 61 项通过。覆盖重新测试的重复提交和过期页面、已删除预览、权限隔离、历史记录只读且不预热运行环境、归档删除提示、中英文及回退、原生执行池工具就绪检查。上文记录的前端类型问题已修复，本轮 API / Web / Runner 类型检查、涉及文件 ESLint、三个应用构建与共享包构建均通过；Web 构建保留已有的大资源块提示。

独立 PostgreSQL 集成验证：历史草稿增量升级后仍可读取和同步源码；删除开发任务后应用可见、测试可用且不会被后台误清理；并发恢复开发只生成一个新任务；已归档任务恢复到活动列表。显式删除应用覆盖忙碌保护、事务回滚、并发测试重启、持久清理和历史无主测试回收。应用删除保留开发任务及正式任务。测试使用临时容器，不修改用户数据库。

Worker 生产镜像已重建并通过任务身份下的真实 MCP 启动与 Default / Plan 工具清单检查。确认本地运行任务数为 0 后执行 `pnpm dev:worker:rebuild`，控制器恢复健康，后续 worker 已使用新镜像。未运行浏览器自动化（遵循项目约定），未执行全仓库全量测试。本轮没有数据库迁移、依赖安装或 Git 提交。

## 空试运行记录优化验证（2026-09-17）

回归覆盖未提交预览的复用、已提交测试的快照保留、并发提交保护、历史空记录在分页前过滤、排队测试在实际轮次建立前可见、跨用户及跨应用游标拒绝、未提交时重置表单、同一会话内实时刷新页面、中英文及回退文案。烧瓶图标用于试运行记录页签，记录仅展示运行次数和状态，不展示内部开发版本。

已运行并通过以下相关检查：

- `pnpm --filter @linksense/api test test/conversations.service.test.ts test/application-test-lifecycle.test.ts test/application-development.service.test.ts test/application-development.routes.test.ts`
- `pnpm --filter @linksense/api test test/application-development-title.test.ts test/application-development-lifecycle.test.ts test/application-development-deletion.test.ts test/application-development-diagnostics.test.ts test/application-development-recovery.test.ts test/user-home-capability-materializer.test.ts`（文档同步更新内置资源摘要后，重新运行 materializer 测试通过。）
- `pnpm --filter @linksense/web exec vitest run src/features/applications/application-development.test.tsx src/features/applications/interactive-application-page.ui.test.tsx src/i18n/date.test.ts --maxWorkers=2`
- `pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts`：在临时 PostgreSQL 中连续更新到第 9 次，始终只有一个空预览会话且历史为空；随后提交测试并修改代码，原始快照及结果保留；旧空记录不影响分页，也随应用删除清理。
- API、Web 的 `typecheck` 和 `build`、涉及文件的 `eslint --max-warnings=0`，以及 `git diff --check`。

本轮复用了 Prisma、TanStack Query、现有组件及 Lucide 图标，没有新增依赖、数据库迁移或历史数据清除。API / Web 修改已同步到本地运行容器；未运行浏览器自动化及全仓库测试。Web 构建仍有既有的浏览器模块适配与资源块大小提示。

```sh
pnpm --filter @linksense/api test test/application-development-recovery.test.ts test/application-development-cleanup.test.ts test/application-development.service.test.ts test/application-development.routes.test.ts test/application-test-lifecycle.test.ts test/conversations.service.test.ts test/jobs.test.ts test/built-in-application-builder.test.ts test/user-home-capability-materializer.test.ts
pnpm --filter @linksense/web exec vitest run src/features/applications/application-development.test.tsx src/features/applications/interactive-application-page.ui.test.tsx src/pages/conversation-pages.test.tsx src/i18n.test.ts --maxWorkers=2
pnpm --filter @linksense/runner test test/application-builder-service.test.ts test/application-builder-route.test.ts test/core-service-registry.test.ts test/process-pool.test.ts
pnpm --filter @linksense/shared test tests/application-test-sessions.test.ts tests/application-development.test.ts
node --test scripts/deployment.test.mjs
pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/shared build
pnpm --filter @linksense/api build
pnpm --filter @linksense/web build
pnpm --filter @linksense/runner build
pnpm dev:worker:rebuild
git diff --check
```

## 应用类型筛选

「我的应用」的同一个单选下拉框提供全部应用、开发中、普通应用、交互式应用。复用现有 Zod 枚举、Select、URL 状态和 TanStack Query 查询缓存，在共享筛选契约中增加 `standard`、`interactive` 两个值。应用类型依据已有 `applications.kind`，未安装草稿归入交互式应用；在 SQL 中先筛选再分页，保留所有权、隐藏预览和开发工程去重边界。无新依赖或数据库迁移，既有数据及 all/developing 查询保持可用。发布时 API 与共享包应先于或同步前端上线，旧 API 不支持新增的筛选值。

验证覆盖中英文、缺失翻译回退、URL 恢复、筛选切换、搜索组合、空结果、携带筛选翻页、后端参数验证和 SQL 参数绑定。实际执行：

- `pnpm --filter @linksense/shared build`：通过。
- `pnpm --filter @linksense/shared test -- tests/application-catalog.test.ts`：脚本实际运行共享包测试，共 518 项通过。
- `pnpm --filter @linksense/api exec vitest run test/application-catalog.test.ts test/applications.routes.test.ts`：25 项通过。
- `pnpm --filter @linksense/web exec vitest run src/features/applications/applications-workspace-panel.test.tsx src/pages/capability-marketplace.test.tsx src/i18n.test.ts src/features/applications/application-center.test.tsx`：153 项通过。
- API 和 Web 的 `typecheck`、涉及文件的 ESLint 及 `git diff --check`：通过。

- `pnpm --filter @linksense/web build`：通过。

未运行浏览器验证或真实 PostgreSQL 集成验证，本次数据库查询通过仓储单元测试检查筛选、分页和隔离条件。

## 开发任务与应用生命周期分离（2026-09-17）

用户确认删除开发任务不应删除应用，本节替代上文最初的任务级联删除行为。源码继续保存在用户工作区，应用工程记录保存独立的工作区位置和项目归属；开发任务关联允许为空。列表直接按工程所有者读取，不再以原任务存在为前提。

- 增量迁移 `20260918010000_detach_application_development_lifecycle` 新增 `workspace_rel_path`、`project_id`，从现有合法开发任务回填，允许 `conversation_id` 为空，并新增所有者/项目索引。保留既有数据、字段和已应用迁移；没有 DROP、清空或恢复历史删除的应用。若旧记录没有合法源任务，迁移会原子失败，禁止猜测路径，须先修复该记录。
- `POST /application-developments/:id/resume` 复用活动任务或取消归档；原任务删除时，在创建任务事务内锁定工程并建立新关联。并发打开复用同一任务。保留原源码目录、项目、安装关联及测试历史。
- `DELETE /application-developments/:id` 仅删除开发工程及其测试，已安装应用保持可用；删除整个应用仍使用应用删除接口。两者都持久化运行资源清理记录，保留开发任务及正式任务。运行中的测试阻止应用删除，但不阻止删除空闲的开发任务。
- 后台只回收没有所属应用工程的预览，不回收仅失去开发任务的工程。项目中只要仍有工程源码，即使任务已经删除，也会阻止删除该项目。
- 部署顺序：先执行正式迁移，再生成 Prisma Client 并加载新版 API / Web。不能回滚到强制依赖开发任务的旧 API。现有草稿及旧应用已通过升级、读取、修改、预览、安装、继续开发验证；无需重新导入或发布。

本轮验证：`pnpm --filter @linksense/api test` 全量 271 个文件、3270 项通过；Web 相关交互与中英文/回退测试通过；共享包全量测试及新增可空关联契约回归通过。API、Web、Runner 类型检查，相关 ESLint，共享包/API/Web 构建通过。`pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts` 使用隔离 PostgreSQL 验证历史记录回填、任务删除保留应用、并发恢复、应用显式删除、事务回滚、测试活动保护和无主清理。

本地已运行 `pnpm db:migrate:deploy`、`pnpm db:generate` 并刷新 API；迁移前检查现有草稿均有合法源任务，迁移后验证源码位置和项目归属一致、应用目录可读、API ready。按用户要求未恢复以前删除的应用；遵循项目约定，未运行浏览器自动化。未新增依赖或执行 Git 提交。

## 开发中的应用配置能力（2026-09-17）

开发面板的“配置资源”改为“配置能力”。复用现有 Base UI / shadcn 多选组件、资源选项接口、Zod 清单契约与资源授权解析器，支持插件、技能、知识库和 MCP 的搜索、分页、多选、移除及清空。即使清单没有依赖或预览尚未创建，也可打开配置。失效的选择保留名称，提示替换或移除；中文、英文及缺失语言回退均覆盖。

- `GET /application-developments/:id/capabilities` 读取当前源码摘要与能力配置，识别旧应用的声明和实际匹配；`PATCH` 提交摘要和完整依赖替换。后端先校验工程所有权、资源所属用户、类型和启用状态，再用服务端资源名称生成声明。
- 仅重写源码 `manifest.json` 的 `dependencies.plugins`、`skills`、`knowledge_bases`、`mcp_servers`。保留其他清单字段和代码文件，不写入凭据。候选包先通过既有包校验器，临时文件与跨进程锁位于包目录外；写入前再次核对源码摘要，使用原子重命名替换清单，拒绝过期配置覆盖新源码。
- 配置写入与预览发布共用源码锁。预览重新生成实际运行绑定；运行中的测试保留既有上下文。正式安装包仅在“安装／更新应用”后变化。保存失败时界面保留选择并支持重新读取配置。
- 继续开发既有导入应用时复制其实际资源映射，包括暂不可用的映射，允许在新编辑器修复。保存后将实际本地资源 ID 写回源码；没有新增字段、数据库迁移或依赖，也不要求重新导入旧应用。
- 内置开发 Skill 与中英文帮助文档说明新入口和持久化方式，要求助手重新读取并保留用户手选能力；同步更新内置内容摘要，以便已有任务加载新版指引。

本轮实际执行：

- `pnpm --filter @linksense/api test`：272 个文件、3290 项通过；其后新增源码工作区缺失回归，相关 8 个文件、96 项再次通过。
- `pnpm --filter @linksense/shared test`：64 个文件、520 项通过。
- Web 配置弹窗、开发面板、既有依赖匹配弹窗、应用中心与 i18n：5 个文件、132 项通过。
- `pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts`：隔离 PostgreSQL 验证四类资源写入源码、预览和正式包，真实运行绑定、越权拒绝、清空配置、安装隔离；另验证旧导入应用的实际映射保留、失效能力可修复和继续开发可执行。
- API / Web `typecheck`，共享包 / API / Web `build`，相关文件 ESLint 及 `git diff --check`：通过。Web 构建仍有既有文档预览依赖的浏览器 externalization 与大分块提示。

本地 API ready，新配置接口已加载并要求认证。遵循项目约定，未运行浏览器或 Playwright 自动化；没有执行 Git 提交。

## 调试菜单与对话命名

开发工具栏将“新建调试对话”“调试对话记录”和“调试日志”收拢到最右侧的“调试”下拉菜单。当前记录或日志视图显示名称，菜单标记当前选项，“应用预览”返回原预览且不重建页面。新建调试对话沿用现有上下文隔离、空会话复用及历史保留规则。
# 试运行启动卡在“正在思考”的修复验证（2026-09-17）

此次故障发生在模型执行前：开发预览使用独立的应用运行环境，但能力预检只在存在已发布版本时选择该环境。草稿的能力目录因此被发布到了个人环境，实际预览 Worker 启动时找不到 `control/capabilities`。异步启动失败虽然写入了错误事件，界面的乐观等待状态却仍在等待一个从未创建的 turn。

- 预热、启动预检和启动准入共用根据实际工作区决定的能力范围。草稿预览使用已配置的当前资源，已发布应用继续使用冻结的资源快照，个人任务保留个人范围；缺少发布快照仍拒绝启动。
- 确定未启动的失败事件附带提交标识。前端只结束匹配提交的等待状态，支持错误早于 HTTP 回执、晚于回执及从详情恢复三种情况；普通错误和原生断线事件不被当作结束信号。
- 已接受的提交确定结束后，再次手动试运行产生新提交标识；请求仍在进行时去重，响应丢失时保留原标识。没有增加自动重放或整轮重试。
- 不涉及数据库结构迁移。已有错误记录仍可读取；已打开的旧页面需刷新加载修复，清除原先遗留的等待状态。前后端事件契约须一起发布。

本次实际执行的检查：

| 命令 / 场景 | 结果 |
| --- | --- |
| `pnpm --filter @linksense/api test test/conversations.service.test.ts test/services.preflight.test.ts test/application-test-lifecycle.test.ts test/application-development-capabilities.test.ts test/user-home-capability-materializer.test.ts` | 398 项通过，先用回归测试复现环境错误及缺少失败关联信息 |
| `pnpm --filter @linksense/web exec vitest run src/test/application/interactive-submission.test.tsx src/test/application/error-notifications.test.tsx src/features/conversations/conversation-start-failure.test.ts src/features/conversations/conversation-execution-lifecycle.test.ts src/features/applications/interactive-application-submission.test.ts --maxWorkers=2` | 32 项通过，涵盖停止思考、错误提示、再次提交、旧错误不影响新提交 |
| `pnpm --filter @linksense/shared test tests/conversation-start-failure.test.ts tests/contracts.test.ts tests/events.test.ts` | 88 项通过，包括已有事件读取与无效关联信息拒绝 |
| `pnpm --filter @linksense/api typecheck` / `pnpm --filter @linksense/web typecheck` | 通过 |
| API 与 Web 的变更文件使用 `pnpm --filter <package> exec eslint ... --max-warnings=0` | 通过 |
| `pnpm --filter @linksense/shared build` / `pnpm --filter @linksense/api build` / `pnpm --filter @linksense/web build` | 通过；Web 仍有既有的文件预览依赖和大分块警告 |
| 当前预览环境的实际预热 | 能力目录发布到预览 Worker，原生 app-server 预热成功 |
| 本地真实 API + Worker + 模型试运行 | 临时开发应用提交一次短任务，获得 native turn、预期回答及 completed 状态；记录从 0 条变为 1 条。临时开发工程、任务和源文件已清理 |

按项目要求未使用 Playwright 或浏览器自动化。真实接口验收验证启动与结果回传，未重放用户的完整调研请求。


## 已发布版与开发草稿的目录展示

目录每个应用只出现一张卡片：有已发布版本时始终显示正式版的图标、名称、描述、版本及资源数量，未发布草稿才显示开发角标与“草稿”。存在未发布修改时，在正式版资源统计的 MCP 数量右侧提示“有新开发版”。开发入口只放在三点菜单中。详情展示独立的草稿信息、资源数量与保存时间，不覆盖正式版信息；开发版资源计数来自当前预览包的依赖声明，历史包缺少依赖声明或尚无预览包时为零，不读取正式版数量填补。

查询在分页前搜索正式版和草稿的名称、描述；开发中筛选按工程更新时间和稳定键分页。目录响应新增草稿的 capability_count、knowledge_base_count、mcp_server_count，与共享类型和前端同步更新，无数据库字段或迁移变更。部署时 API、共享包和 Web 一同更新。已有应用包无需重新导入或发布。

首次从已发布应用创建开发工程时，在同步预览的事务内记录源快照基线，单纯打开开发不算未发布修改。实际编辑和资源配置仍产生待发布状态，发布成功后清除。删除草稿与删除应用是两个显式操作；草稿删除复用行锁、忙碌检查和事务内持久清理，只删除预览应用与调试会话，保留正式版及源任务。

验证覆盖：目录投影与查询分页、旧应用资源计数、发布失败后保留两个快照、草稿删除后正式运行和重新开发、中英卡片/详情/菜单交互及翻译回退。独立 PostgreSQL 脚本使用一次性数据库执行历史升级和完整生命周期，不访问用户数据库。前端以组件测试验证，未运行浏览器自动化。

本轮最终验证：

- `pnpm --filter @linksense/web exec vitest run --project components --project shared-components --project node src/features/applications src/i18n.test.ts --maxWorkers=4`：381 项通过。
- 在 `apps/api` 执行 `pnpm exec vitest run --pool=threads --maxWorkers=4 --maxConcurrency=2 test/application-catalog.test.ts test/application-development*.test.ts test/applications.routes.test.ts test/applications.service.test.ts`：138 项通过。
- `pnpm --filter @linksense/shared test`：537 项通过。
- `pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts`：历史数据升级、目录与草稿生命周期、正式版与草稿资源数量隔离全部通过。
- `pnpm --filter @linksense/api typecheck`、`pnpm --filter @linksense/web typecheck`、两个包中受影响文件的 `pnpm exec eslint` 均通过；API、Web、shared 的 `pnpm --filter <package> build` 均通过。Web 保留已有的产物大小提示，共享包测试有既有 sourcemap 提示。
- 对比运行容器内源码摘要，API、Web 和共享契约均为当前代码。未运行浏览器自动化。

## 发布前任务检查

发布窗口通过 `GET /applications/:id/publication-readiness` 获取 `{ has_active_tasks: boolean }`，打开时必须完成一次新检查，随后每 3 秒刷新。正在检查、有任务进行中或检查失败时禁用发布；任务结束后自动恢复，不重置填写的版本号和使用说明。检查失败可手动重试，关闭窗口后停止轮询。

接口仅允许应用所有者访问，响应禁止缓存，且不返回任务标识或内容。检查与发布执行复用 `hasActiveApplicationTasks`，按当前用户和正式应用 ID 检查运行中的轮次与待启动意图。首次发布的预览应用直接返回未阻塞；独立的开发预览任务不影响正式发布。发布时仍使用原有运行环境锁与原生进程检查，防止预检查后新任务启动造成竞态。

本次未改数据库、任务生命周期或已有数据格式。API、shared 和 Web 应一同更新；已有应用无需重新创建或发布。新 Web 遇到尚未升级的 API 会显示检查失败并禁止发布，不会将接口缺失当作可以发布。
