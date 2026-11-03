# Computer Use

Computer Use 控制用户自己的 macOS 或 Windows 电脑，不是 API/Worker 服务器。现有 Browser Use 的扩展、配对、登录态和权限独立，不因浏览器已连接而授予整机权限。当前支持 macOS 和 Windows 的 arm64/x64 本地构建；Linux 尚未交付。

## 本地使用

1. 按仓库已有方式启动 Web、API 和 Runner。`pnpm dev:host` 保留原开发准备流程；本功能不新增数据库迁移。
2. 在仓库根目录运行 `pnpm desktop:dev`，准备当前平台的固定执行程序并启动 MyGo 客户端。
3. 在网页“设置 → 常规 → Computer Use”生成配对码。已安装 `.app` 可点击“在客户端中打开”；开发运行时也可输入本站地址并粘贴配对码。必须在客户端明确点击配对。
4. macOS 客户端自动刷新辅助功能和屏幕录制权限，并在窗口重新聚焦时立即复查；打开屏幕录制设置会显示可拖入系统设置的浮动面板。Windows 客户端检查 UIA 访问状态，不显示 macOS 权限设置。终端诊断已获权不代表独立客户端已获权。连接成功不代表任务已授权。
5. 在普通聊天提出桌面操作。内置 Skill `linksense-computer-use` 可从 `/computer` 选中，模型使用 `computer_use` 查询设备、应用和窗口，客户端询问本次任务授权后才执行。Plan 只读；授权五分钟有效。

诊断、安装包路径和真实原生白盒命令统一见 [客户端说明](../../apps/desktop/README.md)。macOS 本地安装包仅 ad-hoc 签名；Windows 本地安装包默认未签名，均不代表已完成公共发行。

## 调用链

```text
Web 设置/意图提示 -> API 账户鉴权、设备配对、Redis 围栏
                       <-> 用户本机 MyGo 的主动认证 WebSocket

Codex 原生 turn -> Core MCP computer_use -> Runner 当前任务 token
  -> Controller 内部身份 -> API 会话/用户/活动 turn/Plan/服务范围校验
  -> Redis 短期命令 -> 本机任务授权 -> 受控 agent-desktop stdio host
  -> 结构化观察、动作结果或独立 MCP image
```

沿用 Codex 原生工具调用和生命周期，不创建第二个模型循环、不重放整个 turn、不增加整轮重试。原生 `computer_use` feature flag 不是本桥接工具的启用方式。

## 协议与授权

- 共享 Zod 契约为 `packages/shared/src/computer-use.ts`，协议版本 `1`。完整工具名 `mcp__linksense_core__computer_use`。
- Web 接口为 `/api/v1/computer-use`、`/pairing`、`/client`；客户端兑换为 `/pair`，设备通道为 `/socket`。内部执行为 `/internal/computer-use/execute`。
- 配对码两分钟、单次使用；Redis 保存摘要。设备 token 绑定 owner、设备、服务端 origin、账户认证代次和撤销 epoch，最长三十天。本机凭据进入系统 Keychain，不进入网页、模型或明文配置。
- 首版每账号一个当前配对设备、一个在线连接、一个在途动作。调用显式携带 `device_id`，不会默默选择另一台机器；替换配对让旧凭据失效，离线设备也能从网页撤销。
- API 限制普通、非归档、归属当前账号的会话与 running turn，且用户必须 active。发布服务不能借用发布者电脑；派发前和在途期间继续检查。
- 本机为会话/turn 分别授权，Plan 与写授权不通用。后续动作不滑动延长五分钟授权，执行 deadline 不得晚于本地授权截止。
- 本地暂停、远端 `release`、撤销、断线、过期和任务取消封闭执行入口。暂停围栏不会随心跳租约失效；必须本地恢复，并重新批准任务。
- 连接/命令 ID、代次、超时、原子锁和去重防止旧 socket、迟到回复、重连恢复旧动作。未知送达结果不可自动重试。

## 原生执行

`agent-desktop@1.0.2` 使用 envelope `2.5`。固定白名单与独立 argv 限制文本字节、结果大小、时长和目标；不开放任意 shell、flags、输出路径、启动进程、批处理、通知、全屏截图或剪贴板接口。App 优先使用清单的 `bundle_id`，窗口使用精确返回 ID。

快照只从结构中的 `ref_id` 提取当前 `snapshot_id` 下的引用，不将应用文字中的伪造引用视为可操作对象。动作、停止或新授权后重新观察；跨任务和停止后的引用不能沿用。

遵循快照的 `available_actions`：输入框使用聚焦/输入，只有声明 `Click` 的对象才用于点击。首版没有任意坐标或物理点击兜底；不支持 AX 的画布及特定应用不能据此宣称可控。

`key` 通过固定的 headed 执行模式先前置并确认所选应用的精确窗口，再发送按键，可能将该窗口带到前台。不能确认窗口时返回未送达错误；不对其他窗口重试，也不重放该动作。

普通 macOS CLI 会自动连接独立后台 socket host，杀死外层命令不足以停止在途动作。因此 macOS 固定使用该版本的 **internal stdio host**，直接持有其进程组，取消时杀死客户端拥有的 host。Windows 没有该 host，每条命令使用独立进程，文本输入和聚焦使用 headed 模式。升级必须重验两条路径。已经送入系统的输入无法撤回，不能承诺回滚桌面状态。

截图、AX、窗口标题和输入可能含隐私，仅在本地任务授权后返回；不写入普通日志和审计。原生权限错误映射稳定错误码，动作结果保留送达语义，截图转为独立 MCP image。

## 意图提示

普通可交互聊天对最新已发送用户消息做独立分类，不依赖浏览器扩展。复用标题模型、最多 2000 字符、五秒总超时、零重试，失败静默。Redis 按消息摘要缓存布尔结果，`computer_use_intent` 单独记用量，六语言覆盖。

已连接设备不分类；新用户消息重新核对设备，避免旧缓存压制断线后的引导。空聊天、待发送/乐观消息、嵌入、只读和应用会话不展示同一入口。提示不抢输入焦点、不阻塞主 turn；明确拒绝按账号存入当前浏览器会话，外部点击/Escape 不等于永久拒绝。

引导不自动安装、配对或授权。没有实际安装包时禁用下载并显示本地调试命令，不提供虚假链接。

## 部署与兼容

Shared、API、Runner/Worker、Controller、Web 一起部署。Nginx/Vite 必须转发 `/api/v1/computer-use/socket` 的 WebSocket Upgrade；Browser Use 的旧 listener 不能销毁另一个注册通道。

站点支持 HTTP/WS 和 HTTPS/WSS，内网部署无需强制 HTTPS。地址校验、配对确认和任务授权继续生效；明文传输边界见[客户端说明](../../apps/desktop/README.md#local-use)。

本地 API 自动发现 `outputs/desktop/LinkSense-Desktop-macos.zip` 和 `outputs/desktop/LinkSense-Desktop-windows.exe`。部署 API 分别通过 `LINKSENSE_DESKTOP_CLIENT_ARCHIVE` 与 `LINKSENSE_DESKTOP_CLIENT_ARCHIVE_WINDOWS` 指定绝对路径，并由部署者将实际文件挂载到该路径，建议只读；不能只在开发机生成安装包就宣称生产容器已有安装包。未配置不影响旧部署，对应平台下载保持不可用。

源码 UAT 已接入安装包的只读目录挂载，上传位置和更新方式统一见 [UAT 部署说明](../../deploy/uat/README.md)。

没有 Prisma 迁移，不要求旧用户重建任务、重新导入能力或重配 Browser Use。新增用量分类需要 API/Web 同步部署；回滚旧版本前需评估已生成的新分类记录。

新增内置 Computer Use 不会占用既有自定义资源的合法名称。内置选择 ID 始终为 `builtin:capability:linksense-computer-use`；如果当前运行环境已有同名自定义 Skill，则只将内置 Skill 投影到第一个未占用的 `linksense-computer-use-builtin-N` 目录和原生名称，原自定义资源的 UUID、名称、清单及内容均不修改。同名插件位于独立目录，无需投影改名。API 与 Runner 使用同一确定性映射校验内置 ID、名称和原生路径，并继续校验完整发布目录及内容摘要；选择内置能力不会加载同名自定义内容。已有快照在内置内容指纹变化后自动重建。
