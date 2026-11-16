# Codex 0.168.0 升级与验收

日期：2026-11-13。升级范围：开源版 `develop` 的 `0.154.0 → 0.168.0`。
保留开始工作时已有的联网搜索及其他未提交修改。本次不操作业务数据库、不发布或部署服务。

## 实现

- 唯一版本声明 `apps/runner/src/codex/runtime-version.json` 更新为 `0.168.0`。
  Worker 启动继续严格校验实际版本；应用 Worker 构建也调用同一校验，拒绝继承旧版核心的运行时镜像。
- 对照两个实际二进制导出的实验性 TypeScript 和 JSON Schema：现有 20 个客户端请求方法均保留。
  上游删除的 `thread/rollback` 不在当前调用路径中；没有增加替代回合、重试或输入重放。
- 统一共享消息阶段 Schema，保留 `partial_answer`，贯穿原生事件映射、API 持久化、
  流式消息、普通与嵌入页面、公开知识库及分享契约。中间回答不能成为最终分享内容或知识库最终输出。
- 接受 `flexUnavailable`、`modelNotFound`、`policyCapacityUnavailable`、`tooManyDenials`，
  保留原生 `willRetry` 和终态；未识别的原生字符串、对象和额外字段仍被过滤。
- 使用原生 `agents.enabled` 替代弃用开关。模板加载器把该策略作为启动参数覆盖已有 HOME，
  无需改写用户的原生配置；公开知识库和隔离功能脚本显式禁用子智能体。
- 复用既有 Zod、smol-toml 和原生 app-server；没有添加第三方库，没有修改 Prisma Schema 或迁移。
  消息阶段位于既有事件 JSON 中，旧的缺省/null、commentary、final_answer 记录仍可读取使用。
  本次未增加界面文案或改变布局。

协议依据：[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)，
版本依据：[官方更新日志](https://learn.chatgpt.com/docs/changelog)。

## 验证方式

单元回归覆盖新增消息阶段、最终输出选择、分享过滤、消息持久化、Stop hook、流式消息交接、
新错误码、未知错误脱敏、既有记录及模板策略的有效/无效配置。修复前已运行回归并观察到失败。

真实 Codex 功能验收使用临时 HOME 和本地确定性模型服务，不使用用户配置、业务数据或外部模型密钥。
`test:codex:upgrade` 覆盖三种网关模式、执行中回答、完成并重启后回答、真实 shell 写文件、
计划事件及原生中间回答阶段。

新增历史升级脚本先由实际 `0.154.0` 生成两轮历史，再用固定新版读取、恢复并继续推理，
验证原始 turn ID、clientId、助手回复及上下文均保留；同时检查分叉独立继续、Goal 设置/读取/清除、
正在执行的请求中断及进程重启后的历史恢复。不会将新建记录冒充旧版本升级验证。

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/shared test
pnpm --filter @linksense/api test
pnpm --filter @linksense/runner test
pnpm --filter @linksense/web test:unit
pnpm test:deployment
pnpm typecheck
pnpm lint
pnpm build

# CODEX_BIN 必须是真实的 0.168.0；CODEX_PREVIOUS_BIN 必须是真实的 0.154.0。
CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:upgrade
CODEX_PREVIOUS_BIN=/path/to/codex-0.154.0 CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:history-upgrade
CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:model-gateway
CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:model-switch
CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:native-plugin-refresh
CODEX_DISCOVERY_ONLY=1 CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:skill-discovery
CODEX_BIN=/path/to/codex-0.168.0 pnpm test:codex:shared-home
CODEX_BIN=/path/to/codex-0.168.0 pnpm test:public-knowledge:native
```

本次执行结果：

| 检查 | 结果 |
| --- | --- |
| Shared 单元测试 | 81 个文件，722 项通过 |
| API 单元测试 | 342 个文件，4,425 项通过 |
| Runner 单元测试 | 84 个文件，1,173 项通过，1 项既有平台条件跳过 |
| 部署脚本测试 | 699 项通过 |
| Web 完整 Vitest | 30 个应用文件、331 项通过；425 个其他文件、5,276 项通过 |
| 全工作区类型检查、Lint、生产源码构建 | 通过；Web Lint 有 2 项既有虚拟列表编译提示，构建保留大 chunk 提示 |
| 真实 Codex 三种网关及异步问答/命令执行/计划/中间回答 | 6 组通过 |
| 真实旧会话升级及中断/重启 | 通过，5 次本地推理，0 次外部调用 |
| 网关正常 WebSocket 及强制 HTTP 回退 | 两种路径的三种模式全部通过 |
| 模型切换与上下文压缩 | 通过，加密推理未传入目标模型 |
| 原生插件、Skill 发现、共享 HOME、公开知识库 | 通过 |

完整检查还修复了两个既有验收夹具问题：网关日志桩缺少 `info()` 导致模拟请求 502（旧版亦可复现），以及 Core MCP 夹具未提供当前联网搜索模块的必需配置。改用现有 Pino 并同步模拟环境及 Plan 工具预期，未修改生产网关行为，未删除原有断言。

这些验证不代表所有真实模型供应商、生产并发或大型历史已验收。未进行浏览器自动验证。

## 生产镜像交付条件

当前提交记录的 Worker 基线仍包含旧版 Codex。更改版本声明会使严格配方校验
`node scripts/baseline-adoption.mjs --check` 拒绝该旧基线；这是预期的发布阻断项。
本机 Docker daemon 不可用，未构建或扫描新的 Linux AMD64/ARM64 Worker。

按[基线维护流程](../../deploy/baselines/README.md)，本次源码进入 `main` 并通过 CI/Security 后，
执行 `maintain-baselines.yml`，完成双架构构建、扫描及存储完整性验收，再验证并采用
`verified-baseline/images.lock.json`，同步 Docker 默认引用并重新通过 CI/Security。
不得伪造新摘要、复用旧 Worker 或放宽版本/配方校验。

发布时同步交付更新后的 API、Web、Runner 和 Worker；前端与共享事件契约应先于新版 Worker 生效。
Host 开发模式显式指定匹配版本的 `CODEX_BIN`。正式升级前备份既有数据库和原生用户目录；
不保证新版已写入的原生状态能够降级回旧核心。
