# 消息操作与最后一轮重新生成：可行性调研

- 日期：2026-10-24，Asia/Shanghai。
- 用户要求：先调研截图中的基础 AI 聊天消息操作，重点评估最后一条 AI 回复增加“重试”；本次不实现。
- 结论性质：核对现有源码、固定版本原生 schema、OpenAI Docs，并运行已有隔离测试；没有操作真实会话、调用模型、修改应用代码或数据库。

## 1. 结论

**普通带文字消息可以实现，最小方案主要是补前端入口。** 当前已有“编辑最后一轮主用户消息并重新生成”的完整链路；AI 回复下的按钮可以找到该轮主用户消息，用它的原文调用同一条 mutation/API，不需要另造重试服务、执行循环或更换 Codex 版本。纯图片/文件、结构化输入等不能一概承诺只加按钮即可。[消息工具栏](../../apps/web/src/features/conversations/conversation-thread.tsx#L3009)、[现有 mutation](../../apps/web/src/pages/conversation-pages.tsx#L3888)、[重新生成路由](../../apps/api/src/modules/conversations/routes.ts#L496)

建议按钮在正常完成时叫“重新生成”，失败或停止后叫“重试”。它会重新执行该请求和可能的工具调用；不是仅替换一段 AI 文本。首期仅承诺最后一个普通对话轮次的原主问题，不扩展为任意历史消息编辑、答案版本切换或整轮自动重放。

## 2. 现有消息操作

| 位置 | 当前已有 | 本次建议 |
| --- | --- | --- |
| 用户消息 | 复制、旁聊“旁边问这段”、消息信息；满足条件的最新主用户消息可编辑 | 保留；编辑后继续使用已有重新生成链路 |
| AI 消息 | 复制、旁聊“旁边问这段”、消息信息；终态轮次最后消息可从此分支 | 最新可重试轮次的最终 AI 回复增加重新生成/重试 |
| 失败且没有 AI 文本 | 存在轮次状态/错误区域，不一定有可挂按钮的 AI 消息 | 同一操作放在该轮错误区域，避免无回复时无入口 |

前两行来自 [Message 工具栏](../../apps/web/src/features/conversations/conversation-thread.tsx#L3023) 与 [分支入口条件](../../apps/web/src/features/conversations/conversation-thread.tsx#L4855)。截图的气泡按钮实际进入旁聊，不应笼统当成完整的“引用回复”功能。[旁聊文案](../../apps/web/src/features/conversations/side-chat-messages.ts#L4)、[旁聊入口](../../apps/web/src/pages/conversation-pages.tsx#L6127) 当前最新可编辑消息排除了隐藏计划实施消息、运行中插入的 steer 消息和结构化用户输入。[editableMessageId](../../apps/web/src/features/conversations/conversation-thread.tsx#L4639)

“最后一条”应按 **最新可操作 turn + 该 turn 的最终 AI 消息** 判断，不能直接使用整个 messages 数组的最后一项；一个 turn 可能有过程回复、工具活动与最终回复，最后一项也可能是其他类型消息。已有按 turn 分组与 `final_answer`/旧消息无 phase 的处理可以复用。[消息分组](../../apps/web/src/features/conversations/conversation-thread.tsx#L4650)、[最终回复选择](../../apps/web/src/features/conversations/conversation-thread.tsx#L4698)

## 3. 最小实现路径

1. 从最新终态普通轮次找到现有规则允许且文本非空的主用户消息，保留其原文与 turn 关联；在对应最终 AI 回复提供图标按钮。失败没有 AI 文本时复用轮次错误区。
2. 按钮调用现有 `onRegenerateMessage(sourceUserMessage, sourceUserMessage.content)`。不得把 AI 消息 ID 发给 regeneration API：后端明确要求该轮第一条用户消息 ID。[后端来源校验](../../apps/api/src/modules/conversations/service.ts#L5093)
3. 复用现有 `stableOperationId`、`requestTurnStart`、乐观替换、错误恢复和列表刷新。当前 mutation 会记录 `replacesTurnId`，受理后绑定新 turn，失败则撤销待提交状态。[mutation](../../apps/web/src/pages/conversation-pages.tsx#L3899)、[错误恢复](../../apps/web/src/pages/conversation-pages.tsx#L3951)
4. 保留当前只读/执行权限、生成中、异步问答、计划审核与排队请求的禁止条件；补图标名称、Tooltip、键盘可达与六种语言文案。不要让“重试”绕过编辑所受的约束。[页面禁用条件](../../apps/web/src/pages/conversation-pages.tsx#L6196)

当前 REST 接口为 `POST /conversations/:id/messages/:messageId/regenerate`，请求含非空 `input_text` 与 UUID `idempotency_key`，返回 202。服务层验证 owner、会话锁、没有 pending 请求、当前原生 thread 的最新轮次已经终态、来源确为首个 user message，然后按 `manual_retry` 提交。[路由](../../apps/api/src/modules/conversations/routes.ts#L496)、[服务](../../apps/api/src/modules/conversations/service.ts#L5029)

## 4. Codex 原生协议与 Runner 边界

### 固定版本核验

项目将 Codex 固定为 **0.154.0**，Runner 启动校验必须精确匹配；本机 PATH 中的个人 CLI 为 0.163.0，不能替代部署版本证据。本次另用临时 `pnpm dlx @openai/codex@0.154.0` 确认版本并生成 `app-server generate-ts --experimental` 输出，没有改项目依赖、锁文件或全局默认值。[版本声明](../../apps/runner/src/codex/runtime-version.json#L2)、[精确版本校验](../../apps/runner/src/codex/runtime-version.ts#L41)、[协议投影说明](../../apps/runner/src/codex/protocol.ts#L1)

实际生成结果：

| 0.154.0 原生方法/字段 | 本次核对到的能力 | 对本需求的意义 |
| --- | --- | --- |
| `thread/fork` + `lastTurnId` | 复制到指定轮次，包含该轮；目标不能仍在运行 | 已有 Runner 用它保留重试轮次之前的历史 |
| `thread/fork.beforeTurnId` | 排除指定轮次及之后历史，不能与 `lastTurnId` 同用 | 原生 schema 存在，但现有适配器未投影；无需为本需求改走另一条路径 |
| `thread/start` + `turn/start` | 建立新原生 thread 并以输入开始生成 | 已有 Runner 用于重试首轮 |
| `turn/interrupt` | 请求中断运行中的 turn | 生成中应保留停止流程，不能直接并行再开一次重试 |
| `thread/rollback` | schema 仍存在，但明确 deprecated；只变更历史，不撤销文件 | 不用于新增实现 |
| `thread/revert` | 重写分页历史为指定轮次前缀；也不撤销文件 | 不需要采用，不能把它当作工作区恢复 |
| `regenerate` / `turn/retry` | `ClientRequest` 中没有独立的同名方法 | 应组合既有原生能力，不虚构原生重新生成接口 |

上述字段直接核对本次固定版本生成文件 `ClientRequest.ts`、`v2/ThreadForkParams.ts`、`v2/ThreadRollbackParams.ts`、`v2/ThreadRevertParams.ts`、`v2/TurnStartParams.ts` 与 `v2/TurnInterruptParams.ts`。生成文件只在临时目录，未加入仓库；重现命令见第 8 节。仓库只保留实际使用的较窄 [ThreadForkParams 投影](../../apps/runner/src/codex/protocol.ts#L175)。

当前 OpenAI Docs 也说明 `thread/fork` 复制历史、`turn/start` 开启生成、`turn/interrupt` 请求中断；当前文档的 `thread/rollback` 已移除，而 0.154.0 schema 仍有 deprecated 字段。**文档会变化，不能把当前页面的版本变化反推为部署版本行为。** [官方 App Server 文档](https://learn.chatgpt.com/docs/app-server#api-overview)、[当前撤回历史说明](https://learn.chatgpt.com/docs/app-server#revert-thread-history)

### 已有 Runner 的实际执行

- **重试首轮**：新建原生 thread，清空该新分支的历史基线，再开始新 turn。[process-pool.ts:1796](../../apps/runner/src/process-pool.ts#L1796)
- **重试有此前历史的轮次**：原生 `thread/fork` 到目标前一轮，核对返回历史与预期一致，再在分支开始新 turn。[process-pool.ts:1809](../../apps/runner/src/process-pool.ts#L1809)、[forkManagedThread](../../apps/runner/src/process-pool.ts#L2231)
- **目标不存在或仍运行**：启动前拒绝，不假造一轮成功记录。[目标验证](../../apps/runner/src/process-pool.ts#L1761)
- **模型改变**：已有来源模型压缩与目标模型分支处理；无需为重试按钮再设计一套模型迁移。[模型切换分支](../../apps/runner/src/process-pool.ts#L1833)

服务层通过 `forkFromCodexTurnId` 传递被重试轮次，而不是要求 Runner 重连后再次发送旧 `turn/start`。[runner 输入映射](../../apps/api/src/modules/conversations/service.ts#L11294) Runner 接受原生 `completed`、`failed`、`interrupted` 作为终态；前端可据此提供不同文案。[终态判定](../../apps/runner/src/process-pool.ts#L7866)

## 5. 必须区分的四种行为

| 行为 | 是否是新执行 | 应采用的规则 |
| --- | --- | --- |
| 用户对成功回复点“重新生成” | 是 | 显式提交一次新操作，保留来源关联，用原主问题重跑 |
| 用户对失败/停止轮次点“重试” | 是 | 必须已经终态并无未完成交互；通过同一受保护接口重新受理 |
| 浏览器 SSE 断线重连、页面刷新、恢复原生进程 | 否 | 继续读取原 turn 与已有事件，不能因连接恢复额外执行一次 |
| Codex 原生 `error.willRetry` / 网络恢复 | 由原生当前 turn 管理 | 映射原状态，不让 LinkSense 自动重复整轮 |

原生错误的 `willRetry` 已透传且影响展示；恢复代码使用 `thread/read` 的原生 turn 状态确认注册与终态。[错误映射](../../apps/runner/src/codex/event-mapper.ts#L205)、[恢复逻辑](../../apps/runner/src/process-pool.ts#L3898) 前端请求保留传输失败与结果不确定时的操作 ID，禁止靠请求重试来制造第二个原生 turn。[requestTurnStart](../../apps/web/src/features/conversations/turn-start-request.ts#L16)

## 6. 历史、附件与副作用

**重试不等于撤销已发生的动作。** Runner 的新建/分叉继续使用相同 workspace；文件不会回到上轮开始前。由代码与调用语义可以推断，再次运行工具也可能重新修改文件、上传结果或调用外部写接口；不能把普通聊天式“重新生成”解释成无副作用的文本抽样。[相同 workspace](../../apps/runner/src/process-pool.ts#L1796)、[工作区路径](../../apps/runner/src/workspace/workspace-manager.ts#L239) 官方历史撤回说明同样明确不会撤销本地文件。[OpenAI Docs](https://learn.chatgpt.com/docs/app-server#revert-thread-history)

已有实现会复用被重试轮次绑定的附件，并为新轮创建附件关联；知识库、能力与协作模式也沿现有重新生成流程解析和校验。[提交上下文](../../apps/api/src/modules/conversations/service.ts#L5125)、[原附件选择](../../apps/api/src/modules/conversations/service.ts#L7966)、[附件关联](../../apps/api/src/modules/conversations/service.ts#L8508) 这不保证附件已删除、权限已撤销、能力已停用后仍能重试，也不保证重新使用当年的资源版本。

**纯附件输入存在实际能力差异**：正常提交已有 attachment-only 用例，但 regeneration 路由和服务都要求非空文字。因此仅补按钮不覆盖“只发图片/文件，没有输入文字”的重试。最小范围需明确不提供这类入口；若要支持，应调整 regeneration 的输入边界，同时确认来源轮仍有可用附件，不能放宽为空请求。[正常纯附件用例](../../apps/api/test/conversations.service.test.ts#L9716)、[regeneration 输入边界](../../apps/api/src/modules/conversations/routes.ts#L501)、[服务端重复验证](../../apps/api/src/modules/conversations/service.ts#L5039)

新分支保留目标之前的历史，旧目标轮次仍属于旧原生 thread；服务将此前轮次绑定到新 thread，并建立新 turn。读取时按当前 thread 投影，因此旧目标轮次不在当前可见历史。当前没有“第 1/2 个答案”切换 UI，不能把保留旧记录描述成已有答案版本管理。[分支记录更新](../../apps/api/src/modules/conversations/service.ts#L8330)、[新 turn 创建](../../apps/api/src/modules/conversations/service.ts#L8361)、[当前 thread 投影](../../apps/api/src/modules/conversations/service.ts#L2494)

**steer 边界**：当前 API 只提交主用户消息的 `inputText`，Runner 在目标前分叉后以它重新开始；目标 turn 中后来插入的 steer 指导不会自动合并成这次输入。这是源码推导，尚未执行真实 steer+重试实验。[输入构建](../../apps/api/src/modules/conversations/service.ts#L5126)、[Runner context](../../apps/api/src/modules/conversations/service.ts#L11310) 首期应明确“重跑原主问题”的语义；结构化消息、Goal、计划实施、纯附件且无文本等特殊输入需单独确认，不能简单放开所有消息的按钮。

## 7. 旧数据与兼容性

对于已经具有有效 `codexThreadId`、最新终态 turn、主用户消息及可访问原生历史的现有会话，补前端入口可以复用已有 regeneration API，方案本身不要求新增数据库字段或迁移。这是接口/源码层可行性，不是对所有旧数据的完整兼容证明。

缺失原生 thread、目标原生 turn、首条用户消息，或者数据库关系与原生历史失配时，现有流程会拒绝。前端应保持可用性条件、正确恢复失败状态，不得把“显示按钮”当作已修复旧记录，也不能暗中要求用户重建、重新导入或重新发布资源。[服务端来源约束](../../apps/api/src/modules/conversations/service.ts#L5057)、[事务内复核](../../apps/api/src/modules/conversations/service.ts#L7916)、[原生目标与历史核验](../../apps/runner/src/process-pool.ts#L1761)

本次没有对生产旧数据采样，也没有在真实旧版 rollout 上执行重试；不存在、缺失字段和过期附件等路径仍需实现时补充针对性用例。直接新建全字段 fixture 的测试通过，不能替代升级兼容检查。

## 8. 已执行的核验与后续验收

已执行：

```sh
pnpm dlx @openai/codex@0.154.0 --version
pnpm dlx @openai/codex@0.154.0 app-server generate-ts --experimental --out <temporary-directory>
pnpm --filter @linksense/api exec vitest run --project services test/conversations.service.test.ts test/conversations.routes.test.ts --maxWorkers=1 -t regenerat
pnpm --filter @linksense/runner exec vitest run test/process-pool.test.ts --maxWorkers=1 -t 'starts a fresh native thread when editing the first interrupted turn|forks before the interrupted turn when earlier history exists|forks through the turn preceding the edited message before starting|rejects a fork when the target turn|forks an independent thread through the selected terminal turn|compacts the source branch before changing models during'
```

- API：2 个测试文件通过，9 条匹配测试通过；442 条被名称筛选排除。覆盖现有已完成/已中断轮次与附件、幂等、受理、pending/running/steer 拒绝、过载不绑定暂存附件，以及路由参数契约。[服务测试](../../apps/api/test/conversations.service.test.ts#L11136)、[幂等测试](../../apps/api/test/conversations.service.test.ts#L11390)、[拒绝路径](../../apps/api/test/conversations.service.test.ts#L11485)、[路由测试](../../apps/api/test/conversations.routes.test.ts#L1170)
- Runner：1 个测试文件通过，8 条匹配测试通过；220 条被名称筛选排除。覆盖首轮、新分支、终态校验、独立分叉与模型切换重试。[首轮测试](../../apps/runner/test/process-pool.test.ts#L7012)、[中途轮次测试](../../apps/runner/test/process-pool.test.ts#L7088)、[目标校验测试](../../apps/runner/test/process-pool.test.ts#L7299)、[模型切换测试](../../apps/runner/test/process-pool.test.ts#L4715)

均为现有隔离 mock/临时文件夹测试，没有创建真实 Codex 会话、访问真实 PostgreSQL 或调用付费模型。版本/schema 命令只生成临时协议文件；Node 按 `fnm use default` 使用 v24.22.1，项目 pnpm 声明保持 10.34.6。

后续若实现，最相关的一组交互回归应验证：只有最新可操作 AI 最终回复有按钮；点击原文只受理一次；运行/只读/待交互时不可用；失败无 AI 文本仍有入口；出错保留原答案并恢复按钮；旧消息无 phase 或缺失原生关联不会崩溃。失败、附件、steer 和旧记录要用代表性数据补齐，而不是增加多套重复验证。

本次未做浏览器视觉验收、真实原生生成/工具副作用实验、生产升级验证或全量测试。主要限制是重试可能再次执行工具，且特殊轮次与部分旧数据尚不能统一承诺可重试。
