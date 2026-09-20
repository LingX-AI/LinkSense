# 跨任务 Prompt Cache 对照实验

记录日期：2026-09-11。阶段范围：完成可复现的最小实验，验证「同一用户稳定缓存分组＋公共指令前置」的可行性。生产 Runner 的缓存 key、指令注入和计费逻辑尚未修改。

> 2026-09-20 复核：当前已升级 Codex 0.154.0 并采用共享用户工作区，本文实验脚本依赖的任务 AGENTS.md 已不再生成，夹具采样无法完成。以下保留当时的历史结果，不能将其收益比例直接用于当前版本；当前状态与下一步建议见 [全链路复核](./prompt-cache-review-2026-09-20.md)。

## 结论

在现有默认渠道「Codex LB渠道」、`gpt-5.6-terra` 上，组合方案出现了可观察的缓存收益。每组 3 个新任务，去掉每组第一次请求后，组合方案缓存 Token 命中率为 **75.3%**，基线为 **55.6%**。按当前渠道配置单价估算，剩余两个请求的总费用降低 **35.5%**；包含第一次请求时，费用降低 **18.1%**。

首字延迟没有改善。每组只有 3 个样本，不能据此承诺生产节省比例或提速。单独稳定 key 的结果不稳定，单独前置指令在本轮没有命中；后续应继续验证组合方案，不应把只改 key 作为已经证明有效的优化。

基线使用不同 key 仍然命中了缓存，说明无法仅凭发送的 key 确认该转发渠道的实际缓存分组与路由。不能宣称实验组之间完全隔离，也不能把差异全部归因于某一个参数。

## 实验设计与边界

复用项目现有 `WorkspaceManager`、`buildTurnAdditionalContext`、`CodexJsonRpcClient`、`ModelGateway` 和 SSE 解析器，没有新增依赖。

1. 在临时目录为同一个合成用户创建不同任务工作区，使用项目固定版本 **Codex 0.150.1** 生成真实的首轮请求。
2. 原生链路为工作区规则 → additionalContext → thread/start、turn/start → ModelGateway → 本地响应夹具。模型、工具集合、Default 模式和推理强度固定；没有业务 MCP、用户 Skill、记忆或真实用户内容。
3. 用四个实验组分别测量原方案、仅稳定 key、仅前置指令、两项同时启用。每轮轮换执行顺序。key 按实验运行、实验组、合成用户、渠道、模型分组；基线与仅前置组还包含原生任务 key。
4. 前置方案只将生成的任务 AGENTS.md 中不含 workspace、HOME、CODEX_HOME 具体路径的规则，以及四段固定平台 additionalContext 移到原生 `developerInstructions`。具体路径、应用指令、引用数据保留在原来的任务上下文。模板格式变化时实验直接失败，避免静默漏掉规则。
5. 保存网关处理后的请求到内存。真实测量阶段直接向同一个已配置渠道发送这些请求，每个请求只生成一次，固定 `tool_choice=none`、`max_output_tokens=256`，不执行工具、不重放真实业务 turn、不进行自定义重试。
6. 真实测量覆盖模型 HTTP 边界，首字延迟从发送请求到第一个非空 `response.output_text.delta`。它不包含 Codex 进程启动、API 持久化、SSE 到前端和页面渲染时间。

四段前置平台上下文：`linksense.runtime-identity`、`linksense.interactive-forms`、`linksense.local-web-server-policy`、`linksense.inline-html-preview`。这只是固定 Default 模式的实验分区，不能直接用于生产的 Plan 模式或动态能力切换。

支持 `native_responses` 与 `responses_tool_compat`。`chat_completions_bridge` 不在本实验范围：当前桥接路径不会保留这些缓存参数，需要独立核实目标渠道协议。

## 请求结构验证

比较时只排除原生消息 ID，不删除工具 ID、不重排工具或历史、不改写角色。以下是 JSON 公共前缀字符数，**不是上游实际渲染的 Token 数**。

| 验证模型 / 协议 | 原方案公共前缀 | 指令前置后 | 增加 |
| --- | ---: | ---: | ---: |
| gpt-5.6-luna / native_responses，本地夹具 | 30,852 | 38,827 | 7,975 |
| gpt-5.6-luna / responses_tool_compat，本地夹具 | 30,610 | 38,585 | 7,975 |
| gpt-5.6-terra / native_responses，真实渠道请求 | 38,891 | 46,866 | 7,975 |

两个协议的夹具各完成 12 个原生新任务。各组工具集合一致，稳定 key 组各只有一个 key，另外两组每个任务拥有独立 key。

## 真实渠道结果

12 个请求全部完成，返回的模型名称均为 `gpt-5.6-terra`。输入合计 126,785 Token，输出合计 60 Token。每条响应都明确返回 `cache_write_tokens=0`；这是该渠道本次返回值，不代表所有模型或渠道都没有写入成本。

### 包含每组第一次请求

| 实验组 | 请求数 | 输入 Token | 缓存读取 Token | Token 加权命中率 | 估算总费用 | 首字延迟中位数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 原方案 | 3 | 31,788 | 11,776 | 37.0% | 0.36022815 | 2.416 秒 |
| 仅稳定 key | 3 | 31,748 | 11,776 | 37.1% | 0.35955095 | 2.422 秒 |
| 仅前置指令 | 3 | 31,620 | 0 | 0.0% | 0.53685015 | 2.144 秒 |
| 两项同时启用 | 3 | 31,629 | 15,872 | 50.2% | 0.29511324 | 2.440 秒 |

### 去掉每组第一次请求

这只是排除首个观测样本，不代表上游已经进入确定的热缓存状态。

| 实验组 | 请求数 | 输入 Token | 缓存读取 Token | Token 加权命中率 | 估算总费用 | 首字延迟中位数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 原方案 | 2 | 21,182 | 11,776 | 55.6% | 0.18016072 | 2.017 秒 |
| 仅稳定 key | 2 | 21,152 | 5,888 | 27.8% | 0.26938594 | 1.921 秒 |
| 仅前置指令 | 2 | 21,090 | 0 | 0.0% | 0.35806940 | 2.118 秒 |
| 两项同时启用 | 2 | 21,089 | 15,872 | 75.3% | 0.11616319 | 2.346 秒 |

费用按实验后只读查询的渠道配置计算：每百万普通输入 16.93、缓存读取 1.69、输出 101.57；计价单位沿用该配置，不推断币种。写入单价未知，本次所有响应明确返回零写入，因此不影响这次估算。全部请求合计估算费用为 1.55174249。**这些是配置单价估算，不是供应商账单，也不代表真实业务整条任务的成本降幅。**

计算方式：

```text
缓存命中率 = sum(cache_read_tokens) / sum(input_tokens)
估算费用 = ((input - read - write) × input_price
          + read × read_price + write × write_price
          + output × output_price) / 1,000,000
```

任何 Token 字段缺失均记为未知；写入 Token 非零而写入单价未知时不估算费用。只读取最终响应 usage，不累加中间累计快照。首字延迟不使用推理增量或响应头时间代替。

## 复现

需要与 `apps/runner/src/codex/protocol.ts` 的 `CODEX_SCHEMA_VERSION` 完全一致的 Codex 可执行文件。脚本遇到版本不匹配会停止；不要为了运行实验修改个人机器的 Codex 版本。可通过 `CODEX_BIN` 指定相应二进制，或在项目 Worker 镜像内运行。

在仓库根目录执行，不传 `--live` 时不会向真实模型发送请求：

```sh
pnpm benchmark:prompt-cache --rounds 3 --output /tmp/linksense-cache-fixture.json
LINKSENSE_CODEX_PROTOCOL_MODE=responses_tool_compat pnpm benchmark:prompt-cache --rounds 3
```

真实调用需通过受控环境提供 `LINKSENSE_CODEX_BASE_URL`（HTTPS，无 URL 凭据）、`LINK_SENSE_API_KEY`、`LINKSENSE_CODEX_MODEL`。可选 `LINKSENSE_CODEX_PROTOCOL_MODE`，默认 `native_responses`；可选 `LINKSENSE_CACHE_BENCHMARK_PRICING`，格式为 `{"input":16.93,"read":1.69,"write":null,"output":101.57}`，使用所选渠道当时的单价。

```sh
pnpm benchmark:prompt-cache --live --rounds 3 --output /tmp/linksense-cache-live.json
```

每组至少 2 次、最多 10 次；默认共 12 个真实请求，每次输出上限 256 Token、超时 60 秒。输出文件只包含统计结果，不包含 key、渠道地址、请求正文、用户内容或模型回答；在请求前拒绝覆盖已有文件。途中失败时保存已完成样本，记录没有获得 usage 的请求数量，返回非零退出码；此时已测费用不能当作全部请求费用。使用运行环境设置凭据，避免把密钥写进命令历史或结果。

本次项目 Worker 镜像未包含开发用 tsx，因此用工作区已安装的 tsx 所依赖的 esbuild 将实验入口及本地模块打包到临时目录，保留第三方包为外部依赖，再将该临时入口只读挂载到 Worker 镜像中执行。夹具运行使用 `--network none`；真实渠道的配置仅经内存与标准输入传入临时容器，没有落盘凭据或修改已部署服务。

回归命令：

```sh
pnpm --filter @linksense/runner exec vitest run --pool=forks --maxWorkers=1 test/prompt-cache-benchmark.test.ts test/model-gateway.test.ts test/model-gateway-tool-compat.test.ts test/context.test.ts test/workspace-manager.test.ts
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/runner lint
```

最终回归：5 个测试文件、108 项测试通过，1 项既有 Linux root 专用用例在 macOS 跳过；包含本次新增的 9 项单元测试。Runner 类型检查、Runner 全目录 lint 均通过。最初使用默认 4 个 worker 时，3 个未修改的工作区测试发生 5 秒超时及后续清理冲突；改为单 worker 后原断言和原超时阈值下全部通过，没有修改或跳过失败用例。本次只增加实验工具和开发文档，未运行全仓库测试与生产构建。

## 推广前的验收边界

本轮足以证明公共规则可以前置，组合方案在一个现有渠道出现了缓存收益。生产实现还需要覆盖真实工具/Skill 集合、Plan/Default 切换、原生 resume/fork、渠道切换、记忆调用和用户隔离，并检查提高规则优先级后的行为保持正确。需增加重复样本、核实转发渠道是否保留 key 和缓存计费字段，再判断是否按渠道启用。

原生 `thread/start` 支持 `developerInstructions`；项目版本的 `turn/start` 没有 prompt cache key 参数。因此 key 实验位于模型 HTTP 边界，没有在 Codex turn 生命周期中加入重试、重新执行或历史重建。

参考：[OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[缓存诊断](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics)。供应商文档规定的行为不能直接当作转发渠道已经实现的行为，本报告的数值均来自以上本地与真实渠道实验。
