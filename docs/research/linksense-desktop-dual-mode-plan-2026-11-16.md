# LinkSense 桌面端方案（v2）：本地电脑 + 云电脑（Docker Runner）

日期：2026-11-16，2026-11-17 修订。依据：本仓库现有实现，以及 WorkBuddy、商汤小浣熊、豆包工作三份逆向调研。本文是**方案**，不包含实现改动。

> 2026-11-17 修订：桌面壳由 Electron 改为 **Go + mygo**；明确客户端是**完整应用**（主窗口 webview 承载 `apps/web` 全量 UI），computer use 参考 `feat-computer-use:apps/desktop` 的初稿实现，在当前 `feat` 上重建并扩展。
>
> 2026-11-17 安全边界修订（对照代码评审）：本地运行时改为新增 `desktop` provider（`local-process` 仅 development 且要求 POSIX uid/gid，不能复用）；新增 §6.1 设备凭据模型与 §6.6 文件/工件链路；本地 Shell/文件归 Codex 原生沙箱 + 审批（两层控制，§5.4.2），审批值按 0.168.0 v2 schema；新增设备任务租约（§5.3）；桌面协议版本与 Web build ID 解耦（§8.3）；Phase 0 增加打包运行时冒烟与云模式贯通，GUI 拆为 M1b。
>
> 2026-11-17 复审修订：设备入参改用独立严格 schema，覆盖主模型、记忆提取与模型切换来源；新增 §6.7 Core MCP 受限请求/响应通道；命令与文件变更审批分开校验；Phase 0 只验壳、云模式与独立本地运行时，M1 与 M1b 的测试及发布依赖分开。工作量以任务拆解为准。
>
> 2026-11-17 复审补齐：设备通道以**一次真实 Codex 回合**（读文件、执行命令、事件回传、取消）作为阶段门槛，回显桩不算通过（§9）；应用内更新与进行中的本地回合互斥（§5.10）；本地工作区补保留期、总量上限与清理策略（§5.2）。

已确认的产品决策：

- 桌面壳：**Go + mygo**（`github.com/egoist/mygo` v0.7.4，MIT）。客户端是**完整 LinkSense 桌面应用**：主窗口用 mygo webview 承载 `apps/web` 全量 UI，Go 侧提供窗口、托盘、深链、更新、本地 runner 监督、设备桥与 computer-use 引擎；外壳单二进制，无 Electron/Node 运行时（本地执行运行时随包分发，见 §5.2）。
- 开发基线：**当前 `feat` 分支**。`feat-computer-use` 分支的 `apps/desktop` 只作为 **computer use 的参考实现**（Go + mygo：配对、设备 WS、引擎、权限/暂停、打包脚本），不整分支合并、不 cherry-pick；需要的代码按当前主线结构重写/摘取并逐文件 review。
- 本地电脑：**macOS + Windows**（两个客户端平台）；不做 Linux 客户端。
- 云电脑：**就是现有的 Docker 隔离 runner**（Linux），不新建 Windows VM / WebRTC / PIP 基础设施。
- `agent-desktop`：确认上游为 `vercel-labs/agent-desktop`（Apache-2.0）；现有桌面应用已封装它，本期继续用它实现 local computer use，并采用**最新版**（当前 1.3.1）。

> 重要边界：现有 Docker runner 是**无图形界面的 Linux 执行环境**（文件、Shell、headless Chromium），不是“能看到 Windows 桌面并接管鼠标键盘”的云 PC。LinkSense 本期**不做 Windows 云电脑**（Windows VM / RDP / 视频流）；本地 Windows 客户端要做。“云电脑”= 云端 Linux 隔离执行环境。如果以后要“可视化云桌面”，只在 Linux 容器内做（见 §15.1），不引入 Windows。

---

## 0. 结论摘要

1. **桌面端不重写 Agent**：复用 `apps/web`、`apps/api`、`apps/runner`、Codex app-server、Core MCP、会话/回合/事件/SSE。
2. **两种模式 = 两种执行位置**：
   - **本地电脑**：Agent 在桌面本地 runner 中运行；文件/Shell/浏览器/桌面操作都在本机；桌面操作通过应用内 computer-use 引擎 + `agent-desktop`。
   - **云电脑**：Agent 在现有 Docker 隔离 runner 中运行；文件/Shell/headless Chromium 在容器内；桌面端只是 UI，不需要新云桌面基础设施。
3. **云电脑已经存在**：现有 Docker runner 就是“每用户隔离的云端执行环境”。Web 端现在的会话就是云模式；桌面端云模式复用同一套 API/runner/SSE，只是换了宿主 UI。
4. **本地模式需要反向设备通道**：家用网络中的 Mac 不能被云端 HTTP 直连。API 增加 Desktop Device Gateway，桌面应用主动建立出站 WebSocket；API 通过该通道下发命令、接收事件，设备不暴露入站端口；本地 runner 经桌面应用转发。
5. **computer use 有参考实现**：`feat-computer-use:apps/desktop` 已实现配对（`/api/v1/computer-use/pair`）、设备 WS（`/socket`）、5 分钟任务授权、暂停与 `agent-desktop 1.0.2` 引擎；本期参考它，在当前 `feat` 上重建 `apps/desktop`，再扩展出主窗口、本地 runner 监督与完整产品能力。
6. **权限分三层**：产品模式（每次询问/风险时询问/完全访问）、能力授权（computer.observe/act、filesystem、shell、browser）、执行端强制（本地应用引擎的 OS 权限/任务授权；云端 runner 的容器/工作区边界）。
7. **模式选择在会话级**：`Conversation.executionTarget = local | cloud`；Web 端默认 cloud，桌面端新建可选 local。切换需显式确认 + continuation，不静默切换。
8. **本期不做**：Windows 云电脑（VM/RDP/视频流）、Linux 桌面客户端、WebRTC/PIP 可视化云桌面、混合模式（云 Agent + 本地工具）。协议保留扩展点。

---

## 1. 目标与非目标

### 1.1 目标

- 桌面端可创建/继续会话，使用与 Web 一致的对话、计划、表单、工件、知识库、浏览器能力。
- **本地电脑模式**：Agent 读写本地工作区、执行 Shell、操作用户浏览器、通过可访问性树/截图操作本地桌面应用；用户可暂停/停止。
- **云电脑模式**：复用现有 Docker runner 的隔离执行（文件/Shell/headless 浏览器）；桌面端体验与 Web 会话一致。
- 两种模式共享会话事件、权限卡片、审计与 UI 组件；差异只在执行位置。
- 复用现有六语言 i18n、设计系统、测试与部署流程。
- 客户端是**完整产品**（会话、计划、表单、工件、知识库、浏览器面板、设置），不是只做设备配对或 computer use 的伴随程序；主窗口直接承载 `apps/web` 构建。
- 外壳是单二进制 Go 应用，无 Electron/Node 运行时；安装包为 `.app`/DMG 与 Windows 安装器，含随包本地执行运行时，签名 + 公证/Authenticode + 自动更新。

### 1.2 非目标（本期）

- 不做 Windows **云电脑**（VM/RDP/视频流）、PIP 窗口、鼠标键盘接管。
- 不做 Linux 桌面客户端；不做 Windows 云桌面基础设施。
- 不做“云 Agent + 本地工具”或“本地 Agent + 云电脑”的混合模式。
- 不替换 Codex app-server，不复制其回合/审批/压缩语义。
- 不做云电脑计费结算；只预留 usage/quota。

---

## 2. 现有基础

### 2.1 LinkSense 现有能力

| 能力 | 现有实现 | 桌面端复用 |
| --- | --- | --- |
| Web UI | `apps/web` React/Vite、shadcn、TanStack Query、i18n | mygo webview 加载同一构建 |
| API | `apps/api` Fastify、Zod、Prisma/Postgres、Redis/BullMQ | 新增 desktop 模块 |
| Runner | `apps/runner` controller/worker/standalone、Codex app-server、Core MCP | 新增 `desktop` provider（§5.2）；云端保持 worker |
| 会话/回合 | `Conversation`、`ConversationTurn`、`ConversationEvent`、`PendingRequest`、`ConversationUserInputRequest` | 原样使用；新增 executionTarget |
| 事件流 | SSE（`sse_event_id` + 断点） | 桌面 UI 复用 |
| 工具注入 | `mcp/core-service-registry.ts` 的 Core MCP 模块 | 新增 `computer_use` 模块（本地） |
| 本地浏览器 | Chrome/Edge MV3 扩展、配对/授权/虚拟指针/截图浮窗、`browser_use` 工具链 | 桌面端复用；不内嵌浏览器 |
| 桌面参考实现 | `feat-computer-use:apps/desktop`（Go + mygo，computer use 初稿）；`outputs/desktop` 的 `agent-desktop` 1.0.2 与打包产物 | 仅作参考；在当前 `feat` 重建并扩展为完整客户端；agent-desktop 随包发布 |

### 2.2 Docker runner 的能力边界（关键）

现有 Docker runner（`deploy/docker/Dockerfile.runner`）是：

- **Linux 容器**，每用户/会话隔离；
- Node 24、Python 3.12、`linksense-browser`（Playwright/Chromium **headless**）、文件服务、Codex app-server、Core MCP；
- 工作区、上传/下载、技能、连接器、知识库；
- 无 X11/Wayland 桌面、无 Windows、无屏幕视频、无鼠标键盘接管。

因此：

| 需求 | 现有 Docker runner | 结论 |
| --- | --- | --- |
| 云端跑文件/Shell/Codex | ✅ | 云电脑模式直接复用 |
| 云端 headless 浏览器 | ✅ | 浏览器工具/截图可用 |
| 云端 GUI 桌面（Windows 应用、鼠标键盘、视频） | ❌ | 本期不做；需要额外桌面层 |

---

## 3. 总体架构

```mermaid
flowchart TB
    subgraph Desktop["LinkSense Desktop（Go + mygo，单进程）"]
        Web["主窗口（WKWebView）\napps/web 全量 UI"]
        Native["伴随窗口（mygo/ui）\n配对 / 权限 / 状态"]
        Bridge["设备桥\n出站 WS"]
        Sup["本地 Runner Supervisor"]
        Engine["Computer Use 引擎\nagent-desktop 子进程"]
    end

    subgraph Local["本地电脑模式"]
        LR["Local Runner\napps/runner + desktop provider\nCodex + Core MCP"]
        WS["Local Workspace"]
        AD["agent-desktop 最新版\nAX / 截图 / 输入"]
    end

    subgraph Cloud["云电脑模式（现有）"]
        API["apps/api\n会话/权限/设备网关"]
        CR["Cloud Runner\nDocker worker\nCodex + Core MCP"]
        CW["Cloud Workspace\n文件 / Shell / headless Chromium"]
    end

    Sup --> LR
    LR --> WS
    LR -->|"loopback HTTP\ncomputer_use"| Engine --> AD
    LR -->|"loopback HTTP"| Bridge
    Bridge <-->|"出站 WS\n命令/事件"| API
    Web <-->|"HTTPS/SSE"| API
    API --> CR --> CW
```

### 3.1 组件边界

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| Desktop App（Go + mygo） | 用户机器 | 主窗口（webview 承载 `apps/web`）、伴随窗口（原生配对/权限）、托盘、深链、更新、本地 runner supervisor、设备桥 |
| Computer Use 引擎 | 用户机器（同一进程） | 任务授权、暂停/停止、`agent-desktop` 生命周期、OS 权限校验 |
| Local Runner | 用户机器 | Codex app-server、Core MCP、工具、工作区、事件 |
| Desktop Device Gateway | API | 设备注册/配对、出站 WS、命令路由、事件注入、撤销 |
| Cloud Runner | 云端 | 现有 Docker worker；Codex、云端工作区、headless 浏览器 |
| Web/Desktop UI | 浏览器/桌面 | 会话、计划、表单、工件、浏览器面板、权限卡片 |

---

## 4. 两种模式的运行链路

### 4.1 本地电脑模式

1. 桌面端创建会话：`executionTarget=local`，绑定 `desktopDeviceId`。
2. 桌面应用（Go）启动/复用本地 runner（`apps/runner` + `desktop` provider，§5.2）。
3. 桌面应用的设备桥主动连接 API 设备通道（出站 WS），注册设备能力与在线状态；本地 runner 的请求经桌面应用转发。
4. 用户发消息 → API 校验会话/设备/目标 → 设备通道下发 `turns/start` → 本地 runner。
5. 本地 runner 启动 Codex app-server，注入 Core MCP（含 `computer_use`），在本地工作区执行。
6. 工具：
   - 文件/Shell：本地 runner；
   - 浏览器：现有 browser-use 扩展；
   - 桌面：`computer_use` → 应用内引擎 → `agent-desktop`。
7. 事件：runner 产生事件 → 设备通道回传 API → `ConversationEvent` → SSE 推给 UI。
8. 暂停/停止：UI → API → 设备通道 → 桌面应用撤销任务授权并停止输入。
9. 回合中断：桌面应用退出/崩溃或设备断线时，正在跑的本地 GUI 回合标 `interrupted`，事件回传 API；**不重放已投递动作**，界面状态无法重建，由用户决定是否新开回合继续。

**关键点**：本地 runner 不暴露入站端口；API 不直接访问用户机器。

### 4.2 云电脑模式（现有 Docker runner）

1. 会话 `executionTarget=cloud`（Web 默认即此）。
2. API 使用现有 `RunnerClient` → Docker runner worker；无需新的云电脑 lease/网关。
3. runner 在容器内启动 Codex app-server + Core MCP，执行文件/Shell/headless 浏览器。
4. 事件走现有 runner → API event sink → `ConversationEvent` → SSE。
5. 桌面端与 Web 端看到同一条会话流；断线/重连复用现有 SSE 断点。
6. 会话结束/空闲：现有 worker 回收策略（`LINKSENSE_WORKER_IDLE_TTL_SECONDS` 等）。

**关键点**：云模式就是现在的 Web 会话；桌面端只是另一个 UI 宿主。没有 Windows VM、WebRTC、PIP。

### 4.3 模式选择与切换

- 新建会话时选择“本地电脑 / 云电脑”；默认值来自用户设置。
- Web 端没有本地设备，只能选云电脑。
- 切换目标：
  - 显式确认；
  - 使用现有 continuation 在新目标重建会话；
  - 文件不自动同步，提示用户上传/下载。
- 回退：
  - 本地设备离线/权限缺失 → 提示改用云电脑；
  - Docker runner 不可用 → 提示稍后重试或改用本地；
  - 绝不静默切换。

---

## 5. 组件设计

### 5.1 Desktop App（Go + mygo）

- 栈：Go 1.27.3 + `github.com/egoist/mygo` v0.7.4（MIT）；纯 Go、无 cgo，壳单二进制几 MB；**外壳**不含 Node/Electron。本地执行运行时是随安装包分发的独立进程，见 §5.2。
- 形态：**完整客户端**，不是伴随程序。
  - 主窗口：mygo webview（macOS WKWebView / Windows WebView2）加载 `apps/web` 构建产物，复用全部会话、计划、表单、工件、知识库、浏览器面板与设置 UI。
  - 伴随窗口：保留现有 mygo 原生 UI（配对、设备状态、权限引导、暂停），与主窗口共存；系统级交互不走 webview。
- Go 侧职责：打包时固定服务地址、系统浏览器登录交接、单实例锁、深链 `linksense-desktop://`（登录回调、配对、会话）、托盘与菜单、窗口状态、通知、文件选择/下载、自动更新（mygo updater：签名 + delta）、崩溃日志、本地 runner supervisor、设备桥、computer-use 引擎。
- Web 侧新增：桌面宿主适配层（环境检测、mygo 生成类型化 IPC 客户端、浏览器登录交接、更新入口、本地/云目标选择、设备与权限面板）；没有桌面宿主时（纯浏览器）保持现状。
- 安全：webview 内容按不可信处理，由 mygo 的 content rules / protocol / permissions 限制导航、新窗口与外部打开；Go 只暴露显式绑定的 IPC 方法，不暴露任意文件或命令执行；CSP 沿用 Web 构建。
- 取舍：壳比 Electron 小一个数量级、无 Node 运行时；代价是 mygo 生态较小，原生 UI 能力以其 toolkit 为界，复杂页面一律放 webview。
- Windows：WebView2（系统自带）；安装器 + Authenticode 签名；SmartScreen 信誉随下载量积累，早期可能提示风险。

**与 Web 共用一套 UI（不 fork）**

- 可见界面全部由 `apps/web` 渲染：工具条内容（应用菜单、任务标题、环境 pill、操作）、侧栏、会话、设置，以及桌面新增页（设备/权限、更新）都在同一个 React 代码库里；桌面专属入口用 `isMyGo()` / host adapter 条件启用，Web 端隐藏。
- Go 只负责窗口层与系统能力：隐藏标题栏、红绿灯预留区与拖拽区、多显示器、菜单/托盘/对话框/通知/深链/更新/设备桥/runner supervisor；不用 Go 重画侧栏或聊天。
- 桌面专属页面复用现有路由、组件、设计 token 与六语言资源，不复制组件、不维护第二套 CSS；同一 PR 同时改 Web 与桌面行为。
- 约束：webview 是 WKWebView / WebView2，需在 WebKit 内核下回归（与 Chrome 有差异）；标题栏隐藏、拖拽区与红绿灯预留的具体机制在 Phase 0 用 mygo 自定义标题栏验证。
- 版本：桌面构建内嵌 `apps/web` 产物；host bridge 带版本号，Web 侧按 bridge 版本降级，避免桌面壳与 UI 版本错配。

### 5.2 Local Runner

本地执行运行时是**随安装包分发的独立进程**，不是"要求用户自己装 Node 再跑 `apps/runner`"。

**为什么不能直接复用 `standalone + local-process`**（已核对现有代码）：

- `apps/runner/src/config.ts:209` 要求 `NODE_ENV=development`；`config.ts:221` 明确拒绝 `LINKSENSE_RUNNER_MODE=standalone`。
- `local-process` provider 自述 `not isolated and must only run trusted development workloads`，且 `local-process-worker-provider.ts:132` 要求 POSIX uid/gid，Windows 无此概念。

因此新增 `LINKSENSE_WORKER_PROVIDER=desktop`，与现有两种 provider 并列：

| 维度 | `docker`（云） | `local-process`（开发） | `desktop`（新） |
| --- | --- | --- | --- |
| 隔离 | 容器 | 无 | 无，向用户明示 |
| 运行身份 | 容器用户 | POSIX uid/gid | 当前用户 |
| 生产可用 | 是 | 否（development only） | 是（本地模式） |
| 平台 | Linux | POSIX | macOS / Windows |

- 复用现有 Codex、Core MCP、workspace、事件、文件服务代码；只替换 worker 生命周期与工作区身份：不再要求 uid/gid，改为应用私有目录（`0700`）+ 单实例锁约束。
- 首次启用时明确告知：本地模式不做进程隔离，风险由 Codex 沙箱 + 审批 + 任务授权三层承担（见 §5.4.2、§7.2）。

**打包方式（Phase 0 定死，不允许"可选随包"）**：

- Node 运行时：随包内嵌固定 Node 24.22.1；使用现有 `apps/runner` 的 ESM 产物和完整生产依赖闭包，保留 Core MCP 的独立进程入口及现有文件资源路径。采用 pnpm 的 portable hoisted 部署，避免 mygo 忽略隐藏目录后丢失 `.pnpm` 依赖；在 Phase 0 用**干净机器**验证。
- `apps/runner` 构建产物与实际 native 依赖（Sharp、anydoc 等）按平台放 `resources/<os>-<arch>/`。Windows ARM64 的 Go 壳与 `agent-desktop` 引擎保持 ARM64；由于 anydoc 0.1.8 没有 Windows ARM64 binding，Node/Codex/npm 闭包暂用 x64，在 Windows 11 内置 x64 兼容运行时上执行。待上游提供绑定后再切换整套运行时并回归，Windows 10 ARM64 不满足该条件。
- Codex 沿用现有 `runtime-version.json`（0.168.0）机制，固定随包分发；资源 URL、下载 SHA-256 与实际 runtime architecture 记录在 `apps/desktop/desktop-resources.json`。
- 体积预算：内嵌 Node + runner + Codex 预计 150–250 MB；超 300 MB 需重新评估方案。
- 2026-11-17 实测与复核：macOS arm64 开发产物 DMG 174.6 MB，展开 `.app` 601.6 MB；其中 Node 122.5 MB、Codex 273.6 MB。原估计低估了展开体积，不能把安装后体积列为已达标。保留已确认的固定版本及完整随包运行方式，发布时分别核对下载量、磁盘占用与更新增量；运行时闭包已在仓库外副本通过真实 Codex/Core MCP 与本地模型 fixture 白盒，干净系统安装仍须单独验收。

**其余**：

- 会话级审批策略见 §7.2（本地按 `untrusted` / `on-request` 分档，云保持 `never`）；不再沿用全局常量 `LINKSENSE_APPROVAL_POLICY` 一刀切。
- 工作区：macOS `~/Library/Application Support/LinkSense/...`，Windows `%APPDATA%\LinkSense\...`；与云端隔离。
- **工作区生命周期**（本地磁盘会长期累积，M1 前定死）：根目录按会话一目录（`workspaces/<conversationId>`），默认保留最近 **14 天**；总量上限 **10 GiB**，超限删除最旧会话。清理在应用启动与空闲时执行；**已上传成功的工件不随工作区删除**。已清理的会话再次打开时重建空工作区并在界面明示"本地工作区已清理"。设置页显示占用并支持一键清理。

### 5.3 Desktop Device Gateway（API）

新增 `apps/api/src/modules/desktop-devices`：

- 配对：登录用户生成一次性配对码；桌面应用换取 device token（只存哈希）。
- 通道：桌面应用主动连接 `wss://api/desktop/devices/socket`；设备 token 认证、心跳、撤销。
- 命令路由：API 的 `RunnerTransport` 按 `executionTarget/deviceId` 选择 HTTP（cloud）或设备 WS（local）。
- 白名单：只允许 `turns/start`、`steer`、`interrupt`、`runtime`、`fork`、`prewarm`、`mcp-current-user/*`、`health` 等。
- 事件注入：设备回传事件 → 校验归属 → 写入现有 `ConversationEvent`；`sse_event_id` 幂等。
- 撤销：断开 WS、token 失效、终止该设备本地会话。
- **设备任务租约**：同一设备同一时刻只允许一个任务占用真实桌面。租约在首次 `computer_observe` 时获取，覆盖 observe→act 整个流程；回合结束、暂停、断线、超时、崩溃都要释放，且**不自动续跑**。第二个会话申请时返回 `DEVICE_BUSY`，UI 提示"这台电脑正在被另一个任务使用"。租约存 Redis（TTL + 心跳续期），不放进程内存——API 多 worker 时内存锁无效。
- **窗口身份校验**：每次 act 除校验 ref 外，还要确认目标窗口仍是租约开始时的应用与窗口 ID；不符返回 `COMPUTER_TARGET_CHANGED`，要求重新 observe。仅"每次 act 校验 ref"挡不住跨会话抢焦点。

### 5.4 Computer Use 引擎（Go，随桌面应用进程内）

- 参考 `feat-computer-use:apps/desktop` 的 engine 实现，在当前 `apps/desktop` 重建：以子进程调用 `agent-desktop`（`LINKSENSE_AGENT_DESKTOP_BIN`），解析 stdout JSON 并做错误归一（`COMPUTER_USE_ACCESS_DENIED` / `COMPUTER_USE_PAUSED` / `COMPUTER_USE_COMMAND_FAILED`）。
- 本期扩展：
  - 本地入口：runner 的 `computer_use` MCP 通过 loopback HTTP / Unix socket 调引擎（`status`、`observe`、`act`、`pause`、`resume`、`stop`、`permissions.request`）；只接受带 conversationId/turnId 的本地 token。
  - 任务授权：每任务 5 分钟、可续期；暂停立即停止输入；停止撤销授权。
  - 与设备桥共用同一配对身份与设备状态。
- `agent-desktop` 不直接暴露给模型；模型只看到 `computer_*` 工具。
- 详见 §14。

#### 5.4.1 `agent-desktop` 适配映射

| LinkSense 工具/动作 | 引擎调用 | 说明 |
| --- | --- | --- |
| `computer_status` | `agent-desktop --version` + `permissions` | 版本、Accessibility/Screen Recording、当前任务授权 |
| `computer_observe` | `snapshot --app <app> -i --compact`、`list-windows`、`screenshot` | 返回 `@ref` 树/窗口/截图；限制深度与元素数 |
| `computer_act` click | `click @ref` | 只能点快照中的 ref；`click_at` 仅用于无 ref 的 canvas |
| `computer_act` type | `type @ref --text ...` 或 `set-value @ref --value ...` | 优先 `set-value`；文本长度上限 |
| `computer_act` key | `press <combo>` | 仅允许白名单键 |
| `computer_act` scroll | `scroll @ref --direction ... --amount ...` | 有界 |
| `computer_act` drag | `drag @from @to` / `--headed` | 需要图形会话与用户授权 |
| `computer_act` launch | `launch --app <name>` | 应用白名单；不启动任意路径 |
| `computer_act` wait | `wait --element @ref --predicate actionable` | 有界超时 |
| 停止/暂停 | `session stop` / 撤销授权 + 停止输入 | UI 立即生效 |
| 审计 | `session`/`trace` 本地元数据 | 不把 trace 内容上传；只上报 action 摘要 |

约束：

- 引擎只允许上述子命令与参数；禁止模型传入任意 `--arg`/`--env`/`--cdp`。
- 每次 `act` 前重新校验 ref 属于当前快照/窗口；操作后由模型或引擎重新 snapshot 验证。
- 不自动批量执行 `batch`；由上层逐个工具调用，便于权限与中断。
- `agent-desktop` 的 stdout JSON 由引擎解析、裁剪、错误归一后再返回 runner。

#### 5.4.2 本地动作执行管道（参考 Mika `ActionExecutor`）

本机动作是**两层控制**，职责不能混：

| 层 | 管什么 | 强制点 | 执行位置 |
| --- | --- | --- | --- |
| Codex 原生 | 本地 Shell、文件读写、代码执行 | `sandboxPolicy` + `approvalPolicy` | Codex 自己的进程 |
| Go `ActionExecutor` | `computer_*`（GUI 自动化） | 引擎唯一入口 | 桌面应用进程 |

`ActionExecutor` 拦不到 Codex 的 Shell——那是另一个进程。所以安全承诺只能写成"两层各自成立"，不能写成"所有本机动作都经过 Go"。

- **Codex 层**：非 plan 回合现在是 `dangerFullAccess` + 全局常量 `never`（`process-pool.ts:206`、`process-pool.ts:2096`）。本地会话必须把沙箱与审批分档（见 §7.2），否则等于没有闸。
- **Go 层**：`computer_act` 全部经 `ActionExecutor`；工具层拿不到绕过它的入口（未导出类型 + 只允许 executor 构造的通行证结构）。
- **绕过测试**：用例必须覆盖"模型直接调系统自动化工具（AppleScript / PowerShell / 直调 UIA）"，确认被 Codex 沙箱或审批拦住，而不是指望 Go 层。

固定顺序：

1. 会话/设备/任务授权校验 + 暂停状态；
2. 风险判定（见下）；
3. 需要时审批（命令级或危险动作）；
4. 执行；
5. 效果核对（`effect` + 可选等待条件）；
6. 审计（动作、应用、窗口、结果、耗时；不含截图/键入原文）。

风险等级：

- `Read` 只读观察；`Change` 在本机界面内改动；`External` 把内容交给别人（发送、提交）；`Irreversible` 做了收不回（付款、下单、删除）；`Unknown` 看不清目标。
- `External` / `Irreversible` / `Unknown` 记 `outward`；审批卡的“风险”徽标、审计与可选的对外节奏都按这个等级。
- 点击类动作由引擎按目标（按钮文字、控件角色、所在应用）判级；判不出的记 `Unknown`，按高风险处理。

中断语义：

- 应用退出、崩溃或设备断线时，正在跑的本地 GUI 回合标 `interrupted`，不重放已投递动作；由用户决定是否新开回合。
- runner 已发出但未收到结果的命令记 `UNCERTAIN`，不自动重试。

对外节奏（可选，默认关，不进 MVP）：同一应用/站点连续 `outward` 动作之间加 8–20 秒随机间隔，最近 30 分钟递增，上限 30 秒。

### 5.5 Cloud Runner（现有）

- 不新增 Cloud Computer Gateway/Windows Agent/WebRTC。
- 复用现有 Docker worker；只在 API 侧增加会话目标路由与 UI 入口。
- 如果未来要做“可视化云桌面”，见 §15.1 的扩展路径。

### 5.6 UI

- 复用现有会话页；新增：
  - 环境选择器（本地电脑/云电脑）放在**输入区**，顶栏显示当前环境状态；每次新建可在输入区切换；
  - 设备设置页（配对、状态、权限、撤销）；
  - 本地电脑状态卡：权限、任务授权倒计时、暂停/停止；
  - 权限卡片：作用域、原因、风险、拒绝/允许一次/本次会话（主）；“始终允许”收在“更多”里；超时自动拒绝；
  - 审计页：computer 操作元数据（不含截图/输入内容）；
  - 云模式沿用现有 Web 会话、浏览器面板、工件/文件视图。

**环境切换（参考豆包工作 `chat_window_mode_select` / `chat_window_runtime_environment`）**

- 切换必须显式确认：中途不改变正在运行的目标；确认后用 continuation 新建会话，原会话不动。
- 确认框说明影响：文件不自动同步、云电脑有独立文件系统、本次切换写审计、可随时切回。
- 云电脑入口受功能开关控制（对应 `desktop_cloud_computer`）；不可用时提示并保留本地。
- 云电脑首次使用：探测 → 初始化（30–60 秒）→ 就绪；失败或用户拒绝记录原因，并可回落本地。
- 本期不做云桌面可视化：云模式展示容器文件、Shell 输出与 headless 浏览器面板，不提供桌面视频/接管；未来 Linux 云桌面路径见 §15.1。
- 本地模式展示 computer use 卡片（观察/操作/暂停）；云模式展示云文件与浏览器面板入口。

**视觉基线**：浅色 A（豆包浅蓝白）+ 深色 C（豆包深色），同一套 token 与组件；token、组件状态与交互规则以本节和 §5.7 为准，本地设计评审稿在 `docs/design/desktop-ui/`（未入库）。

- 六语言；键盘可达；焦点可见；`prefers-reduced-motion`。

### 5.7 完整客户端范围（桌面产品面）

**主窗口页面**

- 复用 Web 路由与组件：会话列表与详情（对话、计划、表单、工件）、知识库、浏览器面板、设置；登录/注册在系统浏览器完成，桌面内提供登录交接页。
- 桌面新增页面：设备与权限（配对、在线状态、任务授权、授权记录、撤销）、本地电脑状态、更新、关于/诊断。
- 桌面隐藏或外跳：需要独立浏览器窗口的流程（支付、第三方 OAuth 页面、营销页）交给系统浏览器。

**壳能力（Go 侧）**

| 类别 | 能力 |
| --- | --- |
| 窗口 | 单实例；主窗口尺寸/位置恢复；可选“关闭到托盘”；多显示器；全屏 |
| 导航 | 深链 `linksense-desktop://`（登录回调、配对、会话跳转）；菜单栏；快捷键；外链走系统浏览器 |
| 文件 | 打开/保存对话框；拖拽上传；下载到本地；在 Finder 中显示；最近文档 |
| 系统 | 托盘菜单（打开、新建会话、暂停 computer use、退出）；通知（回合完成、权限请求、更新）；全局暂停快捷键；跟随系统主题/语言 |
| 生命周期 | 启动恢复会话；随应用启停本地 runner；崩溃日志本地留存；诊断包导出 |
| 更新 | 后台检查；签名校验；delta 下载；重启安装；stable/beta 渠道（见 §5.10） |

**登录与账号**

- 服务 Base URL 在打包时注入，安装后的运行时环境和旧配置文件均不能覆盖；首次启动不向用户索要 URL。构建命令见 `apps/desktop/README.md`。
- 登录打开系统浏览器，已有有效会话直接复用；未登录时使用现有 Web 登录/注册和企业/第三方登录。
- 登录交接使用短时一次性授权码、随机 state 和 S256 PKCE，只允许 `linksense-desktop://auth/callback`；Go 不启动回环监听。浏览器若拦截自动打开，页面保留“返回客户端”入口。登录五分钟超时并支持取消；授权码 60 秒到期，跨 API 副本原子消费，兑换时再次校验账号状态与认证 epoch。URL 不含 access/refresh token；verifier 仅保存在原生内存。
- 客户端创建独立 refresh session，refresh token 存系统 Keychain（mygo secrets），access token 只在内存；不读取或复制浏览器 Cookie。完成后恢复客户端焦点，后续启动静默刷新；客户端退出不退出系统浏览器。
- 过期静默刷新；退出登录清理本地 token；设备与账号绑定，退出时提示是否同时解绑。
- 一期单账号；切换账号需重新登录并重新配对本地设备。

**离线与弱网**

- 会话事件始终经 API + SSE，即使 agent 在本地；因此**云端 API 不可达时本地模式也不可用**（一期明确提示，不做纯离线会话）。
- SSE 断线自动重连（现有断点）；设备离线时提示切换云电脑；云 runner 不可用时提示切换本地。

**首次启动引导**

1. 进入使用固定服务地址的客户端，通过系统浏览器完成登录。
2. 设备命名与配对（准备使用本地模式时）。
3. 系统权限：仅在 M1b 首次启用 GUI 时检测/请求；macOS 辅助功能 + 屏幕录制，Windows 受完整性级别约束。M1 跳过此步。
4. 连接浏览器（可选）：安装 Chrome/Edge 扩展并在系统浏览器里完成配对。
5. 默认执行目标（本地/云）。
6. 进入主界面。

**诊断与遥测**

- 结构化日志 + 脱敏；崩溃上报开关；诊断包（版本、设备、权限状态、最近错误码），不含截图、键入内容、token。
- 不采集会话内容。

**客户端范围外**

- 不做多窗口会话（Phase 3 可选）、内置终端、PIP 云桌面、Linux 客户端。
- 不做离线本地会话。

### 5.8 Browser Use（扩展 + 内置浏览器）

- **复用现有实现**：Chrome/Edge Manifest V3 扩展（127+），配对 `/api/v1/browser-use/pair`、`/socket`，凭据哈希存 Redis，tab 级授权、虚拟指针、截图浮窗、站点信任与撤销。规范以 [本地 Browser Use](../development/browser-use.md) 为准。
- **不内嵌浏览器**：桌面应用不打包 Chromium、不做内置标签页；扩展开在用户自己的 Chrome/Edge 里，操作的是用户已登录的真实页面。
- **桌面端职责**：
  - “设置 → 浏览器扩展”页在 webview 内复用；桌面宿主适配层提供“在系统浏览器中打开 LinkSense”（`Shell.OpenExternal`）用于扩展自动配对，以及扩展下载入口。
  - webview 的 UA 不是 Chrome/Edge，现有扩展检测会判为不支持；桌面内改用**桌面专用引导**（打开系统浏览器 → 登录同一账号 → 扩展自动连接），状态沿用现有连接状态接口展示。
  - 首次启动引导提供可选“连接浏览器”步骤；未连接不影响本地/云模式。
- **执行链路**：本地模式 `browser_use` Core MCP → 本地 runner → 设备桥受限请求（§6.7）→ API → 扩展 WSS；设备桥只承载请求/响应，扩展授权与执行仍归 API/扩展。云端模式仍是容器内 headless Chromium。
- **权限**：沿用 tab 级授权、任务归属、解除共享与撤销；桌面端只展示状态与入口。
- **平台**：macOS/Windows 相同，取决于用户安装的 Chrome/Edge。
- **内置浏览器**：客户端另带一个独立窗口的内置浏览器，供应用内打开链接与隔离浏览；Agent 可操作，但不替代扩展。详见 §5.11。

### 5.9 mygo 能力清单（可直接用）

依据 mygo v0.7.4 文档（`mygo.run/docs`）与 `examples/`。只列与本项目直接相关的：

| 能力 | mygo 提供 | LinkSense 用法 |
| --- | --- | --- |
| Web 前端内嵌 | 构建时把前端打进二进制；自定义协议；页面信任模型（`PageOptions.TrustedOrigins` / `Untrusted`） | 主窗口装 `apps/web` 构建；用户内容（HTML 预览、插件 UI）一律 `Untrusted` |
| 类型化 IPC | `mygo.Bind` + 生成的 TS 客户端；`isMyGo()`、`runtime()`、`currentWindow` | 桌面宿主适配层：只在 `isMyGo()` 时启用；Go 只绑定明确方法 |
| 事件 / 通道 | `mygo.Event` 的 `Broadcast`/`Emit`/`EmitPage`；`Channel` 流式值 | 更新进度、设备在线状态、任务授权倒计时推给页面 |
| 原生 UI | `ui` 包（flexbox/grid、控件、文本编辑、可访问性、动画）；`embed-webview` 示例演示原生壳内嵌 webview | 伴随窗口；复杂页面放 webview，原生只做系统级交互 |
| 窗口 / 菜单 / 托盘 | 窗口选项与状态、应用菜单、上下文菜单、托盘与 flyout、`menubar-*` 示例 | 托盘菜单（打开、新建会话、暂停、退出）、关闭到托盘 |
| 系统集成 | 对话框、通知、剪贴板、Shell（开浏览器/Finder）、显示器、深链 `OnOpenURL`、单实例 `RequestSingleInstanceLock`、文件关联、最近文档、拖放（带路径）、全局快捷键、主题/强调色/减少动态、电源、网络代理 | §5.7 的壳能力清单逐项对应，不需要自己写平台代码 |
| 安全存储 | `mygo.Secrets`（macOS Keychain / Windows Credential Manager，单条 ≤2560 字节） | 登录 token、device token；超限则文件加密 + 密钥进 Secrets |
| i18n | 原生 UI 的 `locales/` 目录；`mygo.locale` / `onLocaleChange` 注入页面 | 六语言与 Web 对齐；伴随窗口复用现有 catalog |
| 资源打包 | `resources/<os>-<arch>/` 平台目录；helper 可执行随包并一起签名 | `agent-desktop` 按平台放入；本地 runner 可选随包 |
| 打包 / 签名 | macOS `.app`/DMG、Developer ID + notarytool；Windows NSIS 安装器（per-user `%LOCALAPPDATA%\Programs`）、Authenticode（PFX / `signtool` / `osslsigncode` / Azure Trusted Signing `signCommand`） | Phase 1 发布；Windows 免管理员安装，便于自更新 |
| 更新 | 见 §5.10 | 应用内更新 |
| CI | `docs/github-actions.md` 提供构建、签名、公证、上传的 workflow | 双平台流水线 |

参考示例：`embed-webview`（原生壳 + webview 混排）、`markdown-chat`（流式聊天）、`chart-streaming`（Channel 流）、`menubar-flyout`（托盘）、`drag-drop`（文件拖入路径）。

### 5.10 应用内更新（自动更新）

- **机制**：`mygo build` 用更新密钥签名每个平台的产物；应用内嵌公钥，`mygo.Updater.Check/Install` 校验签名后替换自身；支持 bsdiff delta（默认最近 3 个版本），delta 校验失败自动回退整包；逐文件 SHA-256 校验，结果与发布版本完全一致。
- **发布源**：`updates.github`（公开仓库 + `tagPrefix: desktop-v`）或自托管 `updates.url` + `updates.s3`（S3 兼容：R2 等）。建议主源用自托管对象存储 + CDN（国内可达），GitHub 作为内部/备用；`mygo build -upload` 直接上传 archives、deltas、manifest、install 脚本。需要账号鉴权或自定义渠道时用 `Updater.SetSource`（仍校验同一把更新公钥）。
- **渠道**：stable = latest release；beta = prerelease + `Updater.SetPrereleases(true)`（用户选择持久化在设置里）。切换渠道不回退旧版本。
- **UI**：优先复用 mygo updater 插件（Sparkle 风格窗口：版本说明 Markdown、安装/跳过/稍后）；也可以在 Web UI 里做自定义横幅：`Check` → 显示 notes → `Install` 进度事件 → `App.Relaunch`；菜单提供“检查更新…”，启动后延迟检查一次，之后每 6–24 小时一次（含手动）。
- **安装位置**：`Enabled()` 只在应用可写时返回 true——macOS `/Applications` 或 `~/Applications`；Windows per-user 安装目录。只读位置或开发构建降级为“下载安装包”链接，不静默失败。
- **升级范围**：应用二进制、内嵌前端、`resources` 里的 `agent-desktop` 与本地 runner 一起升级；Chrome/Edge 扩展独立更新（设置页重新下载）。客户端上报版本，API 对过旧版本给升级提示但不强制。
- **与进行中的本地回合互斥**（M1 必须）：下载与校验可后台进行；**安装/重启只在没有运行中的本地回合时执行**。有回合时状态机进入"待回合结束"并提示，用户也可显式选择"结束当前回合并安装"——按中断处理，重启后不续跑。Windows 安装器必须等本地 runner 退出后再替换 `resources/` 文件；启动时若检测到更新半完成，回退到当前版本。
- **安全**：更新私钥只存密码管理器与 CI secrets，不进仓库；公钥固定在构建里；拒绝未签名、篡改与降级；只走 HTTPS；日志不打印密钥与签名内容。
- **发布流程**：CI 在 macOS runner 签名 + 公证、在任何 runner 交叉构建 Windows 并 Authenticode 签名 → 上传为 draft/prerelease → 内部验证 → 转 latest；保留最近 3 个版本供 delta。
- **已知限制**：GitHub 源的检查受 60 次/小时/地址限制（自托管 `url` 无此限制）；delta 构建时需要能读取已发布 manifest，失败则本次不产 delta（整包更新仍可用）。
- **UI 状态机**（已是最新 / 可更新 / 下载中 / 待重启 / 待回合结束 / 检查失败 / 只读安装位置）：可更新时展示增量/完整大小与验证点；失败保留当前版本；只读安装位置降级为下载安装包。设置页布局见本地设计评审稿 `docs/design/desktop-ui/`（未入库）。

### 5.11 内置浏览器（客户端自带）

**定位**：三种浏览器面并存，不互相替代。

| 面 | 用途 | 登录态 | Agent 自动化 |
| --- | --- | --- | --- |
| 内置浏览器 | 应用内打开链接、隔离浏览、不想动用户主浏览器 | 应用自有隔离会话 | 可操作（DOM/JS，坐标兜底） |
| 用户真实浏览器（扩展） | 需要用户登录态、复杂站点、上传/验证码 | 用户 Chrome/Edge | 现有 `browser_use` |
| 云模式 | 容器内执行 | 容器内 | headless Chromium + 现有 browser panel |

**窗口与能力**

- 独立原生窗口：`WindowOptions.Content`（native UI）+ `Window.NewWebView`，不复用主窗口；主窗口仍是整页 webview，**不改成 native UI**。
- 工具条：后退/前进/刷新/停止、地址栏、标签页（每个标签一个 webview）、下载、页内查找、缩放；DevTools 仅开发构建。
- 会话：`mygo.NewSession("browser")` 独立 cookie/storage，不共享应用 webview；设置里可清空；可选 ephemeral。
- 下载：`Page.OnWillDownload` 确认后落盘到下载目录；`mailto:` 等外部协议交给系统。
- 链接：应用内链接默认内置浏览器打开；`target=_blank` 新标签；设置可改回系统浏览器。

**Agent 操作**

- 沿用现有 `browser_use` 工具语义（navigate / read / click / type / scroll / screenshot / wait），按 `browserTarget=builtin|extension` 路由；默认扩展，内置浏览器由用户显式选择或在其中发起任务。
- Go 侧注入 DOM agent（`Page.Eval`）：可见文本、可交互元素 + 稳定 ref、边界框、角色；限制元素数与文本长度。
- 点击优先 JS（`element.click()` + 合成事件）；站点要求 trusted event 或 JS 失败时，回落到 computer-use 引擎在窗口坐标上真点击（复用现有授权与暂停）。
- 输入优先设置 value + `input` 事件；需要真实键盘时回落到 computer-use 引擎。
- 截图用 `CapturePage`；等待用 DOM/URL 条件，默认 8 秒、上限 20 秒。
- 不支持：跨域 iframe 内部、文件上传自动化、网络拦截、扩展 API；遇到时返回稳定错误码并建议改用扩展浏览器。

**安全**

- 第三方页面 `PageOptions.Untrusted`：页面不能调用 Go 绑定；注入脚本只经 `Eval` 返回值通信。
- 独立会话；禁止 `file://` 与自定义协议导航；外链默认拦截；下载需确认；生产禁用 DevTools。
- 审批沿用动作风险：页面内点击/滚动 `Change`，提交表单/发送 `External`，付款/删除 `Irreversible`。
- 审计记录域名、动作、结果；不记录页面正文与键入原文。

**已知限制**

- 不是 Chromium/CDP：没有网络拦截、跨域 iframe 访问、文件上传自动化；复杂 SPA 与反爬站点成功率低于扩展。
- macOS WKWebView 与 Windows WebView2 在 UA、下载、媒体、权限上有差异，需双平台回归。
- 因此**扩展仍是默认**，内置浏览器是补充，不替代。

---

## 6. 协议设计

### 6.1 设备凭据模型（先于 6.3 定稿）

**原则**：设备只拿"绑定用户 + 会话 + 用途"的短期凭据；平台级密钥永远不出服务端。

**现状（已核对）**，现有 HTTP 契约不能原样搬到用户机器：

- `RunnerStartInput.modelProvider.apiKey`（`apps/api/src/adapters/runner.ts:220`、`279`）会随 start 入参抵达 runner；`process-pool.ts:5541` 用它签发 model gateway lease。`modelProvider.memoryExtraction.apiKey`（`packages/shared/src/model-provider.ts:484`）与 `modelTransitionSource.provider.apiKey`（`apps/api/src/adapters/runner.ts:245`）也携带供应商密钥，只删除主模型字段仍会泄露。
- runner 回调 `/internal/*` 用 `Bearer ${sharedSecret}`（`apps/runner/src/event-sink.ts:881`），而这是**全局单一**的 `LINKSENSE_RUNNER_SHARED_SECRET`（`apps/api/src/config.ts:408`），后面挂着几十条内部路由（`apps/api/src/app.ts:569`–`669`）。
- 设备配对码与 TLS 只解决"谁能连"，解决不了"连上之后拿到什么"。任何一个落进用户机器，等于把内部 API 的万能钥匙发出去。

**设计**：

| 凭据 | 签发方 | 绑定 | TTL | 能做什么 |
| --- | --- | --- | --- | --- |
| device token | API（配对时） | 用户 + 设备 | 长期，可撤销 | 只连接设备 WS；不调业务 API |
| run lease | API（每回合） | 用户 + conversationId + turnId + deviceId + 操作范围 | 单回合 + 余量（默认 10 分钟） | 接收该回合命令、回传事件、调用 §6.7 中获授权的工具操作 |
| model proxy token | API（随 run lease） | run lease + 用途 + 模型/供应商版本 | 同 run lease | 只调绑定用途的服务端模型代理，不能调用业务工具 |

- **设备入参**：在 `packages/shared/src/desktop-device.ts` 定义独立的严格 Zod schema，由白名单字段构造设备请求；不能展开内部 `RunnerStartInput`/provider 对象再删除少数字段。云 Runner 的内部契约保留。设备契约不接受任何真实供应商 `apiKey`，未知字段拒绝。
- **模型调用**：主模型、记忆提取、模型切换来源分别下发所需的代理地址、模型标识、用途与短期 token，真实供应商及其版本由服务端绑定并校验。设备适配器将代理 token 传给本地 model gateway；即使内部适配参数仍叫 `apiKey`，值也只能是该用途的代理 token。可复用现有模型协议适配逻辑与 `modelGateway.issueLease`，但服务端受限代理入口、鉴权和撤销校验需要实现，不能把本地 loopback gateway 当成已有的服务端入口。
- **事件回传**：走设备 WS 通道本身，不再用 `/internal/*` + 全局 secret。设备永远不持有 `LINKSENSE_RUNNER_SHARED_SECRET`。
- **工具请求**：通过 §6.7 的请求/响应通道调用服务端业务能力，事件帧不代替工具请求，设备也不能指定任意内部 URL。
- **撤销**：run lease < device token < 会话/用户。停止会话、断线超时、撤销设备都立即失效，且已发出的命令不重放。
- **验收**：正常对话、开启记忆提取、切换模型三种路径均检查设备侧进程内存、日志、配置文件与抓包，确认没有真实供应商密钥、没有 `/internal` secret、没有其他用户/会话的凭据；设备 schema 拒绝未知字段和嵌套内部 provider，云端契约回归通过。

### 6.2 设备通道

TLS WebSocket，JSON 帧：

```text
C→S hello        { deviceId, token, appVersion, protocolVersion, platform, arch, capabilities }
S→C hello.ok     { ownerId, serverTime, heartbeatIntervalMs, maxFrameBytes }
C→S heartbeat    { at }
S→C command      { id, conversationId, method, path, headers, body, expiresAt }
C→S command.result { id, status, headers, body }
S→C command.cancel { id, reason }
C→S event        { conversationId, event }
S→C event.ack    { id }
C→S tool.request { id, runLease, conversationId, turnId, operation, body, expiresAt }
S→C tool.result  { id, ok, data?, error_code? }
C→S tool.cancel  { id }
C→S control.request { id, operation, body, expiresAt }
S→C control.result  { id, ok, data?, error_code? }
C→S control.cancel  { id }
```

约束：命令与工具操作分别使用白名单和严格 schema；`commandId`/工具请求 ID 唯一 + 短 TTL；会话归属校验；帧大小上限（大文件走 HTTPS 预签名）；设备撤销立即生效。工具请求的关联、取消与断线语义见 §6.7。

### 6.3 RunnerTransport 抽象

```ts
interface RunnerTransport {
  request<T>(input: {
    conversationId: string
    ownerId: string
    method: string
    path: string
    body?: unknown
    idempotencyKey?: string
    signal?: AbortSignal
  }): Promise<T>
}
```

- `HttpRunnerTransport`：现有 `RunnerClient`（cloud）。
- `DeviceRunnerTransport`：设备 WS（local）。
- 路由：`Conversation.executionTarget` + `desktopDeviceId`。
- 设备方向的 body 按 §6.1 的独立设备 schema 由白名单字段构造；主模型、记忆提取与模型切换来源均只带代理配置，不转发内部 provider 对象或任何 `/internal/*` 凭据。
- 错误语义复用现有 `RUNNER_UNAVAILABLE` / `RUNNER_OPERATION_UNCERTAIN`：
  - 设备不在线 → `RUNNER_UNAVAILABLE`（可重试）；
  - 命令已发出、连接在收到结果前断开 → `RUNNER_OPERATION_UNCERTAIN`（不重发，UI 提示“可能已执行”）。
- 同一连接按 requestId 去重；离线不积压命令；参考上限：正文 1 MiB、单请求超时 65 秒、并发 8。

### 6.4 Computer Tool（仅本地）

`packages/shared/src/computer-use.ts`：

- `computer_status` → `{ available, permissions, activeGrant, agentDesktopVersion }`
- `computer_observe` → `{ apps, windows, tree?, treeQuality: good|partial|unusable, screenshot? }`
- `computer_act` → `{ action: click|type|key|scroll|drag|launch|wait, ref?, x?, y?, text?, key?, expect?, expectGone?, waitStable?, timeoutMs? }` → `{ ok, effect: done|small_change|no_effect|place_changed, wait?: { result: met|stopped|timed_out, waitedMs }, limitReached?, error?, screenshot? }`

规则：Plan 模式只读；每次 act 绑定 `toolCallId/turnId`；不确定结果不重试；模型按 `@ref` 操作，坐标只用于无 ref 的 canvas；引擎校验授权与暂停状态。

- `expect` / `expectGone` / `waitStable` 由引擎执行并读回，默认 8 秒、上限 20 秒；不把“等界面”变成模型轮询。
- `no_effect` 不自动重试同一动作；结果提示模型换做法。`limitReached` 表示屏上出现次数/频率限制文案，当前回合停在这一步。
- `treeQuality` 不足（自绘界面、canvas）时，引擎附截图并提示改用坐标/视觉定位；不静默返回空树。

云模式不提供 `computer_use`；现有浏览器工具有 `browser_use`（headless Chromium），文件/Shell 走现有工具。

### 6.5 会话事件

复用 `ConversationEvent`，本地新增：

```text
computer.session.updated
computer.permission.requested
computer.permission.resolved
computer.action.started
computer.action.finished
approval.requested
```

`approval.requested` 携带审批请求 ID、原生请求方法与对应的已脱敏展示字段；命令与文件变更按 §7.2 分别校验决策。回答走 §8.2 的审批接口，完成后复用现有 `serverRequest/resolved`。

截图/视频帧不写事件流水；只存元数据。旧客户端忽略未知事件；新增字段可选。

### 6.6 本地文件与工件链路

现有文件服务假设 API 与 runner 共享磁盘：`apps/api/src/modules/files/service.ts:983` 在 API 机器上 `realpath` 工作区路径并读文件字节。本地 runner 在用户电脑上，这条路径不存在，工件注册会直接失败；反向地，服务端工作区的输入附件也不会自动出现在设备上。

链路改为四条，全部带归属校验：

| 方向 | 触发 | 做法 |
| --- | --- | --- |
| 输入附件下发 | 回合开始前 | API 按 turn 生成附件清单 + 预签名下载 URL，随 start 入参下发；设备落到本地工作区后回 `ready` |
| 工件上传 | 回合中/结束 | runner 发现新文件 → 设备桥上传（预签名直传优先）→ API 校验 size/mime/sha256 → 返回 `artifactId` |
| 路径→资源映射 | 事件投影 | 事件里的 `workspaceRelativePath` 在 API 侧换成 `artifactId`/URL 再给前端；前端不再看到本地绝对路径 |
| 技能/插件包 | 会话启动 | 现有能力包按 revision 下发到设备缓存目录，校验同云端同源 |

约束：

- 上传必须由 API 确认后才算注册成功；未确认的文件不进工件列表。
- 单工件上限沿用现有 `upload.maxFileSizeBytes`；超出走预签名分片。
- 本地绝对路径只在设备侧存在，不进事件、不进日志、不进模型上下文。
- 同名不同内容不做自动合并，以 turn 归属为准（模式切换文件不连续，见 §11）。

### 6.7 Core MCP 受限请求/响应通道

`HttpRunnerEventSink` 除事件发布外，还承载 Browser Use、知识库、网页搜索、连接器、技能管理等业务请求（例如 `apps/runner/src/event-sink.ts:553` 的 `/internal/browser-use/execute`）。撤掉全局共享密钥后，这些请求也必须迁移。

- **链路**：Core MCP → 本地 runner 的设备回调适配器 → Go 设备桥 `tool.request` → API 设备网关 → 现有领域 service → `tool.result` 原路返回。云 Runner 保留现有 `HttpRunnerEventSink`；本地适配器同时覆盖启动确认、心跳、退出报告等现有必要控制回调。
- **操作白名单**：依据 `RunnerEventSink` 的真实调用方逐项登记 Browser Use、知识库、网页搜索、连接器、文件/工件确认、技能管理及其他已启用工具；每项都有独立的输入/输出 schema、超时和取消处理。设备只提交稳定操作 code，不提交任意 `/internal/*` 路径、请求头或服务端身份。
- **授权**：API 从已认证连接取得 device/owner，校验 run lease、conversationId、turnId、操作范围与当前状态，再执行已有的资源归属和权限检查。设备心跳等无 turn 控制回调使用绑定连接的 `control.request`，仅允许独立控制白名单；涉及会话的启动确认/退出报告另验设备绑定及实际运行记录，不能借控制帧执行业务工具或伪造 turn。停用、过期、撤销及跨会话请求必须在业务副作用前拒绝；模型代理 token 不能调用这条通道。
- **结果与中断**：工具请求 ID 绑定设备、回合和操作，响应按 ID 关联；超时或取消时中止可取消工作并清理等待项，迟到响应不交给其他请求。断线不自动重放有副作用的请求；结果不明返回稳定错误，沿用当前回合处理，不增加 Codex 回合或重新提交用户输入。
- **文件与审计**：文件字节按 §6.6 传输，工具帧只传资源 ID 与已校验元数据。审计记录操作 code、范围与结果，不记录 token、完整工具参数或原始内部响应；只返回现有领域契约允许的数据。
- **M1 验收**：本地回合分别完成扩展 Browser Use、知识库查询、网页搜索与连接器调用；使用 fake service 覆盖已登记的其余回调。覆盖跨用户/回合、未授权操作、过期、撤销、超时、取消、断线后迟到响应与副作用不重放；设备始终不持内部共享密钥。

---

## 7. 权限与安全

### 7.1 能力矩阵

| 能力 | 本地电脑 | 云电脑（Docker） |
| --- | --- | --- |
| filesystem | 本地工作区/授权目录 | 容器工作区 |
| shell | 本地 shell（命令级审批，见 §7.2） | 容器 shell（`approvalPolicy: never`） |
| browser | 用户 Chrome/Edge 扩展；内置浏览器（隔离会话） | headless Chromium |
| computer.observe/act | 本地桌面（agent-desktop） | 不提供 |
| clipboard | 本地（需授权） | 容器内（现有工具） |

### 7.2 本地权限

- 产品模式：`ask_always` / `ask_on_risk` / `full_access`。
- 能力：`computer.observe`、`computer.act`、`computer.launch`、`computer.clipboard`。
- 范围：应用、目录、动作、时间（5 分钟任务授权）。
- OS 权限（参考豆包 `INIT_LOCAL_APP` 的“检查 → 确认 → 复查 → 回传”）：
  - 首次进入本地会话时自动检测 Accessibility / Screen Recording，显示 0/2–2/2 状态；
  - 分项说明用途，提供系统设置深链；“重新检测”不重启会话；Screen Recording 授权后提示需重启应用生效；
  - 检测失败或用户拒绝：记录原因，提供“先用云电脑”，不重复弹窗；
  - Windows 无 TCC 等价授权，受进程完整性级别约束（提权应用可能不可操作）。
- 单应用授权：默认只给 **一次 / 本次会话**；**“始终允许”需显式开启**（确认卡展开或设备设置），按应用（bundle id/包名）授权，最长 30 天自动过期，设置里可查看/撤销、撤销立即生效；付款、删除、`Unknown`、工作区外写入、`sudo` 等高风险动作不吃“始终”，仍逐次确认。整桌面接管单独确认（对应 `MAIN_DESKTOP_PERMISSION`）。
- **沙箱与审批分档**（两层控制，见 §5.4.2）：
  - 云会话：容器边界，`approvalPolicy=never` + 现有策略不变。
  - 本地严格档（默认）：沙箱 `workspaceWrite`（工作区外只读），审批 `untrusted`——只有信任命令集免问，其余逐次确认。
  - 本地宽松档（`full_access` 产品模式，需显式开启）：沙箱 `dangerFullAccess` + 审批 `on-request`，只约束模型主动升级的请求。
  - 只改审批不改沙箱等于没有闸：`dangerFullAccess` + `on-request` 不会产生逐次确认。
- **命令与文件变更审批（本地，参考小浣熊 §8.3）**：
  - 由 Codex app-server 原生发起审批请求，LinkSense 不另造一套审批语义。
  - 以原生请求方法区分命令与文件变更，审批事件、待处理记录、API 入参及 runner 回答都携带并校验请求类型；决策按锁定的 Codex 0.168.0 v2 对应 schema 验证。
  - **命令审批**：使用 `CommandExecutionApprovalDecision`；确认卡展示完整命令、cwd、涉及路径和提权/联网信息。常用决策为 `accept` / `acceptForSession` / `decline` / `cancel`；原生请求提供且符合本地权限策略时，才展示 `acceptWithExecpolicyAmendment`（结构化前缀规则，默认收在"更多"）。原生网络规则修订 `applyNetworkPolicyAmendment` 也只按该请求提供的结构化决策处理，不能替代文件审批。
  - **文件变更审批**：使用 `FileChangeApprovalDecision`，只接受 `accept` / `acceptForSession` / `decline` / `cancel`；卡片展示原生请求提供的变更路径/范围，不提供命令前缀规则的"始终允许"。API 与 runner 都拒绝给文件请求提交 `acceptWithExecpolicyAmendment` 或网络规则修订。
  - UI 只展示当前原生请求及产品权限策略允许的选项，不能把命令决策集合复用于文件变更。
  - 超时映射 `cancel`，不是 `decline`：`decline` 是用户拒绝，`cancel` 是请求作废，两者在 native 侧语义不同。
  - 同一会话串行审批；拒绝结果回传模型且不自动重试；审批与决策写审计（只记命令摘要，不记完整输出）。
  - **撤销要回到 native**：`acceptWithExecpolicyAmendment` 会写进 Codex 的规则表，撤销"始终允许"必须同时下发 native 规则更新，不能只删本地记录；验收覆盖"撤销后同一命令再次触发确认"。
  - 链路：runner 收到 Codex 审批请求 → API 写入会话事件 → SSE → 桌面/webview 确认卡 → 回答经 `RunnerTransport` 回传 runner → Codex；云会话不暴露该链路。
- 执行端：引擎在每次 act 前校验授权、OS 权限、暂停状态；UI 只负责展示与回传。

### 7.3 云模式权限

- 沿用现有 Docker runner 的容器/工作区边界、Core MCP 授权、文件服务校验。
- 不新增云桌面权限；没有“接管云桌面”概念。

### 7.4 安全

- 设备配对码一次性、短 TTL、限速；device token 只存哈希；Keychain；撤销即时。
- 本地引擎只监听 loopback/Unix socket；只接受带 conversation/turn 的本地 token；不暴露公网。
- `agent-desktop` 子进程受进程树/权限约束；引擎做 action allowlist；不把 CLI 直接交给模型。
- 审计只记录 action/app/window/结果 code/耗时，不记录截图、剪贴板、键入原文。
- 云模式沿用现有 runner 的日志脱敏、工作区隔离与容器安全策略。
- UI 显示“Agent 正在控制本地电脑”；提供全局停止快捷键/暂停。
- 内置浏览器使用独立会话与 `Untrusted` 页面；禁止 `file://`/自定义协议导航；下载需确认；生产禁用 DevTools；页面正文与键入不写审计。

---

## 8. 数据模型与 API

### 8.1 Prisma（新增，非破坏）

```prisma
model DesktopDevice {
  id               String   @id @default(uuid()) @db.Uuid
  ownerId          String   @map("owner_id") @db.Uuid
  name             String   @db.VarChar(120)
  platform         String   @db.VarChar(32)
  arch             String   @db.VarChar(32)
  appVersion       String   @map("app_version") @db.VarChar(40)
  capabilitiesJson Json     @default("{}") @map("capabilities_json") @db.JsonB
  tokenHash        String   @map("token_hash") @db.VarChar(64)
  lastSeenAt       DateTime? @map("last_seen_at") @db.Timestamptz(6)
  revokedAt        DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdAt        DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  @@index([ownerId, revokedAt], map: "desktop_devices_owner_revoked_idx")
  @@map("desktop_devices")
}

model DesktopDevicePairing {
  id        String   @id @default(uuid()) @db.Uuid
  ownerId   String   @map("owner_id") @db.Uuid
  codeHash  String   @map("code_hash") @db.VarChar(64)
  expiresAt DateTime @map("expires_at") @db.Timestamptz(6)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(6)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@index([ownerId, expiresAt], map: "desktop_pairings_owner_expiry_idx")
  @@map("desktop_device_pairings")
}

model LocalComputerSession {
  id             String   @id @default(uuid()) @db.Uuid
  ownerId        String   @map("owner_id") @db.Uuid
  conversationId String   @map("conversation_id") @db.Uuid
  deviceId       String   @map("device_id") @db.Uuid
  status         String   @db.VarChar(24)
  grantScope     String   @map("grant_scope") @db.VarChar(24)
  expiresAt      DateTime? @map("expires_at") @db.Timestamptz(6)
  endedAt        DateTime? @map("ended_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@index([conversationId, status], map: "local_computer_sessions_conversation_status_idx")
  @@map("local_computer_sessions")
}

model ComputerPermissionGrant {
  id             String   @id @default(uuid()) @db.Uuid
  ownerId        String   @map("owner_id") @db.Uuid
  conversationId String?  @map("conversation_id") @db.Uuid
  deviceId       String?  @map("device_id") @db.Uuid
  capability     String   @db.VarChar(48)
  scope          String   @db.VarChar(24)
  targetJson     Json?    @map("target_json") @db.JsonB
  expiresAt      DateTime? @map("expires_at") @db.Timestamptz(6)
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@index([ownerId, conversationId, revokedAt], map: "computer_grants_owner_conversation_idx")
  @@map("computer_permission_grants")
}
```

`Conversation` 新增：

```prisma
executionTarget String @default("cloud") @map("execution_target") @db.VarChar(16)
desktopDeviceId String? @map("desktop_device_id") @db.Uuid
```

现有会话默认 `cloud`，行为不变；桌面端新建可传 `local`。

### 8.2 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/desktop/devices/pairing` | 登录用户生成配对码 |
| POST | `/desktop/devices/pair` | 桌面应用换 device token |
| GET | `/desktop/devices` | 设备列表/在线状态 |
| PATCH | `/desktop/devices/:id` | 修改本人未撤销设备的显示名称 |
| DELETE | `/desktop/devices/:id` | 撤销设备 |
| GET | `/desktop/devices/socket` | 设备 WS |
| POST | `/conversations/:id/local-computer` | 启动本地电脑会话/授权 |
| DELETE | `/conversations/:id/local-computer` | 停止/撤销 |
| GET | `/conversations/:id/local-computer` | 状态/权限 |
| POST | `/conversations/:id/computer-permissions` | 授权/撤销 |
| POST | `/conversations/:id/approvals/:requestId` | 回传审批请求类型及决策（仅 local）；按 §7.2 的命令/文件变更 schema 分别验证，并匹配待处理原生请求 |
| PATCH | `/conversations/:id` | 设置 `executionTarget`（仅新建/未开始会话） |

云模式不需要新 API；继续使用现有 turns/stream/runner。

### 8.3 兼容性

- 新字段 nullable/default；旧会话不变。
- 新事件可被旧客户端忽略；SSE 解析保持宽松。
- 不修改已应用迁移；新增 forward migration。
- Web 端不显示本地设备入口。
- **桌面协议版本与 Web 构建 ID 解耦**：现有 `CLIENT_BUILD_HEADER` 要求客户端 build ID 与服务端完全相等（`apps/api/src/plugins/client-build.ts:19`），前端在 pending 时拦掉除 bootstrap 外所有请求（`apps/web/src/api/client.ts:75`）。内嵌资源编译在安装包里，旧安装包连新 API 会永久 `CLIENT_UPDATE_REQUIRED`，刷新窗口也回不来。
  - Web 保留现有构建一致性检查不动。
  - 桌面改为上报 `desktopProtocolVersion` + 能力位（`capabilities`），API 校验兼容区间而非相等。
  - 不兼容时返回 `DESKTOP_UPDATE_REQUIRED`，UI 给更新入口（走 §5.10 updater），不是死循环阻断。
  - 验收：上一版安装包连当前 API，能登录、能开会话、能收到明确升级提示。

---

## 9. 分阶段落地

### Phase 0（第 1–3 周）

- 在当前 `feat` 新建 `apps/desktop`（Go + mygo），参考 `feat-computer-use` 的 computer use 实现按需摘取/重写；固定 mygo v0.7.4 / Go 1.27.3，`agent-desktop` 使用最新版（当前 1.3.1，见 §14）；验证 macOS/Windows 双平台构建。
- 桌面壳扩展：主窗口 webview 加载 `apps/web` 构建、桌面宿主适配层、本地 runner supervisor。
- 定义 `computer-use` shared schema、设备通道、`executionTarget`。
- API 增加 DesktopDevice/Pairing、设备 WS 骨架（无 UI）。
- **云模式贯通（先做，风险最低）**：打包后的应用在干净 Mac/Windows 上完成登录 → 云会话 → SSE → 下载 → 更新检查。这一步不依赖设备通道与本地执行，先把 mygo 的 webview/登录/更新风险验掉。
- **独立本地运行时验证（Phase 0 出口）**：内嵌 Node + `apps/runner` + Codex 随包，以测试专用入口在干净机器上验证进程启动、Core MCP 装载、临时工作区与退出清理；对话链路用 fake model 验证，不下发平台供应商密钥、不接生产内部接口。生产模型经设备通道的一轮真实本地对话在 M1 验收。
- Phase 0 不要求经设备 WS 执行产品回合，也不要求调用 `computer_use` 引擎；设备凭据、受限工具请求、完整执行与 GUI 分别在 M1/M1b 验收。通过壳、云模式和独立运行时出口后，才进入依赖它们的 Phase 1 集成。

### Phase 1（第 4–10 周出 M1；M1b 到第 14 周）

M1 依赖顺序：**设备白名单契约与凭据 → 双向受限请求 → 文件链路与原生审批 → 目标选择 UI → 双平台发布验收**。独立运行时已在 Phase 0 验证；GUI 自动化及设备桌面占用租约归 M1b。

**通道门槛（第 4–5 周末，P1-01/24/02/03/04 完成后）**：不是"请求能往返"就算过，而是**一次真实 Codex 回合经设备通道完整跑通**——读文件、执行命令、事件回传、取消各一次，且设备侧全程无供应商密钥。用回显桩或假回合通过，会把事件排序、去重、取消的缺陷推到文件链路和 UI 集成阶段。未过不进入文件链路与 UI 集成。

- **设备凭据模型先行**（§6.1）：独立设备 schema、按用途的模型代理 token、事件回传去掉全局 secret；覆盖记忆提取和模型切换来源。
- 设备网关正式化 + `RunnerTransport` 双路由。
- 本地运行时接入 run lease 与 Core MCP 受限请求/响应（§6.7），完成与现有服务端业务能力的连接。
- 文件与工件链路（§6.6）：附件下发、工件上传确认、路径映射。
- 沙箱与审批分档、命令/文件审批分别校验、native 命令规则撤销；本地/云目标选择与设备设置 UI。
- 桌面协议版本兼容（§8.3）。
- Windows M1：WebView2 主窗口、安装器与 Authenticode、文件/Shell 沙箱及权限验证、安装/升级/更新验收；不依赖 UIA 回归。
- Browser Use：桌面端状态/引导/系统浏览器配对入口；本地模式 `browser_use` 走现有扩展链路。
- 打包/签名/公证（双平台）+ 应用内更新（签名 manifest、delta、stable/beta 渠道）；M1 的 E2E、安全与运行手册各自交付。

**里程碑 M1（可发布）**：本地"文件 + Shell + 浏览器"及知识库/连接器调用闭环；命令和文件审批、旧安装包兼容、双平台安装/升级均通过。`computer_*` 入口保持不可用，不要求用户提前授予 GUI 权限。

**里程碑 M1b**：新增 `computer_use` Core MCP、引擎本地入口、设备桌面占用租约、窗口身份校验、GUI 授权/暂停/审计、macOS 权限向导与 Windows UIA 回归。GUI E2E、安全、Windows 回归和手册作为增量验收，不成为 M1 的依赖。

### Phase 2（第 10–14 周，与 M1b 并行）

- 云模式：回归 M1 已提供的双目标路由与切换、桌面/Web 行为一致性；不把云目标入口延迟到 M1 发布之后。
- 验证桌面端与 Web 端的会话、SSE、工件、浏览器面板一致。
- 不需要新基础设施。
- 内置浏览器：独立原生窗口 + 隔离会话 + 标签/下载/查找；Agent 通过 DOM/JS 操作，必要时坐标兜底；`browserTarget` 路由。
- 保持扩展为默认；内置浏览器不替代用户真实浏览器。

### Phase 3（后续）

- Linux 桌面客户端不做；Windows **云电脑**（VM/RDP/视频流）不做。
- 可选“可视化云桌面”：仅在 Linux Docker 内做 Xvfb + WebRTC + `agent-desktop` Linux（AT-SPI），不引入 Windows（见 §15.1）。
- 多设备、配额/usage、审计导出、GA 加固。

---

## 10. 测试与验收

- 单元：computer schema、权限矩阵、审批决策映射、设备通道命令白名单/幂等、transport 路由。
- 集成：API device gateway + fake desktop；local runner bridge；Core MCP computer 模块。
- E2E：
  - M1 本地：创建 local 会话 → 文件/Shell（命令与文件审批分别验证）→ 扩展浏览器 → 知识库/连接器 → 断线重连 → 撤销。
  - M1b GUI 增量：observe/act → 效果/等待 → 暂停/恢复 → 崩溃中断不续跑 → 撤销。
  - 云：创建 cloud 会话 → 现有 Docker runner 文件/Shell/浏览器 → 断线重连 → worker 回收。
- 安全：伪造设备、重放命令、越权会话、路径遍历、撤销后重试；内置浏览器会话隔离、`file://` 拦截、外链与下载策略。
- 凭据边界：正常对话、开启记忆提取、切换模型均检查设备侧进程内存、日志、配置与抓包，确认无真实供应商密钥、无 `LINKSENSE_RUNNER_SHARED_SECRET`、无其他会话凭据；严格设备 schema 拒绝未知/嵌套内部字段，云契约继续可用；run lease 过期/撤销后命令、模型与工具调用同时失效。
- Core MCP 受限请求：本地 Browser Use、知识库、网页搜索、连接器闭环；操作白名单、资源权限、跨用户/回合、过期/撤销、超时/取消、迟到响应和副作用不重放。
- 沙箱绕过：模型直接调 AppleScript / PowerShell / 直调 UIA 时被 Codex 沙箱或审批拦住；不依赖 Go 执行器。
- 审批：命令按 `CommandExecutionApprovalDecision`、文件变更按 `FileChangeApprovalDecision` 校验；文件卡片无前缀规则选项，错误类型决策在 API/runner 两端被拒绝；超时走 `cancel`；"始终允许"撤销后同一命令重新触发确认（native 规则已失效）。
- 设备租约：两个会话争同一设备 → `DEVICE_BUSY`；崩溃/断线/超时后租约释放且不自动续跑；窗口身份变化 → `COMPUTER_TARGET_CHANGED`。
- 文件链路：输入附件到达设备工作区；本地生成工件上传后出现在工件列表；本地绝对路径不出现在事件、日志与模型上下文。
- 兼容：上一版安装包连当前 API，能登录、能开会话、升级提示可达。
- 内置浏览器：导航/读取/点击/输入/滚动/等待/截图/下载/页内查找；登录交接；WKWebView 与 WebView2 双平台回归。
- 六语言；无硬编码；键盘可达。
- 验收（M1）：本地与云都能完成"读文件 + 改文件 + 执行命令 + 浏览器任务"。验收（M1b）：本地额外完成 GUI 操作；云模式不要求 GUI。

---

## 11. 风险与开放问题

| 风险/问题 | 影响 | 建议 |
| --- | --- | --- |
| `agent-desktop` 旧版（1.0.2）与最新版差异 | 兼容/安全 | Phase 0 升级到最新版（当前 1.3.1）并回归；记录 release/sha256 |
| 参考实现只在 `feat-computer-use` 分支 | 照搬带入旧结构 | 只作参考；按当前主线重写，记录参考 commit，跑通 `go test ./...` 再扩展 |
| mygo v0.7.4 生态较小 | 壳能力受限/升级风险 | 固定版本；升级前跑白盒测试；必要时本地补丁或 fork |
| Go 1.27.3 工具链 | 本机与 CI 版本 | `go.mod` 已声明 1.27.3，Go 1.23+ 自动下载 toolchain；CI 固定 `GOTOOLCHAIN` |
| webview 内容安全 | 注入/外链/权限提升 | 内容按不可信处理；content rules 限制导航与新窗口；只暴露显式 IPC |
| 本地 OS 权限引导 | 首次体验 | 向导 + 系统设置深链；失败可回落云模式 |
| Windows 签名与 SmartScreen | 分发体验 | Authenticode 证书 + 安装器；未签名先内部渠道并标注风险 |
| Windows UIA 与 macOS AX 差异 | 兼容 | 双平台白盒回归；动作映射按平台分支；不支持的能力返回稳定 code |
| WebView2 运行时缺失 | 启动失败 | 安装器检测/bootstrapper；失败给出引导 |
| webview UA 不是 Chrome/Edge | 扩展检测误判 | 桌面宿主适配层改用桌面引导；不复用浏览器 UA 判断 |
| 更新密钥丢失 | 已安装用户永久无法更新 | 离线备份 + CI secrets；轮换需发布内置新公钥的新版本 |
| GitHub 源限流（60 次/小时/地址） | 检查更新失败 | 主源用自托管 `url`（S3/CDN）；GitHub 仅备用 |
| Apple Developer / Windows 证书 | 分发阻塞 | Phase 0 申请；无证书前走内部渠道 + ad-hoc 签名 |
| 安装位置不可写 | 自更新禁用 | `Enabled()` 检查并降级为下载安装包链接 |
| Windows ARM64 | 构建/测试 | 现有测试已覆盖 arm64（无 `-race`）；x64 为主发布目标 |
| 模式切换文件不连续 | 用户预期 | 明确提示；后续做同步 |
| 云模式无 GUI 桌面 | 用户预期 | UI 明确“云模式=文件/Shell/浏览器”；需要 GUI 用本地模式 |
| 命令不确定结果 | 重复执行 | 不重发；`UNCERTAIN` + 用户确认 |
| 本地 computer use 占用真实桌面 | 干扰用户 | 明确横幅 + 任务授权 + 全局暂停/停止；不做后台虚拟桌面 |
| 崩溃/断线后界面不可重建 | 误重放动作 | 回合标 `interrupted`，不续跑；命令结果 `UNCERTAIN` 不重发 |
| 动作效果误判 | 空转/重复点击 | `effect` 契约 + `treeQuality` + 截图兜底；`no_effect` 不自动重试 |
| 内置浏览器无 CDP | 复杂站点成功率低 | 明确限制；默认用扩展；失败时回落到扩展或坐标点击 |
| WKWebView/WebView2 行为差异 | 双平台不一致 | 双平台回归；能力差异返回稳定 code |
| 多设备/并发 | 授权冲突 | 每会话单设备 + 每设备单任务租约；设备撤销即终止 |
| 平台密钥下发到用户机器 | 凭据泄露 | 独立严格设备契约；主模型/记忆/模型切换来源均走受限代理；见 §6.1 |
| 全局内部 secret 下发 | 内部 API 暴露 | 设备不持有 `LINKSENSE_RUNNER_SHARED_SECRET`；事件与工具请求分别经设备通道处理 |
| Core MCP 工具回调无替代入口 | Browser Use/知识库/连接器不可用 | §6.7 受限请求/响应与服务端资源授权，M1 必验 |
| 只改审批不改沙箱 | 无实际拦截 | 本地默认 `untrusted` + `workspaceWrite`；`full_access` 需显式开启 |
| 内嵌资源被 build ID 锁死 | 旧客户端无法升级 | 桌面协议版本与 Web build ID 解耦，返回可恢复的升级提示 |
| 本地工件无法注册 | 文件功能不可用 | 附件下发 + 工件上传确认 + 路径映射，见 §6.6 |

**开放问题**：

1. 云模式是否需要“浏览器实时预览”增强？（现有 browser panel 已够用）

---

## 12. 建议代码落点

```text
packages/shared/src/
  computer-use.ts                     # 工具名/schema/权限 code/事件
  desktop-device.ts                   # 严格设备入参、按类型审批、设备帧/配对/工具操作

apps/api/src/
  modules/desktop-devices/            # 配对/设备列表/WS/撤销/设备任务租约
  modules/desktop-credentials/        # run lease 签发/校验/撤销（新增）
  modules/model-proxy/                # 服务端受限模型代理（新增）
  modules/local-computer/             # 本地会话/权限
  modules/files/                      # 附件下发、工件上传确认（扩展）
  adapters/runner.ts                  # 抽出 RunnerTransport
  adapters/desktop-device-transport.ts
  # 设备网关内按操作 code 调已有领域 service，不开放任意内部路径

apps/runner/src/
  controller/desktop-worker-provider.ts # 新 provider：当前用户 + 应用私有目录（新增）
  mcp/core-services/computer-use-service.ts
  mcp/core-service-registry.ts
  desktop/computer-tool.ts            # 调本地 computer use 引擎
  desktop/device-event-sink.ts        # 本地 RunnerEventSink：事件/工具/控制回调经设备桥

apps/desktop/                         # Go module（当前 feat 新建；参考 feat-computer-use）
  main.go                             # 入口/单实例/深链/窗口
  web.go                              # 主窗口：webview 加载 apps/web 构建（新增）
  view.go                             # 伴随窗口：配对/权限/状态（已有）
  bridge.go                           # 设备 WS（已有）
  engine.go                           # agent-desktop 引擎（已有）
  browser.go                          # 内置浏览器：原生窗口 + webview + 标签/下载/查找（新增）
  assets/browser-agent.js             # 注入页面的 DOM 快照/点击/输入/等待（新增）
  runtime.go                          # 本地 runner supervisor（已有部分，扩展）
  locales/                            # 六语言（已有）
  mygo.json / mygo.config.ts          # 应用元信息、resources、updates、签名（已有，扩展）
  resources/<os>-<arch>/bin/          # agent-desktop 按平台随包（新增）

scripts/desktop.mjs                   # 构建/准备/测试（已有）
deploy/desktop/                       # 签名/公证/更新配置与 CI（新增）

prisma/migrations/                    # desktop_devices/pairings/local_sessions/grants/conversation 字段
```

复用原则：不复制 Web、不复制 runner、不复制 Core MCP、不复制 Codex 回合语义。

### 12.1 仓库形态：monorepo 子 app，不新开项目

建议在当前 monorepo 内推进：

- `apps/desktop`（**Go module + mygo**，由 `scripts/desktop.mjs` 构建；不加入 pnpm workspace）；
- 桌面契约放 `packages/shared`（`computer-use.ts`、`desktop-device.ts`）；
- 不建 `apps/desktop-helper`：computer use 引擎与桌面应用同进程。

理由：

1. **契约同源**：设备帧、computer 工具、事件、错误码、六语言 key 都在 `@linksense/shared`；独立仓库需要发布/版本化契约包，容易漂移。
2. **Web 复用**：mygo webview 直接加载 `apps/web` 构建，共享路由、组件、i18n、设计系统；独立项目需要复制或私有包。
3. **Runner 同源**：本地模式复用 `apps/runner`；API/runner/desktop 的协议改动应在一个 PR 内完成并一起测试。
4. **CI/版本/发布一致**：一个 lockfile、一套 lint/typecheck/test；Go 模块单独一个 job；桌面产物仍可有独立版本号，但源码同仓。
5. **Go 模块独立**：`apps/desktop` 用自己的 `go.mod`（mygo v0.7.4 / Go 1.27.3），不影响 pnpm；若未来需要独立团队维护，再拆仓库。

依赖边界：

- `apps/desktop` 通过 webview 使用 `apps/web` 构建产物，不 import Web 源码；桌面契约在 `packages/shared`，由 Web 侧消费；不 import `apps/api`/`apps/runner` 源码，runner 以构建产物/子进程方式打包。
- 引擎与本地 runner 通过 loopback RPC 通信；不依赖 Node 包。
- `packages/shared` 不依赖任何 app；只放 schema/类型/常量/事件/工具名/翻译 key。
- `outputs/desktop` 继续作为构建产物目录，不提交源码；源码在 `apps/desktop`。

何时考虑新项目：

- 桌面端有独立团队、独立发布节奏与权限边界，且需要独立仓库时；
- 届时把 `packages/shared` 中桌面契约抽成 `@linksense/desktop-contracts` 发布，而不是复制；
- 不建议现在拆，收益小于契约/构建/测试的同步成本。

---

## 13. 与三份调研的映射

| 设计点 | 来源 | 说明 |
| --- | --- | --- |
| 会话/回合/权限分层 | WorkBuddy | 不把 Agent 塞进 UI |
| 会话续接/压缩 | 小浣熊 | 复用现有 conversation/turn/event |
| 本地计算机权限/暂停 | 豆包工作 | 任务级授权、拒绝回退 |
| 反向设备通道 | 豆包消息总线 + LinkSense runner | WS 替代入站 HTTP |
| 加密/不重发 | 豆包 GAC | TLS + commandId/expiry；不确定不重发 |
| 客户端工具注入 | WorkBuddy | Core MCP 已具备 |
| 命令级审批 | 小浣熊 | Codex 原生审批请求 + 一次/会话/始终规则（§7.2） |
| 单一动作入口/效果核对 | Mika（Android） | `ActionExecutor` + `effect`/`wait` 契约（§5.4.2、§6.4） |

**不采纳**：豆包的 Windows VM/PIP/GAC（本期不需要）；WorkBuddy 双栈；小浣熊 Python 全量。

---

## 14. `agent-desktop` 是什么（详细）

### 14.1 上游与许可证

- 项目：`vercel-labs/agent-desktop`（GitHub）。
- 许可证：**Apache-2.0**。
- 形态：Rust 核心 + CLI + C FFI；跨平台。
- 最新 release：**v1.3.1**（2026-11-13）；LinkSense 现有产物是 **v1.0.2**（2026-11-03）。**本期采用最新版（当前 1.3.1），不以 1.0.2 为基线。**
- 平台（上游能力）：
  - macOS 13+：Accessibility（AX）API；
  - Windows 10 1809+：UI Automation；
  - Ubuntu 24.04+：AT-SPI（X11/Wayland）。
- **LinkSense 范围**：本地电脑使用 **macOS + Windows**；Linux 仅用于未来可选的 Linux 云桌面；**不做 Windows 云电脑/VM**。

### 14.2 能力

- 观察：`snapshot`（可访问性树 + `@ref`）、`find`、`get`、`is`、`screenshot`、`list-windows`/`list-apps`；
- 操作：`click`、`double-click`、`right-click`、`type`、`set-value`、`clear`、`focus`、`select`、`toggle`、`check`、`scroll`、`press`、`hover`、`drag`、`mouse-move`；
- 窗口/应用：`launch`、`close-app`、`focus-window`、`move/resize`；
- 其他：`clipboard`、`wait`、`batch`、`session`、`trace`、`skills`、`permissions`、FFI。
- 特点：模型用稳定 `@ref` 而不是像素坐标；每次操作后可重新 snapshot 验证；支持 Electron/Chromium 辅助；有权限引导。

### 14.3 LinkSense 现有封装

参考源码：`feat-computer-use:apps/desktop`（Go module，`github.com/egoist/mygo` v0.7.4，Go 1.27.3）；`outputs/desktop` 是其构建产物。该分支只作参考，不并入当前主线。现状：

- `LinkSense helper.app`（mygo）：
  - 配对码 UI、服务器地址、设备标签；
  - `api/v1/computer-use/pair`、`api/v1/computer-use/socket`；
  - WebSocket `desktopBridge`/`desktopCommand`/`desktopRequest`；
  - “Allow this task to use your computer?” 5 分钟任务授权、暂停、权限页；
  - `LINKSENSE_AGENT_DESKTOP_BIN`、`AGENT_DESKTOP_HOME`。
- 它是**伴随客户端**（约 480×570 原生窗口），不承载网站、不跑 agent；本期扩展点是主窗口 webview、本地 runner supervisor 与完整产品 UI。
- `agent-desktop` 由应用启动/管理；模型不直接调用 CLI。
- 构建：`pnpm desktop:prepare|dev|test|build`（`scripts/desktop.mjs`），产物含 `.app`/DMG/zip 与 legal 资源。

### 14.4 落地要求

1. **版本**：使用最新版（当前 1.3.1），Phase 0 升级并回归；记录 release/sha256，不以 1.0.2 为基线。
2. **许可证**：安装包内附 Apache-2.0 LICENSE/NOTICE；第三方声明更新。
3. **校验**：下载/内置 binary 校验 sha256；禁止未校验自动更新。
4. **安全**：引擎侧 action allowlist、任务授权、暂停/停止、审计；binary 签名/公证；不以 root 运行。
5. **兼容**：回归 macOS AX/截图与 Windows UI Automation；Electron/Chromium 辅助；系统权限拒绝路径。
6. **替代方案**：若不允许第三方 binary，可用 Swift/ObjC 自研 AX/ScreenCaptureKit helper（工作量更大）；当前 Apache-2.0 许可下建议复用。

---

## 15. 现有桌面资产清单

参考实现在 `feat-computer-use:apps/desktop`（不并入主线）；`outputs/desktop` 仅为构建产物与缓存。

```text
outputs/desktop/
├── build-artifacts/resources/bin/
│   ├── agent-desktop                 # 1.0.2, Rust CLI
│   ├── agent-desktop-macos-helper
│   └── manifest.json                 # version/target/sha256
├── LinkSense-Desktop-macos.zip       # "LinkSense helper.app" (Go)
├── LinkSense-Desktop-windows.exe     # Windows 客户端产物；本期纳入（安装器 + 便携 exe）
└── cache/agent-desktop-v1.0.2-aarch64-apple-darwin.tar.gz
```

已观察字符串：

```text
api/v1/computer-use/pair
api/v1/computer-use/socket
LINKSENSE_AGENT_DESKTOP_BIN
AGENT_DESKTOP_HOME
COMPUTER_USE_ACCESS_DENIED / COMPUTER_USE_PAUSED / COMPUTER_USE_COMMAND_FAILED
"Allow this task to use your computer?"
"Allow desktop access, including clicks and typing, for 5 minutes. You can pause at any time."
```

### 15.1 如果以后要“可视化云桌面”

只考虑 Linux 路径（本期不做）：

- 在 Docker 镜像内加 Xvfb + 轻量窗口管理器 + x11vnc 或 WebRTC + `agent-desktop` Linux（AT-SPI）；
- 用户看到的是 Linux 桌面；
- **不引入 Windows VM、Windows Agent 或 RDP**。

当前决策不需要可视化云桌面；云模式保持文件/Shell/headless 浏览器。
