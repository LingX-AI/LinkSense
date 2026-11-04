# Computer Use 白盒验收

日期：2026-11-02。范围为本机 macOS Computer Use：共享协议、Core MCP、Runner/Controller、API/Redis、Web 配对与意图提示、MyGo 客户端、原生执行程序、构建和网关配置。

## 结论与边界

已实现从普通聊天的 Core MCP 调用到独立 MyGo 客户端的配对、任务授权和本机执行链路。真实 macOS arm64 隔离窗口已验证聚焦、按钮点击、输入、按键、重新观察、窗口截图和停止后的引用失效，不是界面模拟。

这不等于已验证所有桌面应用、付费模型完整任务或生产分发。当前验收采用两段明确区分的证据：

1. Go 客户端通过真实 HTTP/WebSocket 连接隔离 Fastify API，验证配对、执行、授权、暂停、到期、归档和撤销；该测试的原生执行器为 fake。
2. 真实打包的 `agent-desktop@1.0.2` 控制本次测试专用 MyGo 窗口，验证原生效果；该测试不调用真实用户账号或模型。

独立启动的 `.app` 实测显示辅助功能和屏幕录制“未授权”，这是与从 Codex/终端启动的诊断程序不同的 OS 权限主体。用户仍须亲自在系统设置授权，不能将终端 `doctor` 的 granted 当作 `.app` 已获权。

## 验证结果

| 层 | 实际检查 | 结果 |
| --- | --- | --- |
| Shared | `pnpm --filter @linksense/shared test tests/computer-use.test.ts tests/usage.test.ts tests/browser-use.test.ts`；包脚本同时包含全量 src/tests | 83 文件，704 项通过 |
| API | Computer Use 三个测试文件、Browser Use 五个文件、config、capabilities-importer、user-home-capability-materializer | 11 文件，274 项通过 |
| Runner | computer-use-service、browser-use-service、Core 注册表、Controller、context、MCP stdio、workspace-manager，单 worker | 7 文件，161 项通过；1 项原有 Linux root 专用测试在 macOS 不适用 |
| Web | Computer Use、Browser Use、native-activity-item、i18n | 10 文件，283 项通过 |
| Native | `go test -race -count=1 ./...`、`go vet ./...` | 25 个顶层测试、含子用例共 48 项通过；真实硬件 opt-in 测试另行执行 |
| 原生硬件 | 显式启用 `TestInstalledEngineAgainstIsolatedNativeWindow`，使用最终 `.app` 内的 CLI/helper | 通过；只触及专用测试窗口 |
| 打包 | `pnpm desktop:build`，`codesign --verify --deep --strict` | macOS arm64 `.app`、DMG、ZIP 生成且本地签名校验通过 |
| 本地诊断 | `pnpm desktop:doctor` | 终端执行主体的两项权限均为 granted；不替代独立 `.app` 授权 |
| 脚本 | desktop archive / Runner runtime smoke | 10 项通过 |
| 网关及构建契约 | 三份模板分别验证 Browser Use / Computer Use Upgrade、维护模式、实际 Node workspace manifest | 8 项针对性检查通过 |
| 全量部署脚本测试 | `node --test scripts/deployment.test.mjs` | 67 项通过，2 项因缺少 Docker CLI 未通过；详见下文 |
| TypeScript / lint | API、Runner、Web typecheck；本功能相关 TS/TSX 的 ESLint | 通过 |
| 生产构建 | Shared、API、Runner、Web | 全部通过；Web 保留既有大 chunk 和浏览器模块外置警告 |

Runner 多 worker 混合测试初跑有一项既有 MCP subprocess 测试超过 5 秒。未修改超时或断言；改为单 worker 后整个上述 Runner 集合通过。此记录不能据此证明并发启动性能不存在问题。

全量 `node --test scripts/deployment.test.mjs` 另含 Docker Compose 环境测试。当前机器没有 `docker` CLI，其中两项报 `spawn docker ENOENT`，不将它们记作通过，也未修改或跳过其源代码。Docker/生产容器验收不属于已验证结果；具备 Docker 的环境应重新运行该命令。

## 已修复的问题

1. **停止不完整**：普通 CLI 使用独立后台 command host，取消外层进程不够。固定持有 internal stdio host 的进程组，超时、暂停、断线和撤销时取消并停止；不自动重放未知送达动作。
2. **旧代连接污染**：dispatch 检查与 active 预留现为同一临界区；awaiting、ready、heartbeat 受 generation/connection 约束；远端 pause/cancel 与停止、新任务启动通过生命周期锁串行。新增回归在修复前实际失败，修复后通过。
3. **成功回包后误取消**：API 在匹配回复后清除 in-flight；本机取消仅作用于匹配的活动命令。连续成功动作不会丢失同一任务授权和快照引用。
4. **暂停围栏丢失**：暂停标记不随心跳租约过期；Redis CAS 冲突重验，真实隔离 Redis 覆盖并发心跳和暂停。恢复只能由本机显式触发，并重新申请任务授权。
5. **授权滑动/超期**：五分钟授权不会被后续动作延长；每次执行同时受命令、任务授权和原生动作 deadline 约束。阻塞执行器验证到期取消。
6. **引用注入与错误投影**：只从真实 `snapshot_id`/`ref_id` 收集引用，忽略应用文字中的伪造 ref；跨任务、动作后和停止后要求重新观察。权限拒绝及未送达语义稳定映射，不向模型泄露原生路径和原始错误。
7. **界面与本地调试缺口**：安装包检测和下载为真实文件；离线设备可撤销；每条新消息重新检查连接，不被之前的“在线”缓存压制提示；本机后台权限检测完成后连接按钮保持可用。
8. **打包和配置断点**：修正 MyGo 平台子目录；固定双架构归档摘要并拒绝多余归档项；API 接收可选绝对安装包路径；三份网关模板均支持独立桌面 WebSocket。新增 Go app 不再被 Node workspace 测试误认作缺失 `package.json`。

原生扩展测试曾尝试点击只声明 SetFocus/TypeText 的输入框，上游正确拒绝。没有删掉该失败路径：测试现明确断言非可点击输入框不产生物理兜底，并新增有 Click 动作的独立按钮验证真实点击效果。工具说明要求遵循 `available_actions`；没有宣称支持任意坐标或不可访问性画布。

## 安全覆盖

- 网页认证、内部身份、当前账号、设备 ID、服务端 origin、认证代次、过期和撤销；与 Browser Use 凭据/Redis key 隔离。
- 普通会话归属、非归档、活动 turn、active 用户、Plan 只读；发布应用/服务不能借用发布者电脑。
- 两分钟单次配对码、摘要存储、独立设备 token、系统凭据存储，无明文回退；深链仅填入待确认表单。
- 单设备、单连接、单在途动作；命令代次、连接 ID、去重、固定期限、断线取消及未知送达不可重试。
- 固定 argv 和动作集合，禁止任意 shell、flags、输出路径、启动进程、整屏截图和剪贴板接口；文本、输出、截图和网络体积有上限。
- 六语言资源、明确错误/禁用状态、不抢聊天焦点、拒绝提示持久化、浅深色、小窗口和减少动态效果。

## 升级兼容与部署

在用户已确认完成的 Browser Use 重命名基线上继续，保留该基线改动，未切分支、重置、stash、提交或推送本次新功能。

本功能无 Prisma migration，未运行 migrate/seed，也不要求旧任务重建、能力重导入或 Browser Use 重配。无桌面配对记录的旧账号得到 disconnected 状态。新的 `computer_use_intent` 用量分类要求 API/Web 同步发布；回滚旧版前应处理旧版不能识别该分类的风险。

Shared、API、Runner/Worker、Controller、Web 和网关应同步部署。本地 API 自动发现 `outputs/desktop/LinkSense-Desktop-macos.zip`；生产必须配置 `LINKSENSE_DESKTOP_CLIENT_ARCHIVE` 并实际只读挂载 ZIP，环境变量本身不会把开发机文件带进容器。缺失安装包时禁用下载，不影响原有功能。

## 未验收与风险

- 浏览器已验证本地登录页和认证拒绝，但没有现成用户登录会话；未绕过登录、读取账号凭据或发起付费模型任务。真实账号的网页配对、Keychain 写入/恢复、模型选择工具与完整聊天仍待用户登录后验收。
- `.app` 的 macOS 辅助功能/屏幕录制权限须用户授予；授权撤销、锁屏、多显示器和具体第三方应用的长期行为未逐项实机覆盖。不能以 AX/会话授权替代 OS 沙箱或确定性的高风险业务审批。
- macOS arm64 已实机验证；x64 仅固定并核验归档契约，未实机测试。Windows/Linux 未交付。
- 仅 ad-hoc 本地签名；没有 Developer ID、公证、公共发行、自动更新、托盘或开机自启验收。关闭客户端会断开，不是隐形常驻服务。
- internal stdio host 是固定上游版本的内部契约，升级必须重验。已送达 OS 的输入不能撤回；失败不保证桌面状态回滚。
- 没有 Docker CLI，未进行容器部署、生产安装包挂载/下载和真实网关握手验收。全仓 API/Web 测试、浏览器 E2E 与所有平台测试未作为本次 feature 白盒的一部分执行。

可重复命令、原生硬件测试环境变量及产物路径以 [客户端说明](../../apps/desktop/README.md) 为准，协议以 [Computer Use 开发说明](../development/computer-use.md) 为准。
