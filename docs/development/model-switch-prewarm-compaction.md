# 模型切换预热跳过上下文压缩

## 现象与根因

已有会话从 DeepSeek 切换到 GPT-5.6 Luna 后，模型请求被拒绝：
`input[62].content` 的数组长度为 1，而接收方只允许长度为 0。切回 DeepSeek 后可继续执行。

这不是上下文长度超限。历史中存在带非空 `content`（`reasoning_text`）及非空
`encrypted_content` 的源模型推理项；这些字段不能直接作为另一模型的推理状态重放。
故障会话的原生记录没有 `compacted` 项，各次模型切换也没有产生新的原生线程。

现有切换逻辑本应使用源模型执行原生 `thread/compact/start`，等待成功，再
`thread/fork` 到目标模型并发送新输入。预热路径却复用了“恢复已接受轮次”的逻辑，
用目标模型执行 `thread/resume`，提前把运行时模型标记成了目标模型。正式发送复用
该进程时，便无法识别模型变化。此外，复用健康进程的发送路径跳过历史读取，即便
修正预热模型，也会因没有读到历史而跳过压缩。

## 修复边界

- 预热有待切换模型的会话时，明确使用已授权的源模型恢复原生线程。打开页面本身
  不压缩、不发送用户输入，也不消耗一次应用试运行。
- 正式发送时，模型变化必须读取原生历史，不能使用同模型进程复用的省略读取路径。
- 压缩成功后才切换并开始新轮次；压缩失败不创建目标轮次，也不自动重放用户输入。
- 已接受轮次的恢复仍使用该轮次的模型，不被预热的源模型选择覆盖。
- 沿用 Codex 0.154.0 的原生压缩、分支和事件语义，不新增模型网关过滤规则或依赖。

## 既有数据与升级

无需数据库迁移或手工修改 rollout。业务任务、应用工程及聊天记录保留。既有 API
按当前原生线程最后成功的轮次确定源模型，因此目标模型失败的旧会话可以在下一次
发送时正常进入压缩流程，不需要重建应用或清空对话。

运行中的任务执行容器不会仅因控制器源码更新而自动更新。开发环境在任务空闲时
执行 `pnpm dev:worker:rebuild`，替换 worker 镜像并刷新控制器；生产环境按正常发布
流程更新 worker 镜像及其 revision。不要在有活动任务时强制清理 worker。

## 验证

`process-pool.test.ts` 新增预热后切换模型的回归测试，包含旧目标模型失败记录、
源模型压缩成功/失败、进程复用、源模型路由授权及不额外启动轮次。保留现有恢复、
中断、重新生成、同模型预热测试。

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/runner test test/process-pool.test.ts test/model-gateway.test.ts
pnpm --filter @linksense/runner test test/turn-start-contract.test.ts test/controller-worker-contract.test.ts test/controller-server.test.ts
pnpm --filter @linksense/api test test/conversations.service.test.ts -t 'prewarm|source runtime|source channel|model transition|target model'
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/runner lint
pnpm --filter @linksense/runner build
```

原生协议冒烟使用同版本 Codex 和本地模拟模型服务、隔离临时 HOME，无真实账号调用：

```sh
CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:model-switch
CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:model-switch --deepseek-to-luna
```

第二条覆盖带明文推理和非空加密字段的源响应，验证原模型收到完整历史用于压缩，
目标模型收到压缩上下文且不包含源推理字段。第一条保留 GPT → Qwen 路径。
这些验证不等于真实远端模型服务的端到端验收。

协议依据：[Codex app-server](https://developers.openai.com/codex/app-server) 的
`thread/compact/start` 异步完成语义，以及
[推理状态的模型兼容范围](https://developers.openai.com/api/docs/guides/reasoning)。
实际参数契约以部署的 `codex app-server generate-json-schema` 输出为准。
