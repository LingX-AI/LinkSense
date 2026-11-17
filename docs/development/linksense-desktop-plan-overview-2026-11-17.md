# LinkSense 桌面端方案总览（2026-11-17）

> 这是当前最新方案的整理稿，供评审与沟通使用。权威细节以两份原文为准：
> [方案 v2](../research/linksense-desktop-dual-mode-plan-2026-11-16.md) · [任务拆解](./linksense-desktop-dual-mode-task-breakdown-2026-11-16.md)。
> 本文与原文冲突时，以原文为准。

## 1. 一句话

**Go + mygo 单二进制桌面客户端**，主窗口用 webview 承载现有 `apps/web` 全量 UI；同一套 Agent，执行位置可选**本地电脑（macOS / Windows）**或**云电脑（现有 Linux Docker runner）**。

## 2. 已定决策

| 项 | 决定 |
| --- | --- |
| 桌面壳 | Go 1.27.3 + `github.com/egoist/mygo` v0.7.4（MIT）；不用 Electron/Tauri |
| 客户端形态 | **完整桌面应用**：会话、计划、表单、工件、知识库、浏览器面板、设置；不是 companion |
| UI 复用 | 主窗口加载 `apps/web` 构建，**一套 UI 不 fork**；Go 只做窗口/系统层，禁止在 Go 里重画侧栏或聊天 |
| 本地模式 | macOS + Windows 双平台 |
| 云模式 | 复用现有 Linux Docker runner，不新建基础设施 |
| 明确不做 | Windows 云电脑（VM/RDP/视频流）、Linux 客户端、WebRTC/PIP 可视化云桌面、混合模式 |
| computer use | `vercel-labs/agent-desktop`（Apache-2.0，**最新版**，当前 1.3.1），由 Go 引擎以子进程管理，模型只看到 `computer_*` 工具 |
| Browser Use | 沿用现有 Chrome/Edge MV3 扩展；桌面端只做引导与状态 |
| 内置浏览器 | 独立原生窗口 + mygo webview，应用自有隔离会话；Agent 可操作（DOM/JS，坐标兜底）；不替代扩展 |
| 模式选择 | 会话级 `Conversation.executionTarget = local \| cloud`；切换必须确认并新建会话 |
| UI 风格 | 浅色 A（豆包浅蓝白，#3370FF）+ 深色 C（#4D7CFE），同一套 token 与组件 |
| 更新 | mygo 签名更新：bsdiff 增量、失败回退整包、stable/beta 渠道 |
| 基线 | 开发基线是当前 `feat`；`feat-computer-use:apps/desktop` 仅作 computer use 参考，不合并、不 cherry-pick |

## 3. 架构

```text
┌────────────────────── 桌面应用（Go + mygo 单二进制）──────────────────────┐
│  主窗口 webview ── 加载 apps/web ── 桌面宿主适配层（typed IPC）           │
│  原生层：窗口/托盘/菜单/深链/通知/更新/Secrets                            │
│  本地 runner supervisor（apps/runner standalone + local-process）         │
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
- **本地 runner**：复用 `apps/runner`，Codex app-server、Core MCP、workspace、文件服务不变。
- **API**：设备配对/在线状态、命令路由、审批转发、事件写入现有 `ConversationEvent`。
- **引擎**：只监听 loopback/Unix socket；所有本机动作经唯一 `ActionExecutor`：授权/暂停校验 → 风险分级 → 审批（如需）→ 执行 → 效果核对 → 审计。

### 3.1 代码落点

| 位置 | 内容 |
| --- | --- |
| `packages/shared/src` | `computer-use.ts`（工具名/schema/权限 code/事件）、`desktop-device.ts`（设备帧/配对/能力） |
| `apps/api/src/modules/desktop-devices` | 配对、设备列表、设备 WS、撤销 |
| `apps/api/src/modules/local-computer` | 本地会话/权限（可选） |
| `apps/api/src/adapters` | `runner.ts`（RunnerTransport）、`desktop-device-transport.ts` |
| `apps/runner/src` | `mcp/core-services/computer-use-service.ts`、`desktop/computer-tool.ts` |
| `apps/desktop` | Go module：`main.go`、`web.go`（主窗口）、`view.go`（伴随窗口）、`bridge.go`（设备 WS）、`engine.go`（agent-desktop）、`browser.go`（内置浏览器）、`assets/browser-agent.js`（DOM 注入）、`runtime.go`（supervisor） |
| `scripts/desktop.mjs` | 构建、打包、签名入口 |

- `apps/desktop` 是 Go module，**不进 pnpm workspace**；桌面契约放 `packages/shared`。
- 引擎与应用同进程，不建 `apps/desktop-helper`；CI 覆盖 macOS/Windows 双平台构建。
- 本地 runner 复用 `apps/runner`：`RUNNER_MODE=standalone` + `WORKER_PROVIDER=local-process`；工作区 macOS `~/Library/Application Support/LinkSense`、Windows `%APPDATA%\LinkSense`。

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
| Agent | 本地 runner（standalone） | 现有 Docker runner |
| 文件 | 本地工作区/授权目录 | 容器工作区 |
| Shell | 本地 shell，**命令级审批** | 容器 shell（`approvalPolicy: never`） |
| 浏览器 | 用户真实 Chrome/Edge（扩展） | 容器内 headless Chromium |
| 桌面 GUI | `computer_observe/act`（agent-desktop） | 不提供 |
| 权限 | OS 权限 + 应用授权 + 命令审批 | 容器/工作区边界 |
| 展示 | 会话内 computer use 状态卡 | 与 Web 会话一致；云文件/浏览器面板 |
| 离线 | API 不可达时也不可用（一期明确提示） | 同左 |

切换规则：显式确认 → continuation 新建会话 → 原会话不动；文件不自动同步；绝不静默切换。本地不可用提示改用云，云不可用提示改用本地。

云电脑 = **无图形界面的 Linux 执行环境**（文件 / Shell / headless Chromium），不是可接管的桌面：无 X11/Wayland、无屏幕视频、无鼠标键盘接管。

## 5. 客户端范围

**主窗口**：登录/注册、会话列表与详情（对话、计划、表单、工件）、知识库、浏览器面板、设置；桌面新增设备与权限、本地电脑状态、更新、关于/诊断。

**内置浏览器**：独立原生窗口，带后退/前进/刷新、地址栏、标签页、下载、页内查找、缩放；应用自有隔离会话。应用内链接默认在此打开，可在设置改回系统浏览器。

**外跳**：支付、第三方 OAuth、营销页等需要独立浏览器窗口的流程交给系统浏览器。

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

**首次启动**：登录 → 设备命名与配对 → 系统权限（macOS 辅助功能/屏幕录制）→ 连接浏览器（可选）→ 默认执行目标 → 主界面。

**登录**：深链回调；token 存系统 Keychain，不落 localStorage；退出清理并可解绑设备；一期单账号。

**诊断**：结构化日志 + 脱敏；诊断包只含版本、设备、权限状态、最近错误码；不含截图、键入内容、token。

## 6. 权限模型

三层权限 + 命令审批 + 动作契约：

1. **产品模式**：`ask_always` / `ask_on_risk` / `full_access`。
2. **能力授权**：`computer.observe` / `computer.act` / `computer.launch` / `computer.clipboard`；作用域为应用、目录、动作、时间（5 分钟任务授权，可续期）。
3. **执行端强制**：引擎每次 act 前校验；OS 权限（macOS TCC）、暂停状态、授权有效期。
4. **命令级审批（本地 shell/文件写入）**：
   - 本地会话 `approvalPolicy=on-request`，由 **Codex 原生审批请求**驱动，不另造语义；云会话保持 `never`。
   - 卡片展示完整命令、cwd、写入路径、提权/联网标记。
   - 选项映射 Codex 决策：拒绝 / 允许一次 / 本次会话 / 始终允许（前缀规则，默认收在“更多”，30 天过期、可撤销）。
   - 只读命令与工作区内写入可自动放行；工作区外写入、`sudo`、删除、下载执行、常驻服务必须确认。
   - 串行审批；超时自动拒绝；拒绝不自动重试；只记命令摘要，不记完整输出。
5. **动作风险分级**：`Read` / `Change` / `External` / `Irreversible` / `Unknown`；`External`、`Irreversible`、`Unknown` 归为 `outward`，审批卡的风险徽标、审计和可选的对外节奏都按这个等级。
6. **动作效果契约**：`computer_act` 返回 `effect`（`done` / `small_change` / `no_effect` / `place_changed`）与 `wait`；支持 `expect` / `expectGone` / `waitStable`（默认 8s、上限 20s）；`computer_observe` 带 `treeQuality`，树不可用时附截图。`no_effect` 不自动重试。

**OS 权限向导**（参考豆包 `INIT_LOCAL_APP`）：检测 0/2–2/2 → 分项说明 + 系统设置深链 → 重新检测（不重启会话）→ 屏幕录制授权后提示重启；拒绝记录原因并可"先用云电脑"。

**单应用授权**：默认只给一次 / 本次会话；“始终允许”需显式开启（确认卡展开或设备设置），按应用授权、最长 30 天过期、设置里可撤销、撤销立即生效；付款、删除、`Unknown`、工作区外写入、`sudo` 不吃“始终”，仍逐次确认。整桌面接管单独确认（`MAIN_DESKTOP_PERMISSION`）。

**安全底线**：配对码一次性短 TTL；device token 只存哈希；撤销立即断 WS；引擎不暴露公网；`agent-desktop` 不直接给模型；审计不含截图/剪贴板/键入原文；本地操作时界面固定显示“Agent 正在控制本地电脑”，并提供全局暂停/停止快捷键。

## 7. UI 基线

- 浅色 A + 深色 C 共用同一套 token；深色靠表面亮度差与边线分层，取消卡片投影；状态色只改明度。
- 尺寸：单条 44px 工具条（红绿灯 + 侧栏开关 + 应用菜单 + 任务 + 环境 pill + 操作）；侧栏 224px / 行高 34；卡片圆角 14；输入区 20；胶囊 999；会话阅读宽 680。
- 关键界面：新任务空态、环境 pill 与分段、切换确认、权限卡、权限向导、本地 computer use 运行卡、云电脑四态、设置（通用/个性化/运行环境/浏览器扩展/更新/关于）、更新六态。
- 交互规则：环境是会话级控件；切换必须确认；云初始化 probe → 确认 → 初始化 → ready → 失败可回退；所有权限/暂停/停止/切换写审计。
- 六语言；键盘可达；焦点可见；`prefers-reduced-motion`。
- 本地设计评审稿在 `docs/design/desktop-ui/`（未入库）。

## 8. 浏览器

三种浏览器面并存，不互相替代：

| 面 | 用途 | 登录态 | Agent 自动化 |
| --- | --- | --- | --- |
| 内置浏览器 | 应用内打开链接、隔离浏览、不动用户主浏览器 | 应用自有隔离会话 | DOM/JS，坐标兜底 |
| 用户真实浏览器（扩展） | 登录态、复杂站点、上传/验证码 | 用户 Chrome/Edge | 现有 `browser_use` |
| 云模式 | 容器内执行 | 容器内 | headless Chromium + 现有 panel |

- **扩展**：沿用 Chrome/Edge MV3（配对 `/api/v1/browser-use/pair`、`/socket`；tab 级授权、虚拟指针、截图浮窗、站点信任与撤销）。桌面不打包 Chromium；webview UA 不是 Chrome/Edge，桌面内改用专用引导：打开系统浏览器 → 登录同一账号 → 扩展自动连接。执行链路仍是 `browser_use` → Worker → API → 扩展 WSS，桌面不参与转发。
- **内置浏览器**：独立原生窗口（mygo `Window.NewWebView`），标签/下载/查找/隔离会话。Agent 沿用 `browser_*` 语义，按 `browserTarget=builtin|extension` 路由，默认扩展；DOM 快照与 ref 由注入脚本提供，JS 失败时回落到坐标点击。第三方页 `Untrusted`，不能调用 Go；禁止 `file://`，下载需确认，生产禁用 DevTools。
- **限制**：不是 Chromium/CDP——没有跨域 iframe、文件上传自动化、网络拦截；复杂 SPA 与反爬站点成功率低于扩展。遇到时明确报错并建议改用扩展。

## 9. 应用内更新

mygo 内置：签名 manifest、bsdiff 增量、失败回退整包、stable/beta 渠道、只读安装位置降级为下载安装包。六种状态：已是最新 / 可更新 / 下载中 / 待重启 / 检查失败 / 只读安装位置；进度只用真实数据；错误给稳定 code。

## 10. 数据与 API 增量

- Prisma 新增（非破坏）：`DesktopDevice`、`DesktopDevicePairing`、`LocalComputerSession`、`ComputerPermissionGrant`。
- `Conversation` 新增：`executionTarget`（默认 `cloud`）、`desktopDeviceId`。
- API 新增：`/desktop/devices*`（配对/列表/撤销/WS）、`/conversations/:id/local-computer`（启停/状态）、`/computer-permissions`（授权/撤销）、`/approvals/:requestId`（审批回传）、`PATCH /conversations/:id`（仅新建/未开始会话改目标）；`RunnerTransport` 按目标路由 HTTP/设备 WS。
- 事件：`computer.session.updated`、`computer.permission.requested/resolved`、`computer.action.started/finished`、`approval.requested`；回答后复用 `serverRequest/resolved`。

### 10.1 设备协议与兼容

- WS 帧：`desktopBridge`（注册/心跳/能力）、`desktopCommand`（API→设备：`turns/start`、`steer`、`interrupt`、`runtime`、`fork`、`prewarm`、`mcp-current-user/*`、`health`）、`desktopRequest`（设备→API：事件/结果/文件上传）。
- 命令白名单 + `commandId` + 短 TTL；同一连接去重；离线不积压；撤销立即断 WS。
- 事件注入：校验归属 → 写 `ConversationEvent`；`sse_event_id` 幂等。
- 错误：设备离线 → `RUNNER_UNAVAILABLE`；结果不明 → `RUNNER_OPERATION_UNCERTAIN`，不重发。
- 兼容：新字段 nullable/default；旧客户端忽略未知事件；不修改已应用迁移；Web 端不显示本地设备入口。

## 11. 阶段与工作量

| 阶段 | 内容 | 估时 |
| --- | --- | --- |
| Phase 0 | 在当前 `feat` 新建 `apps/desktop`，参考旧实现重写配对/引擎/打包；主窗口 webview、宿主适配层、runner supervisor；shared schema/executionTarget；设备 WS 骨架 | 约 25 人日 |
| Phase 1 | 设备网关正式化、双路由、本地 runner + computer use 引擎、动作执行管道与效果契约、权限/任务授权/命令审批、macOS 向导、Windows 本地模式、Browser Use 接入、打包签名更新、E2E | 约 68 人日 |
| Phase 2 | 云目标在 UI/API 暴露；复用现有 Docker runner；与 Web 一致性验证；内置浏览器窗口 + Agent 适配 + 安全交接 | 约 18 人日 |
| 合计 | — | **约 111 人日；2 人并行约 11 周** |

Phase 3（后续）：多设备、配额/usage、审计导出、GA 加固；Linux 云桌面仅在需要时另行评估。

### 11.1 测试与验收

| 层级 | 覆盖 |
| --- | --- |
| 单元 | computer schema、权限矩阵、审批决策、设备通道白名单/幂等、transport 路由 |
| 集成 | device gateway + fake desktop；local runner bridge；Core MCP computer 模块 |
| E2E | 本地：local 会话 → 文件/Shell（审批）→ 浏览器 → observe/act → 效果/等待 → 暂停/恢复 → 断线重连 → 崩溃不续跑 → 撤销；云：cloud 会话 → Docker runner → 断线重连 → 回收 |
| 安全 | 伪造设备、重放命令、越权会话、路径遍历、撤销后重试 |
| 内置浏览器 | 导航/标签/下载/查找；DOM 点击/输入/等待；会话隔离；`file://` 拦截；双平台 |
| 验收 | 两种模式都能完成“读文件 + 改文件 + 执行命令 + 浏览器任务”；本地额外完成 GUI 操作 |

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
- **macOS TCC 不可自动化**：权限引导只能深链 + 重新检测；E2E 需已授权环境或 mock。
- **`agent-desktop` 升级**：采用最新版（当前 1.3.1），Phase 0 做 AX/UIA 回归并记录 sha256；许可证随包。
- **内置浏览器无 CDP**：复杂站点成功率低于扩展；默认仍用扩展，失败时回落到扩展或坐标点击。
- **WKWebView / WebView2 差异**：UA、下载、媒体、权限行为不一致，需双平台回归，能力差异返回稳定 code。
- **Windows UIA 差异**：提权窗口、DPI、多显示器需白盒回归（P1-18/19）。
- **设备通道不确定性**：命令用 `commandId` + 短 TTL；不确定结果不重发，UI 显式提示。
- **API 强依赖**：一期没有纯离线会话；弱网只做提示与重连。
- **webview UA**：浏览器扩展检测会判不支持，已用桌面专用引导规避。
- **其余工程风险**：mygo 生态小（固定版本、升级前白盒回归）；webview 内容按不可信处理、只暴露显式 IPC；Windows 需处理 SmartScreen/WebView2 缺失；更新密钥离线备份；更新主源用自托管对象存储，GitHub 仅备用；证书 Phase 0 申请。

**开放问题**

1. 云模式是否需要“浏览器实时预览”增强？（现有 browser panel 已够用）

## 14. 下一步（Phase 0）

1. 在当前 `feat` 新建 `apps/desktop`，参考旧实现摘取 computer use 相关代码并重写。
2. 固定 Go/mygo/`agent-desktop` 版本与第三方声明。
3. 打通主窗口 webview 加载 `apps/web` + 桌面宿主适配层。
4. 定义 shared schema：`executionTarget`、computer 工具、设备协议。
5. 设备配对与 WS 骨架（无 UI），验证 macOS/Windows 双平台构建。
