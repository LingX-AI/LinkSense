# LinkSense 桌面端方案总览（2026-11-17）

> 这是当前最新方案的整理稿，供评审与沟通使用。权威细节以两份原文为准：
> [方案 v2](../research/linksense-desktop-dual-mode-plan-2026-11-16.md) · [任务拆解](./linksense-desktop-dual-mode-task-breakdown-2026-11-16.md)。
>
> 2026-11-18：本轮先完成 macOS 的全部功能。下文保留 Windows 架构与双平台交付要求供后续参考，macOS 不等待 Windows。
> 本文与原文冲突时，以原文为准。
>
> 2026-11-17 复审同步：独立设备契约覆盖主模型、记忆提取与模型切换来源；补 Core MCP 受限回调；命令/文件审批分开；Phase 0、M1、M1b 采用各自出口和测试依赖。新增回调任务后约 130 人日，2 人理想开发约 13 周，排期预留 14 周。
>
> 2026-11-17 复审补齐：设备通道以真实 Codex 回合验收（回显桩不算）；更新与进行中回合互斥；本地工作区补保留期与清理。均为既有任务内的验收补充，估时不变。
>
> 2026-11-24 范围调整：macOS 本期不含内置浏览器；P2-05 至 P2-07 尚未完成，暂缓并移出活动工作与发布门槛。主窗口 WebView 继续承载 LinkSense UI；系统浏览器外链/登录、Chrome/Edge 扩展与云端 `BrowserPanel` 保持现状。

## 1. 一句话

**Go + mygo 单二进制桌面壳**（本地执行运行时随包分发），主窗口用 webview 承载现有 `apps/web` 全量 UI；同一套 Agent，执行位置可选**本地电脑（macOS / Windows）**或**云电脑（现有 Linux Docker runner）**。

## 2. 已定决策

| 项 | 决定 |
| --- | --- |
| 桌面壳 | Go 1.27.3 + `github.com/egoist/mygo` v0.10.0（MIT）；不用 Electron/Tauri |
| 客户端形态 | **完整桌面应用**：会话、计划、表单、工件、知识库、浏览器面板、设置；不是 companion |
| UI 复用 | 主窗口加载 `apps/web` 构建，**一套 UI 不 fork**；Go 只做窗口/系统层，禁止在 Go 里重画侧栏或聊天 |
| 本地模式 | macOS + Windows 双平台 |
| 云模式 | 复用现有 Linux Docker runner，不新建基础设施 |
| 明确不做 | 内置浏览器（P2-05 至 P2-07 暂缓）、Windows 云电脑（VM/RDP/视频流）、Linux 客户端、WebRTC/PIP 可视化云桌面、混合模式 |
| computer use | `vercel-labs/agent-desktop`（Apache-2.0，**最新版**，当前 1.3.1），由 Go 引擎以子进程管理，模型只看到 `computer_*` 工具 |
| Browser Use | 沿用现有 Chrome/Edge MV3 扩展；桌面端只做引导与状态；云端继续用现有 Docker Runner Chromium 与 `BrowserPanel` |
| 模式选择 | 会话级 `Conversation.executionTarget = local \| cloud`；切换必须确认并新建会话 |
| UI 风格 | 浅色 A（豆包浅蓝白，#3370FF）+ 深色 C（#4D7CFE），同一套 token 与组件 |
| 更新 | mygo 签名更新：bsdiff 增量、失败回退整包、stable/beta 渠道 |
| 凭据边界 | 设备只拿短期 run lease；平台模型密钥留在服务端；设备不持内部共享密钥 |
| 本地运行时 | 新增 `desktop` worker provider，随包分发 Node + `apps/runner` + Codex；不复用 development-only 的 `local-process` |
| 基线 | 开发基线是当前 `feat`；`feat-computer-use:apps/desktop` 仅作 computer use 参考，不合并、不 cherry-pick |

## 3. 架构

```text
┌────────────────────── 桌面应用（Go + mygo 单二进制）──────────────────────┐
│  主窗口 webview ── 加载 apps/web ── 桌面宿主适配层（typed IPC）           │
│  原生层：窗口/托盘/菜单/深链/通知/更新/Secrets                            │
│  本地执行运行时（随包 Node + apps/runner + desktop provider）           │
│  computer-use 引擎（loopback RPC → agent-desktop 子进程）                │
│  设备桥（出站 WSS，Desktop Device Gateway）                              │
└──────────────────────────────────────────────────────────────────────────┘
              │ WSS 出站（无入站端口）              │ HTTPS/SSE
              ▼                                    ▼
      API：设备网关 / RunnerTransport 路由 / 审批   现有会话与事件
              │ HTTP（云）                        │
              ▼                                    │
      现有 Docker runner（Linux）◄────────────────┘
```

职责边界：

- **Go 壳**：窗口生命周期、托盘、菜单、深链、通知、更新、本地 runner 监督、设备桥、computer-use 引擎。不承载 Agent 逻辑。
- **webview**：全部产品 UI 与交互；通过薄适配层调用 Go 能力。
- **本地 runner**：复用 `apps/runner` 的 Codex app-server、Core MCP、workspace、事件代码，新增 `desktop` worker provider（详见方案 §5.2）。
- **API**：设备配对/在线状态、run lease 签发、命令路由、审批转发、事件写入现有 `ConversationEvent`、服务端模型代理，以及 Core MCP 受限请求的资源授权与领域 service 调用。
- **引擎**：只监听 loopback/Unix socket；`computer_*` 经唯一 `ActionExecutor`：授权/暂停校验 → 风险分级 → 审批（如需）→ 执行 → 效果核对 → 审计。本地 Shell/文件由 Codex 原生沙箱与审批约束，不经过 Go 执行器——两层控制不能混。

### 3.1 代码落点

| 位置 | 内容 |
| --- | --- |
| `packages/shared/src` | `computer-use.ts`（工具名/schema/权限 code/事件）、`desktop-device.ts`（严格设备入参、按类型审批、设备帧/工具操作） |
| `apps/api/src/modules/desktop-devices` | 配对、设备列表、设备 WS、撤销、设备任务租约 |
| `apps/api/src/modules/desktop-credentials` | run lease 签发/校验/撤销 |
| `apps/api/src/modules/model-proxy` | 服务端受限模型代理（设备不持平台密钥） |
| `apps/api/src/modules/local-computer` | 本地会话/权限 |
| `apps/api/src/modules/files` | 附件下发、工件上传确认（扩展） |
| `apps/api/src/adapters` | `runner.ts`（RunnerTransport）、`desktop-device-transport.ts` |
| `apps/runner/src` | `controller/desktop-worker-provider.ts`、`desktop/device-event-sink.ts`（受限业务/控制回调）、`mcp/core-services/computer-use-service.ts`、`desktop/computer-tool.ts` |
| `apps/desktop` | Go module：`main.go`、`web.go`（主窗口）、`view.go`（伴随窗口）、`bridge.go`（设备 WS）、`engine.go`（agent-desktop）、`runtime.go`（supervisor） |
| `scripts/desktop.mjs` | 构建、打包、签名入口 |

- `apps/desktop` 是 Go module，**不进 pnpm workspace**；桌面契约放 `packages/shared`。
- 引擎与应用同进程，不建 `apps/desktop-helper`；CI 覆盖 macOS/Windows 双平台构建。
- 本地 runner 复用 `apps/runner`，新增 `WORKER_PROVIDER=desktop`（现有 `local-process` 仅 development 且要求 POSIX uid/gid，Windows 不可用）；Node + runner + Codex 随安装包分发。工作区 macOS `~/Library/Application Support/LinkSense`、Windows `%APPDATA%\LinkSense`。
- 随包方式已按现有多进程入口选用固定 Node + ESM 依赖闭包。Windows ARM64 保持原生外壳/GUI 引擎，Node/Codex/npm 闭包暂用 Windows 11 的 x64 兼容运行时，以覆盖 anydoc 当前缺失的 ARM64 binding。版本/哈希及体积测量以方案 §5.2 和桌面 README 为准；Windows 实机验收留待其实施阶段。

### 3.2 mygo 与 agent-desktop 落地要求

**mygo 直接提供**（不自己写平台代码）：

- 窗口/菜单/托盘/深链/单实例/文件关联/最近文档/拖放/全局快捷键/主题/网络代理。
- `mygo.Secrets`（Keychain / Credential Manager，单条 ≤2560 字节）存登录 token、device token；超限则文件加密 + 密钥进 Secrets。
- `locales/` + `mygo.locale` 让原生 UI 六语言与 Web 对齐。
- `resources/<os>-<arch>/` 放 `agent-desktop`，随包签名。
- macOS `.app`/DMG + Developer ID/公证；Windows NSIS per-user + Authenticode。
- `mygo.Updater`：签名 manifest、bsdiff delta、失败回退整包、stable/beta。

**agent-desktop**（`vercel-labs/agent-desktop`，Apache-2.0）：

- 使用最新版（当前 1.3.1），Phase 0 升级并做 macOS AX / Windows UIA 回归，记录 release/sha256。
- 随包附 LICENSE/NOTICE；内置 binary 校验 sha256，禁止未校验更新。
- 引擎侧 action allowlist、任务授权、暂停/停止、审计；不以 root 运行；应用签名/公证。
- 回归 macOS AX/截图与 Windows UIA；权限拒绝路径不崩溃。
- 模型不直接调 CLI；引擎解析、裁剪、归一 stdout。

## 4. 双模式

| 维度 | 本地电脑 | 云电脑 |
| --- | --- | --- |
| 执行位置 | 用户 Mac / Windows | 现有 Linux Docker 容器 |
| Agent | 本地 runner（`desktop` provider，随包） | 现有 Docker runner |
| 文件 | 本地工作区/授权目录；工件上传后入列表 | 容器工作区 |
| Shell | 本地 shell，**沙箱 + 命令级审批** | 容器 shell（`approvalPolicy: never`） |
| 浏览器 | 用户真实 Chrome/Edge（扩展） | 容器内 headless Chromium（现有 `BrowserPanel`） |
| 桌面 GUI | `computer_observe/act`（agent-desktop） | 不提供 |
| 权限 | OS 权限 + 应用授权 + 命令审批 + 设备租约 | 容器/工作区边界 |
| 展示 | 会话内 computer use 状态卡 | 与 Web 会话一致；云文件/浏览器面板 |
| 离线 | API 不可达时也不可用（一期明确提示） | 同左 |

切换规则：显式确认 → continuation 新建会话 → 原会话不动；文件不自动同步；绝不静默切换。本地不可用提示改用云，云不可用提示改用本地。

云电脑 = **无图形界面的 Linux 执行环境**（文件 / Shell / headless Chromium），不是可接管的桌面：无 X11/Wayland、无屏幕视频、无鼠标键盘接管。

## 5. 客户端范围

**主窗口**：浏览器登录交接、会话列表与详情（对话、计划、表单、工件）、知识库、浏览器面板、设置；桌面新增设备与权限、本地电脑状态、更新、关于/诊断。服务地址在打包时固定，不让用户首启填写 URL；账号登录/注册在系统浏览器完成。macOS 端主窗口固定 100% 页面比例，不提供客户端页内缩放控件（含菜单项与快捷键）；窗口尺寸调整、最大化/还原、最小化、全屏与系统辅助功能不受影响。

**外链与登录**：普通外链、支付、第三方 OAuth、营销页等交给系统浏览器；已有有效浏览器登录可复用，经授权交接，不读取或复制 Cookie。

**范围外**：多窗口会话（Phase 3 可选）、内置终端、纯离线会话。

**壳能力**

| 类别 | 能力 |
| --- | --- |
| 窗口 | 单实例、尺寸/位置恢复、关闭到托盘、多显示器、全屏 |
| 导航 | `linksense-desktop://` 深链（登录回调、配对、会话）、菜单、快捷键、外链走系统浏览器 |
| 文件 | 打开/保存对话框、拖拽上传、下载、Finder 显示、最近文档 |
| 系统 | 托盘（打开/新建会话/暂停 computer use/退出）、通知、全局暂停快捷键、跟随系统主题/语言 |
| 生命周期 | 启动恢复会话、随应用启停本地 runner、崩溃日志、诊断包 |
| 更新 | 后台检查、签名校验、delta、重启安装、stable/beta |

**首次启动**：M1 登录 → 本地设备命名与配对 → 连接浏览器（可选）→ 默认执行目标 → 主界面；M1b 首次启用 GUI 时再请求辅助功能/屏幕录制等系统权限。

**登录**：系统浏览器已有会话直接复用，无会话则走现有登录/注册。短时一次性授权码经固定应用深链回调，由原生校验 state、S256 PKCE 并兑换独立客户端会话；URL 不带登录 token。refresh token 存系统 Keychain，access token 只在内存；退出清理并可解绑设备，不退出浏览器；一期单账号。完整契约见方案 §5.7。

**诊断**：结构化日志 + 脱敏；诊断包只含版本、设备、权限状态、最近错误码；不含截图、键入内容、token。

## 6. 权限模型

三层权限 + 命令审批 + 动作契约：

1. **产品模式**：`ask_always` / `ask_on_risk` / `full_access`。
2. **能力授权**：`computer.observe` / `computer.act` / `computer.launch` / `computer.clipboard`；作用域为应用、目录、动作、时间（5 分钟任务授权，可续期）。
3. **执行端强制**：引擎每次 act 前校验；OS 权限（macOS TCC）、暂停状态、授权有效期。
4. **命令级审批（本地 shell/文件写入）**：
   - **沙箱与审批分档**：本地默认 `untrusted` + `workspaceWrite`（工作区外只读，信任命令集之外逐次确认）；`full_access` 产品模式需显式开启，才用 `dangerFullAccess` + `on-request`。云会话保持 `never`。
   - 只改审批不改沙箱等于没有闸：`dangerFullAccess` + `on-request` 不会产生逐次确认。
   - 卡片展示完整命令、cwd、写入路径、提权/联网标记。
   - 命令用 `CommandExecutionApprovalDecision`、文件变更用 `FileChangeApprovalDecision`，事件/API/runner 按原生请求类型分别验证。文件只允许 `accept` / `acceptForSession` / `decline` / `cancel`，不提供命令前缀规则的"始终允许"；命令规则修订仅在原生请求与权限策略允许时显示。完整契约以方案 §7.2 为准，超时走 `cancel`。
   - 撤销"始终允许"必须同时下发 native 规则更新（`acceptWithExecpolicyAmendment` 已写进 Codex 规则表），只删本地记录不够。
   - 串行审批；拒绝不自动重试；只记命令摘要，不记完整输出。
5. **动作风险分级**：`Read` / `Change` / `External` / `Irreversible` / `Unknown`；`External`、`Irreversible`、`Unknown` 归为 `outward`，审批卡的风险徽标、审计和可选的对外节奏都按这个等级。
6. **动作效果契约**：`computer_act` 返回 `effect`（`done` / `small_change` / `no_effect` / `place_changed`）与 `wait`；支持 `expect` / `expectGone` / `waitStable`（默认 8s、上限 20s）；`computer_observe` 带 `treeQuality`，树不可用时附截图。`no_effect` 不自动重试。

**macOS 权限引导**：仅 M1b 的 GUI 能力按需触发。用 mygo `permissionflow` 在系统设置旁展示可拖拽的 LinkSense，用户在系统设置中完成授权；详见[方案 §7.2](../research/linksense-desktop-dual-mode-plan-2026-11-16.md#72-本地权限)。

**单应用授权**：默认只给一次 / 本次会话；“始终允许”需显式开启（确认卡展开或设备设置），按应用授权、最长 30 天过期、设置里可撤销、撤销立即生效；付款、删除、`Unknown`、工作区外写入、`sudo` 不吃“始终”，仍逐次确认。整桌面接管单独确认（`MAIN_DESKTOP_PERMISSION`）。

**安全底线**：配对码一次性短 TTL；device token 只存哈希；撤销立即断 WS；引擎不暴露公网；`agent-desktop` 不直接给模型；审计不含截图/剪贴板/键入原文；本地操作时界面固定显示"Agent 正在控制本地电脑"，并提供全局暂停/停止快捷键。

**凭据边界**：独立严格 Zod 设备契约按白名单构造，不从内部请求只删除主模型 key。主模型、记忆提取与模型切换来源都用受限代理配置；设备不持真实供应商密钥或 `LINKSENSE_RUNNER_SHARED_SECRET`。正常对话、记忆提取与切模型分别验收，云端内部契约保留。详见方案 §6.1。

**Core MCP 回调**：本地工具请求经设备桥受限请求/响应通道到 API，按 run lease、操作白名单及资源权限校验，再调现有领域 service；覆盖 Browser Use、知识库、网页搜索、连接器及必要控制回调。请求关联、超时/取消、迟到响应与副作用不重放均需验收，详见方案 §6.7。

## 7. UI 基线

- 浅色 A + 深色 C 共用同一套 token；深色靠表面亮度差与边线分层，取消卡片投影；状态色只改明度。
- 尺寸与顶部：侧栏 224px / 行高 34；卡片圆角 14；输入区 20；胶囊 999；会话阅读宽 680（以上为通用设计数据，不是已实现的像素测量）。macOS 顶部是一整块连续表面，不另设独立标题条或地址栏；保留额外内边距的原生红绿灯在常规侧栏宽度下，与紧凑的蓝色 L 图标（无字标）及铃铛/搜索/折叠同排对齐，页面固定为 100% 缩放；窄侧栏、全屏与缩放细则见[桌面手册的窗口外观](../../apps/desktop/README.md#window-chrome)。
- 关键界面：新任务空态、环境 pill 与分段、切换确认、权限卡、权限向导、本地 computer use 运行卡、云电脑四态、设置（通用/个性化/运行环境/浏览器扩展/更新/关于）、更新六态。
- 交互规则：环境是会话级控件；切换必须确认；云初始化 probe → 确认 → 初始化 → ready → 失败可回退；所有权限/暂停/停止/切换写审计。
- 六语言；键盘可达；焦点可见；`prefers-reduced-motion`。
- 本地设计评审稿在 `docs/design/desktop-ui/`（未入库）。

## 8. 浏览器

本期 Browser Use 只有两种面，内置浏览器不在范围（P2-05 至 P2-07 尚未完成并已暂缓；范围与重新评估条件见[方案 §5.11](../research/linksense-desktop-dual-mode-plan-2026-11-16.md#511-内置浏览器暂缓)）：

| 面 | 用途 | 登录态 | Agent 自动化 |
| --- | --- | --- | --- |
| 用户真实浏览器（扩展） | 登录态、复杂站点、上传/验证码 | 用户 Chrome/Edge | 现有 `browser_use` |
| 云模式 | 容器内执行 | 容器内 | headless Chromium + 现有 `BrowserPanel` |

- **扩展**：沿用 Chrome/Edge MV3（配对 `/api/v1/browser-use/pair`、`/socket`；tab 级授权、虚拟指针、截图浮窗、站点信任与撤销）。桌面不打包 Chromium；webview UA 不是 Chrome/Edge，桌面内改用专用引导：打开系统浏览器 → 登录同一账号 → 扩展自动连接。本地执行链路为 `browser_use` → 本地 runner → 设备桥受限请求 → API → 扩展 WSS；扩展授权仍在 API/扩展侧。
- **云端**：沿用现有 Docker Runner 的 headless Chromium 与 `BrowserPanel`；不新增浏览器引擎、不迁移链接。
- **限制**：本地 Browser Use 依赖用户安装扩展；未连接时明确提示，不影响云模式。

## 9. 应用内更新

mygo 内置：签名 manifest、bsdiff 增量、失败回退整包、stable/beta 渠道、只读安装位置降级为下载安装包。六种状态：已是最新 / 可更新 / 下载中 / 待重启 / 检查失败 / 只读安装位置；进度只用真实数据；错误给稳定 code。

## 10. 数据与 API 增量

- Prisma 新增（非破坏）：`DesktopDevice`、`DesktopDevicePairing`、`LocalComputerSession`、`ComputerPermissionGrant`。
- `Conversation` 新增：`executionTarget`（默认 `cloud`）、`desktopDeviceId`。
- API 新增：`/desktop/devices*`（配对/列表/撤销/WS）、`/conversations/:id/local-computer`（启停/状态）、`/computer-permissions`（授权/撤销）、`/approvals/:requestId`（审批回传）、`PATCH /conversations/:id`（仅新建/未开始会话改目标）；`RunnerTransport` 按目标路由 HTTP/设备 WS。
- 事件：`computer.session.updated`、`computer.permission.requested/resolved`、`computer.action.started/finished`、`approval.requested`；回答后复用 `serverRequest/resolved`。
- 凭据、工具与文件：独立设备契约 + 用途凭据（方案 §6.1）；Core MCP 受限请求/响应（§6.7）；附件下发、工件上传确认、`workspaceRelativePath` → 资源 ID 映射（§6.6）。文件字节走预签名传输，工具帧不承载大文件。

### 10.1 设备协议与兼容

- WS 契约以方案 §6.2 为准：执行命令、事件、回合内 `tool.request/result/cancel` 与绑定设备连接的 `control.request/result/cancel` 分开；工具及控制各有操作白名单，控制帧不能执行业务工具。设备不提交内部路径或服务端身份。
- 命令白名单 + `commandId` + 短 TTL；同一连接去重；离线不积压；撤销立即断 WS。
- 事件注入：校验归属 → 写 `ConversationEvent`；`sse_event_id` 幂等。
- 错误：设备离线 → `RUNNER_UNAVAILABLE`；结果不明 → `RUNNER_OPERATION_UNCERTAIN`，不重发。
- 兼容：新字段 nullable/default；旧客户端忽略未知事件；不修改已应用迁移；Web 端不显示本地设备入口。
- **桌面协议版本与 Web build ID 解耦**：现有 `CLIENT_BUILD_HEADER` 要求 build ID 完全相等，内嵌资源又在安装包里，旧安装包连新 API 会永久 `CLIENT_UPDATE_REQUIRED`。桌面改为上报 `desktopProtocolVersion` + 能力位，API 校验兼容区间；不兼容返回 `DESKTOP_UPDATE_REQUIRED` 并给更新入口。Web 端现有检查不动。

## 11. macOS 阶段

| 阶段 | 内容 |
| --- | --- |
| Phase 0 | 壳、系统浏览器登录、独立本地运行时、云模式和配对/WS 骨架 |
| M1 | 设备凭据与通道、受限工具与文件链路、原生审批、安装与更新 |
| M1b | GUI 引擎、桌面租约、macOS 权限引导、暂停/停止和审计 |
| Phase 2 | 云模式回归（P2-01–04） |

各阶段完成后先审查，再跑白盒、修复和复测，通过后提交。通道门槛与详细依赖见[任务拆解](./linksense-desktop-dual-mode-task-breakdown-2026-11-16.md#7-macos-实施顺序)。

Phase 3（后续）：多设备、配额/usage、审计导出、GA 加固；Linux 云桌面仅在需要时另行评估。

### 11.1 测试与验收

| 层级 | 覆盖 |
| --- | --- |
| 单元 | computer schema、权限矩阵、审批决策、设备通道白名单/幂等、transport 路由 |
| 集成 | device gateway + fake desktop；local runner bridge；Core MCP computer 模块 |
| E2E | M1：local 文件/Shell/扩展浏览器/知识库/连接器、重连与撤销；M1b：追加 GUI 效果/等待、暂停/恢复、崩溃不续跑；云回归独立执行 |
| 安全 | 伪造设备、重放命令、越权会话、路径遍历、撤销后重试 |
| 凭据边界 | 正常/记忆/切模型三路径无真实供应商 key 或内部 secret；严格设备 schema 拒绝未知/嵌套内部字段；过期/撤销与云契约回归 |
| Core MCP 回调 | 本地 Browser Use/知识库/搜索/连接器；操作及资源权限；关联 ID、超时/取消、迟到响应、副作用不重放 |
| 沙箱与审批 | 原生沙箱生效；默认档系统自动化绕过拦截；命令/文件分别按 v2 schema；文件无前缀规则选项，错类型决策拒绝；命令规则撤销后 native 生效 |
| 文件链路 | 附件到达设备；工件确认后入列表；本地路径不进事件/日志/模型上下文 |
| 设备租约 | 第二会话 `DEVICE_BUSY`；崩溃/断线后释放；窗口身份变化报错 |
| 设备通道 | 一次真实回合（读文件/执行命令/取消）经通道跑通；排序、去重、取消；回显桩不算通过 |
| 更新 | 安装/重启与进行中回合互斥；重启后按中断处理，不续跑 |
| 本地工作区 | 保留 14 天/总量上限；清理不影响已上传工件；重开后提示已清理 |
| 协议兼容 | 上一版安装包连当前 API 可登录、可开会话、升级提示可达 |
| 验收 | M1：本地与云都能完成"读文件 + 改文件 + 执行命令 + 浏览器任务"；M1b：本地额外完成 GUI 操作 |

## 12. 外部参考的取舍

| 来源 | 吸取 | 不采纳 |
| --- | --- | --- |
| WorkBuddy | Agent 与 UI/壳解耦、客户端工具注入、事件续接幂等 | ACP 双栈、计费进权限 hook、巨型单 bundle |
| 小浣熊 | 权限生命周期（一次/会话/始终）、命令级确认、单进程多会话、单一事实源 | Python agent 全量移植、JSONL SessionLog 实现 |
| 豆包工作 | 会话级执行目标、本地/云权限分开、`INIT_LOCAL_APP`、云初始化闭环、服务端开关、`commandId` 不重发 | Windows VM、PIP 视频流、GAC 加密栈、云文件映射成本地路径 |
| Mika（Android） | 唯一动作执行入口、风险分级、`effect`/`wait` 效果契约、崩溃不续跑、设备通道错误语义 | 虚拟屏后台操作、无障碍/ADB 栈、只拦付款的审批姿态 |

UI 只借交互模型，视觉按 A/C 重做。

## 13. 主要风险与开放问题

- **参考实现**：`feat-computer-use` 只作参考；照搬会带入旧结构，按当前主线重写并记录参考 commit 与摘取范围。
- **本地 computer use 占用真实桌面**：会抢鼠标键盘，不能像手机虚拟屏那样后台跑；靠任务授权、明确横幅、全局暂停/停止缓解。
- **崩溃/断线**：界面状态不可重建，回合标 `interrupted`，不重放已投递动作；`UNCERTAIN` 命令不自动重发。
- **macOS TCC 由用户授权**：拖拽引导不替用户打开开关；引擎在执行前重新校验权限。
- **`agent-desktop` 升级**：采用最新版（当前 1.3.1），Phase 0 做 AX/UIA 回归并记录 sha256；许可证随包。
- **WKWebView / WebView2 差异**：UA、下载、媒体、权限行为不一致，需双平台回归，能力差异返回稳定 code。
- **Windows UIA 差异**：提权窗口、DPI、多显示器需白盒回归（P1-18/19b/20b）；M1 安装/沙箱/升级由 P1-19a/20a 独立验收。
- **设备通道不确定性**：命令用 `commandId` + 短 TTL；不确定结果不重发，UI 显式提示。
- **API 强依赖**：一期没有纯离线会话；弱网只做提示与重连。
- **webview UA**：浏览器扩展检测会判不支持，已用桌面专用引导规避。
- **本地运行时形态**：`local-process` 是 development-only 且要求 POSIX uid/gid，不能直接复用；新增 `desktop` provider，并把 Node + runner + Codex 的打包方式在 Phase 0 定死（干净机器冒烟是出口门槛）。
- **更新与回合冲突**：更新会替换随包的 runner 与 `agent-desktop`；安装/重启必须等回合结束或用户显式确认，重启后按中断处理、不续跑。
- **本地磁盘累积**：工作区不设上限会长期增长；按会话保留 14 天 + 总量上限 10 GiB + 设置页一键清理。
- **凭据边界**：内部请求中的主模型、记忆提取、切换来源均含供应商 key；独立严格设备契约仅下发用途代理配置。Core MCP 业务请求经 §6.7 受限通道，设备不持内部共享密钥。
- **审批 ≠ 拦截**：只把 `never` 改成 `on-request` 不产生逐次确认；本地默认必须是 `untrusted` + `workspaceWrite`。
- **旧安装包升级**：内嵌构建被 build ID 锁死，必须把桌面协议版本与 Web 构建 ID 解耦。
- **其余工程风险**：mygo 生态小（固定版本、升级前白盒回归）；webview 内容按不可信处理、只暴露显式 IPC；Windows 需处理 SmartScreen/WebView2 缺失；更新密钥离线备份；更新主源用自托管对象存储，GitHub 仅备用；证书 Phase 0 申请。

**开放问题**

1. 云模式是否需要“浏览器实时预览”增强？（现有 browser panel 已够用）

## 14. 下一步（Phase 0）

1. 在当前 `feat` 新建 `apps/desktop`，参考旧实现摘取 computer use 相关代码并重写。
2. 固定 Go/mygo/`agent-desktop` 版本与第三方声明。
3. 打通主窗口 webview 加载 `apps/web` + 桌面宿主适配层。
4. 定义 shared schema：`executionTarget`、computer 工具、设备协议。
5. 设备配对与 WS 骨架（无 UI），验证 macOS/Windows 双平台构建。
6. **云模式贯通**：打包后的应用在干净机器完成登录 → 云会话 → SSE → 下载 → 更新检查。
7. **独立本地运行时冒烟**：随包 Node + runner + Codex，测试专用入口用 fake model 验证启动、临时工作区、Core MCP 装载与退出；不接生产内部接口。壳、云与独立运行时通过后进入 M1，真实设备回合与 GUI 分别在 M1/M1b 验收。
