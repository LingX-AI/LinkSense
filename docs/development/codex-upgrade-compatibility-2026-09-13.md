# Codex 0.154.0 升级与验收记录

日期：2026-09-13。基线：`develop`、`1ca7c60`，保留开始工作时已有的本地修改。

## 当前交付状态

Codex 版本配置已从 `0.150.1` 更新至检查时的最新稳定版 `0.154.0`，已修复网关、计划工具、限流分类和非阻塞问答的适配问题。真实 Codex 在 macOS 和 Linux ARM64 上均通过三种网关模式的执行中回答、结束并重启后回答功能检查。

用户已明确要求“保留全部历史数据”。正式前向迁移、Prisma Schema 和 Client 已完成，在隔离 PostgreSQL 16 中验证了所有历史字段、旧答案和历史迁移校验值保持不变。API 全量测试、类型检查和构建均已通过。本次未对实际业务数据库执行迁移或发布服务。

## 版本与依据

- `apps/runner/src/codex/runtime-version.json` 是 Codex 版本的唯一声明，固定为已完成适配和验证的 `0.154.0`。Docker 安装和 Runner 的 `CODEX_SCHEMA_VERSION` 都读取该文件。
- `.env.example`、Compose 和 Docker 构建参数中的 `CODEX_VERSION` 入口已移除；本地私有 `.env` 也只删除了该项。已有部署即使遗留此变量，也不能改变安装版本。
- Codex 在 Docker 中由 pnpm 安装，不是 workspace 依赖；本次没有添加第三方依赖或修改 lockfile。
- 系统 PATH 中的个人 Codex 为 `0.142.5`，没有升级它。所有功能检查显式使用独立安装的 `0.154.0`。
- 版本依据：[官方更新日志](https://learn.chatgpt.com/docs/changelog)。协议依据：[官方 app-server 文档](https://learn.chatgpt.com/docs/app-server)，以及两个版本实际导出的实验性 TypeScript 和 JSON Schema。
- 排除注释与空白后，原生 TypeScript 导出有 26 个文件变化、35 个文件新增；未删除既有客户端请求或服务端通知方法。

## 已实现的适配

### 版本随 LinkSense 发行

Codex 是 LinkSense 适配器的固定依赖。维护者升级时修改仓库内的版本声明，并同步完成原生 Schema 对照、适配器调整和功能验收，再发布 LinkSense 版本。安装过程不会查询上游 `latest`，也不接受用户通过环境变量或构建参数选择 Codex 版本。`CODEX_BIN` 只指定可执行文件位置，所指文件仍必须符合仓库固定版本。

开发环境和源码生产部署的 Worker 指纹均覆盖该声明；生产脚本的运行时变更检查也包含此文件，因此版本变化会触发镜像重建，并阻止显式复用旧 Worker。发行工作流针对 amd64 和 arm64 候选 Worker 执行实际版本检查，然后按既有不可变 OCI 摘要发布。一键升级安装对应 LinkSense 发行的 Worker，自动获得已经适配的 Codex。

两个 Worker 构建目标都在安装后检查 `codex --version`。Worker 和 standalone Runner 还会在加载执行服务、创建用户运行目录和监听请求之前检查实际二进制；版本不符、无效输出、执行失败或超时都会拒绝启动。Worker 复用现有 `setpriv` 隔离，以任务用户身份且清除继承能力后运行版本命令；controller 不运行 Codex，跳过此检查。

版本固定机制不涉及数据库结构、迁移、业务记录或持久化卷。

### 工具目录和流式网关

新版默认启用 `content_item_kinds`。工具目录可通过 `input[].additional_tools` 发送，顶层没有 `tools`。修复 WebSocket 转发删除转换后工具目录的问题，并按原生 `previous_response_id` 保留当前连接的工具映射，覆盖预热、增量请求、从较早响应继续及连接之间的隔离。

Astra 还会在命名空间内声明自定义 `exec` 工具。已复用现有工具兼容模块完成包装、历史调用转换、流式输入恢复及命名空间还原。没有添加完整回合重试或输入重放。

### 原生计划工具和错误语义

每次启动 app-server 都显式设置 `tools.update_plan.enabled=true`，覆盖新建和既有 Codex HOME。保留原生 `turn/plan/updated` 进度事件；Plan 协作模式的插件授权覆盖仍生效。

原生类型及共享事件 Schema 接受 `rateLimitExceeded`，保留 `willRetry` 和原生终态。非阻塞问题不会替代 Stop hook 使用的最终回复。

### 非阻塞问答

Runner 保留 `agentMessage.delivery = "async"`、问题和选项；API 将其转换为 `async_questions` 请求，避免生成重复的空助手消息。问题在原始回合完成、失败或中断后继续待答。

答案遵循原生用户消息路径：执行中使用 `turn/steer`，空闲时使用 `turn/start`。没有把答案错误地发送为 `toolOutput`。原生工具说明及 TUI 实现表明，异步答案作为新的用户消息抵达，并以问题引文关联答案：

- [原生 request_user_input_async 实现](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/request_user_input_async.rs)
- [原生 AnsweredQuestion 片段](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/context-fragments/src/answered_question.rs)

复用 LinkSense 已有的持久化 steer/start 操作，保存投递身份，支持不确定结果后的同答案重试和服务重启恢复，防止重复创建回合。服务端校验用户、任务、原生分支及源回合；取消问题不会调用模型。

分叉保留已回答问题及答案；新分叉中的未完成问题独立待答，不复用源任务的投递标识、暂存答案或处理状态。源任务记录保持不变，已增加服务层回归测试。

任务页面和嵌入页面复用现有问答卡片，支持选项和自由回答、首项预选但不自动提交、继续使用输入框、已提交答案回看，以及失败后的状态刷新。阻塞问题及计划确认优先展示。中英文提示及中文回退已覆盖。

非阻塞问答独立支持最多 100 个问题及字符串答案；既有表单保持自己的 20 项约束。空选项数组和 null 均支持自由输入。

## 保留历史数据的数据库迁移

已新增 `prisma/migrations/20260913060000_add_async_user_input/migration.sql`，保留所有历史数据及现有字段：

1. 将 `conversation_user_input_requests.native_request_id` 改为可空。异步问题没有原生 RPC 请求编号；既有阻塞问题和表单仍要求真实编号。
2. 新增可空、有大小与对象形状约束的 `response_delivery_json`，只保存对应的投递方式与幂等标识；答案内容仍存放在已有的 `response_content_json`。
3. 扩展问答类型、表单形状及响应形状约束，使其接受 `async_questions`，保留既有类型的约束。

这些变更不删除表、字段或历史记录，不改写既有编号，也不需要数据清理。迁移使用事务，新约束保留旧类型原有规则；没有修改历史迁移。

功能测试先向独立 PostgreSQL 应用旧迁移、写入旧问题和已回答表单，再应用当前完整迁移链，逐字段比对旧数据并核对历史迁移校验值。新增的非阻塞问答还覆盖持久化、JSONB 事件重复投递、8 个并发相同回答、越权与变更答案拒绝、数据库客户端重启后继续同一次投递、回合结束后回答及取消。

真实并发测试曾发现重复生成回答完成事件，已通过统一使用任务行事务锁修复；最终验证为同一原生操作、恰好一个完成事件。数据库也验证拒绝伪造请求编号、不完整、超大或含额外字段的投递对象，以及违反旧问题和旧表单约束的写入。

## 已执行的验证

| 检查 | 结果 |
| --- | --- |
| API 全量单元测试 | 235 个文件、2,835 项通过 |
| Runner 全量单元测试 | 54 个文件、723 项通过；1 项原有平台条件跳过 |
| Shared 全量单元测试 | 44 个文件、375 项通过 |
| Web 全量 Vitest | 18 个应用文件、220 项通过；其余 293 个文件、2,639 项通过；后续异步提交重试和计划确认优先级回归 3 个文件、28 项通过 |
| 部署脚本检查 | 250 项通过 |
| Runner、API、Web ESLint | 均无错误；Web 有 1 条虚拟列表的 React Compiler 提示，与本次升级无关 |
| Shared、Runner、API、Web 类型检查与构建 | 通过；Web 有原有的大 chunk 提示 |
| Prisma Schema 校验与 Client 生成 | 通过 |
| PostgreSQL 16 历史迁移及持久化功能检查 | 7 组通过，包含历史字段保留、并发、重启恢复及数据库约束拒绝路径 |
| macOS 真实 Codex 升级功能检查 | 三种网关模式 × 执行中/结束后回答，共 6 项通过 |
| Linux ARM64 真实 Codex 升级功能检查 | 相同 6 项通过；临时升级镜像及最终完整构建镜像分别验证，均以 worker 任务用户 1001:1000 运行 |
| 完整 Linux ARM64 worker 镜像构建 | `worker-cached-browser` 目标通过，镜像 `linksense-runner-worker:codex-0.154.0-test`；Python、Node、Chromium 及字体检查通过 |
| 既有网关功能脚本 | 三种模式通过 |
| 模型切换与上下文压缩脚本 | 通过；源模型加密推理不泄漏给目标模型 |
| 原生插件脚本 | 安装、读取、同版本刷新、移除和新进程检查通过 |
| 技能发现脚本 | 独立技能及内置浏览器技能发现通过；此项不执行模型任务 |

升级功能脚本使用真正的固定版本 Codex、LinkSense 网关和 shell 执行，验证实际文件写入、计划事件、原生问题历史及恰好一次答案消息。模型供应商由本地确定性服务替代，因此这些结果不代表所有外部供应商或新模型都已验证。

第一轮 Linux 验证使用单独构建的临时 worker 镜像，在原有 Linux 运行环境中更新 Codex，并只读挂载本次编译的 Runner/Shared。随后通过仓库的完整 `Dockerfile.runner` 构建 `worker-cached-browser` 目标，生成镜像 `e103fde7d34f`，包含本次编译的生产代码和依赖。没有挂载用户数据或替换运行中的服务。

最终完整镜像只挂载转译后的测试入口，直接使用镜像内的 Runner、Shared、Codex 和配置模板，全部 6 项功能检查通过，没有覆盖镜像中的生产代码。

当前机器的官方 Debian 和 npm 下载较慢。完整构建使用既有浏览器缓存、补充公开 CA 证书的同版本固定 Node 基础镜像、USTC Debian 镜像及现有 worker 使用的 npm 包镜像；仓库默认镜像源保持不变。先前官方源尝试的停止或失败是构建网络问题，最终完整构建退出码为 0。

初次评估还验证过：0.154.0 读取 0.150.1 创建的隔离会话，原生分叉、回滚、目标设置/读取/清除和中断。此结果覆盖最小历史恢复，不表示支持把新版写入的原生状态降级回旧版。

## 可重复执行的命令

### 版本固定机制的追加验收

本次追加调整基于 `42663c2`，保留已完成的 `0.154.0` 协议适配与历史数据方案，没有修改 Prisma Schema 或任何迁移。

| 检查 | 结果 |
| --- | --- |
| Runner 单元测试 | `pnpm --filter @linksense/runner test`：56 个文件、738 项通过；1 项既有 Linux root 条件测试在 macOS 上跳过 |
| 部署与升级脚本 | `pnpm test:deployment`：252 项通过；最终调整后 `node --test scripts/deployment.test.mjs scripts/dev.test.mjs` 的 97 项再次通过 |
| 类型、Lint、构建 | `pnpm --filter @linksense/runner typecheck`、`lint`、`build` 全部通过；编译产物包含版本 JSON |
| 实际 Compose 解析 | 分别传入 `CODEX_VERSION=0.150.1` 和 `999.0.0`，Worker 构建参数相同，且不含版本覆盖项 |
| 源码升级与旧镜像复用 | 隔离 Git fixture 只改变版本声明即可改变生产指纹，且出现在运行时与重建路径检查中；开发 Worker 指纹同样变化；旧环境变量不改变生产指纹 |
| macOS 原生功能 | 使用固定二进制运行 `pnpm test:codex:upgrade`，三种网关模式 × 两种回答时机，共 6 组通过 |
| Linux ARM64 Worker 构建 | `worker-cached-browser` 构建通过，即使传入 `--build-arg CODEX_VERSION=999.0.0` 仍安装并验证 `0.154.0`；Python、Node、Chromium、字体和配置读取权限检查通过 |
| 发布候选校验 | 以任务 UID 1001 执行发行工作流使用的生产版本检查，传入错误环境版本仍通过固定二进制验证 |
| Linux ARM64 原生功能 | 新镜像中以 UID 1001 运行同一功能测试，6 组全部通过，包含真实 shell 执行、计划更新、非阻塞问题持久化和重启后回答 |
| 实际 Worker 启动 | 在隔离容器中使用生产相同的监督进程 capabilities 与 `no-new-privileges`，旧版本在创建数据目录前被拒绝；探针实际 UID 为 1001，Inheritable、Permitted、Effective、Ambient capabilities 全为零；固定版本启动后 `/health/ready` 和原生 app-server 握手均可用 |

最终测试镜像：`linksense-runner-worker:codex-pinned-test`，镜像 ID：`sha256:2b411062d604539316decae4a356c1432117c98acbb7eb037c937d7454d3ab0e`。镜像测试禁用外部网络、使用容器内临时目录和确定性本地模型服务，没有挂载业务数据。

初次构建的目录权限检查发现，新增 `COPY --chmod=0444` 会让自动创建的 `/opt/linksense` 父目录也成为 `0444`，已改为先显式创建 root 所有、`0755` 的父目录，并增加回归断言。最终镜像已重新构建并通过上述验收。

本机未执行 Linux AMD64 构建或远端 GitHub Actions 发布；发行工作流已对两个架构配置同一版本检查。本次没有重新部署正在运行的环境、修改业务数据库或删除持久化卷。

### 原有升级功能回归

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/shared test
pnpm --filter @linksense/runner test
pnpm --filter @linksense/api test
pnpm --filter @linksense/web test:unit
pnpm test:deployment
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/api typecheck
pnpm --filter @linksense/runner lint
pnpm --filter @linksense/api lint
pnpm --filter @linksense/web lint
pnpm --filter @linksense/runner build
pnpm --filter @linksense/api build
pnpm --filter @linksense/web build

# 需要 Docker；自动创建并清理独立 PostgreSQL，不读取应用 .env。
pnpm test:codex:upgrade:postgres

# CODEX_BIN 必须指向实际的 codex 0.154.0。
CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:upgrade
CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:model-gateway
CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:model-switch
CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:native-plugin-refresh
CODEX_DISCOVERY_ONLY=1 CODEX_BIN=/path/to/codex-0.154.0 pnpm test:codex:skill-discovery
```

新增功能检查入口：`apps/runner/test/functional/codex-upgrade.ts` 和 `apps/api/test/integration/async-user-input-postgres.ts`。既有技能发现脚本同时修正了根目录导入路径及缺失的 `conversationId` 参数。

## 未验证及尚待完成

- 实际环境发布及业务数据库迁移尚未执行；当前没有运行中的 LinkSense 服务。
- 外部模型供应商、AMD64、生产并发和大型用户历史。
- 浏览器端到端及视觉检查未运行；前端验证为 Vitest 应用交互和组件测试。
