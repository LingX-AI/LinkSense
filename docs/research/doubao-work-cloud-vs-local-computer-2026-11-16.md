# 豆包工作 2.36.19：云电脑 vs 本地电脑运行模式专题调研

调研日期：2026-11-16。样本同前：`doubao_work_desktop_dbgzb_sem_pinp_hexin_cpc_xiaz_xin1_macos_v2036019_b4d5_1794570495.dmg`（SHA-256 `2e72a5b1a2ff10f2fc9a8efa6ab60f8139bed11af7ba5b3a2352778eb251eedc`）。本报告只聚焦**两种计算机运行模式**：本地电脑（macOS CUA）与云电脑（Cloud Desktop / Windows GAC / PIP）。[D01]

核验方式：只读挂载 DMG，静态阅读 `entry-moa/main.js`、Chromium Framework 字符串、`libaha_cua.dylib`、`libagent_infra.dylib`、`task-mode-resource/gac_runtime` 的明文 Python 源码；未启动应用、未连接云电脑、未执行任何工具。文中“已观察”表示代码/资源/符号可直接确认；“推断”表示由调用关系得出；“未知”表示不可见。

> 一句话：**本地电脑 = macOS AHA CUA（Accessibility + ScreenCaptureKit + CG 输入）；云电脑 = Cloud Desktop 的 Windows GAC 实例，经 RTC/GPU video 渲染到 PIP 窗口，通过加密 GAC 协议执行 Windows 计算机操作。** 二者共用同一套 Agent 工具名与权限交互框架，但执行目标、权限边界和生命周期完全不同。

---

## 0. 一页结论

1. **两种模式在协议层是不同工具名 + 不同执行后端**：
   - 本地：`mac_computer_use_tool` / `general_computer_use`，走 `libaha_cua` 的 macOS AX/ScreenCaptureKit；
   - 云：`computer_use_tool` 且上下文 `native_windows_gac=true`，走 `gac_runtime` 的 Windows Computer Use 命令协议。[D02][D03]
2. **云电脑是“Cloud Desktop”，不是本地 Windows 虚拟机**：Framework 中存在 `[CLOUD_DESKTOP][SESSION/WINDOW/VIDEO/SDK]`、`AHACloudDesktopWindow`、`cloud_computer_session`、`cloud_computer_fs`、`cloud_desktop_files`、`cloudComputerHostId`、`gpuVideoTrack`、`reconnectInPlace`、`clipboardSynchronization`；包内只有 GAC **客户端**（`gac_runtime` 的 transport/client 与命令 schema），没有 Windows 执行环境本体。[D04][D05]
3. **云电脑的显示是 PIP 窗口**：支持 `inline-preview`、`floating-preview`、`interactive-window` 三种 presentation；`setRdpPlaceholderRect` 预留视频区域，`notifyVideoFrameRendered` 通知帧渲染；有 `hasPipWindow`、`mainPids`/`pipPids` 进程管理。[D04][D06]
4. **PIP 初始化是一套独立流程**：先 probe `isPipSystemEnvironmentInitialized`，状态可能是 `ready / needs_initialization / need_reboot / user_rebooting / need_init_env_and_reboot / init_failed`；用户需要输入 Windows 账户密码（`native-windows-gac-password`），支持重试上限、忘记密码、密码设置；可 `rebootComputerForPip`，拒绝使用会 `reportPipUsageDeclined`。[D06][D07]
5. **本地电脑的权限是 OS 级**：`INIT_LOCAL_APP` 要求 Accessibility + Screen Recording；`USE_LOCAL_APP` 做单应用授权（一次/本次会话/始终）；`CONTROL_LOCAL_APP` 做接管确认；`MAIN_DESKTOP_PERMISSION` 做整桌面权限；`AhaLockedUse` 在控制期间锁定用户输入。[D08][D09]
6. **云电脑的权限是“会话 + 接管”级**：`INIT_PIP_ENV` 确认初始化、`PIP_CONTROL` 确认控制接管、`MAIN_DESKTOP_PERMISSION` 确认主桌面权限；确认通过服务端 callback（`server_option.callback_id`/`approve`）完成，客户端只负责展示与回传。[D06][D10]
7. **GAC 传输是加密的**：`GACF` 帧头、HMAC challenge、HKDF 派生会话密钥、ChaCha20-Poly1305 加密帧；绑定 `session_id + execution_id`，v2 还做 server peer 校验；明确“写/读失败后不重发”，避免重复执行。[D11]
8. **云电脑有独立文件系统**：`neotix.cloudComputer::fs::*` 提供 snapshot、storage usage、list、get、createFolder、rename、move、delete、upload、download、tasks/observe、cancel；这使云电脑的文件与本地电脑分离。[D05]
9. **云电脑受产品开关控制**：远程配置 `doubao.desktop_cloud_computer_enabled.enable`（前端字段 `desktop_cloud_computer`）决定是否启用；会话/窗口侧有 `chat_window_runtime_environment` 事件用于运行时环境选择。[D12]
10. **同一条 Agent 工具链可以切换目标**：服务端下发不同工具名/上下文，客户端按名称选择本地 AHA 或云 GAC；权限、超时、结果上传、截图转换都走同一套 interaction/tool 框架。[D02][D06]

---

## 1. 模式定义与入口

### 1.1 本地电脑（Local Computer）

| 项 | 观察 |
| --- | --- |
| 工具名 | `mac_computer_use_tool`、`general_computer_use`，以及 `computer_use_tool` 的 macOS 分支 |
| 执行库 | `Resources/cua/libaha_cua.dylib`（macOS Accessibility / ScreenCaptureKit / CGEvent） |
| Python API | `task-mode-resource/gcu`（`CUA`/`get_app`/`click`/`get_state`） |
| 权限 | Accessibility、Screen Recording、单应用授权、整桌面权限 |
| 锁屏 | `AhaLockedUseService.app` / `AhaLockedUse.pkg`（控制期间锁定用户输入） |
| 超时 | `general_computer_use` 700s；`mac_computer_use_tool` 150s |

### 1.2 云电脑（Cloud Computer / Cloud Desktop）

| 项 | 观察 |
| --- | --- |
| 工具名 | `computer_use_tool` 且 `context.native_windows_gac === true` |
| 执行环境 | 云端 Windows（GAC），包内只有客户端 `gac_runtime` 与 Windows 命令 schema |
| 显示 | `AHACloudDesktopWindow` / PIP 窗口；`inline-preview`、`floating-preview`、`interactive-window` |
| 视频 | `gpuVideoTrack`、`notifyVideoFrameRendered`、`setRdpPlaceholderRect` |
| 文件 | `neotix.cloudComputer::fs::*`、`cloud_desktop_files`、独立 file manager |
| 初始化 | `INIT_PIP_ENV` + Windows 密码 + 环境安装/重启 |
| 控制 | `PIP_CONTROL` 接管确认 |
| 开关 | `doubao.desktop_cloud_computer_enabled.enable` |

---

## 2. 本地电脑模式：macOS AHA CUA

### 2.1 执行栈

`libaha_cua.dylib` 的源码路径与符号明确显示：[D08]

```text
aha_assistant/src/aha_cua/desktop/platform/darwin/accessibility.mm
aha_assistant/src/aha_cua/desktop/platform/darwin/accessibility_activator.mm
aha_assistant/src/aha_cua/desktop/screenshot/darwin/screen_capture_kit/sc_capture.mm
aha_assistant/src/aha_cua/desktop/input/keyboard_input_darwin.mm
aha_assistant/src/aha_cua/desktop/input/scoped_mouse_press.cpp
```

能力：

- **观察**：`AXUIElement` 树、窗口枚举（`CGWindowListCopyWindowInfo`）、AX 属性批量读取、屏幕截图（ScreenCaptureKit）、窗口级截图/裁剪/缩放；
- **动作**：AX press/set value/select text、鼠标点击/拖拽/滚轮、键盘输入/快捷键、焦点校验；
- **确认**：很多动作在发送前做“先观察/先聚焦”的确认；失败会返回 `ACTION_OUTCOME_UNCONFIRMED`、`KEYBOARD_FOCUS_UNVERIFIED` 等结构化错误；
- **限制**：`ACCESSIBILITY_PERMISSION_REQUIRED`（未授权时不做任何输入）、Notes 表格等特殊控件不支持时明确拒绝。

`gcu` Python API 是对上述能力的封装：[D09]

```python
app = gcu.get_app("com.apple.TextEdit")
state = app.get_state(screenshot=True)
app.click(12)
```

文档明确：`gcu.CUA()` 不接收参数；没有 host session 时构造会抛 `CUAError("NO_SESSION")`；Python 不做 SDK 加载/路径选择/ctypes 执行回退；host 负责调度、授权、超时、取消、输出预算与 worker 生命周期；`emit_image()` 也需要 host session。

### 2.2 工具执行

- **`mac_computer_use_tool`**：模型提供 `code` + `title`，在 sandbox 中执行 Python 代码（调用 `gcu`/Browser API）；超时 150s；结果转换为 ACP/工具结果，截图上传到 ImageX（`GAC image` 映射）。[D02]
- **`general_computer_use`**：通过 `aha_task_start` 启动一个 AHA 任务，轮询任务输出（`task_output_polling`），支持 abort；超时 700s；任务结束做 `task_terminal` 清理。[D02]
- 两个工具都要求 `nativeSandbox` adapter；没有沙箱能力时返回结构化 generic_tool 错误，而不是崩溃。

### 2.3 权限与确认

`INIT_LOCAL_APP` 场景：[D09]

```text
检查 accessibility + recordscreen
→ 用户确认（AGWRequireAskHumanWarn）
→ 若批准，客户端再次查询系统权限
→ 返回 approve=true/false，回传 server_option
```

`USE_LOCAL_APP` 场景（单应用授权）：

- 动作：`CUA_WARN_ALLOW`（允许本次）、`CUA_ALWAYS_ALLOW`（始终允许）、`CUA_WARN_REFUSE`（拒绝）；
- 记录：`{ appId, conversationId | always }` 写入 `gui-coding-app-authorization-records:v1`；
- 始终允许使用保留标记 `@@gui-coding/always-allow@@`，禁止把它当作 conversationId；
- 授权记录同时写内存与持久化存储。[D09]

`CONTROL_LOCAL_APP` 场景：

- 服务端发起“Mac GUI AskHuman”确认；
- 客户端用 `nA` 注册表等待授权结果，`nS` 解析 `approve` 并 resolve；
- 支持移动端远程提交决策（`mobile_action_submit_mac_gui_ask_human`）。[D09]

`MAIN_DESKTOP_PERMISSION` 场景：

- 校验 `authorization_id`、`tool_call_id`、`server_option.callback_id`、`params.approve`；
- 通过 `resolveMainDesktopAuthorization` 回传服务端 callback；
- 支持允许/拒绝，且拒绝与允许不能同时出现在一次决策里。[D10]

### 2.4 锁屏与用户干扰

`AhaLockedUseService.app` 的字符串：

```text
Press any key or click the mouse to unlock the screen
com.aha.locked-use.remote
```

推断：Agent 在本地控制期间可以进入“锁定使用”状态，阻止用户输入干扰；用户按键/点击可解锁。本次未验证其实际触发条件与解锁流程。[D08]

### 2.5 生命周期与限制

- 本地任务有 `executionDeadlineAt`、`executionSignal`、`sandboxId`、`sandboxLogId`；
- 任务中断会 abort 并清理；
- `AhaLockedUse` 是独立服务，需要安装（`AhaLockedUse.pkg`）与授权 bundle；
- 本地模式依赖用户 macOS 的辅助功能/录屏权限，首次使用需要用户去系统设置授权。

---

## 3. 云电脑模式：Cloud Desktop + Windows GAC + PIP

### 3.1 Cloud Desktop 会话与窗口

Framework 字符串（已观察）：[D04][D05]

```text
[CLOUD_DESKTOP][SESSION]
[CLOUD_DESKTOP][WINDOW]
[CLOUD_DESKTOP][VIDEO]
[CLOUD_DESKTOP][SDK]
AHACloudDesktopWindowFrame
AHACloudDesktopWindow
NSWindowDelegate
```

会话/窗口字段与能力：

- presentation：`inline-preview`、`floating-preview`、`interactive-window`；
- `presentationGeneration`、`windowBounds`、`activateWindow`、`previewScale`；
- `gpuVideoTrack`：GPU 视频轨；
- `clipboardSynchronization`：剪贴板同步；
- `reconnectInPlace` / `reconnectWindowId`：窗口原地重连；
- `cloudHostId` / `cloudComputerHostId`：云主机身份；
- `statusEvents`、`terminate`、`createState`、`session_lookup`、`create_reused`；
- `file manager`：`cloud_desktop.file_manager_registry`、standalone file manager、file preview、`cloud_desktop_debug_panel_config`。

窗口层是原生 macOS 窗口（`AHACloudDesktopWindow`），不是网页 iframe；这解释了 `setRdpPlaceholderRect`（给视频留位）与 `setPipPresentation`（切换内联/悬浮/交互窗口）。

云桌面 SDK 的内部代号是 **Llama**（与模型无关）：错误码包括 `LLAMA_DEVICE_SDK_UNAVAILABLE`、`LLAMA_ASSETS_UNAVAILABLE`、`LLAMA_USER_ACTIVATION_REQUIRED`、`LLAMA_CALLER_GONE`、`LLAMA_INVALID_OWNER`、`LLAMA_INVALID_WINDOW` 等；SDK 日志通过 `llama_log_level` 控制。由此可判断云桌面能力由独立 SDK 提供，而非 Chromium 自带。

### 3.2 PIP 生命周期

`neotix.computerUse` 中与 PIP 相关的方法：[D06]

| 方法 | 作用 |
| --- | --- |
| `isPipSystemEnvironmentInitialized` | probe Windows 环境状态 |
| `initializePipSystemEnvironment` | 初始化环境 |
| `rebootComputerForPip` | 重启云电脑 |
| `getPipWindowsUserInfo` | 获取 Windows 用户信息 |
| `validatePipWindowsUserPassword` | 校验 Windows 密码 |
| `openPipWindowsUserForgotPasswordPage` | 忘记密码 |
| `openPipWindowsUserPasswordSettings` | 密码设置 |
| `reportPipUsageDeclined` | 记录用户拒绝使用云电脑 |
| `setPipPresentation` / `getPipPresentationState` | 设置/读取 PIP 展示状态 |
| `setPipPresentationActionCallback` | PIP 操作回调 |
| `setRdpPlaceholderRect` | 设置 RDP 视频占位区域 |
| `openBrowser` | 打开云电脑浏览器（含 main/pip 进程信息） |

probe 的状态机（前端已观察）：[D06]

```text
isInitialized=true                     → ready
state = init_failed                    → 失败
state = user_rebooting                 → 失败（用户重启中）
state = need_reboot                    → 失败（需要重启）
state = need_init_env_and_reboot       → 失败（需初始化并重启）
否则                                   → needs_initialization
```

初始化交互：

- 场景 `INIT_PIP_ENV`；
- 用户看到密码/初始化卡片，输入 Windows 密码；
- 终端状态可能是 `ready`、`skipped`、`cancelled`（`password_prompt_closed`、`password_retry_limit_reached`）；
- 取消/跳过会触发 `reportPipUsageDeclined`，记录 `password_declined` / `password_retry_exhausted` 等原因。[D06][D07]

### 3.3 控制接管（PIP_CONTROL）

- 场景 `PIP_CONTROL`；
- 用户确认后，动作类型 `CUA_REQUEST_ACTION_PIP_OPERATION`；
- 用户跳过/取消 → `PIP_CONTROL` 返回 `skipped`/`failed`；
- 失败时带 `errorCode` + `text`，前端记录 `windows_pip_control_authorization_outcome`；
- 支持移动端远程接管决策（`mobile_action_submit_gui_coding_pip_environment` / `windows_pip_control_mobile_action_*`）。[D06][D10]

`MAIN_DESKTOP_PERMISSION` 也出现在云电脑流程中，推断用于“允许 Agent 控制整个云桌面”的额外确认；本地模式同样使用该场景，两者共用服务端 callback 机制。[D10]

### 3.4 Windows GAC 运行时

包内的 `task-mode-resource` 是云电脑的**客户端运行时**：[D03][D13]

```text
gcu/                     # macOS GCU Python API（本地 AHA）
python-packages/
  gac_runtime/
    runner.py            # 由 sandbox.bash.run 调用的 CLI bridge
    cell.py / envelope.py / wire.py / gac_profile.py
    transport/           # tcp / uds / named_pipe / chacha20poly1305 / handshake
    modules/
      browser_use.py
      computer_use_ax.py
      computer_use_windows.py
    computer_use/_windows/  # Windows 命令 schema 与实现
```

`computer_use_windows.py` 定义了 Windows Computer Use 命令协议（module id 2，protocol 1）：[D13]

- `ListApps`、`LaunchApp`、`Screenshot`、`Click`、`Hover`、`Type/Key`、`Scroll`、`Drag` 等；
- 截图返回 PNG + 虚拟桌面宽高（`Frame`）；
- Windows 模块声明最大响应 payload 129 MiB、最大截图 PNG 128 MiB；传输层另有 128 MiB 帧上限；
- 请求/响应使用 JSON 参数（`json.dumps(..., separators=(',', ':'), allow_nan=False)`）。

`runner.py`：

- 入参是 base64(JSON)，字段 `code`、`filename`、`timeout_ms`；
- 在 sandbox 内执行 Python cell，产出 `envelope`（stdout/stderr/异常/图片/环境变化）；
- 图片只返回路径，不把二进制放进 stdout；host 后台读取；
- 支持 finalizer 输出、GAC profile 预算（stdout/stderr/动作数/观察数/图片数等）。[D13]

### 3.5 GAC 传输安全

`gac_runtime/transport` 是完整的安全通道：[D11]

- 帧头 `GACF` + little-endian 长度；
- 握手：`session_id + ":" + execution_id` → 64 字节 challenge → HMAC-SHA256(secret, challenge) → HKDF 派生会话密钥；
- 数据帧：ChaCha20-Poly1305 加密，帧上限 128 MiB，明文上限 128 MiB - 28；
- v2：先 `verify_server` 做 peer 校验，再 `authenticate_v2`；
- 传输：TCP、Unix domain socket、Windows named pipe；
- 重连：只允许在“可重试”状态重连；**写/读失败后绝不重发**，因为对端可能已经执行；
- 失败分类：`AuthenticationError` 不可重试，`RemoteClosedError` 可重试；
- 客户端 `from_env` 读取 `CUA_GAC_TRANSPORT`、`CUA_GAC_ENDPOINT`、`CUA_GAC_SERVER_PORT`、`CUA_GAC_SECRET`、`CUA_GAC_SESSION_ID`、`CUA_GAC_EXECUTION_ID`、`CUA_GAC_PROTOCOL_VERSION`、`CUA_GAC_AUTH_ONLY_LOCAL` 等；
- `allow_auth_only` 允许仅认证模式（不执行）——推断用于探测/握手验证。

这是一套比普通本地 HTTP 更严格的执行通道：**会话绑定、执行绑定、加密、防重放（不重发）、peer 校验**。

### 3.6 云文件系统

`neotix.cloudComputer` 命名空间（Framework 字符串）：[D05]

```text
neotix::cloudComputer::fs::snapshot
neotix::cloudComputer::fs::getStorageUsage
neotix::cloudComputer::fs::listFiles
neotix::cloudComputer::fs::listFolders
neotix::cloudComputer::fs::getFile
neotix::cloudComputer::fs::createFolder
neotix::cloudComputer::fs::rename
neotix::cloudComputer::fs::move
neotix::cloudComputer::fs::deleteFiles
neotix::cloudComputer::fs::upload
neotix::cloudComputer::fs::download
neotix::cloudComputer::fs::getTask
neotix::cloudComputer::fs::listTasks
neotix::cloudComputer::fs::observeTasks
neotix::cloudComputer::fs::observe
neotix::cloudComputer::fs::listUploadItems
neotix::cloudComputer::fs::cancel
```

这使云电脑有独立的文件管理/上传下载/任务观察，和本地电脑的文件系统完全分离；UI 侧有 `cloud_desktop_files` 事件与独立 file manager/preview。

### 3.7 云电脑里的浏览器

`gac_runtime.browser` 包含完整的 Browser Use 实现：[D13]

- CDP runtime、tabs/pages/navigation/input/keyboard/snapshot/reads；
- `browser_use.py` 模块；
- `gac_profile` 控制每次 cell 的 stdout/stderr、动作数、观察数、图片数、渲染限制。

推断：云电脑的浏览器自动化运行在 Windows 云主机侧，通过 GAC 协议把结果返回；本地只负责显示与交互。

### 3.8 产品开关与环境上报

- 远程配置 key：`doubao.desktop_cloud_computer_enabled.enable`，前端字段 `desktop_cloud_computer`；[D12]
- `sandbox_info_report`：`{ protocol_version: "v1.0.0", agent_id, info, connectors, mobile_context }`，用于把云环境可用性/连接器/移动上下文上报给调度服务；[D12]
- `multi_env_agent` 日志：同一 Agent 可对应多个环境/设备；不可用时上报 `available: false` + `unavailable_reason`；
- `INIT_AGENT_ENV` 命令：初始化 Agent 环境，客户端 ack 并上报本地技能目录。

---

## 4. 模式选择与切换

### 4.1 谁决定模式

从静态代码看，**模式由服务端下发的工具名/上下文决定**：

- 服务端发 `mac_computer_use_tool` / `general_computer_use` → 本地；
- 服务端发 `computer_use_tool` 且 `context.native_windows_gac = true` → 云电脑；
- 服务端发 `browser_use` → 浏览器代码执行（本地或云侧由上下文决定）；
- 服务端不会同时下发两个互斥的计算机工具（推断，基于工具匹配逻辑与上下文区分）。[D02]

### 4.2 UI 入口

- 事件常量 `chat_window_runtime_environment`（`ChatWindowRuntimeEnvironment`）表明聊天窗口有“运行时环境”选择/展示组件；[D12]
- `chat_window_mode_select` 是模式选择事件；
- 具体 UI 文案与选项在加密 `.pak` 中，本次未能读取（UI 资源为专有/加密格式）；[D14]
- 功能开关 `desktop_cloud_computer` 控制云电脑入口是否可见。

### 4.3 回退

- 云电脑 probe 失败/用户拒绝 → `reportPipUsageDeclined`，Agent 可改用本地工具或其他方案（推断：服务端根据能力上报决策）；
- 本地权限未授予 → `INIT_LOCAL_APP` 返回拒绝，工具失败并给出 `system_permission` 错误；
- 两种模式都有明确的“用户拒绝即停”语义，不会静默切换执行目标。

### 4.4 与“远程控制/多设备接管”的区别

包内还有一套 `RemoteSession` + RTC + `/alice/dispatch/*`：

- `neotix.RemoteSession.joinRoom/leaveRoom/updateToken/sendMessage`；
- `RTC_START_ROOM_REQUEST/RESPONSE`、`AGWGetRTCSessionMeta`（`rtc_app_id/room_id/session_id/user_id`）；
- 设备发现、授权、发送命令、设备状态、移动端决策转发。

这套能力是**把当前会话/设备交给另一端（如手机或其他电脑）接管**，与云电脑（Windows GAC 实例）不是同一概念；本文不展开其业务流程，只将其视为“第三种远程入口”。[D12]

---

## 5. 两种模式对比

| 维度 | 本地电脑 | 云电脑（Cloud Desktop / PIP） |
| --- | --- | --- |
| 执行位置 | 用户 macOS | 云端 Windows（GAC） |
| 工具名 | `mac_computer_use_tool`、`general_computer_use` | `computer_use_tool` + `native_windows_gac` |
| 观察方式 | AX 树 + ScreenCaptureKit | Windows GAC 命令（截图/应用目录/输入） |
| 显示 | 无独立窗口（直接操作用户桌面） | `AHACloudDesktopWindow`，inline/floating/interactive |
| 视频 | 无 | `gpuVideoTrack`、`notifyVideoFrameRendered`、RDP 占位 |
| 初始化 | 系统权限 + 应用授权 | Windows 账户密码 + 环境安装/重启 |
| 权限确认 | `INIT_LOCAL_APP` / `USE_LOCAL_APP` / `CONTROL_LOCAL_APP` / `MAIN_DESKTOP_PERMISSION` | `INIT_PIP_ENV` / `PIP_CONTROL` / `MAIN_DESKTOP_PERMISSION` |
| 锁屏/干扰 | `AhaLockedUse` 可锁定用户输入 | 云桌面独立，用户不可直接操作（PIP 交互窗口可接管） |
| 文件系统 | 本地 workspace / sandbox | 云文件系统 `cloudComputer::fs` |
| 传输 | 本机 XPC / sandbox | GAC TCP/UDS/named pipe + ChaCha20-Poly1305 |
| 典型超时 | 150s / 700s | PIP 控制与初始化按交互/配置超时 |
| 开关 | 系统权限 + 产品配置 | `desktop_cloud_computer` 特性开关 |

---

## 6. 对 LinkSense 的启示

1. **把“执行目标”抽象成会话级配置，而不是两套 Agent**：
   - 同一套工具名（Computer/Browser/File）在服务端路由到不同 executor；
   - 客户端只负责展示权限、转发调用、上传结果；
   - 这比维护两套 Agent 循环更可控。
2. **本地与云端的权限模型要分开**：
   - 本地是 OS 权限（Accessibility/Screen Recording）+ 应用授权 + 桌面接管；
   - 云端是账户认证（Windows 密码）+ 会话初始化 + 接管确认 + 云文件系统授权；
   - 不要用一个 `allow` 布尔同时覆盖两者。
3. **云电脑必须有“初始化/重启/拒绝”闭环**：probe → 用户确认 → 密码 → 环境安装/重启 → ready；拒绝要记录原因并可回退。豆包的 `reportPipUsageDeclined` 与状态机可以直接借鉴。
4. **显示层与执行层分离**：PIP 窗口只负责渲染视频与接收输入；执行在 GAC 协议后；这使窗口崩溃/重连不影响执行会话（`reconnectInPlace`）。
5. **执行通道要防重放**：GAC 的“写/读失败后不重发”与 session/execution 绑定，是云端工具调用的关键；LinkSense 的 runner 通道也应区分“可安全重试”与“可能已执行”。
6. **云文件系统独立**：不要把云电脑文件映射成本地路径；用独立的 fs API 与任务/观察模型，避免本地路径语义污染云端。
7. **模式选择交给产品/服务端**：`desktop_cloud_computer` 开关 + `chat_window_runtime_environment` 事件，让实验/灰度/企业策略可控。

---

## 7. 未验证与风险声明

- 未启动应用、未连接云电脑；未验证 PIP 初始化、Windows 密码校验、视频帧渲染、剪贴板同步、云文件系统、GAC 握手与加密的实际行为。
- 云电脑服务端（Windows 环境、镜像、调度、计费）不在包内，本文只描述客户端协议与包内 GAC 客户端；服务端实现未知。
- 本地 CUA 的实际 AX/截图行为未运行验证；仅依据符号、字符串与 `gcu` 文档。
- UI 的云/本地模式选择文案与交互在加密 `.pak` 中，未读取；`chat_window_runtime_environment` 的具体选项未知。
- `AhaLockedUse` 的实际锁定/解锁流程、安装条件未验证。
- 未审计 `libaha_cua`、`libagent_infra`、`libmcp_helper`、云桌面 SDK 的第三方依赖与网络行为。
- 版本差异：2.36.19 的实现可能随版本变化；本文只对该样本负责。

---

## 附录 A：证据索引

| 编号 | 证据 | 说明 |
| --- | --- | --- |
| D01 | DMG 挂载 + `Info.plist` | 版本 2.36.19、Chromium 147 |
| D02 | `entry-moa/main.js` 工具适配器 | `mac_computer_use_tool`、`general_computer_use`、`computer_use_tool`、`browser_use` |
| D03 | `task-mode-resource/gac_runtime` 明文 Python | GAC 客户端、cell、transport、Windows 命令 schema |
| D04 | Framework 字符串 `[CLOUD_DESKTOP][*]`、`AHACloudDesktopWindow` | 云桌面会话/窗口/视频/SDK |
| D05 | Framework 字符串 `neotix::cloudComputer::fs::*`、`cloud_computer_session` | 云文件系统与会话 |
| D06 | `entry-moa/main.js` PIP 方法/场景/状态机 | `isPipSystemEnvironmentInitialized`、`INIT_PIP_ENV`、`PIP_CONTROL` |
| D07 | `entry-moa/main.js` `native-windows-gac-password` | Windows 密码与拒绝原因 |
| D08 | `libaha_cua.dylib` 符号/字符串 | macOS AX/ScreenCaptureKit/CG 输入、AhaLockedUse |
| D09 | `entry-moa/main.js` `INIT_LOCAL_APP`/`USE_LOCAL_APP`/`CONTROL_LOCAL_APP` | 本地权限与授权记录 |
| D10 | `entry-moa/main.js` `MAIN_DESKTOP_PERMISSION` | 主桌面权限 callback |
| D11 | `gac_runtime/transport/*.py` | GACF、HMAC、HKDF、ChaCha20-Poly1305、不重发 |
| D12 | `entry-moa/main.js` 远程配置/事件 | `desktop_cloud_computer`、`chat_window_runtime_environment` |
| D13 | `gac_runtime/runner.py`、`modules/computer_use_windows.py` | cell 执行与 Windows 命令协议 |
| D14 | `local_webcontents` `.pak` 头部 | 非标准 DataPack，UI 资源加密/专有 |

## 附录 B：关键路径

```text
DoubaoWork Browser.app/Contents/
├── Frameworks/.../Libraries/
│   ├── libagent_infra.dylib
│   ├── libmcp_helper.dylib
│   └── sbox/audit/
├── Resources/
│   ├── cua/libaha_cua.dylib              # 本地 macOS CUA
│   ├── cua/aha_locked_use/               # 锁屏服务
│   ├── computer_recording/libaha_cua_record.dylib
│   ├── task-mode-resource/
│   │   ├── gcu/                          # 本地 GCU Python API
│   │   └── python-packages/gac_runtime/  # 云电脑 GAC 客户端
│   └── local_webcontents/apps/entry-moa/main.js  # 模式/工具/权限适配
└── XPCServices/
    ├── AgentInfraService.xpc
    └── McpService.xpc
```

## 附录 C：术语

| 术语 | 含义 |
| --- | --- |
| 本地电脑 | 用户 macOS 桌面，通过 AHA CUA（AX + ScreenCaptureKit）控制 |
| 云电脑 | Cloud Desktop 的 Windows 实例，通过 PIP 窗口显示、GAC 协议执行 |
| PIP | 云桌面的悬浮/内联/交互窗口（推断为 Picture-in-Picture / PC-in-PC 语义） |
| GAC | GUI Agent Computer，云电脑侧执行 Windows Computer Use 的运行时/协议 |
| GACF | GAC 帧头魔数 |
| GCU | General Computer Use，本地 macOS 的 Python CUA API |
| AhaLockedUse | 本地控制期间锁定用户输入的辅助服务 |
