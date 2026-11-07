# Computer Use 白盒验收

日期：2026-11-07（Asia/Shanghai）。分支：`feat-computer-use`。
基线：`f74deb2a46f87ec035b069cf182c96c3d173a4d8`。

本次继续当前分支，覆盖 Shared、API、Controller/Runner、Web、桌面客户端、部署脚本和历史格式兼容。白盒验收阶段未切换分支、提交、推送、执行迁移或部署生产环境；提交和推送另按用户后续授权执行。

## 修复与补齐

1. **派发前账户权限竞态。** WebSocket 泵在数据库检查前验证账户，但检查等待期间禁用账户或更改 `authValidAfter` 后，旧连接仍可能收到命令。两个阻塞数据库的真实 WebSocket 回归在修复前都实际收到了 command。现在周期校验和最终派发共用账户、认证代次、设备凭据和连接校验；失效连接关闭，命令不重放。原有暂停、取消、更换连接、撤销和过期围栏保留。
2. **Runner 任务授权覆盖。** 新增 Default/Plan 两种模式回归，验证错误 token、跨任务 token、活动 projection turn、取消信号传递、Plan 禁写及任务关闭后 token 失效。复用既有任务和 app-server 测试夹具，没有新增模型循环或原生 turn 重试。
3. **原生动作贯穿 API。** 原生白盒复用真实配对和 WebSocket 客户端，通过 loopback HTTP 调用 Fastify 内部接口。每一步真实输入均经过服务端围栏、本机任务授权和安装包内的固定原生引擎，数据库与命令存储使用隔离测试夹具；不读取既有账户或 Keychain。
4. **原生滚动和有效引用。** MyGo 测试窗口没有可进行语义滚动的 AX 容器，因此增加独立 AppKit 滚动夹具。测试先观察位置 0，再调用 scroll，再观察实际偏移大于 0。Stop 校验使用停止前最后一次快照产生的有效 ref，避免拿本来就过期的引用证明 Stop 生效。临时 AppKit 程序在测试结束时关闭并删除，不随客户端发行。
5. **全仓测试夹具。** 历史修复测试自动给运行环境写入器内所有变量赋值，意外给旧版资源填入当时不存在的可选桌面安装包设置。夹具现保持这两个设置缺失，继续用未修改的已发布旧版严格解析器验证原有凭据、并发数和卷名。另六条安装包配置回归继续验证新配置传递和已有配置保留。
6. **Web E2E 稳定性。** 归档/删除图标断言同步当前设计基线中的 `DesignIcon`，保持颜色、尺寸、透明度校验。横向溢出断言现在实际等待 body 和 document 均满足原有 1px 容差，取代只等待返回值是数字的空轮询。消息渠道弹窗在一次 DOM 采样中检查边界，避免关闭动画后用已经移除的 locator 等待 30 秒。未改产品 UI、放宽布局容差或增加超时。

## 原生覆盖

安装包内 `agent-desktop@1.0.2` 通过实际 HTTP/WS 链路执行以下检查：

- `status` 不触发本机任务授权；应用和精确测试窗口可发现。
- `snapshot`、`focus`、`click`、`type`、精确窗口 `key`、PNG `screenshot`。
- 点击与输入后重新观察到对应效果；权限刷新不破坏已有引用。
- 非 Click 控件拒绝点击，不增加物理点击或任意坐标兜底。
- AppKit `scroll` 后重新观察真实文档偏移。
- 多个应用中的连续动作只获得一次当前任务授权。
- Stop 后拒绝刚生成的有效引用；`release` 后拒绝后续动作。

完整原生白盒必须同时获得辅助功能和屏幕录制权限，不再把未执行截图算作通过；未显式开启原生测试时报告 skipped。执行命令和 Xcode Command Line Tools 前提见[桌面客户端说明](../../apps/desktop/README.md#build-and-verify)。

## 升级兼容

- 无数据库、共享协议、设备 token、配对码、历史任务或能力资源格式变更。
- 仍有效的旧配对设备可继续连接和执行；无需重新配对、重建任务或重新发布能力。
- 禁用账户或认证代次失效时更及时地断开，是现有授权语义的修复。
- 未更改内置 Skill 内容和运行时指纹；原有快照刷新、名称冲突、旧 Browser Use ID 与端点兼容回归继续随全套测试运行。
- 旧版部署兼容测试保留原解析器和原数据断言。新增安装包配置没有被注入从未配置过这些字段的历史环境。

## 全量验证

最终根目录 `pnpm test` 连续完成并退出 0，各包测试数来自同一轮运行，不以单文件重跑拼接全绿结果。原生、构建和静态检查独立执行：

| 检查 | 实际结果 |
| --- | --- |
| Shared 全量 | 84 文件，712 项通过 |
| API 全量 | 349 文件，4713 项通过 |
| Runner 全量 | 86 文件，1166 项通过，1 项原有 Linux root 专用用例跳过 |
| Docs 全量 | 27 项通过 |
| 部署脚本全量 | 800 项通过，无跳过 |
| Web application | 35 文件，349 项通过 |
| Web components / shared-components / node | 434 文件，5414 项通过 |
| Web E2E | 150 项通过，包含真实隔离 Chrome 扩展配对、重连、页面操作与撤销 |
| 根目录合计 | 13331 项通过，1 项上述平台跳过 |
| 原生 `go test -race -count=1 -json ./...` | 44 个顶层测试通过；包含子测试共 84 项通过；实际原生窗口白盒通过 |
| `go vet ./...` | macOS 通过 |
| Windows amd64/arm64 `go test -c` 与 `go vet ./...` | 两种架构均通过；没有声称执行 Windows 测试 |
| `pnpm typecheck` | Docs、Shared、API、Runner、Web 和浏览器扩展全部通过 |
| `pnpm lint` | 通过；0 errors，保留既有 TanStack Virtual React Compiler 警告 |
| `pnpm build` | Docs 中英双语、Shared、API、Runner、Web 全部构建通过 |
| Web 变更文件格式与 `git diff --check` | 通过 |
| `pnpm desktop:build` 与 `codesign --verify --deep --strict` | macOS `.app`、DMG、ZIP 构建及签名完整性校验通过 |

新 Runner 授权测试增加后另外完成 Runner 类型检查；最后修改的 Web 测试另外完成 lint。Web 单测会输出现有 JSDOM `Could not parse CSS stylesheet` 提示，但全部断言通过，没有过滤输出、新增测试跳过或改变布局容差。Web 构建保留既有 `stream` 浏览器 externalization 与较大 chunk 提示。

本机日志位于 `/tmp/linksense-computer-use-20261107/`。本次临时 Docker CLI/Compose 的根目录复跑方式：

```sh
eval "$(fnm env --shell zsh)"
fnm use default
PATH="/tmp/linksense-computer-use-20261107/tools/bin:$PATH" \
DOCKER_CONFIG="/tmp/linksense-computer-use-20261107/tools/config" \
pnpm test
```

临时目录清理后需使用正常安装的 Docker CLI/Compose；Compose 配置解析不需要启动 Docker daemon。原生白盒命令继续以[客户端说明](../../apps/desktop/README.md#build-and-verify)为准。

macOS 安装包：`outputs/desktop/LinkSense-Desktop-macos.zip`。
SHA-256：`d538762cd69a3130eee5830636d06a3bde9900d855eefec5281d9aa2a2c05388`。

## 验收边界

- 本地 macOS arm64 原生动作与安装包已验证；Windows amd64/arm64 仅交叉编译和 vet，未执行 Windows UIA、安装/卸载、Credential Manager 或深链接实机流程。
- 没有 Docker daemon。本次补充的 Docker CLI/Compose 仅放在临时目录，用于实际 Compose 配置解析；部署脚本的模拟运行测试不能替代真实容器部署。
- 没有调用真实账户的付费模型会话。Runner/MCP/Controller 的身份与中继合同由白盒测试覆盖；自主选择工具、真实登录和生产模型连接不属于本次已验证结果。
- 真实账号在已安装客户端主窗口中的完整配对、授权弹窗操作及 Keychain 写入/恢复尚未验收；白盒使用测试授权回调，不读取或改写现有 Keychain。
- 原生动作只触及专用 MyGo/AppKit 窗口；锁屏、权限撤销、多显示器、macOS x64 和任意第三方应用矩阵未逐项实机覆盖。
- macOS 安装包为 ad-hoc 本地签名，尚未 Developer ID 签名或公证；Windows 安装包未签名。已经送达 OS 的输入不能回滚。
- 保留一项已有的 Linux root 专用 Runner 测试在 macOS 跳过；现有 TanStack Virtual React Compiler 警告不影响 lint 退出状态。

本次按 ponytail 与 simplify 复核，只修改业务授权检查及相应测试。另查阅 `modern-web-guidance` 的 `css-layout`；没有修改 CSS 或 UI 布局，最终只需要修正测试选择器与异步测量方式。
