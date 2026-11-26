# LinkSense 桌面端发布与验收手册（2026-11-26）

本手册只列发布/验收的顺序、命令和证据要求；开发、配对、代理、文件、审批、更新与排障的细节以
[`apps/desktop/README.md`](../../apps/desktop/README.md) 为准，范围与阶段门槛以
[方案](../research/linksense-desktop-dual-mode-plan-2026-11-16.md) 和
[任务拆解](linksense-desktop-dual-mode-task-breakdown-2026-11-16.md) 为准。

当前状态：Mac ARM64 开发包已重出（ad hoc、回环 origin）；Developer ID 签名、公证、Gatekeeper、
干净安装、M1b 真机和生产本地执行仍待完成。开发包证据见任务拆解 §10 的 2026-11-26 回执。

## 1. 前置条件

1. Apple Silicon Mac，Xcode Command Line Tools，Go 1.27.3，pnpm。
2. 登录钥匙串中有 `Developer ID Application: <名称> (<TEAMID>)` 证书：
   `security find-identity -v -p codesigning` 必须列出它。
3. 公证凭据 profile 名为 `linksense-desktop-notary`：
   `xcrun notarytool store-credentials linksense-desktop-notary`。
4. 一个应用可访问的 HTTP(S) origin。自部署内网可直接使用 HTTP（例如 UAT 的
   `http://192.168.2.210:19090`）；HTTPS 仍推荐，但不是打包或运行的硬性要求。
5. 更新源（如需要）：HTTP(S) stable/beta 目录、更新公钥、私钥文件路径，见 README 的
   “Releasing a verified candidate”与“macOS releases”。

## 2. 构建

开发包（ad hoc，回环 origin）：

```sh
pnpm desktop:build -- --platform darwin/arm64 --server-url http://127.0.0.1:18173
```

签名发布包：

```sh
LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY="Developer ID Application: <名称> (<TEAMID>)" \
pnpm desktop:build -- --platform darwin/arm64 --server-url http(s)://<origin> --macos-release
```

`--macos-release` 还会要求：原生 Apple Silicon、`darwin/arm64` 和 Developer ID 证书；origin
可以是 HTTP 或 HTTPS。公证使用 `mygo.config.ts` 中的 `linksense-desktop-notary` profile；
发布构建会把签名者 token 编译进 Go 二进制，产品 GUI 路径只接受这种包。

## 3. 产物核对

1. `codesign -dv --verbose=2 <app>`：TeamIdentifier 正确，非 ad hoc。
2. `codesign --verify --deep --strict <app>` 与 `spctl -a -vv <app>` 通过。
3. `hdiutil verify <dmg>`，只读挂载确认包内签名、图标、runtime manifest 与 preload。
4. 包内运行时冒烟：worker 就绪并停止、Core MCP 可调用、固定 Codex 完成一次合成模型回合，
   且不要求供应商密钥。
5. 记录构建 commit、产物大小、SHA-256、签名/公证结果。

## 4. 安装矩阵（干净 Mac）

按顺序记录每一步的实际结果：

1. Gatekeeper 放行首次安装；包内不含未签名 helper。
2. 首启不要求填写 URL；服务 origin 来自打包注入。
3. 系统浏览器登录，复用已有浏览器会话；Keychain 刷新凭据可跨重启恢复；退出删除。
4. 系统深链 `linksense-desktop://pair` 打开设置页；默认 scheme 路由正确。
5. 云会话 SSE、断线游标重连、工件下载。
6. 更新检查、stable/beta 切换、delta 命中与失败整包回退、只读安装位置降级。
7. 用上一版签名包连当前 API：可登录、可开会话；协议过旧时到更新入口。
8. 原地升级与回滚；更新与进行中回合互斥（busy，不排队、不重放）。

## 5. M1 验收（不依赖 GUI）

1. 配对、`executionReady`、新任务默认目标与显式切换。
2. 本地回合：读文件、写文件、Shell 实际执行、取消、断线重连、撤销。
3. 命令/文件逐次审批：允许、拒绝、超时 cancel、迟到答复不重发；严格档沙箱保持写限制。
4. Browser Use：系统浏览器扩展配对、标签页操作、撤销即时生效。
5. 知识库、网页搜索、连接器只读回包与服务端资源权限。
6. 输入附件与工件：单文件、32 MiB 分片、网页资源包、活动工件链接、下载字节核对。
7. 旧客户端兼容：旧包连新 API、旧连接不协商新工具、云端策略不变。
8. 证据：登录/配对、每类工具的请求与回包、拒绝路径、断线与撤销、工件 SHA-256。

## 6. M1b 验收（GUI，必须签名安装包）

产品 GUI 路径要求 `--macos-release` 包；ad hoc 包不构建该路径。

1. PermissionFlow：辅助功能与屏幕录制的检查、引导、拒绝/取消、返回应用后复查；无权限时不挂 GUI 工具。
2. 用户选择单个窗口，模型只见 `computer_status`/`computer_observe`/`computer_act`，协商后才有 `computer_wait`。
3. observe → click/type → 效果读回 → 只读 wait；迟到/不明结果不重试。
4. 五分钟授权、续期、Pause/Resume、Stop/撤销；暂停后输入停止；旧回执不能清掉新租约。
5. 同设备第二会话 `DEVICE_BUSY`，结束/暂停/断线/崩溃/到期后接手；窗口变化 `COMPUTER_TARGET_CHANGED`。
6. 物理快捷键 `Cmd+Shift+Esc`；系统通知中心投递与冷启动点击；崩溃后不重放。
7. 审计：动作、应用、窗口、结果、耗时；不含键入原文、截图、路径或凭据。

## 7. 生产本地执行准入

`apps/api/src/config.ts` 在 `NODE_ENV=production` 时以
`desktop_local_execution_not_released` 拒绝 `LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED`，
除非同时显式设置 `LINKSENSE_DESKTOP_LOCAL_EXECUTION_RELEASED=true`。放开前必须有：

1. 服务端用量记账：`model-proxy` 的 provider usage 记录在三种协议下均有回执。
2. 隐私屏蔽契约：屏蔽开启时拒绝新的本地回合，不派发、不回落云、不占槽。
3. 崩溃清理：工作区、runner、Codex 子进程与 outbox 的强杀/管道丢失回收。
4. 签名安装包的 M1 验收完成，且首发审批范围已确认（当前为严格档逐次确认）。
5. 统一开关顺序：升级所有 API/设备网关/恢复消费者 → 迁移 → 再开开关；回滚顺序相反。

不得以删除准入检查代替验收；准入检查的放开是一次独立的发布决定。

## 8. 证据与回滚

- 每条验收写入任务拆解 §10：日期、commit/镜像、命令、实际结果、未覆盖项。
- 保留本次构建的 Go module 缓存、固定运行时归档和上一版签名包，供回滚与升级矩阵使用。
- 回滚前停止新本地回合、关闭相关开关并等待授权/审批/回合结算；不要删除 outbox、原生历史或迁移列。
- 多次打包后清理 Go 构建缓存与临时 staging，只保留最新同目标产物；正式发布包与回滚包除外。
