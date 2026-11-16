# 普通对话直接创建公开动态应用：现状与最小改进

> 采纳记录（2026-11-16）：用户已批准实施第 6 节的第一轮对话引导与验证。普通对话路由、公开 Skill 的直接创建和后续发布说明已对齐，并更新内置能力指纹以刷新已有任务。完整私有动态预览与通用 HTML 首次发布的后端绑定仍属于后续独立范围。以下调查结论和源码行号保留为实施前基线，当前行为以 [开发文档](../development/web-site-sharing.md#对话内创建与发布) 为准。

调研日期：2026-11-16（Asia/Shanghai）。起始代码基线：`feat`，`6bdf51ac`；已包含 `7a31a531` 自托管 Appwrite 后端、`5eaeb726` 动态应用创建与链接交付。调研期间其他工作新增 `dae3e13f`（开发环境 launch 配置），当前 HEAD 为该提交；本文引用的产品源码行号未受影响。范围是“在普通对话提出需求，创建有独立访客登录、持久化数据、文件或业务 API 的公开应用”；不是安装后在 LinkSense 内运行、依赖平台 AI/任务/知识库的交互应用。本次只调查和记录，不修改产品代码、配置或依赖，不启动服务，不部署。[R01][R02][R03]

## 1. 结论

**当前代码已经允许从普通对话直接创建并发布自托管 Appwrite 动态应用，不要求先进入“创建应用”。** 三个后端工具与发布工具属于普通 Default 模式的 Core MCP；内置公开站点 Skill 无条件进入正常能力快照，并允许原生隐式调用。服务端要求任务属于当前用户、没有 `applicationId`、处于 Default 模式且有正在运行的 owner turn；没有检查“是否从创建应用按钮进入”或“是否存在应用开发记录”。[R02][R04][R05][R06][R07]

**这证明执行通路已存在，尚不能证明任意一句自然语言都能稳定走完整流程。** 普通对话依赖模型通过 Skill 描述与交付路由选择工作流；公开站点创建入口显式添加 Skill 优先 ID，并组织了发布提示词，减少这一不确定性。当前普通对话的交付路由还只写“公开网站 / browser-only tool”，遗漏 Skill 已支持的独立访客登录、持久化数据、文件和业务 API。最小方案应先补齐这段引导并验证直接对话，不另建一条动态应用后端链路。[R03][R08][R09][O01]

有两个需要单独理解的现有边界：HTML 产物预览不是完整动态运行环境；用户先要预览、之后点击通用“发布为站点”首次发布时，当前按钮与弹窗不携带 `backend_id`。这一条件分支可能得到静态站点绑定，不能据此宣称“所有预览与手动发布流程都已支持动态应用”。这是源代码流程判断，未做浏览器运行复现。[R10][R11][R12]

## 2. 普通对话实际拥有的能力链

### 2.1 工具不依赖创建入口

`webSiteCoreMcpModule` 注册六个工具：`prepare_web_site_backend`、`configure_web_site_backend`、`inspect_web_site_backend`、`publish_web_site`、`list_web_sites`、`update_web_site`，模块只声明 `modes: ["default"]`。Core 注册表按 collaboration mode 过滤模块；没有按应用创建页面、优先 Skill、应用开发记录或 Appwrite 是否已配置来决定是否暴露这些工具。四项后端配置全部缺省时，实际准备后端会返回 `WEB_SITE_BACKEND_NOT_CONFIGURED`；部分填写或 URL 无效会在启动校验时失败。“创建应用”入口不承担这一配置检查或权限开关。[R04][R05][R13][R21]

Runner 为正常执行进程注入当前 conversation 的 web-site endpoint 和随机 scoped token。调用时先验证有效 turn、logical projection turn、token 及非 Plan 模式，再由 event sink 转发到 `/internal/web-sites`；owner 来自 workspace manager，不能由模型请求体自由指定。API 内部入口还验证 Runner shared secret，拒绝 published runtime service session，并校验 owner、conversation、turn 与请求 schema。[R14][R15][R16]

API 的 `toolForOwner` 统一调用 `assertActor` 和 `assertActiveTurn` 后，再分发后端准备、配置、检查和发布。仓储真实条件是：

1. 用户 `status = active`；conversation 的 `ownerId` 匹配、`archiveStatus = active`、`applicationId = null`、`collaborationMode = default`。
2. conversation 已有 Codex thread；turn 的 thread 匹配当前 conversation、`submittedBy = ownerId`、`collaborationMode = default`、`status = running`。
3. 后端与站点的操作继续检查具体资源 owner；同任务同名称准备复用后端，后端绑定与发布检查就绪状态。[R06][R07][R13][R17]

因此准确范围是“正常 owner 对话中的 Default 执行 turn”，不能扩大为所有对话。安装/运行 LinkSense 应用的会话、归档对话、Plan turn 和非 owner 提交的协作 turn 不满足该发布工具的现有授权条件。[R06][R07][R16]

### 2.2 Skill 已具备动态应用流程

内置 `linksense-public-site` 描述已明确包括“externally used applications”及自己的 visitor login、data、files、backend functions。正文规定 `prepare → configure → 本地打包前端/函数 → 检查就绪 → register_artifact → publish_web_site(backend_id)`，访客使用 Appwrite 原生 Account 会话；LinkSense 账号和管理密钥不得进入应用前端。后端未配置必须报告实际错误，不能默认转用托管云或用 localStorage 模拟持久化成功。[R02]

Skill 的 `agents/openai.yaml` 声明 `allow_implicit_invocation: true`。官方文档说明隐式调用依赖任务与 Skill description 匹配，完整 Skill 指令按需加载；这一策略表示允许模型选择，不代表所有自然语言输入的确定性路由。当前项目对显式选择通过 `$skill` Markdown 路径恢复原生引用；普通对话不需要预先显式选择才能拥有这个 Skill。[R02][R08][R18][O01][O02]

能力物化器的 `#stage` 始终写入公开站点 Skill 和交互应用 builder；仅受现有 managed browser 设置影响的是浏览器 Skill。Runner 对已发布 Skill 文件做精确来源校验，并调用原生 `skills/list`，参数为当前 workspace 和 `forceReload: true`，再验证返回目录。选中的 `prioritySkills` 影响显式原生引用；它没有控制这六个 web-site 工具的注册。[R05][R18][R19][R20]

### 2.3 “创建应用”公开站点入口增加了什么

`ApplicationPublicSiteCreateDialog` 创建的仍是普通 `/conversations`，请求只指定 Default 模式；随后通过同一个 turn-start API 提交用户目标，并附加 `builtin:capability:linksense-public-site` 优先 ID。它没有先调用 interactive application 创建或建立专属动态后端权限。[R03]

相对于直接聊天，这个入口提供可见的目标分类、明确的 Skill 选择和发布提示；它是更强的引导，而非动态应用工具的唯一来源。若普通对话已经明确“外部公开、自己的访客登录、使用自托管 Appwrite、发布可访问链接”，现有 Skill 可以走同一后端与发布链。[R02][R03][R04]

## 3. 硬门槛、软引导与产品边界

| 条件 | 实际约束位置 | 对直接对话的含义 |
| --- | --- | --- |
| Default 执行模式 | Core 注册表、Runner token/turn 检查、API 仓储共同限制 | Plan 中只能研究；不能准备、配置或发布。[R04][R06][R14] |
| 普通 owner 会话 | `applicationId: null`、active archive、owner-submitted running turn | 不需要创建入口；不能借安装应用会话获得发布者权限。[R06][R07] |
| 自托管后端完整配置 | 配置解析与 `requiredClient`；独立域名检查 | 工具存在也可能返回 `WEB_SITE_BACKEND_NOT_CONFIGURED`；对话本身不能替代管理员配置。[R13][R21] |
| 后端归属、配额与就绪 | owned 查询、每 owner 50 个后端、持久化配置租约、函数/列/索引状态检查 | 非 owner 不能配置；资源尚未可用时发布失败。[R13][R17] |
| 完整前端产物 | source artifact、bundle manifest 与对象存储资源校验 | 必须先构建并登记完整 HTML 与资源；有后端不等于有可发布前端。[R07] |
| 用户明确授权公开创建/发布 | Skill 与 tool description 的指令约束 | 需要模型遵守用户意图；请求 schema 没有单独的 consent token 或 `publish_authorized` 字段。[R02][R04][R07][R22] |
| 首次公开运行 | gateway 要求 published site binding | prepared backend 的 origin 在未发布前不能作为完整可用动态预览。[R11][R17] |

“授权公开发布”当前是模型行为规则，和 owner、mode、资源隔离这些服务端硬检查应分开表述。源码没有证明用户必须点击某个按钮才能授权；同样不能把“工具能调用”解释为用户已批准公开。研究请求、预览请求及尚未明确的需求不构成发布授权。[R02][R04][R07][R22]

动态应用保留独立顶层 origin 与同 origin `/appwrite/v1` 代理；旧静态站点仍走原沙箱 iframe。当前公开动态流程可覆盖登录、私有记录、文件和有界 Node.js 24 HTTP 函数。函数 timeout 最大 30 秒；原生创建参数清空 schedules、events、build commands。Realtime、OAuth/SMS、SSR、定时任务和常驻服务不在现有生成工作流内，不能把“可在普通对话创建”扩大为任意后端框架托管。[R02][R11][R13][R22]

## 4. 已发现的衔接缺口

### 4.1 普通对话路由提示仍偏向静态站点

`context.ts` 为所有 Default turn 添加 `linksense.deliverable-routing`。目前公开分支只提“standalone public website or browser-only tool”，交互应用分支则明确列出 LinkSense AI、任务、知识库、文件、插件与组织共享。公开 Skill 的新描述已支持访客账号和服务端数据，但路由段没有同步说明独立账号、Appwrite 数据、文件和业务 API。这是引导表达未对齐，不是后端能力缺失。[R02][R08]

最小修改候选是同步交付路由中的公开应用定义，同时保留“涉及 LinkSense 平台 AI/资源/身份时才选择交互应用”的边界。不要把“需要登录/数据库”一律理解为需要 LinkSense 应用。无需为直接对话再增加强制 intent classifier、另一个 app schema 或另一组后端工具；除非真实用例证明现有原生 Skill 选择不能满足要求。[R02][R04][R08][O01]

### 4.2 动态预览和手动首次发布尚未闭环

Skill 正确指出 HTML artifact preview 仍为 sandbox，不能据此验证实际登录/后端行为。gateway 对页面和 API 请求先查 `publicBinding`，该查询要求站点已 `published` 且 owner active，因此“准备后端但不发布”不等于已有可用动态预览环境。[R02][R11][R17]

当前 `WebSiteSourceFile` 只有 conversationId、fileId、name；HTML 产物上的按钮也只传这些字段；通用首次发布 `createWebSite` 没有 `backend_id`。若对话生成阶段准备了后端、交付 HTML 预览后停止，用户稍后点击新建发布不会自动沿用该后端。API 不会从 source file 或 conversation 猜测绑定，静态创建仍是合法请求。更新一个已经绑定后端的站点则由服务端保留原 backend，两者不能混为一谈。[R07][R10][R12]

本轮最小直接对话路径应保持“用户授权后，由助手使用已有工具连同 backend_id 完成首次发布并返回链接”。如果目标还包括完整的 preview-first 产品体验，需要另行确定预览权限及后端绑定传递方式；不要在没有确认产品语义前新增 draft application 模型、迁移或把预览自动当作公开发布。[R02][R07][R10][R11]

## 5. 新会话与旧会话升级兼容

正常 turn 的 API preflight 会解析当前 catalog，再解析已发布 capability runtime；快照 key 包含 `BUILT_IN_CAPABILITY_RUNTIME_REVISION` 和启用的 built-ins。若旧任务绑定的是上一版内置内容，读取路径不匹配当前 key 时会进入重新物化并绑定路径，所以设计上不要求用户重建旧普通会话或重新安装公开站点 Skill。[R19][R23][R24]

已有针对“只有 built-in revision 变化”的旧任务刷新回归测试，同时验证首次重建后后续调用复用。它覆盖快照机制，不等价于用本轮某个历史真实会话完成自然语言生成验收。本轮也没有修改或手工重写任何用户的 managed snapshot。[T01]

当前实现已经处理历史自定义 Skill/Plugin 同名冲突：`linksense-public-site` 不是新禁止的自定义 package name；内置 Skill 选择不占用已存在名称的 `-builtin-N` 别名，但稳定能力 ID 不变。物化测试保留旧同名 Skill/Plugin；Runner 测试验证可按两个不同 ID 显式选择自定义与内置 Skill。不能沿用旧研究“新保留名会阻塞普通任务”的未修复判断。[R01][R19][T02][T03]

如果仅修改路由指令，需要检查普通 Default 对话、已有同名 Skill 的对话及现有交互应用路由；若还修改生成 Skill 内容或 bundled docs，必须重新生成 `BUILT_IN_CAPABILITY_RUNTIME_REVISION` 并跑指纹与旧快照刷新测试。不能只跑全新空用户测试。旧静态站点的可空后端字段和原发布入口也应继续保留。[R19][R24][T01][T02]

仓库协议固定 `0.154.0`，启动时严格检查实际 Codex 版本等于该 pin。本轮在线确认同 tag 的 `SkillsListParams` 有 `cwds` 与 `forceReload`，与调用一致；没有把当前文档中的新字段当作该版本契约。当前 shell 的 `codex --version` 输出为 `0.169.0`，并未核验实际 worker 的 `CODEX_BIN`、容器或运行进程，所以不能据此断言现有部署有版本故障；也不能用这个 shell binary 的行为代替固定版本的运行验证。[R25][O02][O03]

## 6. 建议的最小后续工作

### 6.1 用户在对话里的目标流程

1. 用户在新建或已有的普通对话直接说：“做一个预约系统，客户能注册登录、查看自己的预约，管理员审核；完成后发布链接给我。”这种需求已经说明外部访客身份和公开链接，可以直接选择公开动态应用工作流；无需填写创建页、手选 Skill 或了解 Appwrite。目标含糊时，只澄清影响交付的业务选择。[R02][R03][R08]
2. 助手按需求准备或复用自部署后端、配置权限与业务函数，生成完整前端。登录、数据和 API 都使用现有隔离 origin 及同源网关；继续遵守不在任务工作区启动监听服务的规则。[R02][R11][R13]
3. 检查后端就绪并登记资源，在已获得公开发布授权时传递 `backend_id` 完成首次发布。如果用户仅要求研究或预览，保持未发布，明确当前 HTML 预览无法验证完整动态功能；后续可在同一对话确认发布，再由助手调用工具完成绑定。[R02][R07][R10][R17]
4. 直接在该轮对话展示现有站点卡片，交付实际地址和打开、复制、管理入口。当前卡片来自发布记录，刷新对话可以重新获取；发布或更新工具完成会使相关查询失效。HTML 保留在产物列表。用户明确要求本机打开时才调用一次现有 Browser Use；配对或权限不满足时保留链接操作。[R02][R26][R27][R28]
5. 用户继续说“加上取消预约，沿用现在的链接和数据”。助手定位已有 `site_id` 与 `backend_id`，更新原应用，保留访客账号和数据；涉及业务函数时沿用分阶段构建与显式激活。前端发布、函数与数据库变更仍是独立操作，不能承诺统一原子回退。[R02][R07][R13]

这条流程复用已经存在的会话、后端和发布记录。第一轮改进可以限定为对话引导和验证；完整私有预览及动态草稿的手动发布应按下面的独立范围评估。[R02][R04][R07][R10]

### 6.2 最小改动与验收

1. **先对齐普通对话路由。** 明确公开动态应用包括独立访客账号、持久化数据、文件和业务函数，复用 `linksense-public-site` 与现有 tools。保留无明确公开授权时先预览/澄清的规则。[R02][R04][R08]
2. **做一组真实直接对话验收。** 不从创建页进入、不手选 Skill，要求一个可外部访问、有登录和私有记录的预约/审批应用；验证实际 Skill 选择、后端准备与配置、发布带 backend_id、返回稳定链接和卡片。已有 mock、字符串断言及手工编排 Appwrite 集成测试不能代替这一步。[T04][T05][T06]
3. **另测原有会话继续使用。** 使用升级前存在的普通会话及代表性同名自定义 Skill；更新既有动态应用后检查访客账号和数据、链接、函数激活及状态保持。需要时复用现有同 owner 跨任务管理能力，不新增完整 Codex turn 重试。[R07][R17][T01][T02][T03][T05]
4. **预览优先需求单独决策。** 若必须支持先在私有环境验证动态登录、随后人工按钮发布，再确定最小绑定与预览方案；当前研究不推荐直接引入新的草稿模型或数据库迁移。[R10][R11][R12]

这些是研究建议，尚未得到实施或部署授权。后续工作的重点是补齐普通对话的路由表达与真实自然语言验收，继续使用现有后端能力。[R02][R04][R06][R08]

性能上建议保留原生 Skill 的按需加载，只在通用路由里补充简短定义；避免向每条对话注入整份 Appwrite 操作手册。没有持久化、独立账号或业务 API 需求时沿用静态站点；需要动态能力时才准备后端。同任务同名称和后续版本继续复用已有资源。以上是减少上下文和重复开通的策略建议，本轮没有模型 token、生成耗时或吞吐量测量结果。[R02][R08][R17][O01]

## 7. 证据与本轮未验证范围

本轮已阅读真实实现、共享 schema、相关单测和集成测试入口，并核对官方 Skill 文档及固定版本 schema。主调研实际执行的定向检查全部通过：API 3 个文件 / 11 项，Runner context 与 registry 2 个文件 / 57 项，Web 公开站点创建与站点交付 2 个文件 / 33 项，合计 101 项。它们不覆盖真实模型自然语言选择和完整生成端到端。执行环境为 Node.js 24.22.1，命令如下：

```sh
eval "$(fnm env --shell zsh)"
fnm use default
pnpm --filter @linksense/api exec vitest run test/web-sites.tool.test.ts test/web-sites.internal-routes.test.ts test/built-in-public-site.test.ts
pnpm --filter @linksense/runner exec vitest run test/context.test.ts test/core-service-registry.test.ts
pnpm --filter @linksense/web exec vitest run src/features/applications/application-public-site-create-dialog.test.tsx src/features/web-sites/web-sites.test.tsx
```

下表进一步区分“源码中已有的覆盖”与本轮未执行的真实 Appwrite 集成。

| 覆盖 | 现有证据 | 能证明 / 不能证明 |
| --- | --- | --- |
| 工具暴露与传输 | `web-site-service.test.ts` | Default 有六工具、Plan 没有、后端请求正确透传；不能证明模型自动调用。[T04] |
| Skill 内容与隐式策略 | `built-in-public-site.test.ts` | 生成文件包含动态工具、自托管、安全流程与隐式策略；不是模型运行测试。[T06] |
| API/Runner 授权 | `web-sites.tool.test.ts`、`web-sites.internal-routes.test.ts`、`web-site-route.test.ts` | actor/turn 调用、shared secret、service session 拒绝及错误清洗；部分测试 mock 真实仓储，完整 authorization 条件仍以仓储源码为准。[T07][T08][T09][R06] |
| Appwrite 能力与更新 | `web-site-backends.test.ts`、`integration/web-site-backends-appwrite.ts` | mock 后端和显式集成场景覆盖准备、权限、就绪及稳定链接；未在本轮重跑真实 Appwrite，也不证明普通对话隐式完成。[T05] |
| 旧快照与同名冲突 | materializer / process-pool tests | 覆盖升级刷新与已有包保留；未用真实历史会话和模型执行本次目标。[T01][T02][T03] |

未启动 API、Runner、Codex app-server、Appwrite 或浏览器；未读取部署凭证或生产数据；未做生产部署、动态预览可用性、SMTP、容量、备份恢复或对抗隔离测试。当前结论是静态代码与现有测试契约的研究判断，不是本轮真实模型、外部访客或生产环境验收。

## 8. 一手来源

下列本地链接相对本文，标注的行号对应上述产品源码基线，并在 `dae3e13f` 现场仍适用。`R` 为当前仓库实现，`T` 为测试源码，`O` 为官方文档或版本固定的上游 schema。

- [R01] [共享能力定义](../../packages/shared/src/capabilities.ts#L11-L47)，11–47 行：内置名称、稳定 ID 与自定义名称兼容。
- [R02] [公开站点 Skill 生成器](../../apps/api/src/modules/capabilities/built-in-public-site.ts#L11-L194)，11–194 行：描述、动态工作流、预览/发布授权、安全和隐式策略。
- [R03] [公开站点创建入口](../../apps/web/src/features/applications/application-public-site-create-dialog.tsx#L45-L77)，45–77、101–118 行：普通 conversation、优先 Skill、turn 请求与目标提示。
- [R04] [web-site Core MCP 模块](../../apps/runner/src/mcp/core-services/web-site-service.ts#L23-L108)，23–108 行：模式、六工具、输入解析、description。
- [R05] [Core MCP 注册表](../../apps/runner/src/mcp/core-service-registry.ts#L30-L125)，30–45、64–89、113–125 行：模块聚合只按 mode 过滤。
- [R06] [站点仓储任务准入](../../apps/api/src/modules/web-sites/repository.ts#L15-L42)，15–42 行：active owner、普通会话、Default、当前 owner turn。
- [R07] [站点服务](../../apps/api/src/modules/web-sites/service.ts#L37-L54)，37–54、83–136 行：backend 就绪、source bundle、toolForOwner dispatch、可空创建与更新保留。
- [R08] [普通 turn 交付路由](../../apps/runner/src/context.ts#L87-L95)，87–95、223–231 行：Default 交付形态指令及现有表达。
- [R09] [显式优先 Skill 解析](../../apps/runner/src/process-pool.ts#L502-L537)，502–537、1979–2008 行：priority ID 解析与额外上下文。
- [R10] [通用站点发布弹窗](../../apps/web/src/features/web-sites/site-dialog.tsx#L55-L62)，55–62、148–161 行：source 无 backend_id、首次创建与更新分支。
- [R11] [公开应用网关](../../apps/api/src/modules/web-site-backends/gateway.ts#L14-L55)，14–55 行：所有页面/API 先要求 publicBinding、独立域 CSP。
- [R12] [HTML 产物发布按钮](../../apps/web/src/features/web-sites/site-share-button.tsx#L53-L62)，53–62 行：source 只传 conversationId、fileId、name。
- [R13] [Appwrite 后端服务](../../apps/api/src/modules/web-site-backends/service.ts#L23-L174)，23–41、71–174 行：域隔离、prepare/configure、就绪、凭据加密与配置失败。
- [R14] [Runner web-site 调用边界](../../apps/runner/src/process-pool.ts#L4291-L4297)，1656–1700、4291–4297 行：endpoint/token 注入、active turn 与模式。
- [R15] [Runner event sink](../../apps/runner/src/event-sink.ts#L416-L420)，416–420 行：传递可信 owner 和 turn。
- [R16] [API 内部发布入口](../../apps/api/src/modules/web-sites/routes.ts#L49-L61)，49–61 行：shared secret、service session 拒绝及请求 schema。
- [R17] [后端仓储](../../apps/api/src/modules/web-site-backends/repository.ts#L8-L54)，8–54 行：幂等预留、owner、配额、租约、published publicBinding、函数 artifact 归属。
- [R18] [原生 Skill 引用](../../apps/runner/src/context.ts#L153-L173)，153–173 行；[Runner Skill catalog](../../apps/runner/src/process-pool.ts#L5946-L6117)，5946–6117 行：skills/list 强制刷新、来源验证和公开 Skill 标记。
- [R19] [能力物化器](../../apps/api/src/modules/capabilities/user-home-materializer.ts#L563-L600)，563–600、837–877 行：内置 Skill 无条件生成、冲突别名与 enabled built-ins。
- [R20] [Runner 精确 Skill 来源检查](../../apps/runner/src/workspace/capability-runtime.ts#L458-L476)，458–476 行。
- [R21] [Appwrite 配置 schema](../../apps/api/src/config.ts#L93-L125)，93–125 行：可选配置组及完整性验证。
- [R22] [后端共享 schema](../../packages/shared/src/web-site-backends.ts#L15-L82)，15–82 行：输入字段、可支持变更及上限。
- [R23] [API conversation preflight](../../apps/api/src/services.ts#L993-L1069)，993–1069、1074–1159 行：catalog 与快照解析、普通会话的内置优先 ID。
- [R24] [旧 snapshot 解析与 revision 绑定](../../apps/api/src/modules/capabilities/user-home-materializer.ts#L355-L375)，62–66、355–375、1704–1725 行。
- [R25] [固定 Codex 版本](../../apps/runner/src/codex/runtime-version.json#L1-L3)，1–3 行；[版本校验](../../apps/runner/src/codex/runtime-version.ts#L18-L44)，18–44 行；[schema 投影](../../apps/runner/src/codex/protocol.ts#L1-L12)，1–12、338–350 行。
- [R26] [对话站点卡片](../../apps/web/src/features/web-sites/conversation-site-card.tsx#L11-L111)，11–111 行：发布状态、实际链接、打开、复制和管理。
- [R27] [普通对话交付查询](../../apps/web/src/pages/conversation-pages.tsx#L1276-L1295)，1276–1295、2087–2099、6223–6224 行；[发布记录查询](../../apps/api/src/modules/web-sites/repository.ts#L44-L60)，44–60 行：按当前用户和对话恢复卡片，发布工具完成时失效查询。
- [R28] [Browser Use 站点打开入口](../../apps/api/src/modules/browser-use/routes.ts#L195-L199)，195–199 行：只接受拥有的已发布站点；[内置 Skill 的本机打开规则](../../apps/api/src/modules/capabilities/built-in-public-site.ts#L151-L155)，151–155 行。
- [T01] [内置指纹与旧任务刷新](../../apps/api/test/user-home-capability-materializer.test.ts#L355-L402)，355–402 行。
- [T02] [旧同名 Skill/Plugin 保留](../../apps/api/test/user-home-capability-materializer.test.ts#L51-L83)，51–83 行。
- [T03] [按稳定 ID 区分同名 Skill](../../apps/runner/test/process-pool.test.ts#L9972-L10013)，9972–10013 行。
- [T04] [Core web-site 工具单测](../../apps/runner/test/web-site-service.test.ts#L41-L118)，41–118 行。
- [T05] [Appwrite 单测](../../apps/api/test/web-site-backends.test.ts#L9-L169)，9–169 行；[真实 Appwrite 集成场景](../../apps/api/test/integration/web-site-backends-appwrite.ts#L124-L273)，124–273 行：登录、函数、发布、私有数据与文件、并发唯一性、更新与停用，未在本轮重跑。
- [T06] [公开站点 Skill 单测](../../apps/api/test/built-in-public-site.test.ts#L8-L48)，8–48 行。
- [T07] [toolForOwner 服务单测](../../apps/api/test/web-sites.tool.test.ts#L8-L80)，8–80 行。
- [T08] [API 内部入口单测](../../apps/api/test/web-sites.internal-routes.test.ts#L34-L116)，34–116 行。
- [T09] [Runner 路由单测](../../apps/runner/test/web-site-route.test.ts#L38-L97)，38–97 行。
- [O01] [OpenAI 官方 Build skills](https://learn.chatgpt.com/docs/build-skills#how-chatgpt-and-codex-use-skills)，2026-11-16 核对；旧 `/codex/skills/` 重定向至此。技能按描述隐式选择与按需加载；Optional metadata 说明 `allow_implicit_invocation`。
- [O02] [OpenAI 官方 App-server：Skills](https://learn.chatgpt.com/docs/app-server#skills)，2026-11-16 核对；说明 `skills/list`、`cwds`、`forceReload` 及显式引用。其当前扩展字段不直接视为 0.154.0 契约。
- [O03] [Codex rust-v0.154.0 SkillsListParams schema](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/json/v2/SkillsListParams.json#L1-L18)，1–18 行：固定版本只需本项目使用的 `cwds`、`forceReload`。

## 9. 第一轮实施与验证记录

2026-11-16 已在 `feat` 实施第 6 节的对话引导改进。普通 Default turn 明确使用当前对话创建公开动态应用，独立访客账号、持久化数据、上传和业务 API 路由到现有公开站点 Skill；公开 Skill 同步说明对话内继续发布、首次发布携带后端 ID，以及静态预览与动态运行环境的区别。生成内容指纹更新为 `86d273069928d588a5dc59f511a2175b935c391a87e087b0d69a27a51d966b02`，旧任务刷新与同名自定义 Skill 兼容回归通过。没有新增数据库迁移、依赖、意图分类器或后端工具。

实际检查：

| 检查 | 结果 |
| --- | --- |
| API 全量，`vitest run --pool=threads --maxWorkers=2 --maxConcurrency=1` | 362 个文件，4,876 项通过。包含指纹、旧任务刷新、同名包及新增 Skill 回归。 |
| Runner 全量，`vitest run --pool=forks --maxWorkers=2` | 90 个文件，1,226 项通过，保留 1 项既有跳过。包含普通对话、内置别名、Plan 边界和工具传输回归。 |
| Web 既有公开创建与站点交付测试 | 2 个文件，33 项通过；打开、复制和动态 URL 合约继续通过。 |
| API 与 Runner `typecheck`、`lint`、`build` | 全部通过。 |
| 普通平台上下文文本预算 | 含公开 Skill 的普通上下文为 1,293 token，同名冲突别名场景为 1,297 token，均在既有 1,300 上限内。仅为文本预算，不代表实际模型计费或延迟。 |
| 固定 Codex 0.154.0 + 真实模型的直接对话 | 未选择 Skill、未进入创建页；原生发现并读取公开 Skill，实际调用 `prepare_web_site_backend`，没有调用内部应用创建工具。测试夹具故意返回后端未配置，验证选择与失败分支，未验证完整自动发布。 |
| 真实 Appwrite 集成脚本 | 旧静态数据升级、后端租约、HTTPS 会话 Cookie、私有数据、并发唯一性、审批函数、文件权限、更新保留链接和数据、停用及 owner 停用全部通过。与前一项是独立检查。 |

首次同时运行两包全量及类型检查时出现超时和后续临时目录清理错误；失败文件单独复跑通过，随后按上述并发顺序重跑全部通过。未提高测试超时、降低阈值或新增跳过。真实 Appwrite 复测前确认原临时实例处于停止状态，恢复后通过。测试后已停止该栈主服务；最后核验时原 Docker context 已被移除，未重新创建，未能复核剩余函数 runtime 容器的最终状态。没有修改开发或生产数据库。

本轮没有执行“真实模型完整生成前端和函数 → 自动发布 → 实际浏览器访问”的一体化验收。完整私有动态预览、生产入口/TLS、容量与延迟、备份恢复及生产部署仍未验证；不据上述分项检查宣称这些路径已通过。

## 10. 代码审查修复记录

2026-11-16 发现并修复一项 P2 工作流缺口：用户给已有静态站点增加独立登录或持久化数据时，原指引没有先检查该站点是否具备动态后端。现有发布接口保持后端绑定不变；向静态站点传入新的 `backend_id` 会返回 `CONFLICT`，省略该参数仍会发布静态资源，因此不能把上传依赖后端的前端当作原地升级。

修复放在内置 Skill 的执行步骤：修改已有站点前先 `list_web_sites`，已有动态应用通过 `inspect_web_site_backend` 取回并复用原配置，跨对话也沿用原后端。旧静态站点需要动态能力时，说明独立应用和新地址的影响，仅在用户要求或批准后另建，并保留原站点及链接。服务端权限、后端绑定规则和数据库结构保持原有实现。

新增回归验证工作流中的检查顺序、跨对话读取已有后端且不触发开通，以及历史记录的后端字段缺失或为 `null` 时，绑定冲突不会发布新版本。内置内容指纹重新生成为 `b85d1e8951c096c83776f73e0109813876423c2005a1a8961ceb4dc776e48327`，已有任务的刷新测试同时检查新指引。审查复测 API 全量 4,884 项、Runner 相关 308 项通过；最终定向回归 18 项及 API 类型检查、lint、构建通过。完整模型到浏览器的一体化验收仍按第 9 节保留未验证边界。
