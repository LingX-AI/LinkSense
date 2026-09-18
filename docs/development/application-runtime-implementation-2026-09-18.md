# 应用安装版本与正式、调试环境实施记录

本记录对应 [2026-09-18 确认的需求](../../requirements/application-version-and-runtime.md)，替代旧文档中“跟随发布版执行”“共享时隐式发布”“副本三方合并”的行为说明。

## 实现边界

- 普通应用、服务使用者和安装副本均按执行用户与应用 ID 使用固定 HOME、原生会话目录和工作空间。开发工程已有的私有预览应用 ID 作为独立调试身份；不会按版本或任务另建 HOME。
- `application_runtime_installations` 保存使用者明确安装的版本。`application_versions.purpose` 区分正式发布、调试快照和副本安装快照。任务上的版本 ID 仅记录最近一次接纳的执行，不决定下一次运行的版本。
- 正式发布要求严格的数字三段版本，没有历史版本时建议首次 `0.0.1`，随后递增末段；版本输入框固定展示 `v` 前缀，数据库事务内检查同号和倒退。历史带构建标识的版本仍可读取、使用和分发，新发布必须使用更高的三段版本。
- 发布仅安装到创建者。组织共享和应用中心审核分别推进各自的可安装版本，接收者首次和更新都要手动安装；跨入口使用同一安装，较旧入口不能降级已安装环境。
- 复制更新定位原副本并覆盖应用内容，保留个人凭据、会话和工作文件；所需个人资源或凭据缺失时不切换当前安装。既有权限仍生效：交互式应用提供服务，不新增复制权限。
- 实际调试提交才准备快照。同一快照可并行试运行；切换快照只检查调试环境，并校验新快照所需的插件凭据，缺失时保留上次可用快照。发布只检查正式环境，两种用途可以同时执行。
- 应用卡片以正式安装内容展示，草稿在详情和开发入口中呈现。安装、发布和更新表单提供中英文、版本说明、错误和重复提交状态。

## 安装与任务的排他边界

复用 Redis 原有租约机制，在“用户 + 应用”粒度提供共享的启动准入和排他的安装准入。私有预览应用拥有不同的键。启动租约只持有至任务入场，正常多个任务可并发；安装还会查询全部任务的运行轮次与启动意图，并请执行器确认没有未完成原生调用。

点击停止不直接解锁安装。原生工具未结束时返回对应的正式任务或测试忙碌提示；不会代替用户停止任务、排队安装或重放消息。安装时关闭目标环境的空闲任务进程，按既有原生插件流程重新加载资源；未完成准备或校验不得更新安装指针。其他用户、其他应用、正式与调试的另一环境不受影响。

文件更新使用现有 `proper-lockfile` 与目录替换工具；版本、绑定、安装选择在事务中提交。未发布草稿、上架审批和资源校验错误不改变原来可用的安装。同名工作文件并发写入和外部知识库、MCP 的实时变化仍按需求允许。

普通应用支持创建并发布、编辑并发布；交互式应用导入和更新时先展示应用包元数据，再执行导入并发布或更新并发布。已有普通应用的编辑、交互式应用包的更新，与版本快照和创建者安装选择在同一事务中提交。首次创建或导入后若发布失败，窗口保留已创建的应用 ID，重试不重复创建应用。

发布前关闭旧任务进程使用控制器的专用接口，仅查询已有 Worker。确认环境没有 Worker 时直接返回成功，保留所有历史文件，不为关闭进程而启动或准备新的环境；已有 Worker 返回任务忙碌或无法确认其他控制器上的 Worker 状态时仍阻止发布。

开发发布接口先校验完整请求，再将 `source_hash` 与正式发布参数分开传递。源码哈希只用于确认用户审阅的草稿，不能混入严格校验的版本号和使用说明对象。回归测试通过实际 HTTP 路由覆盖首次发布和更新发布；PostgreSQL 集成测试同时检查版本快照、使用说明、安装选择和已发布源码哈希。

## 历史数据升级

新增的两项正式迁移：

- `20260918130000_application_runtime_installations`：新增安装表和版本用途，回填已有服务任务最近接纳的版本及创建者已有发布指针。
- `20260918140000_application_publication_metadata`：补齐旧版本 JSON 缺失的描述和图标；已有值保持原样。

不删除旧字段、任务、发布包、审批或用户文件。目录归并与旧安装固定化必须离线执行，未完成时启动检查会阻止新代码使用混合布局。

1. 停止新任务入口，等待所有轮次与工具结束；停止 API、Controller 和 Worker，保存 PostgreSQL 备份。
2. 使用同一修订代码执行 `pnpm db:generate`、`pnpm --filter @linksense/shared build` 和 `pnpm db:migrate:deploy`。部署环境须提供已解析、可访问的 `DATABASE_URL`，以及绝对路径 `LINKSENSE_USER_DATA_ROOT`。
3. 在包含 API 与 Runner 源码的仓库中执行下述命令。`CODEX_BIN` 指向项目锁定版本 **0.154.0** 的可执行文件；工具先在副本上调用原生 app-server 完成会话数据库升级，不手写原生 SQLite 迁移，也不发送模型请求。

```sh
pnpm --filter @linksense/api runtime:convert-applications \
  --output-directory /absolute/path/application-check

pnpm --filter @linksense/api runtime:convert-applications \
  --apply --workers-stopped \
  --database-backup /absolute/path/database.dump \
  --output-directory /absolute/path/application-conversion
```

输出目录必须为新目录且位于用户数据目录之外；Linux 下以具备恢复文件归属权限的运维身份执行。转换保留原始目录、数据库备份和提交日志。旧独立环境的工作文件移入 `workspace/imports/<旧环境 ID>/`，个人工作区文件移入 `workspace/imports/personal/<原工作目录>/`，已登记文件引用同步更新。个人原目录不搬走。同名工作文件均保留；不同凭据或不能无损归并的原生记录会中止转换。

创建者以升级时实际配置形成安装基线，不推进原有共享和中心指针。服务使用者优先保留已接纳的版本；没有接纳版本时保留原分发版本。已有副本按自己的配置形成基线。已真正执行过的调试任务保留最近使用的页面快照；仅打开预览的不创建调试安装。版本无法解析、资源缺失或冲突时停止，不能以重新导入或清空目录代替恢复。

发生中断时保持服务停止，用同一日志目录恢复：

```sh
pnpm --filter @linksense/api runtime:convert-applications \
  --recover --workers-stopped \
  --output-directory /absolute/path/application-conversion
```

恢复会按数据库是否已提交保留归并结果或恢复原目录；若安装基线尚未完成，可使用新的检查/输出目录重新运行转换。该步骤可重复执行，已完成的安装不再次升级。状态不一致时保持启动隔离并保留全部备份。完成后启动服务，验证旧任务和文件；备份保留期另行决定，不自动清除。

本地环境已执行：归并 **115 组应用环境、121 个历史任务**，补建 **4 个创建者安装基线**，服务已恢复健康。备份位于本地 `.data/dev/application-runtime-backup/`，未删除原始数据。

## 验证与验收对应

| 范围 | 验证 |
| --- | --- |
| A01–A03、A13–A14：固定环境、并发与排他 | 环境路径单测、启动准入单测、真实 Redis 两客户端集成；另一用户和正式/调试身份互不阻塞 |
| A04–A10、A19–A22：发布、分发、手动安装、权限、语言 | 版本契约、前端表单和卡片测试；真实 PostgreSQL 分发和审批集成 |
| A11–A12、A15–A18：忙碌、失败保护、覆盖、旧任务 | 全环境运行轮次和启动意图集成；只停止一个任务仍拒绝；凭据失败保留旧选择；移除 Skill 后不可发现 |
| A23、A34：历史升级 | 从旧迁移链写入旧结构后升级；正式/调试任务、原目录、原生登录文件、元数据、分发指针、重复转换和失败恢复 |
| A24–A31：独立调试 | 真实调试提交、同快照并发、草稿变更隔离、调试运行中发布、正式运行中切换调试快照 |
| A32–A33：清理与授权 | 开发工程删除、孤儿回收、任务引用检查、越权拒绝与正式任务保留 |

实际执行命令：

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/shared test
pnpm --filter @linksense/api test
pnpm --filter @linksense/runner test
pnpm --filter @linksense/web test:unit
pnpm --filter @linksense/api exec tsx test/integration/application-runtime-installation-postgres.ts
pnpm --filter @linksense/api exec tsx test/integration/application-distribution-postgres.ts
pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts
pnpm test:codex:native-plugin-refresh
```

原生测试使用锁定的 Codex 版本，验证同版本号的插件内容替换、Skill 发现与移除，以及在途 MCP 完成后更新。PostgreSQL/Redis 集成测试只使用临时容器和目录，结束自动清理，不读取本地业务数据库。

验证结果：API 3,369 项、前端 3,762 项、共享契约 483 项、执行器 831 项和部署脚本 383 项通过。执行器另有一项仅 Linux root 可运行的目录权限测试，在 macOS 下按既有条件跳过，已在本地 Linux 容器单独执行通过。三组数据库集成与原生插件测试通过；API、Web、Runner 的类型检查、lint 和构建通过，共享包构建通过。一次与构建并行的文件清理测试触及 5 秒超时，单独重跑及完整 API 重跑均通过，未放宽超时或删除断言。

类型检查、lint 和构建分别使用 `pnpm --filter @linksense/api <脚本>`、`pnpm --filter @linksense/web <脚本>`、`pnpm --filter @linksense/runner <脚本>`，脚本为 `typecheck`、`lint`、`build`。部署测试命令为 `pnpm test:deployment`。前端构建保留部分文档预览包大于 500 KiB 的体积提示，不影响构建完成。

按项目约定未进行浏览器自动化，也未调用真实付费模型进行整轮测试。本次功能链路验证使用组件交互、HTTP/真实数据库/Redis 集成，以及不启动模型的原生 Codex 测试；不据此声称完成了真实模型端到端验收。

## 外部访问自动更新补充（2026-09-18）

外部会话首次采用创建者的正式安装；后续任务启动和旧任务续聊前，在该访问者的环境空闲时自动安装创建者当前正式版。有未结束任务或启动准入时保留原版，正常并行不受影响；真正更新期间阻止该环境的新执行。组织共享和应用中心仍手动安装。

更新复用 `ApplicationRuntimeGate`、已有发布包完整性检查、资源与凭据校验和事务安装选择。自动尝试不设置 Redis 的读者排空标记，因此因忙碌放弃更新后，新任务仍可使用原版。安装成功后记录现有的应用安装审计，失败返回原有中英文错误，本次不启动任务，也不改变原安装；后续请求可以重试。未新增重试队列或整轮重放。

外部身份按已有会话记录识别，包括历史安装渠道为 `direct` 的记录。授权在准备前和提交前复核；未改变身份、任务、工作文件或数据库结构，无需迁移。前端和接口响应结构保持不变，继续使用现有更新中与资源不可用反馈。公开与需要认证的入口共用该任务启动路径。

新增回归覆盖空闲更新、忙碌保留、并发启动、包/凭据失败、权限撤销、历史渠道、禁止降级和更新租约；真实 PostgreSQL 与两个 Redis 客户端验证任务/启动意图保护、旧 Skill 替换、文件与原生会话身份保留、失败恢复，以及普通共享安装不被自动更新。中英文用户文档同步说明外部自动更新与组织/中心手动安装的区别。

本次补充验证：完整后端 **3,413 项**、文档 **21 项**通过，真实 PostgreSQL/Redis 安装集成通过。API 类型检查、lint、构建和两种语言的文档构建通过。文档变化引发的内置 Skill 内容摘要已同步，现有缓存刷新回归通过。

```sh
pnpm --filter @linksense/api exec vitest run --pool=threads --maxWorkers=2 --maxConcurrency=2
pnpm --filter @linksense/api exec tsx test/integration/application-runtime-installation-postgres.ts
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/api lint
pnpm --filter @linksense/api build
pnpm --filter @linksense/docs test
pnpm --filter @linksense/docs build
```

验证使用临时数据库、Redis 和工作目录；未修改业务数据。未进行浏览器自动化或真实模型整轮测试。文档构建有 Node 的 `localStorage` 实验性提示，两种语言均成功生成。
