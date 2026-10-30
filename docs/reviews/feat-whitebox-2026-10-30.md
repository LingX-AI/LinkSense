# feat 分支白盒测试与修复

## 当前分支

按最新追加要求，再次 fetch 并将 `origin/main`（`b29cb1836ededb6b03201837497aaf5a90154903`）合入 `feat`，合并提交为 `3d1025ee63da58df5d4b6e5165059e832d2dbf52`。第二父提交即该 main，`git merge-base --is-ancestor origin/main HEAD` 通过。合并前再次通过 `ls-remote` 查询远程 main，确认仍为该提交。

没有切换本机 main。已有修复先备份再恢复；设置导航断言和发布网关计数两项已随合并吸收，其余源码与测试修复已按语义分为 8 个英文提交，最新代码提交为 `ac45cd6`。本报告提交后继续执行维护者要求的 feat 推送及 dev server 更新，不把恢复旧服务等同于新版已部署。

机器人升级影响已获维护者接受；Skill 统一使用新标准名；`fresh_task` 在第四轮获确认后已改为继承源项目目录，不复制聊天历史或应用运行时。第三轮去重 13,111 项通过；第四轮新增 7 项项目继承回归并重新运行完整 API 4,662 项，以及类型/lint/构建，累计唯一用例覆盖为 13,118 项。非 API 测试沿用第三轮结果，没有声称第四轮又全量重跑所有分组。1 项 Linux root 限定在 macOS 不适用。

另完成 HTML 预览原生浏览器修复前后验证。一次额度菜单单测的非稳定失败仍单独保留，没有把未确认原因当作功能错误。未收集完整行/分支覆盖率，外部系统及实际部署限制仍适用。

## 首轮范围与结论边界

- 执行日期：2026-10-29 至 2026-10-30，Asia/Shanghai。
- 首轮保持在 `feat`，起始 HEAD 为 `5be2bf9385e521e10eed0b32bcbc2139e38d731b`；首轮未切换分支、提交或部署。
- 已 fetch `origin/main` 与 `origin/feat`。比较基线为 `origin/main` 与 HEAD 的共同祖先 `086f77ee99c152ba1e7685098c104d42be225cd0`，不是落后于远程的本机 main。检查时远程 main 为 `9b0b93491a707b392b7412f3921a60c388cb044c`。
- 范围为 83 个分支提交、615 个差异文件，35,270 行增加、4,412 行删除。包括 API 104、Web 362、Runner 39、Shared 29、其余文档/部署/脚本 81 个文件；不把图片等静态资源计作独立业务功能。
- 从修改的入口、调用方、持久化契约、权限、生命周期和测试追踪功能；按多 API 实例、隔离用户 Worker 和已有安装升级场景审查，而非只检查新建数据。
- 未收集整个分支的行/分支覆盖率。本报告不等于穷尽全部代码路径，也不把模拟第三方接口的测试视为真实模型、IM、SSO 或生产部署验收。
- 最终各测试分组合计 12,876 项通过，另有 1 项 Linux root 限定测试在 macOS 不适用；不重复累计初轮及定向重跑。已修复三个确认的功能问题，保留两个需要维护者确认的升级/语义问题。

## 已确认并修复

### 1. 新会话自动化创建前失败，漏发失败通知

`apps/api/src/modules/automations/notifications.ts` 原先要求运行对应的新任务已经存在。`fresh_task` 创建任务失败时，运行已记录为 failed，但新任务不存在，通知被永久 cancelled。

修复仅在“运行失败、新任务不存在、冻结执行上下文合法且为 fresh_task”时，使用快照中的原任务 ID 再次校验同一用户归属。取得发送锁后仍重查该授权来源；不从当前可变配置猜测来源，不放宽越权或删除检查。

回归 `apps/api/test/automation-notifications.test.ts` 先出现 5 failed / 21 passed，修复后 26 passed。新增覆盖定时/手动创建失败、旧上下文缺失或 null、无效快照、原任务删除/他人归属、发送前来源失效。

### 2. UAT 空闲检查与更新之间存在新任务派发窗口

`deploy/uat/deploy-uat.sh` 原先只检查一次 running turn，旧 API 和调度器仍在线，随后就备份、迁移和替换服务。隔离 shell 复现中，初查为 0、备份开始后出现新任务，脚本仍进入更新。

现在统一检查 running turn、启动意图及 dispatching 自动化；空闲后顺序停止 API 和 Runner Controller，确认写入服务确已停止，再复查活跃工作，最后才备份/迁移。计数、停机或复查失败均拒绝更新。没有新增 Codex 重试/重放/中断机制，也不主动删除动态 Worker。

`scripts/uat-deployment.test.mjs` 完整执行脚本的隔离替身回归先有 7 项失败，修复后 14/14 通过；覆盖新任务竞态、两类漏计、分别停机失败、仍运行的容器、正常更新和首次安装。`sh -n` 通过。

兼容与恢复：构建失败仍不影响运行环境。更新切换增加明确停机窗口；停机或复查失败后服务可能保持停止。`deploy/uat/README.md` 说明用相同 Compose 参数的 `start api runner` 恢复已有容器，不用 `up` 提前迁移或切换镜像。本次未停止实际用户服务。

### 3. 生产 Compose 搬迁后默认环境文件路径错误

`deploy/compose/docker-compose.production-stack.yml` 保留了搬迁前的 `.env.production` 默认路径。实际 Compose 将 include 的 env_file 相对当前 Compose 文件解析，因此仓库根目录已有环境文件时仍错误查找 `deploy/compose/.env.production`；显式 `--env-file` 不会修正这个 include 路径。

使用独立临时目录、真实 Docker CLI / Compose 与 `.env.example` 先复现 `stat .../deploy/compose/.env.production: no such file or directory`。默认值改为 `../../.env.production`，保留显式 `LINKSENSE_COMPOSE_ENV_FILE` 覆盖方式。

新增 `scripts/repository-layout.test.mjs` 的实际 Compose config 回归，并同步 `scripts/deployment.test.mjs` 的路径契约。相关两文件 68/68 通过，覆盖默认路径、显式覆盖、根构建上下文和生产挂载。

## 测试基础设施修复

- Elasticsearch、发行输入准备和镜像扫描的五处替身命令，把含空格的 `process.execPath` 直接写入 shebang。本机 fnm 的实际 Node 路径包含 `Application Support`，导致 EACCES，甚至绕过假 gh 调用真实 gh。改为 `env node`，替身 PATH 明确包含当前 Node 目录。
- 发行工作流的匿名镜像检查补齐 timeout 替身，在没有 GNU timeout 的 macOS 上仍执行真实工作流 shell，并保留全部镜像引用及拒绝路径断言。
- 以上缺陷经共同祖先源码核实，属于既有测试可移植性问题，不能算作 feat 新增功能回归。四文件共 86 项修复后通过；未弱化实际镜像安全门或引入对真实 Docker/Trivy 的依赖。
- Web 侧栏排序回归仍匹配旧文案“排序方式”，但本次产品文案已改为“任务排序”。改为匹配菜单的可访问名称，并明确断言新标题。
- 弹窗间距测试在 Escape 后立即打开另一个菜单，可能与前一个弹层的关闭/焦点归还竞争；现在等待旧弹层卸载，不使用 sleep、不提高超时或重试数。额外覆盖延迟加载新任务路由时，已经用键盘打开的账号菜单仍可使用和关闭。

## 模块检查矩阵

| 改动模块 | 白盒检查与实际测试重点 |
| --- | --- |
| 自动化/监控/IM 通知 | 调度领取、次数/停止规则、手动与自动触发、fresh/reuse、过期日期/时区、冻结配置、幂等键、通知租约/重试/取消、归属和终态结算 |
| 跨任务引用 | 来源授权、普通/托管/旁聊隔离、排队和 steer 限制、可信展示信息、历史/最新助手回复、隐藏消息与长消息续读、草稿失败恢复 |
| 本地 Browser Use | 扩展配对、HTTP 与重连、共享授权、命令领取/互斥、连接代次、撤销、账号/任务隔离、真实扩展页面控制、PiP 与设置引导 |
| 托管浏览器/Runner | MCP 到 Controller/Worker 路由、Plan 限制、人工控制租约、CLI 锁/CWD、会话保留、空闲与退出清理 |
| 模型/知识库 | 协议探测及部分失败、凭据复用、模型发现/保存、图像/语音、同源路径前缀回退、超时/取消、价格和用量归类 |
| Web 共享 UI | 外壳/设置/侧栏、全局搜索/IME、排序与菜单、分段标签、主题/字号、桌面/窄屏、长译文、键盘、Axe |
| 聊天与文件 | 新任务/项目、草稿/附件/引用、快捷命令/Tab、语音控件、乐观提交、虚拟列表/滚动/流式替换、预览 |
| 应用与嵌入 | 创建/发布/导入入口、旧应用/草稿、外部访问、technical 默认兼容、end_user 状态/确认/文件呈现 |
| Shared/i18n | Zod 边界、可选字段、错误码、六语言键与插值一致性、旧请求和记录 |
| 部署/工作流 | 仓库搬迁、构建指纹、Compose/挂载、UAT 数据身份/备份、镜像安全门替身、发行/安装/脚本失败路径 |
| 附件交接示例 | 授权清单、路径/字节/哈希与限额、取消和回执；作为示例而非已上线第三方服务验证 |

## 首轮实际验证

工具链使用 fnm default 的 Node v24.22.1 与仓库指定 pnpm 10.34.6，未升级依赖或更改全局默认值。Docker CLI 28.5.2 / Compose 2.40.3 仅放在临时目录，Compose 核验发行 checksum；仅运行无 daemon 的 config 和脚本测试，没有安装或启动 Docker Engine。

| 检查 | 实际命令/结果 |
| --- | --- |
| Shared | 根测试中的 Shared 全量：78 文件、680 项通过 |
| API | `pnpm --filter @linksense/api test`：336 文件、4,552 项通过 |
| Runner | 根测试中的 Runner 全量：84 文件、1,125 项通过，1 项 Linux root 限定测试在 macOS 不适用 |
| Docs | 根测试中的文档测试：23 项通过 |
| Web 应用 | `pnpm --filter @linksense/web exec vitest run --project application --maxWorkers=1`：34 文件、342 项通过 |
| Web 组件/Node | `pnpm --filter @linksense/web exec vitest run --project components --project shared-components --project node --maxWorkers=2`：426 文件、5,237 项通过 |
| 浏览器 | `pnpm --filter @linksense/web test:e2e --workers=2`：147 项全部通过，0 skip、0 retry；包含真实扩展控制与六语言/窄屏/键盘回归 |
| 部署 | 临时 Docker CLI / Compose PATH 下 `pnpm test:deployment`：770 项全部通过，0 skip；默认环境路径相关 68 项亦通过 |
| Redis | `pnpm --filter @linksense/api exec tsx test/integration/local-browser-redis.ts`：PASS |
| PostgreSQL 升级 | `pnpm --filter @linksense/api exec tsx test/integration/automation-upgrade.ts`：两个 PASS |
| 类型 | `pnpm typecheck`：通过 |
| lint | `pnpm lint`：通过；保留一条既有 TanStack Virtual / React Compiler 兼容警告，0 error |
| 构建 | `pnpm build`：全部工作区通过；保留 Office 等既有大块提示 |
| 差异 | `git diff --check`：通过；保持 feat 原 HEAD，未改依赖/迁移文件、未提交、未部署 |

PostgreSQL 升级检查使用随机私有 schema、单连接事务和不含 public 的 search_path，执行真实历史迁移及两条新增迁移。覆盖两个旧计划、三个旧运行的字段快照保留、null 默认解码、旧请求编辑、日程函数、真实数据库约束下的领取/启动和通知唯一键；最后 ROLLBACK 并确认 schema 不存在。它不调用真实 Repository、Codex 或 IM，不等同完整任务执行，也未修改应用 schema 或迁移历史。

Redis 检查使用独立 Unix socket 临时服务，不连接已有 Redis 数据，验证双实例的配对、单次命令领取、锁、连接替换和撤销。浏览器用临时 Chromium profile、合成网站与模拟业务 API，不读取现有浏览器资料或真实账号。

初次 `pnpm test` 的部署部分失败，已逐项区分既有替身缺陷与缺少本地工具，未把它报告为通过。Web 与类型检查高并发时的初轮超时未作为功能结论；中止仅本次创建的验证进程，改为分阶段、低并发重跑。未提高测试超时、启用重试或新增 skip。

## 保留给维护者 Review

### Skill 命名：统一使用新内置名称

维护者已确认统一使用新的 Skill name。本轮按当前新内置标准名 `linksense-local-browser` 执行；共享保留名、生成目录、SKILL.md frontmatter、云浏览器指引、Runner 指令与开发文档均已一致，没有另造别名或更换名称。补充了同名自定义 Skill 导入必须拒绝的回归用例，避免用户内容覆盖内置能力。

这项命名决定不等于可以把任意同名自定义内容转换成内置能力。历史自定义 Skill 若恰好占用该名称，其旧 publication、持久化 turn / start-intent 能力快照仍可能被新校验拒绝；需要把自定义资源改为非保留名称并验证既有执行快照的恢复，而不是覆盖、删除它或重建全部任务。

本轮没有连接业务库盘点或改写历史资源。目标实例有冲突时仍需完成上述升级处理；不能把仓库命名已统一当作所有已有安装均兼容的证据。本轮没有修改内置 Skill writer，内容指纹无需重新生成。

### 功能/需求语义：fresh_task 的项目工作目录（第四轮已确认修复）

第三轮维护者要求先详细说明，当时未修改。以下记录的是修复前行为与确认依据；当前实现见第四轮。

已追踪定时与手动「立即执行」两条路径：Repository 为 `fresh_task` 分配新的 conversation ID，并冻结原目标任务 ID；Service 调用 `createPinnedConversation(ownerId, title, undefined, newId)`。该创建入口未接收项目参数，最终 `createConversation` 将 `projectId` 写为 null，并通过 `projectWorkspaceRelativePath(ownerId, null)` 选择用户 HOME 下的 `workspace`。项目任务则使用 HOME 下的 `projects/<project-id>`。同一用户运行环境不等于同一项目工作目录。

具体示例：原任务属于项目 A，指令为「读取 `./sales.csv`，输出 `./daily.md`」。

| 模式 | 对话与目录 | 对该指令的影响 |
| --- | --- | --- |
| `reuse_task` | 沿用原任务及历史，仍在项目 A 目录 | 相对路径指向项目 A 的文件 |
| `fresh_task` | 新任务、无原聊天历史，不归属项目 A，进入用户默认 `workspace` | 不会自动复制项目文件；同一相对路径改为默认目录，可能找不到输入或把输出写在另一处 |

原项目与文件不会被删除，也不能据此断言项目文件在其他已授权工具或显式路径下完全不可访问。`fresh_task` 也没有每轮独立的文件目录：多个这样的新任务仍共享该用户的默认工作区，同名输出可能互相影响。这里说明的是工作目录与项目归属的差异，不是新增文件权限结论。

每轮执行仍提交自动化保存的原指令；模型/推理强度使用已保存的自动化选择（两者齐全时），否则沿用现有默认解析，不应解释为复制了源任务的全部模型、知识库或能力选择。

维护者随后确认仅隔离聊天历史、同时保留原目标项目目录。第四轮已修改新任务创建链路并覆盖项目权限、项目删除、项目变动、重复派发与目录继承；不再作为待确认需求项。没有追溯移动历史任务或复制文件。

## 未验收的外部路径

- 真实模型的协议/工具选择、监控停止条件判断、跨任务引用和完整 AI 任务执行；没有发起付费推理。
- 飞书/企业机器人真实主动发送权限、真实 SSO/邮件、公共网站登录或验证码。
- Linux UAT 的实际部署/备份恢复/服务切换、真实 Docker Worker 生命周期和最终镜像漏洞扫描；脚本替身测试与 Compose config 不替代这些验收。
- Edge/Windows 实机、系统级音频/权限以及前述 Linux root 测试。

完整日志位于本次机器临时目录 `/tmp/linksense-feat-whitebox-W5kJI4`；回归测试与命令保留在仓库，因此后续不依赖临时日志才能复验。

## 第二轮：合入 main 与复验

### 合并与准备

- 解决 16 个冲突文件；保留 feat 的自动化/监控/引用/本机浏览器及界面改动，同时保留 main 的个人与组织机器人、连接器配置、会话 Skill 管理和私有 HTML 资源预览。
- 运行时回调、MCP 工具和环境变量按功能并集合并；保留发布会话限制，没有通过选整边文件丢弃另一侧功能。
- 合并后重新生成内置运行时内容指纹 `1526287e5502989f9c5511b087e5bffdce8fc612456f2899f8235086f7452249`，验证指纹与既有快照刷新两项通过。
- `pnpm install --frozen-lockfile --ignore-scripts` 通过，未改锁文件或增加未要求的依赖；运行 `pnpm db:generate` 更新本地 Prisma Client，没有执行业务数据库迁移。
- 当前合并提交相对 main 的差异为 581 文件、35,215 行增加、4,287 行删除；首轮未提交修复另保留在工作区。

### 新增确认问题及修复

1. **机器人身份模型合并后，自动化通知仍按已删除的单一发送者字段授权。** main 将组织连接 ownerId 改为 null，并通过 BotChannelIdentity 绑定用户；feat 的通知仍引用 allowedSenderId，也会排除组织连接。现在列表与目标校验均限定当前绑定、成员、peer 与收件 owner；发送时在连接租约内重新验证身份与活跃账号，忙锁不得被当作发送成功。三渠道正常发送、撤销、换绑、他人个人渠道、生命周期撤销和忙锁均有回归。先 11 failed / 21 passed，修复后相关三文件 52/52 通过；恢复首轮补丁后又运行完整 API 测试。
2. **Skill 管理回调在 Controller 提前按 15 秒中止。** MCP 与 EventSink 为 60 秒，但 Controller 未覆盖新路由。补充实际回调边界回归，先验证收到 15,000 而非 60,000；修复到相同的 60 秒，不新增重试或改变 Codex turn。Runner 合并相关九文件 196 项通过，1 项 Linux root 限定不适用。

类型检查还发现自动合并的测试夹具重复返回 message / connection，已去除重复属性；租约替身按真实 nullable 返回类型声明，没有用类型断言掩盖错误。

合并后的测试断言同步也经过红绿验证：设置导航因新增连接器从 23 项变为 24 项，补充了连接器实际 href 断言；HTML 私有资源路由使两套网关的维护/协议转发计数各增加一项。Vite 源码配置夹具改为与实际 Web CLI 相同的工作目录，避免第三方插件从仓库根扫描无关的 Runner store；没有修改该缓存或 node_modules。上述修复未通过删除失败断言、提高超时或增加重试来获得通过。

另外遵循 main 的 `7306cce` 原意，保留其替换后的工作流 Dockerfile 路径检查，不重新引入 feat 旧的仓库布局 strict recipe 断言。该旧断言在当前基线下本来通过，并非为了掩盖当前失败而移除；保留它会在后续安全基线维护、recipe 尚未重新冻结时错误阻断流程。严格发布检查及“维护可检查、应用构建仍拒绝未验证 recipe”的回归继续由 `baseline-adoption.test.mjs` 与实际构建入口负责。

### 合并后完整验证

| 检查 | 结果 |
| --- | --- |
| API | 346 文件、4,654 项通过 |
| Runner | 85 文件、1,145 项通过，1 项 Linux root 限定不适用 |
| Shared | 82 文件、701 项通过 |
| Docs | 23 项通过 |
| Web 应用 | 35 文件、349 个唯一用例覆盖；初轮 348 通过、1 个旧数量断言失败；修复后完整侧栏文件 45/45 通过，其余 34 文件未重复执行 |
| Web 组件/Node | 428 文件、5,276 项通过 |
| 浏览器 | 147 项全部通过，0 skip、0 retry |
| 部署/脚本 | 修复夹具/计数断言并保留 main 基线维护契约后，最终完整 777 项全部通过 |
| 类型/lint/构建 | 最终 `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过；仍仅有既有 Virtual/React Compiler 警告和大块构建提示 |
| 真实数据库/队列集成 | 下面三项均通过 |

另外新建了独立、仅监听 loopback 的临时 PostgreSQL 和 Redis，不复用现有服务或业务库。完整执行：

- `bot-channel-upgrade-*.ts`：从前一版迁移填充旧连接与队列，再升级；确认预期清除范围，并保留用户、任务、微信及飞书。
- `bot-channels-*.ts`：三渠道真实持久化收发、双实例去重、同聊顺序、任务复用、重启后分段续发、停用与事务清理。
- `bot-channel-organization-*.ts`：一次性关联/撤销、同群多成员隔离、原生幂等、成员停用、组织启停与保留任务的清理。

平台传输和模型边界仍用替身，但 Prisma、PostgreSQL 约束、Redis 锁与收发记录为真实实现。所有临时服务已停止；合成测试数据保留在 `/tmp/linksense-channel-integration-hnjpkq`，没有对用户现有实例执行迁移、清空或服务停机。第二轮日志在 `/tmp/linksense-feat-whitebox-W5kJI4/after-main`。

### 机器人升级影响：维护者已接受

main 自带的 `20261029040000_split_personal_and_organization_bot_channels` 会删除旧企业微信、钉钉、Teams 连接及收发/会话映射。仓库已有文档说明这是原需求接受的破坏性升级，本轮没有修改该已存在迁移，也没有将其执行在业务库。

**对 feat 自动化的额外影响**：旧自动化的通知配置仍保存被删除的 connection_id。即便旧计划仍能调度，通知也会因为目标失效而取消，不等于旧功能继续可用。编辑时如果仍提交旧通知目标，也会被后端拒绝，需要清除或替换目标后再保存。重新配置/关联机器人并产生新会话后，还需要编辑相应自动化、重新选择通知目标。飞书不受这条迁移影响。

维护者在 2026-10-30 明确回复「OK，这个不影响」，已接受这项连接清除及旧自动化通知中断，不再作为待确认的发布阻断项。此确认不代表要求现在执行迁移或部署，本轮仍未操作业务库。部署前备份；若需要回退旧机器人模型，必须恢复升级前数据库备份，仅回退二进制不能恢复已删除记录。Skill 命名按上文新标准执行，`fresh_task` 项目目录仍等待行为确认。

## 第三轮：再次同步 main 与注释决策

### 合并与改动保全

- 最新 main 比第二轮多 9 个提交，其中 1 个为合并提交、8 个为非合并提交；包括 HTML 预览资源就绪与恢复、MinIO 查询解码安全补丁、0.3.12 版本和测试断言同步。
- 预览合并只发现 `scripts/release-installation.test.mjs` 一处内容冲突。保留 main 新增的私有 HTML 预览协议转发断言，同时将总数设为 feat 实际存在的六条转发路径，不丢弃本机浏览器路由。
- 合并前的全量二进制补丁、未跟踪文件、状态及 refs 保存在独立临时目录。恢复时核对 14 个未冲突的已有修复文件逐字节一致；其余两项已被合并结果吸收。本轮没有使用 stash、reset、分支切换或覆盖用户改动。
- `pnpm install --frozen-lockfile --ignore-scripts` 通过；依赖/锁文件改动仅来自本次 main，自行新增依赖为零。没有新的 Prisma 改动，没有重复执行业务迁移。
- 合并提交已完成；本轮 HTML 修复、保留名回归、额度点击 E2E 与先前其他修复仍在工作区，未 push。

### Standards

本轮新增 main 差异的规范、安全及升级可用性审查没有新增确认问题，也没有需要另作重构的实质性代码异味。检查了序列化运行时、消息校验、重试代际、六语言提示、MinIO 补丁注册与构建复制路径；Node 24.22.1 下真实 MinIO 签名及查询解码回归 3/3 通过。

已有 HTML 每次打开时仍通过当前客户端生成预览运行时；本轮未新增历史记录必填字段，也不要求重建、重新导入或重新发布旧 HTML。此结论不扩大为旧同名自定义 Skill 的兼容性证明，后者见命名决策。

### Spec

**确认并修复 1 项 P2：未生效的打印 CSS 导入阻塞屏幕预览。**

规范要求只等待当前生效的样式表。共享 `html-preview-readiness.ts` 原来只要发现内联 `CSSImportRule` 就判为 pending，未检查导入规则自身的媒体条件。包含 `@import url(...) print` 的旧 HTML 在屏幕上已经可正确显示，却仍会等待满 4 秒并误报资源慢，消息内与文件预览均受影响。

先补回归：新增非匹配媒体导入用例后，1 failed / 15 passed，失败点是正常就绪回调未触发。修复只在原生 CSSOM 判断中增加导入媒体匹配，不改变作者 HTML、不移除打印样式、不修改字体等待、超时上限或重试策略。相关两个测试项目共 13 文件、137 项通过，随后 Web 组件/共享组件/Node 全量 430 文件、5,310 项通过。

原生复验使用真实两种 document builder、共享 shell 的 `document.open/write/close`、生产 sandbox 和 Selecto，并覆盖内联 iframe 加载时的 `visibility:hidden`。Codex browser 在复验阶段不可用，按顺序回退 Chrome 156，再使用隔离的仓库 Playwright Chromium 作前后对照：

- 打印导入：修复前 inline/file 约 4,007 / 4,009ms timeout；修复后约 18 / 24ms complete。没有仪表注入的内联对照从约 4,008ms timeout 变为 17ms complete。
- 活跃嵌套导入：仍等待资源或达到 4 秒上限，没有因为过滤打印媒体而提前展示。
- 延迟图片及字体：图片延迟 8 秒不阻塞正常就绪；真实字体延迟 100ms 时会等待字体，但不等待该图片。隐藏 iframe 的动画帧也正常执行。

“`fonts.ready` 会因图片阻塞生产预览”的初始假设已撤回。最初仅直接导航并调用共享函数的夹具不等同生产 shell 的文档替换生命周期；使用真实链路后不复现，因此没有据此修改字体逻辑或把它列作升级阻断项。

本轮新增规范问题 0 项；需求偏差确认 1 项并已修复，未遗留该项阻断。

### 最新完整回归

| 检查 | 结果 |
| --- | --- |
| API | 346 文件、4,655 项通过，包括新增 `linksense-local-browser` 保留名导入回归 |
| Runner | 85 文件、1,145 项通过；1 项 Linux root 限定在 macOS 不适用 |
| Shared | 82 文件、701 项通过 |
| Docs | 23 项通过 |
| Web 应用 | 最终完整重跑 35 文件、349 项通过，见下面的稳定性记录 |
| Web 组件/共享组件/Node | 最后一次修复后完整重跑 430 文件、5,310 项通过 |
| 浏览器 E2E | 148 项通过，0 skip、0 retry；包含新增额度菜单鼠标点击导航回归。最后的打印导入修复另外完成上述真实预览链路前后对照 |
| 部署/脚本 | 完整 780 项通过，包括真实 Compose config 及 MinIO 补丁回归 |
| 类型/lint/构建 | HTML 修复后的 `pnpm typecheck`、`pnpm lint`、`pnpm build` 全部通过；仍仅保留既有 Virtual/React Compiler 警告及大块提示 |
| Git | main 祖先关系、无冲突索引及 `git diff --check` 通过 |

本轮使用 `pnpm test:packages`、`pnpm test:deployment` 与 Web 各既有测试分组独立执行，没有把未执行的根 `pnpm test` 声称为通过。第二轮的隔离 PostgreSQL/Redis 升级、组织身份与双实例收发证据保留；本轮没有新的数据库变更，未重复迁移真实业务库。

### 仍需 Review：额度菜单单测稳定性

第一次 Web 应用全量中，`opens personal quota usage from the unlimited account-menu quota` 未找到目标页标题，348 passed / 1 failed。该测试单独运行通过，完整侧栏文件 45/45 通过，随后完整 Web 应用 349/349 通过；新增的原生浏览器鼠标点击回归也通过，确认实际点击可关闭菜单并进入 `/settings/quota`。

尚未定位首次失败的具体原因，不能据此确认菜单、路由或额度功能存在运行时错误。本轮没有改该单测的断言/超时、加重试或修改运行时点击逻辑；将这次非稳定结果保留为测试可靠性 Review 项，而非通过猜测做产品修复。

### 证据与未验证边界

第三轮完整日志、备份、原生生成 HTML 与修复前后事件时序位于 `/tmp/linksense-main-refresh-ufeRGS`，原生夹具位于其 `native-preview-probe` 子目录。该临时服务器已正常停止，18476 端口已确认不再监听；证据文件保留。

未执行业务数据库迁移、UAT/生产部署、真实模型/IM/SSO 调用或最终镜像扫描；未验证 Safari/Firefox/Edge 实机。原有同名自定义 Skill 未在业务库盘点或改写；`fresh_task` 继续保持现状，等待维护者确认项目目录语义。

## 第四轮：确认项目继承并准备推送部署

### 已完成的源码修复与验证

- `ecfe343`：定时及手动 fresh_task 将运行快照中的原目标 ID 传入创建入口；旧快照缺少该字段时沿用已保存自动化目标。源任务须属于当前用户、活跃、置顶且为默认协作模式。
- 新任务读取源任务的 projectId，在对应项目工作目录创建；项目锁验证当前用户拥有项目，并在创建事务内对源任务持有共享行锁，重新核对有效状态与项目归属。准备期间源任务删除、取消置顶或移动项目时失败，不静默切回公共目录。
- 已创建的幂等任务沿用自身现有目录，不追溯迁移；不复制原 Codex 线程、聊天历史、应用身份、知识库或能力选择。应用隔离运行时不会被复制到普通新任务。
- 回归先验证 8 failed / 404 passed，修复后两文件 412/412 通过。新增 7 项覆盖项目/无项目目录、不可用或越权源任务、不可访问项目、源任务变化和幂等恢复；定时/手动既有用例额外验证使用冻结目标，而非后来变更的自动化目标。
- 随后 API 全量 346 文件、4,662 项，以及 `pnpm typecheck`、`pnpm lint`、`pnpm build`、`git diff --check` 全部通过；仅保留既有 Web lint 警告与大块提示。其余分组未因这项后端改动重复运行，沿用第三轮结果。

通知失败回退、fresh_task 项目继承、HTML 非匹配媒体导入、UAT 停机边界、生产 Compose 环境路径、测试夹具可移植性、API 升级/保留名回归、Web 菜单交互分别提交，未把私有配置、环境文件、构建产物或机器缓存纳入 Git。

### dev server 交付前状态

只读检查期间发现既有 UAT 的七个服务被外部统一正常停止。维护者明确要求重新启动并继续更新后，先直接启动原有数据库、Redis、MinIO、Runner、API、Web 与网关容器：全部 healthy，就绪接口返回 ready。没有重新运行迁移或初始化任务，也没有更换运行镜像。

目标旧版本为 `1f1cf48`，尚待应用的数据库改动仅为前文已获接受的机器人拆分迁移及其暂停状态约束扩展。只读检查运行中 turn、start intent、派发中自动化均为 0，同名自定义 Skill 记录为 0；没有修改业务记录。

磁盘空间最初不足部署脚本要求。已仅删除确认无任何容器引用的更旧 UAT 镜像，并清理描述明确归属 LinkSense 的构建缓存；保留当前可回退镜像、全部持久卷、配置和其他应用。部署空间、备份及空闲边界仍须由后续实际部署继续检查，不以此报告替代部署成功证据。

本轮验证日志与改动前备份保存在 `/tmp/linksense-feat-push-deploy-fXew9D`。真实模型、IM/SSO、浏览器非 Chromium 实机和最终生产镜像扫描仍未完成；dev server 更新完成后以实际镜像版本、迁移状态和就绪检查为交付依据。

### Modern Web Guidance

前两轮核对了表单输入保留与嵌套菜单键盘/焦点建议，没有更换现有 Base UI 交互。第三轮搜索并查看字体与资源就绪目录，没有直接适配本次打印导入问题的指南；修复沿用既有原生 CSSOM 和媒体查询，没有引入依赖或新的 UI 模式。
