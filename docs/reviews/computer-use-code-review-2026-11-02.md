# Browser Use / Computer Use 全量改动审查

审查开始：2026-11-02；最终复核：2026-11-03（Asia/Shanghai）。基线：`8c73cb35019ef74910bd5198f5f9b7f100ae1b2e`；范围为本次全部已跟踪未提交差异和未跟踪源码、测试、配置及文档，不把目录移动误认为已完成行为审查。

按两条独立轴审查：工程标准/安全，以及已确认需求/升级兼容。假设为生产多 API、Controller/Worker 进程和多个账号并发；设备控制仍按账号串行。没有切分支、提交、推送、执行数据库迁移或改写用户资源。

## Standards：工程、安全和并发

以下问题均已修复。

1. **[P2] 状态查询与派发之间更换设备，会错误影响替换设备。** `ComputerUseService.execute` 原来只比较首次 status 的设备，随后重新取得的连接可能已经属于另一设备；`release` 可暂停新设备，其他请求则被错误入队。现再次比较连接凭据中的显式 `device_id`，不自动改控另一台电脑。回归覆盖 release 和普通请求两条交错。
2. **[P2] 旧连接的延迟暂停会删除新连接命令。** `ComputerUseService.pause` 在旧暂停成功后可能跨过一次重连，最后删除新 request。现检查 request 的 `connection_id`，删除仍使用精确值比较，不影响替换连接。
3. **[P2] WebSocket 控制和回包状态存在并发竞态。** 原来异步 `handle` 并发处理有序到达的 pause/resume，较早暂停可晚于恢复生效；本机暂停回声和旧 Redis 暂停观察也可把显式恢复再次变成暂停。另外，后台任务重验的数据库 await 期间成功回复会清除 `inFlight`，随后泵继续解引用已清除对象并关闭正常连接。现按到达顺序处理、限制积压最多 16 条、不回声本机暂停、用恢复代次隔离过期观察，并对重验的活动命令保存快照，在发取消前核对仍为同一条命令。真实 loopback WebSocket 回归覆盖所有交错；完成回包期间的重验测试曾实际收到 closed，修复后收到下一条 command。
4. **[P2] 不确定写入后仍可使用旧快照引用。** 原生执行器仅在成功分支清引用，原生失败但已影响 UI 时可能继续操作旧目标。现尝试任何写入或新快照前先使旧引用失效；成功快照才重新建立引用。隔离执行器返回 `ACTION_FAILED` / unknown 的回归在修复前失败、修复后通过。
5. **[P2] 后台工作会禁用本机暂停。** 主按钮统一继承 busy，后台权限检查期间即便仍连接也无法暂停。现暂停按钮不受普通 busy 禁用，其他连接/配对按钮仍维持重复提交保护；定向 UI 回归验证暂停调用和引擎停止。
6. **[P2] 桌面发行包缺少随包许可和通知。** 原 `.app` 只有原生程序及语言资源，源仓库的法律文件没有随 ZIP/DMG 分发。构建现复制产品法律文件及固定 Go/MyGo/原生引擎/图标依赖的完整许可文本到 `Contents/Resources/legal/`；临时目录测试验证产物包含真实内容，最终 `.app` 已核对。
7. **[P2] 网关增加桌面通道后遗漏另一份发布回归断言。** 全量脚本测试发现 release gateway 的转发计数仍按旧通道数量断言。已同步新旧 Browser Use 和 Computer Use 三条地址的实际计数，保留协议、Upgrade、维护及转发头校验；不是删除测试或降低门槛。

主要代码入口：

- `apps/api/src/modules/computer-use/service.ts`
- `apps/api/src/modules/computer-use/routes.ts`
- `apps/desktop/engine.go`
- `apps/desktop/view.go`
- `scripts/desktop.mjs`、`scripts/desktop.test.mjs`
- `scripts/deployment.test.mjs`、`scripts/release-installation.test.mjs`

## Spec：需求和升级兼容

以下两组升级阻塞均已修复。外显名称仍为 Browser Use，客户端名称仍为 LinkSense helper，设置图标居中修复保持不变。

1. **[P1] 纯更名破坏已安装扩展、配对及历史工具调用。** 当前差异曾同时更改 Redis 命名空间、HTTP/WS 路径、共享包入口、错误码和旧工具分派。旧 Redis 凭据不再被读取，旧扩展保存的 endpoint 被拒绝，旧 Worker/Controller 转发变成 404。现保留既有存储命名空间和配对响应地址，新旧网络路径共用同一权限校验；严格转换已知错误码，保留旧共享包入口和隐藏工具分派。工具发现只公布 `browser_use`。旧 Web Storage 键和六语言历史活动展示保持可用，不要求重新配对。
2. **[P1] 内置 Skill 改 ID/slug 导致旧任务恢复失败并占用原本合法的自定义名称。** 已保存的 `builtin:capability:linksense-local-browser` 会被新 schema 拒绝，影响 pending/start-intent、历史 capability 事件及恢复/停止；同时既有自定义 `linksense-browser-use` 被新保留名排斥。现保留旧内置目录、slug、ID 和保留名，新 ID 只作为精确输入别名归一到稳定 ID。直接发布旧格式自定义资源、与内置资源共存及既有快照使用的回归均通过，无需用户改名、重新导入或重建。

内置 Skill 生成字节恢复为基线内容，所以内容指纹正确保留 `f4a2c2b39279d7c353d191f954f6734cfdd528cff2a13c7db80cf089a99d7297`，指纹及既有快照刷新测试均通过。没有通过放宽签名、路径、Plan、owner 或 scope 校验取得兼容。

主要代码入口：

- `packages/shared/src/capabilities.ts`、`packages/shared/src/browser-use.ts`、`packages/shared/src/local-browser.ts`
- `apps/api/src/modules/browser-use/`、`apps/api/src/modules/capabilities/user-home-materializer.ts`
- `apps/runner/src/mcp/core-service-registry.ts`、`apps/runner/src/server.ts`、`apps/runner/src/controller/server.ts`
- `apps/web/src/features/browser-use/`、`apps/web/src/features/conversations/native-activity-view-model.ts`
- 三份 Nginx 网关模板和 `docs/development/browser-use.md`

## 最终验证

| 检查 | 实际结果 |
| --- | --- |
| Shared 全量 `pnpm --filter @linksense/shared test` | 84 文件、707 项通过 |
| API 全量 Vitest（threads / 1 worker） | 349 文件、4698 项通过 |
| Runner 全量 Vitest（forks / 2 workers） | 86 文件、1153 项通过；1 项原有 Linux root 专用测试在 macOS 不适用 |
| Native `go test -race -count=1 ./...`、`go vet ./...` | 全部通过，包含真实 Fastify/WebSocket 协议、取消/过期、旧代隔离、引用失效及 UI 回归 |
| 最终 `.app` 真实原生窗口测试 | 通过：聚焦、按钮点击、输入、按键、窗口截图、停止后旧 ref 拒绝；只触及专用测试窗口 |
| `pnpm --filter @linksense/web test:browser-extension` | 隔离 Chrome 1 项端到端通过：HTTP 配对、重连、真实页面操作及撤销；不读取用户 profile |
| 全仓 `pnpm typecheck` | 通过，含 Docs、Shared、API、Runner、Web 和扩展 TypeScript |
| 全仓 `pnpm lint` | 0 errors；保留现有 `conversation-message-list.tsx` 的 TanStack Virtual React Compiler 警告 |
| Shared、API、Runner、Web production build | 全部通过，Web 保留既有较大 chunk 提示 |
| `pnpm desktop:build` 与本地签名校验 | `.app` / DMG / ZIP 构建通过，最终原生测试使用该包，随包 legal 资源存在 |
| 全量 `node --test --test-concurrency=2 scripts/*.test.mjs` | 788 项中 781 通过、7 项因 `docker ENOENT` 未通过；未改写/跳过 Docker 测试 |
| Web 全量 application / components 等项目 | 非连续全绿：初跑及最终轮次的实际差异详见下文，不将文件重跑计作整套一次通过 |

API 在新增最后一条回包竞态回归前，2 worker 全量 4697 项通过。补齐该回归后的 2 worker 重跑有 7 项能力文件系统相关用例超时；最后 1 worker 全量 4698 项全部通过，未修改这些超时、断言或实现，不能据此宣称并行稳定性已解决。

Web 单测初次完整执行：application 349 项通过；其余项目 5388 项通过、3 项失败（两个 5 秒超时、一个异步分页断言）。三个文件单 worker 复测共 179 项通过，未增加超时或修改断言。最终 application 再跑时有一个设置套件的 10 秒初始化 hook 超时，导致该套件 10 项未执行；单独重跑这 10 项全部通过。最终其他项目 5397 项通过、1 项应用工作区测试超过 5 秒；该完整文件单 worker 复测 46 项全部通过，没有修改其超时、断言或实现。此记录保留冷启动/并发时序不稳定的风险，不把按文件重跑包装成连续整套稳定通过。

## 交付与未验收

源码和回归已完成，未发现仍未处理的已确认代码或升级兼容阻塞；这不是生产发布放行。

- 没有 Docker CLI，7 项 Compose/容器相关检查及生产代理、生产安装包只读挂载未验收；具备 Docker 的环境应重跑全量脚本测试。
- 没有使用真实账号、私有 Keychain 凭据或付费模型执行聊天全链路；独立启动 `.app` 的 OS 权限仍需用户授权。
- 只验证 macOS arm64。Windows/Linux、x64 实机、Edge、锁屏和具体第三方应用矩阵未验证；安装包仍为本地 ad-hoc 签名，没有 Developer ID 公证。
- 新增 `computer_use_intent` 用量分类要求 Shared/API/Web 同步发布；旧版本回滚对该分类的处理仍需部署者评估。
- 已送达系统的输入不可回滚；暂停/取消和未知送达不能被描述为桌面状态恢复。原生内部 stdio 协议固定为上游版本，升级必须重新验证。

结论：Standards 7 组问题、Spec 2 组问题已修复；两轴各自最严重问题分别为 P2 和 P1。剩余边界为环境/平台验收及已记录的 API/Web 并发测试不稳定，不是通过新数据测试掩盖历史资源失效。
