# agent-desktop 接入 LinkSense 的可行性

调研日期：2026-11-02（Asia/Shanghai）。范围：上游 README、发行记录、npm 元数据、原生后端与 CLI/FFI 源码，以及本机授权、MyGo 客户端与分发的一手文档；未安装依赖、构建上游或控制真实桌面。下文区分已核实事实与工程建议，不以宣传视频或体积/内存宣传数字代替运行验证。

**需求已澄清：用户在 LinkSense Web 发起任务，AI 控制的是该用户自己的物理电脑；允许安装类似现有浏览器扩展的小型本地客户端。** 不是控制 LinkSense 服务器，也不是新增云端/容器桌面。原调研的云端桌面发现保留作可选路线，不再作为主推荐。

**客户端选型已确认：独立 companion 使用 MyGo + Go，替代先前的 Tauri 候选。** 这只确定本地壳，不迁移现有 LinkSense Web/API/Runner 技术栈，也不改变已确认的出站 WSS 与本机 `agent-desktop` 架构；目前尚未实现客户端。

## 结论

**可以接入；符合本次需求的方案是“LinkSense Web + 用户电脑上的小型 companion + 本机 `agent-desktop`”。** `agent-desktop` 负责原生桌面的观察与动作，LinkSense 负责设备配对、账户/会话/turn 授权、命令传输、停止和审计。它不是额外的 LLM Agent，也不是把 npm 包导入网页就能控制电脑。[S1][S4][S5][S7]

| 用户真正想要的能力 | 对该项目的判断 |
| --- | --- |
| 从 LinkSense Web 控制用户自己的桌面 | 本次主路线：本地 companion 在该用户的已登录图形会话内运行 `agent-desktop`，主动连接 LinkSense |
| 只操作已登录的本机 Chrome/Edge 标签页 | 保留现有 `browser_use` / Browser Use 和扩展；浏览器授权不能自动升级为桌面授权 |
| 在 LinkSense Web 中观看一台云端电脑 | 是另一个可选产品场景；不能用它代替“控制用户本机” |

这是根据原生执行架构作出的集成判断，不是上游已交付的 SaaS、远程设备配对或 Web SDK。**只在服务器安装 `agent-desktop` 会控制服务器上的图形会话，控制不到打开 LinkSense 网页的用户电脑。** 本地 companion 是本次需求的必要执行桥；网页画面直播不是首版前提。[S2][S4][S5]

## 版本快照：发行版与 main 必须分开

- 已发布版本：`v1.0.2`，2026-10-30 21:17:30 UTC 发布，tag 提交 `a47ed664e0db00d1d4df364eb3fe8a5599882f3c`；本次 npm registry `latest` 也是 `1.0.2`，`gitHead` 指向同一提交。[S3][S4]
- 本次源码快照：main 提交 `9eb9b296192fcb70bda25e918cd6dd66abfa3d0d`，提交时间 2026-11-01 03:30:44 UTC；比发行版多 16 个提交。[S6]
- `Cargo.toml`、`npm/package.json` 在发行版与该 main 快照均标为 `1.0.2`，**版本字段相同不表示二进制行为相同**。本次比较确认 README 仅移除演示视频、CLI 命令枚举未变；main 已新增 `type --interval-ms` 和光标呈现等改动，不应当成发行版已有能力。[S4][S6]
- 接入时应固定发行包/校验来源，并使用与二进制一致的内置 Skill；本次不对任一版本给出生产批准。[S1][S6][S8]

## 它提供什么，不提供什么

| 边界 | 已核实内容 |
| --- | --- |
| 决策循环 | 它是工具，不含主 Agent/LLM 循环；由调用者执行“观察 → 动作 → 再观察” |
| 原生后端 | Rust；macOS 使用 AX、Windows 使用 UI Automation、Linux 使用 AT-SPI；根据编译目标选择本机 adapter |
| CLI | 结构化 JSON 输出；snapshot/ref、点击输入、键鼠、应用与窗口、截图、剪贴板、session/trace 等；60 个命令名不等于所有系统上全部可用 |
| MCP | **本次未发现官方 MCP server/transport**：核对完整未截断文件树、实际 CLI 命令枚举和启动分发，没有 `mcp`/`serve` 入口；不能因仓库 topic/类似项目有 MCP 就宣称开箱即用 |
| SDK/FFI | 有真正的 C-ABI `libagent_desktop_ffi`，不是浏览器 JS SDK；可由 Node/Python 等 native host 通过 FFI 调用。npm 包只声明 CLI `bin`，无 `main`/`exports`/`types` |
| Web UI / 远程桌面 | 上游明确无 GUI；debug HTML 是截图与 AX 的静态检查产物，不是实时桌面客户端 |
| Sandbox / 多租户 | session/ref namespace 管理工具状态；没有据此建立 VM、容器或 OS 用户安全隔离 |
| 人工接管 | 有原生动作互斥 lease 和呈现用 cursor overlay；不是人/AI 控制权仲裁、WebRTC/VNC 画面通道或用户授权系统 |

来源：定位与架构 [S2]，CLI 真实入口 [S5]，FFI 与 npm manifest [S4][S7]，截图/调试产物与会话概念 [S9]，原生 lease [S10]。上述“不提供”限于本次核对到的正式入口与实现，不等于已对全部代码做安全审计。

**“浏览器里使用”必须区分执行位置和观看位置。** 运行在服务器里的 `agent-desktop` 操作服务器图形会话，不会自动操作打开 LinkSense 页面的用户电脑；网页前端也不能把原生二进制当普通客户端 npm 库导入。[S4][S5][S7]

## 系统与图形环境要求

| 平台 | 上游要求及限制 |
| --- | --- |
| macOS | Accessibility 授权；截图另需 Screen Recording；部分系统 UI 需要 Automation；源码构建要求 macOS 13+ 与 Xcode command-line tools |
| Windows | 普通应用按执行进程的 integrity level 工作；控制管理员应用需要相应提升。发行二进制未签名，可能被 SmartScreen、杀软或 Smart App Control 拦截 |
| Linux | 主要目标为 Ubuntu 24.04+ / GNOME 46，glibc floor 2.35；需要目标用户的图形 session、session bus、display/runtime 环境及 `at-spi2-core`。Ubuntu 22.04 的 ATK bridge 存在已知 abort 问题 |
| X11 与 Wayland | AX 语义操作均可；物理鼠标操作和原生窗口控制主要走 X11。X11 键盘需要 XTEST；Wayland 键盘依赖 GNOME Mutter RemoteDesktop 能力，剪贴板需 `wl-clipboard` |

来源：[S8][S11]。Rust 1.89 是源码构建要求；npm launcher 要求 Node >=18；可直接使用对应平台发行原生包，不必因此在生产镜像加入 Rust 工具链。[S1][S4][S8]

**`headless by default` 的含义是默认以无障碍语义动作在后台操作，不移动鼠标或抢焦点；不是 Linux 不需要图形桌面。** 单纯 SSH/TTY、无 session bus 的容器或另一个用户的 session 看不到目标应用。`--headed` 是允许物理输入，不是自动启动 X server/桌面。[S1][S8][S11]

对本次本机路线，关键是 companion 必须运行在目标用户自己的已登录桌面会话内，而不是系统服务的另一会话或 SSH shell。用户已经拥有真实桌面，不需要为此在 LinkSense Worker 新建 Xvfb/GNOME/VNC。只有另选云端路线时，才需要一致配置图形会话、窗口管理器、DBus/AT-SPI、应用启动环境与远程显示。[S8][S11][S12]

## AX、截图及浏览器的实际限制

1. **AX 不是 OCR/视觉理解。** 没有暴露无障碍树的 Canvas、自绘 UI 等内容，核心快照无法识别。另有截图命令，不代表该工具自带“截图 → 视觉模型 → 坐标规划”能力；仓库可选 JEV helper 会额外向配置的模型服务发送内容。[S2][S13]
2. **浏览器窗口可暴露 AX，但不是 DOM/CDP 自动化替代品。** Linux Chromium 需要 `--force-renderer-accessibility`；裸 Xvfb/无桌面设置 daemon 场景还可能需要 `ACCESSIBILITY_ENABLED=1`。这与“已能稳定操作任意网页、Canvas、标签页上下文”是不同的承诺。[S12]
3. **截图是单次 PNG/文件或 base64，不是推流。** Linux 源码明确：Wayland 拒绝单窗口截图，走 portal 的显示器截图需要人工同意；X11 合成窗口管理器下整屏截图也可能拒绝，建议改截窗口。不能直接把它的 screenshot API 当成通用桌面直播服务。[S14][S15]
4. **动作成功不总是业务效果已确认。** 输出区分 `delivered_verified`、`delivered_unverified` 与未发送/未知状态；接入后必须保留这种语义。上游还记录 Firefox/Gecko 选择值可能未触发页面事件等差异。[S11][S16]

## 安全与维护成本

- **桌面访问范围很大。** 窗口标题、AX 文本、截图、剪贴板、通知及 trace 可能包含敏感数据；截图不能靠结构化字段脱敏变成安全公开内容。API、审计与 SSE 不应直接透传原始结果。[S13]
- **session 不是租户安全边界。** Unix 原生 interaction lease 使用当前 UID 下的锁，能串行化参与该协议的工具动作；不隔离共享桌面上的应用/文件/登录态，也不会让外部 VNC、浏览器控制器或真人自动遵守同一锁。[S10]
- **许可可用但不是免维护承诺。** 仓库为 Apache-2.0；再分发需保留相应许可/声明。它有跨 OS 测试、FFI ABI 校验和持续发行，但 Labs 标识、版本号与测试存在均不能代替目标镜像上的稳定性和安全验证。[S2][S3][S17]
- **升级必须固定内容。** main 与 release 可能显示相同版本号；FFI 还需 ABI-major 握手和资源释放约定。若仅需子进程 CLI，不应为了省一次进程创建就先引入 native FFI 绑定和额外崩溃面。[S6][S7]

## LinkSense 现有架构与接入建议

本地核对基于当前工作区；本调研未切换分支。现有实现不是空白；下表使用统一名称 `browser-use` / `browser_use` / Browser Use，内置 Skill 为 `linksense-browser-use`。项目尚未上线，命名同步调整不保留旧别名：

| 既有能力 | 实际状态与可复用边界 |
| --- | --- |
| 云端浏览器 | `linksense-browser` 已封装固定版本 Playwright CLI，使用完整 Chromium 的 headless 模式；普通网页继续沿用，不因引入桌面工具而替换。[浏览器配置](../../apps/runner/src/browser/cli-wrapper.ts#L670)、[浏览器实现文档](../development/browser-use-implementation.md) |
| 用户本机浏览器 | `browser_use` MCP 通过 Chrome/Edge 扩展和 `chrome.debugger` 操作明确共享的标签页；已有 snapshot/ref、截图、坐标点击及登录态复用，不等于本机完整桌面授权。[MCP 工具](../../apps/runner/src/mcp/core-services/browser-use-service.ts)、[扩展执行](../../apps/api/browser-extension/background.ts) |
| 配对与连接 | 已有短时单次配对码、服务端保存凭据摘要、approval 与撤销围栏、扩展主动 WebSocket 连接、心跳、命令过期和取消；目前凭据/连接主要按 owner 单槽管理，WS upgrade 只接受扩展 Origin。可复用设计，不可直接把 native client 当扩展接进去。[配对服务](../../apps/api/src/modules/browser-use/service.ts)、[WS 与 API](../../apps/api/src/modules/browser-use/routes.ts)、[扩展连接与本地信任](../../apps/api/browser-extension/background.ts) |
| 云端画面与人工接管 | API、Runner 和 `BrowserPanel` 组件已有截图、点击、滚动、文字、导航键、claim/release；组件约每 1.5 秒刷新，不是视频流。当前会话页只挂载 `BrowserUsePreview`，没有挂载云端 `BrowserPanel`，不能描述为现成可达的云端桌面入口。[Web 组件](../../apps/web/src/features/browser-panel/browser-panel.tsx#L20)、[会话实际入口](../../apps/web/src/pages/conversation-pages.tsx#L6159)、[Runner 操作](../../apps/runner/src/browser/panel-operation.ts#L20) |
| 授权与运行边界 | 本机浏览器调用有当前用户 token、活动 turn/会话校验、Plan 只读限制；API 拒绝已归档会话、非运行 turn、失效账户与发布服务调用，扩展另做标签页 grant。桌面需要同等后端边界和独立本地桌面 grant。[Runner](../../apps/runner/src/process-pool.ts)、[本机浏览器 API](../../apps/api/src/modules/browser-use/routes.ts)、[扩展 grant](../../apps/api/browser-extension/background.ts) |
| Worker 镜像 | 最终运行基础为 Ubuntu 24.04；Node 的 Debian 镜像仅作工具链来源。现有 Worker 配置只读根文件系统、非特权任务进程和资源限制；本次在相关源码/镜像配置中未找到 Xvfb、GNOME、AT-SPI 或 VNC 服务配置。[运行时基础](../../deploy/baselines/Dockerfile.runtime#L37)、[容器约束](../../apps/runner/src/controller/docker-worker-provider.ts#L531) |

### 主路线：本地 companion，不是云端桌面

建议拓扑如下，**不是本次已实现的链路**。Web 发起任务与选择设备；本地客户端主动建立出站连接，云端只转发已授权的结构化工具请求：

```text
LinkSense Web --现有账户认证/选择本机设备--> LinkSense API
                                                |
现有 Codex turn --受控 MCP 桌面工具--> 授权/Redis 调度
                                                |
                         已认证 WSS，连接由本地客户端主动建立
                                                |
用户自己的电脑：MyGo + Go companion --固定参数的 CLI 调用--> agent-desktop
                                                |
                                 当前用户的桌面应用 / OS 输入
```

服务端本次不需要安装 `agent-desktop`，也不需要进入用户局域网或开放用户电脑入站端口。新增桌面能力与 `browser_use` 分开暴露、分开授权；不要导入扩展的执行代码、借用扩展 token，或因扩展已连接就默认获得整机访问。新工具的名称只是 LinkSense 适配层约定，不等同于开启 Codex 同名内置 feature。

LinkSense 已有原生 MCP 工具调用链，项目适配的 `0.154.0` 协议投影包含 `mcpToolCall`；因此接工具不需要另造 Agent 循环、turn 状态或整轮重试。上游没有正式 MCP transport，应由 LinkSense 的受控 MCP 适配层把请求经 API 转到 companion，再调用 CLI，而不是填写不存在的上游 MCP 地址。[版本锁定](../../apps/runner/src/codex/runtime-version.json)、[协议投影](../../apps/runner/src/codex/protocol.ts)、[既有 MCP 模块](../../apps/runner/src/mcp/core-services/browser-use-service.ts)、[OpenAI 官方 app-server 文档](https://developers.openai.com/codex/app-server/)

本机 `codex --version` 返回 `0.166.0`，与项目锁定版不同；本次没有用它生成 schema 冒充部署版。尝试获取固定 tag 的上游协议源码返回 404，因此这里仅确认项目已有工具边界，不宣称已核验 `0.154.0` 原生 `computer_use` 的完整宿主能力，也不建议仅翻转同名 feature flag。

### 配对、设备选择与撤销：应补齐的最小边界

以下是复用现有本机浏览器设计的**新能力建议**，不是宣称这些桌面流程已经存在：

1. **首次配对由两端明确确认。** 已登录 Web 生成短时、单次、用途为桌面设备的配对请求；用户在 companion 确认服务器 origin、账户和电脑名称后兑换独立设备凭据。深链只负责唤起待确认页面，不能让任意网页通过 URL 自动注册服务端或开启控制。设备凭据放系统凭据存储，不进入 Web、命令行 URL、日志或模型上下文。
2. **客户端只主动连接已批准的服务端。** 使用认证 WSS、短认证截止时间、心跳和有界重连；采用独立协议/Redis key，凭据绑定 owner、device、server origin、授权代次和有效期。native 客户端可自行设置 Origin，因此 Origin 不是其身份证明；不能简单放宽现有扩展 socket 的 Origin 检查来替代认证。
3. **会话显式选择设备。** Web 显示该账户已配对设备的名称、平台、在线状态、权限和当前控制任务；保存明确的 `device_id`，不把“最后连接的一台”悄悄当作“这台电脑”。最小首版可以只允许一台设备/一个桌面用户会话被一个任务占用，但 UI 与授权仍要指明目标；离线、锁屏或多设备歧义时返回错误，不改控其他机器或云端桌面。
4. **每条命令绑定当前授权上下文。** API 验证 owner、device、conversation、运行中的 turn、非归档、Plan 与调用来源限制；本地验证当前会话 grant、控制租约/代次、命令 ID、过期时间和能力范围，串行执行。Redis 保留跨 API worker 的租约与取消状态；重连只恢复连接，不重放未知或已过期的桌面动作。
5. **停止/撤销同时在本地生效。** companion 常驻可见状态和本地“立即停止/断开”，先关闭本地 dispatch 门闩、清队列并取消正在进行的调用，再通知服务端；Web 撤销、账号失效、turn 中断、断线或租约到期也让本地停止继续接单。撤销围栏防旧连接/迟到回包复活；停止控制不等于卸载客户端，重新连接也不等于恢复任务授权。

本机桌面上的两个会话并不因不同 `--session` 名而隔离；同时控制同一个桌面会互相影响。AI 的物理输入与用户手动操作应互斥，人工接管先暂停相关桌面输入；同机 Browser Use 若也在操作同一应用，应纳入控制权协调而不是共享凭据。上游 action lease 只约束参与它的调用，不能替代 LinkSense 的设备/任务授权。[S9][S10]

### 系统权限、command host 授权与任务授权是三件事

- **OS 权限：** macOS 必须由用户在系统设置授权 Accessibility，截图再要 Screen Recording；仅屏幕共享不能授予整机输入。[S8][S19] Windows 保持普通用户级运行，管理员窗口/UAC 等不可控时明确报告，不把常驻 companion 提升为管理员来绕过边界。[S8][S20] Linux 必须使用实际登录桌面的 bus/display/runtime 环境，不以 root daemon/SSH shell 假装目标用户桌面。[S8][S11]
- **本机 command host 信任：** macOS 的常驻 command host 检查当前 UID、私有目录、`0600` socket 与 peer UID；这是本机 IPC 的访问边界，不是远程 LinkSense 账户、任务或风险动作审批系统。[S18] companion 不应暴露未认证 localhost HTTP/WS，更不能把该私有 socket 转成任意网页可调用的桥。若未来确需 loopback，仍须独立认证、Origin/Host 校验与明确本地授权，不能靠“只绑定 127.0.0.1”。
- **任务授权：** 设备已配对、OS 已授权、command host 已可调用，都不代表任意任务可以操作整机。必须再由用户授权当前会话的目标应用/范围与期限；token 被撤销后，OS Accessibility 开关可能仍开着，因此本地执行门闩不可省略。

**不能承诺“在 prompt 里写高风险先确认”就能严格拦住所有高风险操作。** 通用 click/type/key 可以在任意应用产生删除、转账、发送或命令执行；普通 click 的业务后果并不由其操作名可靠表达。上游 `command_policy` 主要检查系统权限和参数，不提供 LinkSense 业务风险审批。[S21] 若需要确定性阻断，最小保守模式是本地对所有写动作逐次确认，并将确认绑定精确命令、目标与期限；或在用户明确接受整机控制风险后，为短时受控任务开放写权限。不能把模型自报“低风险”、截图预览、应用白名单或 MCP annotation 当成完备的高风险识别器；应用白名单也不是 OS 沙箱。

### CLI 适配：只转发结构化桌面动作

首版用受控 CLI 子进程即可，不先写 native FFI。服务端沿用 Zod 校验小的动作集合与结果映射，Go companion 对收到的同版协议再次校验；执行固定绝对路径的已验证二进制，以 `exec.CommandContext(ctx, path, args...)` 调用，不能接受模型提供的 shell、任意命令/flags、可执行文件路径、环境变量或输出路径。Go 的 `os/exec` 默认不经过 shell；Windows 直接调用 `.exe`，不经 `.cmd` 或包管理器 launcher。[S5][S7][S22]

限制输出大小、截图尺寸、动作时长与并发；应用/窗口/ref 绑定授权目标，过期 ref 或目标变化后重新观察，坐标动作仅在明确授权范围内开放。首版不必暴露 batch、任意 launch、剪贴板、通知全集、trace 导出等大范围入口；会话状态/临时截图目录由客户端决定并私有化。保留 `delivered_verified` / `delivered_unverified` / 未送达语义，取消和网络超时不能被解释为“可安全重试”。[S9][S13][S16]

**停止保证需要实测，不等于 kill 一下 CLI 就成功。** `CommandContext` 默认取消只杀它的直接进程，不承诺停止独立 command host/全部后代；其默认 `WaitDelay` 为零，继承管道也可能拖住等待。应设置有界等待并验证实际 host/helper 的停止路径，而不只杀最外层 launcher。已送进 OS 的点击/文字不能撤回；在途动作结果未知时禁止自动重试。首版应避免长批次，并验收停止到不再发出新输入的上界，而不是声称能回滚桌面状态。[S18][S22]

### 画面：先按动作截图，不强制远程桌面直播

用户就在本机，可以直接看到真实桌面。最小实现可在必要时上传当前授权窗口的 snapshot/单次截图供模型观察，并在 Web 显示最近一帧及时间；不需要先装 VNC/noVNC 或搭 WebRTC。截图能力本身仍需 OS 权限，单次截图也不应假装视频或持续监视。[S14][S15]

若以后要求在另一台设备远程观看或低延迟人工接管，再独立实现原生捕获/WebRTC 或选成熟传输，另做画面授权、停止、带宽/编码、信令/中继、窗口切换和敏感画面保护。Web `getDisplayMedia` 只是用户选择屏幕后的媒体捕获，不是原生输入控制器；当前 W3C 工作草案要求用户选择与短时激活，且不能持久保存其 granted 权限，不能用它实现默认无感共享。[S23] 不应以该草案代替目标浏览器运行验收。

### 已选客户端：MyGo + Go

本次查询的最新非预发行版为 **MyGo `v0.7.4`**，2026-11-01 06:05:02 UTC 发布，tag 指向 `9bd34e1eb9525d9a1fe698aadc964c49c8ff8e7e`；以下以该 tag 的文档/源码为准，不将 main 新能力混入。其 `go.mod` 明确要求 **Go `1.27.3`**，比快速入门的泛称“1.27+”精确；实施时应同时固定框架和 CLI 版本，不使用漂移的 `@latest`。[S24]

建议首版用 **Go 原生 UI 模式**：`ui.View` 作为 `mygo.NewWindow` 的 `WindowOptions.Content`，只做配对、权限说明、连接/任务状态与“立即停止”。这是 MyGo 自绘的 GPU UI（Metal / Direct3D 11 / OpenGL），不是系统控件集合，也不是 WebView；不需要 React、HTML/JS、Bun/Node 或 Rust 工具链来构建这个壳。MyGo 另有系统 WebView 模式，但本次不为复用聊天页面而引入它，LinkSense Web 保持独立。[S26][S32]

| 已核实接口/能力 | 本项目的最小用法与限制 |
| --- | --- |
| 托盘与生命周期 | `App.Run()` 在 main goroutine 运行，`App.WhenReady` 后创建窗口和 `NewTray(TrayOptions)`；macOS 可用 `SetActivationPolicy(ActivationPolicyAccessory)`。**托盘本身不会阻止最后窗口关闭后退出**；用 `OnClose` 拦截普通关闭并 `Hide()`，区分 `OnBeforeQuit` 的真正退出，退出前先停止接单/取消调用。UI 回调在主线程，WSS/CLI 耗时工作放 goroutine。[S27][S28] |
| 单实例、深链、自启 | 有 `RequestSingleInstanceLock`、`OnSecondInstance`、`OnOpenURL` 与 `SetOpenAtLogin` / `OpenAtLogin` / `WasOpenedAtLogin`。只做单实例和待确认配对入口；自启默认关闭，可后置，不能将唤起/自启当作控制授权。macOS 13+ 自启需要 packaged app，Windows 为用户 Run 项，Linux 为用户 XDG autostart。[S28] |
| 系统凭据 | `Secrets.Set/Get/Delete` 分别使用 macOS login Keychain、Windows Credential Manager、Linux Secret Service（libsecret + session bus + keyring）；单值上限 `MaxSecretSize = 2560` bytes。无存储返回 `errors.ErrUnsupported`，不能悄悄退回明文文件；缺失/锁定/拒绝时保持未配对或断开。它不是同一 OS 用户下的应用隔离沙箱，Linux/Windows 同用户程序仍可能读取；macOS 重签/重建可能再次询问。[S29] |
| 平台与依赖 | MyGo 构建目标含 macOS、Windows、Linux 的 amd64/arm64 与 macOS universal，不代表 LinkSense 已支持这些组合。原生 UI 在 Linux 仍需 GTK 3；托盘需 `libayatana-appindicator3` 及桌面面板支持，缺库时 `NewTray` 返回错误。设 `linux.webview: false` 才能让打包依赖不要求 WebKitGTK；实际桌面控制仍受前文 `agent-desktop` 的 OS/图形环境约束。[S27][S30][S32] |
| 随包资源与子进程 | 按 `resources/<os>-<arch>/bin/` 携带对应 native CLI/helper，经 `App.Path(PathResources)` 取绝对路径，再用前文 `os/exec` 调用，无需用户安装 Go/Node/Rust。MyGo 复制/打包资源，不负责实现 LinkSense 的命令授权、超时、停止或 CLI 版本兼容；`go run`/`go test` 的资源目录未做平台合并，不能冒充 packaged app 验收。[S22][S30] |

WSS 设备通道、凭据使用和本地执行门闩留在 Go 内；MyGo 的 WebSocket 插件主要把 Go 连接暴露给 WebView 页面，并不是已完成的设备协议，不为原生 UI 额外加入页面或把设备 token 交给 JS。具体 Go WSS 客户端尚未选库/实现。MyGo 也不自动提供 Accessibility/Screen Recording 授权、远程桌面直播或高风险动作审批。[S33] 上述 UI 仍需本项目六语言资源与可访问性验收，框架存在控件不等于产品已完成这些要求。

**分发与更新不是零成本。** `go tool mygo build` 可生成 macOS `.app`/`.dmg`、Windows `.exe`/NSIS installer、Linux archive/desktop entry/`.deb` 等；编译不需 cgo，但 macOS 正式签名、DMG 和 notarization 仍要 macOS 构建环境，其他平台也要相应打包/签名工具。[S30] macOS 配置 `macos.signingIdentity` / `macos.notarize`，随包 Mach-O/helper 从内向外签名，按需提供 `macos.helperEntitlements`；Windows 通过 `windows.certificate` 或 `windows.signCommand` 签主程序及未签 helper、installer/uninstaller。默认 ad-hoc/无证书构建不等于可无警告分发，不能让用户关闭系统防护。[S25][S30]

MyGo 有 `mygo.Updater`，以配置内公钥检查独立签名更新包，原生 UI 可用 `mygo.json` 配置，不必加 JS；但密钥保管、HTTPS 发布、协议兼容/回退和更新前停控仍由项目负责，自动更新可后置。[S31][S32] CLI/helper 必须同版更新、验证来源；checksum 不能单独证明发布者身份。[S8] **尚未验证** agent-desktop 随 MyGo 重签/打包后的 helper 定位、OS 权限归属/升级保留、系统凭据访问及停止上界；不能因 `.app` 存在便声称子进程自动获得权限。先在一个明确支持的平台完成这些闭环，再逐个平台扩展；不先增加 Electron、第二套聊天 UI、桌面内 LLM、FFI 或直播。

### 可选路线：云端桌面仍然是另一件事

若未来另有“给每个用户提供一台云端电脑”的需求，可在隔离图形 runtime 中运行 `agent-desktop`，再加认证画面/输入通道；noVNC 仅是浏览器端 VNC 客户端，服务端仍需 VNC server 与 WebSocket。[noVNC 官方说明](https://novnc.com/info.html) 不应把用户真实桌面 display/session bus 挂进多用户 Worker，`--session` 不能替代 OS/VM 隔离。[S9][S10]

这不是本次本机需求的前置工程；把旧云端 `BrowserPanel` 接回页面也不能让 AI 取得用户电脑控制权。既有浏览器会话、扩展、已发布资源和旧部署应在未启用本机桌面能力时继续工作，不强制重新配对、重建任务或安装新客户端。

## 最小验证范围（建议，尚未实施）

1. 在明确同意的测试用户电脑固定发行版与 helper，验证 OS 权限拒绝/撤销、`status`、应用列表、snapshot/ref 与一个原生应用的无破坏写入；明确证明动作落在用户电脑，而非 LinkSense 服务器。
2. 验证独立配对、设备选择、两账户/两会话隔离、伪造/过期/撤销凭据、未授权网页/深链与无认证本机端口拒绝；Plan、归档、已结束 turn、发布服务调用不可写桌面。
3. 验证 Web 停止、本地停止、人工接管、断网、锁屏、过期命令、迟到回包与快速撤销/重连；检查 host/helper，确认不再发出新输入且不重放未确认动作。已发生动作不可撤回的边界必须呈现给用户。
4. 验证 fresh/stale ref、目标窗口/多屏与坐标变化、长文本、误焦点和未知送达结果；AX/截图/剪贴板/trace 不进入普通日志或无权会话，风险确认绑定具体动作，不靠 prompt 执行。
5. 验证 MyGo packaged app 的托盘/关闭/退出、缺托盘或 keyring 的失败路径，以及客户端/CLI/helper 升级后的 OS 授权、签名、设备凭据、协议兼容、停控和卸载/禁用自启；未启用桌面的用户仍可使用独立的 `browser_use` 链路。尚不要求云端图形 Worker 或直播 PoC。

本次完成文档和源码核对，没有执行上游程序、安装依赖、实现 companion、进行真实电脑 PoC、性能/成功率测试或安全审计；尚不能承诺具体应用兼容性、停止时延、权限继承、实时帧率或生产安全强度。**结论是本机 companion 路线可行且对题，`agent-desktop` 可作原生执行后端；不是只装服务器包或接一个云桌面页面就完成。**

## 一手来源

agent-desktop 引用默认固定 main 快照；涉及已发行能力时交叉核对 `v1.0.2`。MyGo 固定 `v0.7.4`，不将官网后续更新视为该 tag 已有能力。GitHub API/npm registry 元数据通过只读请求获取。

- [S1：发行版 README](https://github.com/vercel-labs/agent-desktop/blob/v1.0.2/README.md)
- [S2：上游定位、架构与工程约束](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/AGENTS.md)
- [S3：v1.0.2 发行记录](https://github.com/vercel-labs/agent-desktop/releases/tag/v1.0.2)
- [S4：发行版 npm manifest](https://github.com/vercel-labs/agent-desktop/blob/v1.0.2/npm/package.json)、[Cargo workspace](https://github.com/vercel-labs/agent-desktop/blob/v1.0.2/Cargo.toml)、[npm registry latest](https://registry.npmjs.org/agent-desktop/latest)
- [S5：CLI 命令枚举](https://github.com/vercel-labs/agent-desktop/blob/v1.0.2/src/cli/mod.rs)、[启动与本机 adapter 分发](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/src/main.rs)
- [S6：源码快照提交](https://github.com/vercel-labs/agent-desktop/commit/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d)、[发行版到快照的比较](https://api.github.com/repos/vercel-labs/agent-desktop/compare/a47ed664e0db00d1d4df364eb3fe8a5599882f3c...9eb9b296192fcb70bda25e918cd6dd66abfa3d0d)、[完整文件树](https://api.github.com/repos/vercel-labs/agent-desktop/git/trees/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d?recursive=1)
- [S7：FFI 接口、ABI 与线程约定](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/crates/ffi/README.md)
- [S8：安装、权限与平台前提](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/docs/install.md)
- [S9：快照、调试产物、session 与 overlay 定义](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/CONCEPTS.md)
- [S10：Unix interaction lease 源码](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/crates/core/src/session/interaction_lease.rs)
- [S11：Linux 平台 Skill](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/skills/agent-desktop-linux/SKILL.md)、[Linux adapter 源码](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/crates/linux/src/adapter.rs)
- [S12：Chromium、Electron、Xvfb 与 toolkit 限制](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/skills/agent-desktop-linux/references/troubleshooting.md)
- [S13：隐私、无模型核心与可选 JEV helper](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/docs/faq.md)
- [S14：Linux 截图限制与授权](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/skills/agent-desktop-linux/references/capture-and-clipboard.md)、[原生截图路由](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/crates/linux/src/system/capture/screenshot.rs)
- [S15：单次截图输出源码](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/crates/core/src/commands/screenshot.rs)
- [S16：JSON、错误及动作送达语义](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/docs/json-output.md)
- [S17：Apache-2.0 LICENSE](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/LICENSE)
- [S18：macOS command host 私有 endpoint](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/src/command_host/command_host_endpoint.rs)、[socket 与 peer UID 检查](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/src/command_host/command_host_socket.rs)
- [S19：Apple，Accessibility 访问的用户授权与撤销](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac)
- [S20：Microsoft，UI Automation 与 integrity/UIAccess 安全边界](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview)
- [S21：上游 command policy 的权限与参数检查](https://github.com/vercel-labs/agent-desktop/blob/9eb9b296192fcb70bda25e918cd6dd66abfa3d0d/src/command_policy/mod.rs)
- [S22：Go，os/exec 的无 shell 调用、CommandContext、Cancel 与 WaitDelay 边界](https://pkg.go.dev/os/exec)
- [S23：W3C Screen Capture 工作草案，2026-08-27](https://www.w3.org/TR/2026/WD-screen-capture-20260827/)
- [S24：MyGo v0.7.4 发行记录](https://github.com/egoist/mygo/releases/tag/v0.7.4)、[latest release 元数据](https://api.github.com/repos/egoist/mygo/releases/latest)、[tag 指向](https://api.github.com/repos/egoist/mygo/git/ref/tags/v0.7.4)、[Go 版本要求](https://github.com/egoist/mygo/blob/v0.7.4/go.mod)
- [S25：Apple，外部分发的软件签名与 notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [S26：MyGo 原生 UI、GPU 与 WebView 区别](https://github.com/egoist/mygo/blob/v0.7.4/docs/ui/README.md)、[README 与 MIT 许可](https://github.com/egoist/mygo/blob/v0.7.4/README.md)
- [S27：MyGo 托盘、关闭与 Linux AppIndicator 限制](https://github.com/egoist/mygo/blob/v0.7.4/docs/menus.md)
- [S28：MyGo 生命周期、线程、单实例、深链与自启](https://github.com/egoist/mygo/blob/v0.7.4/docs/app.md)、[App 源码](https://github.com/egoist/mygo/blob/v0.7.4/app.go)、[自启接口](https://github.com/egoist/mygo/blob/v0.7.4/login.go)
- [S29：MyGo Secrets 接口、大小和缺存储边界](https://github.com/egoist/mygo/blob/v0.7.4/secrets.go)、[平台与同用户读取限制](https://github.com/egoist/mygo/blob/v0.7.4/docs/native.md)、[macOS 实现](https://github.com/egoist/mygo/blob/v0.7.4/internal/darwin/secrets.go)、[Linux 实现](https://github.com/egoist/mygo/blob/v0.7.4/internal/linux/secrets.go)、[Windows 实现](https://github.com/egoist/mygo/blob/v0.7.4/internal/windows/secrets.go)
- [S30：MyGo 平台资源、helper 签名和打包限制](https://github.com/egoist/mygo/blob/v0.7.4/docs/distribution.md)、[build 实现](https://github.com/egoist/mygo/blob/v0.7.4/cmd/mygo/build.go)
- [S31：MyGo 签名更新与密钥管理](https://github.com/egoist/mygo/blob/v0.7.4/docs/updates.md)
- [S32：MyGo native 模板与工具链](https://github.com/egoist/mygo/blob/v0.7.4/docs/getting-started.md)、[mygo.json / linux.webview 配置](https://github.com/egoist/mygo/blob/v0.7.4/docs/configuration.md)
- [S33：MyGo WebSocket 插件面向页面的接口边界](https://github.com/egoist/mygo/blob/v0.7.4/docs/plugins/websocket.md)

## 实施补充：v1.0.2 macOS CLI 固定契约

本节追加于 2026-11-02，逐文件核对发行提交 `a47ed664e0db00d1d4df364eb3fe8a5599882f3c`；仅下载到系统临时目录做源码、归档、SHA-256、Mach-O 依赖和签名静态检查，**未执行下载的 CLI/helper，也未申请权限或操作真实桌面**。这里的白名单、限额和结果投影是 LinkSense 建议，不是上游提供的远程授权保证。

### 最小动作与参数

所有参数由 companion 从结构化字段生成，固定可执行文件绝对路径，不接受任意 CLI、shell、工作目录、环境变量、输出路径或额外 flags。下表省略由客户端确定的 `--session <namespace>`；同一授权期间须使用同一 namespace。裸 namespace 不需要 `session start`，也不会自动开启 trace；长度限 1–64 个 ASCII 字母、数字、`_`、`-`。[C1][C2]

| LinkSense 动作 | 固定 CLI 参数 | 约束 |
| --- | --- | --- |
| 本地诊断 | `status`、`permissions` | 仅被动检查；`permissions --request` / `--guide` 只能走本机用户明确点击的权限流程，不开放给模型 |
| 应用发现 | `list-apps --timeout-ms 5000` | 可选 `--app=<APP>`；不要把完整本机清单写入审计日志 |
| 窗口发现 | `list-windows --app=<APP> --timeout-ms 5000` | 先验证应用在本地 grant 内；不能由同名应用隐式改换目标 |
| 观察 | `snapshot --app=<APP> --window-id=<ID> --timeout-ms 3000 --max-depth 10 --include-bounds` | 默认 `window` surface；首版不开放全桌面/通知/任意 surface/root；必须读取 `complete` |
| 截图 | `screenshot --app=<APP> --window-id=<ID>` | 不传位置参数 PATH，也不传 `--screen`；无目标会退回整屏，所以 companion 必须要求目标 |
| 点击 / 元素聚焦 | `click --timeout-ms 5000 -- <REF>`、`focus --timeout-ms 5000 -- <REF>` | REF 必须来自当前授权目标的已发出快照，不仅检查字符串格式 |
| 输入 | `type --timeout-ms 5000 -- <REF> <TEXT>` | `--` 结束 options，TEXT 是独立 argv；发布版无 `--interval-ms`；上游实际限 10,000 **bytes**，首版建议更低 |
| 按键 | `press --app=<APP> --window-id=<ID> -- <COMBO>` | companion 固定枚举，不接受 `--force`；例如 `return`、`escape`、`tab`、`shift+tab`、方向键、`home`、`end`、`pageup`、`pagedown`、`backspace`、`delete` |
| 滚动 | `scroll --direction <DIRECTION> --amount <N> --timeout-ms 5000 -- <REF>` | 方向限 `up/down/left/right`；建议单次 `N` 限 1–10，避免不可中断长循环 |
| 聚焦窗口 | `focus-window --app=<APP> --window-id=<ID>` | 不使用标题模糊匹配；这本身是写动作，不能在 Plan 中绕过授权 |

命令与参数来自 [C1][C3]；`type` 的字节限制来自 [C4]。`press` 上游支持比表中更多组合，但自身只拦截退出、登出、锁屏等少量快捷键；即使不传 `--force`，也**不等于**阻断发送消息、提交表单或删除数据。首版不开放 `launch`、任意脚本/命令、batch、key-down/up、mouse-down/up、剪贴板、通知、trace/debug、坐标物理输入与全屏捕获。默认不加 `--headed`；需要物理输入时应作为另一个明确能力授权，不能遇到 AX 失败后悄悄升级。[C5]

全局 flags 实际还包括 `--agent-id`、`--headed`、`--trace`、`--trace-strict`、`--wait-for`/`-w`、`--wait-for-gone`、`--wait-timeout`、`--verbose`/`-v`、`--debug`、`--screenshot`。它们不应直接成为远程工具参数；路径、trace 和 debug 输出可能带敏感内容。应用名等 option 值用 `--app=<value>` 这样的单 argv 形式，文本位置参数放在 `--` 后，避免将数据解释为 flags。[C1][C6]

### 返回结构与最小投影

CLI stdout 为 JSON envelope：`version: "2.5"`、`ok`、`command`，成功时 `data`，失败时 `error`。进程退出码分别为 0（成功）、1（结构化错误）、2（参数解析失败，同样有 `INVALID_ARGS` JSON）；`--help`、`--version` 属于 Clap 文本输出例外，不作工具动作。不能只依据进程退出码判断动作是否发生。[C7]

| 命令 | `data` 的实际结构 |
| --- | --- |
| `permissions` | `{accessibility, screen_recording, automation}`，每项为 `{state}`；state 为 `granted / denied / not_required / unknown`，denied 还含 `suggestion` |
| `status` | `{platform, version, permissions, snapshot_id, ref_count, session_id, tracing, supported_surfaces}`，可另含 `artifacts`、`state_root`；macOS 的 platform 为 `macos`，这里的 version 为软件版本 `1.0.2`，不是 envelope `2.5` |
| `list-apps` | `{apps: [{name, pid, bundle_id?, process_instance?, presentation?}], complete?: false, skipped?: [...]}`；没有 `complete` 不能自行理解为失败 |
| `list-windows` | **直接是数组** `[{id, title, app_name, pid, process_instance?, bounds?, is_focused, accessible, minimized?, visible?}]`，不是 `{windows: [...]}` |
| `snapshot` | `{app, window: {id,title}, ref_count, snapshot_id, complete, tree}`；部分观察另有 `truncated: true`、`nodes_observed`，树内边界有 `subtree_truncated` |
| `screenshot` | 无 PATH 时 `{data: "<base64>", format: "png", width, height, scale_factor}`；指定 PATH 后改为 `path`，没有 base64 |
| `focus-window` | `{focused: <完整 WindowInfo>}`；不是通用动作 report |
| ref 动作 / `press` | `{action, disposition, steps?, post_state?, surfaces?, details?}`；需要保留送达语义，不声称 `ok: true` 就是业务状态已保存 |

权限和诊断来自 [C8]，清单类型来自 [C9]，观察/截图/聚焦来自 [C10]，动作 report 来自 [C11]。建议向云端/模型仅投影需要的应用、窗口、树、图片和结构化送达结果；本地路径、PID generation、helper 路径、`state_root`、`artifacts`、stderr 与原始错误详情不进入普通日志或 SSE。截图、窗口标题和 AX 文本本身也可能敏感，投影不等于内容已自动脱敏。

每个错误均有 `code`、`message`、`disposition`；`suggestion`、`recovery`、`platform_detail`、`details` 可省略。delivery 为 `unknown / not_delivered / delivery_uncertain / delivered_unverified / delivered_verified`，retry 为 `unknown / safe / unsafe`；仅 `not_delivered` 映射 `safe`，其余已知送达状态均为 `unsafe`，`unknown` 也不能自动重试。`recovery` 只会在 retry safe 时出现；不能执行错误里的自然语言/命令建议。断线、超时、取消或丢回包后不能重发原写动作。[C7]

### macOS command host 与停止边界

**普通 CLI 子进程不是实际动作进程的完整生命周期。** 在该发布版，macOS 普通命令会自动连本用户私有 Unix socket；缺少 host 时，同一个 `agent-desktop` 二进制被另起为 command host，设置独立 process group，stdin/stdout/stderr 指向 null。host 串行处理、保存 retained AX refs，空闲 900 秒退出；socket 目录为 `0700`、socket 为 `0600` 并检查 peer UID。例外主要是 `session`、`batch` 和 `permissions --guide` 在调用者路径处理。[C12]

socket 请求有版本、二进制/状态根/session/helper 身份和绝对单调时间 deadline；排队时间不会返还。断开 CLI **不会给执行中的 host 发送取消**，host 仍可执行完才发现回包失败；客户端把丢失回复标记为 `delivery_uncertain`。因此，只杀 `exec.CommandContext` 的外层 CLI 或其 process group 不能宣称“立即停止所有桌面输入”；没有公开 `cancel` / `stop-host` 子命令。[C12][C13]

固定版本源码另有可由 companion 直接拥有的 **internal stdio-host** 路径：对固定 CLI 设置 `AGENT_DESKTOP_INTERNAL_COMMAND_HOST=1`、客户端生成的 `AGENT_DESKTOP_SESSION` 和私有 `AGENT_DESKTOP_HOME`，移除 `AGENT_DESKTOP_INTERNAL_HOST_SOCKET`；stdin 写一行 JSON argv 数组，stdout 每行一个 envelope。请求上限 1,048,576 bytes，空闲 900 秒、帧 I/O 5 秒；无 request ID，必须一次只发一个命令，不做 pipeline。该路径不自动再起 socket host，但它是内部接口，不是稳定公开 SDK，采用时必须绑定发行 SHA、加契约测试，并接受升级维护成本。[C12][C14]

stdio 模式没有 socket request envelope 的排队 deadline 继承，必须同时限制单动作 timeout、companion 截止时间和输出字节；关闭 stdin 只会让空闲 host 退出，不取消当前同步动作，取消应终止自己拥有的 host 并有界等待。上游部分 helper/外部原生命令也有自己的 process group，不能声称一个 group kill 已覆盖所有子进程；默认语义 `type` 走 `AXSelectedText`，不走剪贴板 helper。停止后立刻关闭本地 dispatch 门闩，当前动作结果视为未知，不重放；重建 host 必须重新观察再允许使用 refs。[C4][C15]

权限缓存也需要处理：socket host 回答 Accessibility denied / `PERM_DENIED` 后退出，让下次调用重新看授权；stdio host 不执行该自动退出分支，权限修改后 companion 应主动重建自己的 host。`AGENT_DESKTOP_HOME` 才是该版本状态根变量，要求绝对路径、当前用户拥有的非 symlink 目录；上游不强制现存目录 mode，companion 仍应自行创建 `0700` 私有根。不能覆盖用户 HOME，也不能继承任意 trace/debug/internal 环境。[C12][C16]

### 发行物与本机分发

以下两个原生 CLI 归档已实际下载并以 `checksums.txt` 和 GitHub release asset digest 双重比对；两者内部**恰好只有** `agent-desktop` 与 `agent-desktop-macos-helper`，不需要 npm launcher、Node、Rust runtime 或 FFI dylib。[C17]

| 归档 | 归档 bytes | SHA-256 | 解包文件 bytes（CLI + helper） |
| --- | --- | --- | --- |
| `agent-desktop-v1.0.2-aarch64-apple-darwin.tar.gz` | 2,181,954 | `7bee385196d7b478de80cf05ca4304aaa38f0eba593b3406ad3c247c1773be19` | 3,741,392 + 529,616 = 4,271,008 |
| `agent-desktop-v1.0.2-x86_64-apple-darwin.tar.gz` | 2,304,657 | `8edda6df17eafc042395502a823dbb8415bc8ac14835a6731e4d8becc9cb4121` | 4,378,968 + 571,156 = 4,950,124 |

ARM64 两文件的 `otool -L` 仅列系统 framework/dylib；静态签名检查显示 linker ad-hoc 签名、无 TeamIdentifier，不是 Developer ID 分发签名/公证证明。`LC_BUILD_VERSION minos` 虽为 11.0，不能据此覆盖上游 macOS 13+ 文档要求或宣称旧系统兼容。大小不包含 MyGo companion、图标/语言资源、私有快照状态、截图或更新缓存，不能当作客户端完整安装体积。

helper 默认在 CLI 同目录按固定名字发现；也可由可信宿主设置绝对 `AGENT_DESKTOP_MACOS_HELPER_PATH`。该版本要求 helper 是**当前有效 UID 所有**的可执行、单链接、非 symlink 常规文件，无 group/world 写权限；祖先目录须由 root 或当前用户拥有，不能被非可信主体写入，ACL 也会检查。root 所有的系统级安装副本可能被当前普通用户拒绝，不能假设放进任意 `.app` 就正常；应在所选打包位置验证文件所有权、重签、helper 身份与 OS 授权归属，不能放宽这些校验绕过问题。[C18]

### 本节固定一手来源

以下源码均固定发行提交，不从 main 推断 `v1.0.2` 行为；归档/checksum 固定该 release。

- [C1：CLI 全局身份和根参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli/root.rs)、[身份参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli/identity.rs)
- [C2：session 解析](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/session/mod.rs)、[namespace 校验与无 trace manifest 逻辑](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/context/mod.rs)
- [C3：动作参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli_args/actions.rs)、[系统参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli_args/system.rs)、[观察/截图/ref 参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli_args/mod.rs)、[snapshot 参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli_args/snapshot.rs)
- [C4：type 限额](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/type_text.rs)、[macOS 输入机制](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/macos/src/actions/type_text.rs)
- [C5：macOS 按键阻止列表](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/macos/src/input/blocked_combo.rs)、[命令权限策略](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/command_policy/mod.rs)
- [C6：全局 wait](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli/post_action_wait.rs)、[debug 参数](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/visual_debug/options.rs)
- [C7：发行版 JSON 契约](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/docs/json-output.md)、[stdout/退出码实现](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/main.rs)
- [C8：status](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/status.rs)、[permissions](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/permissions.rs)、[状态枚举](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/system/permission_state.rs)
- [C9：app 清单](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/list_apps.rs)、[window 清单](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/list_windows.rs)、[AppInfo](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/system/app_info.rs)、[WindowInfo](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/system/window_info.rs)
- [C10：snapshot 返回](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/snapshot.rs)、[screenshot 返回](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/screenshot.rs)、[窗口聚焦返回](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/focus_window.rs)
- [C11：动作结果类型](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/actions/action_result.rs)、[press 路由](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/commands/press.rs)
- [C12：host 启动/帧循环](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/command_host/mod.rs)、[客户端/独立 process group](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/command_host/command_host_client.rs)、[socket](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/command_host/command_host_socket.rs)、[命令入口例外](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/cli/mod.rs)
- [C13：host 请求 deadline](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/command_host/command_host_request.rs)、[预算](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/command_host/command_host_budget.rs)
- [C14：host 进程契约测试](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/src/tests/command_host_process.rs)
- [C15：helper 独立 process group 与清理](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/macos/src/input/clipboard/clipboard_helper_process.rs)、[原生命令子进程](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/macos/src/system/process/mod.rs)
- [C16：AGENT_DESKTOP_HOME 验证](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/core/src/storage/state_root.rs)
- [C17：固定 release 元数据](https://api.github.com/repos/vercel-labs/agent-desktop/releases/tags/v1.0.2)、[checksums.txt](https://github.com/vercel-labs/agent-desktop/releases/download/v1.0.2/checksums.txt)、[发行打包脚本](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/.github/workflows/release.yml)
- [C18：helper 发现与文件身份验证](https://github.com/vercel-labs/agent-desktop/blob/a47ed664e0db00d1d4df364eb3fe8a5599882f3c/crates/macos/src/input/clipboard/clipboard_helper_identity.rs)
