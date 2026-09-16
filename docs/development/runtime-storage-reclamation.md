# 运行环境空间回收

同一用户、同一发布应用现在复用同一个环境，详见[应用任务共享环境与历史归并](application-shared-environments.md)。以下整环境删除条件针对最后一个任务引用。

## 本轮实现：明确删除应用任务后的环境回收

2026-09-16 确认的边界：只有新版本中明确删除的应用任务可以授权永久回收独占环境。任务只是完成、归档、会话令牌过期或 Worker 空闲时，均不删除 HOME。个人任务及使用个人环境的应用副本继续共用用户 HOME、CODEX_HOME 和项目文件。

删除流程复用现有数据库清理记录、BullMQ 重试和 Redis 用户生命周期锁，没有增加独立的回收调度系统：

1. 删除事务先保留已登记成果的对象存储引用及追溯元数据。有成果尚未保存时，事务中止，任务和运行环境保持原状。
2. 同一事务写入 `runtime_cleanup_outbox.remove_service_environment`，再删除任务记录。嵌入页面明确删除任务也写入许可；创建失败的补偿操作不授予整环境删除许可。
3. 后台清理在用户生命周期锁内重新查询全部任务引用，包括归档任务和分叉。还有引用时只移除已删除任务的控制目录。
4. 最后一个引用消失后，Controller 在对应环境的操作锁内关闭任务进程、移除容器，并再次确认没有其他容器挂载该环境，然后删除且校验独占目录已消失。
5. 有在途请求、容器状态不确定、释放失败、路径越界或权限异常时保留数据，复用现有失败记录和重试入口。重复执行已完成的清理返回成功。

永久删除范围是该服务会话的整个目录，包括 HOME、CODEX_HOME、独占配置、原生恢复状态和未登记文件。不会删除用户个人目录、其他应用环境、MinIO 已保留成果或任何仍有任务引用的环境。

预热也使用用户生命周期锁，避免与回收竞态。已移除应用预热时额外启动个人 Worker 的调用；准备应用运行环境本身已会启动正确的 Worker。

## 公共依赖与用户增量

公共 Python、Node 和内置浏览器已经在 Worker 镜像中提供。用户 Python 环境通过 `.pth` 引用公共库，Node 通过现有解析钩子引用公共包，内置浏览器直接使用镜像中的浏览器。个人任务创建不复制这些公共依赖。

用户自己安装的版本、项目依赖、浏览器和工具属于持久化数据；不能仅因名称与公共包相同就删除。当前补丁不改写已有用户安装或历史配置。

## 后续缓存清理规则

### 原生插件市场缓存

Worker 的 `/etc/codex/requirements.toml` 现在使用 Codex 原生的 `marketplaces.restrict_to_allowed_sources`，仅允许 `/home/linksense` 本地来源。个人和应用 Worker 都将 LinkSense 管理的插件市场挂载到该 HOME，因此已安装的本地插件、技能和 MCP 继续使用原生发现和运行流程。该规则不会禁用 `features.plugins`。

Codex 0.154.0 即使设置 `features.remote_plugin=false`，初始化 app-server 时仍会后台同步 OpenAI 的 Git 插件市场，生成 `HOME/.codex/.tmp/plugins`。来源限制阻止这类下载，避免每个新环境再次缓存整套未使用的官方插件。原生 Git 市场安装也会被拒绝；插件应通过 LinkSense 插件中心安装，由现有流程提供本地市场。这不影响插件自身访问它配置的 MCP 服务。

该文件在两种 Worker 镜像构建目标中均为 root 所有、只读。发布时先构建镜像，待活动任务结束后再替换旧 Worker；配置不需要改写历史 HOME 或数据库。容器里固定挂载路径是策略边界，宿主机直接运行的开发模式不使用这份系统文件。

相关配置依据：[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。可使用实际 Worker 镜像执行无网络回归，验证本地插件安装、技能发现、插件 MCP 调用、非授权 Git/本地来源拒绝，以及启动后 30 秒内没有生成官方目录。必须使用空 tmpfs，不能挂载正式用户目录：

```sh
docker run --rm --network none --user 1001:1000 \
  --tmpfs /home/linksense:uid=1001,gid=1000,mode=0750 \
  --entrypoint node \
  --mount "type=bind,src=$PWD/deploy/docker/codex-marketplace-policy-smoke.mjs,dst=/smoke.mjs,readonly" \
  linksense-runner-worker:oss-local /smoke.mjs
```

来源限制不会自动清除已有缓存。历史清理须先确认缓存的市场名称和 Git 来源、配置及实际安装均未引用该缓存，并在无活动 Worker 时仅删除核实过的 `.codex/.tmp/plugins` 目录及其同步标记。不得删除 `.codex/plugins/cache/linksense-personal`、会话记录、凭据或项目文件。

### 其他缓存

缓存自动清理尚未在本轮启用。后续实现应遵守以下规则：

- 仅在环境没有运行任务、原生进程和用户后台进程，且持有生命周期锁时清理。
- 包下载缓存使用固定版本 uv / pnpm 自带的清理命令，避免直接递归删除包管理器内部目录。设置执行超时和清理频率，失败保留数据并记录结果。
- uv 的符号链接安装可能依赖缓存本身。必须先排除这类依赖；不能把“名称是 cache”当成可删依据。
- pnpm 的 `dlx` 缓存可能承载正在运行的 MCP。不得在该进程运行时按缓存年龄删除。
- 已安装包、浏览器二进制、Corepack 工具、插件、凭据、CODEX_HOME、项目 `temp` 和迁移 `imports` 不属于自动清理白名单。

依据：[uv 缓存安全与清理](https://docs.astral.sh/uv/concepts/cache/)、[uv 符号链接安装限制](https://docs.astral.sh/uv/reference/cli/#uv-pip-install--link-mode)、[pnpm store prune](https://pnpm.io/10.x/cli/store#prune)。同时检查了项目固定版本 pnpm 10.6.4 的实现：store prune 也会处理过期 dlx 缓存，不能只按下载缓存看待。

## 历史数据与升级

迁移 `20260916010000_add_service_environment_cleanup_intent` 只新增默认值为 false 的列，旧清理记录保持原来的任务控制目录清理范围。它不删除、搬迁或改写历史任务与文件。新版本中明确删除历史应用任务，才会生成新的整环境回收许可。

本地只读盘点保存于 `.data/dev/storage-inventory-20260916.json`：310 个任务、180 个身份目录、119 个服务环境；所有服务环境都有任务引用，未发现可以按本轮许可回收的历史无引用服务环境。`.data` 分配空间约 7.00 GiB。目录统计不是删除授权，盘点期间没有修改任务、凭据、项目文件或清理历史目录。

发布顺序：应用新增数据库迁移，更新 Runner Controller，再更新 API。API 要求整环境删除响应明确返回 `environment: deleted | absent`；旧 Controller 的普通成功响应不能使该清理记录被误判完成。本轮尚未更新本地正式数据库和正在运行的服务。

## 验证

- API、Runner 类型检查、lint 和构建通过；新增回归覆盖成果保留失败、历史许可、分叉引用、预热、路径边界、容器释放失败与重复回收。
- `pnpm test:runtime:projects:postgres`：独立 PostgreSQL 历史升级及旧清理许可默认值验证通过。
- `LINKSENSE_TEST_WORKER_BASE_IMAGE=linksense-runner-worker:oss-local pnpm test:runtime:docker-shared-home`：独立 Docker 环境验证个人任务共享项目、重建保留文件、后台进程检测、应用认证边界及整环境回收通过。
- `pnpm test` 全量通过：API 2,946 项、Runner 797 项、共享模块 405 项、部署 306 项、文档 12 项、前端单元测试 3,112 项及端到端 64 项。macOS 条件跳过的 Linux 权限场景另在 Docker 中验证通过。随后补充的 Node 依赖链接归并回归，连同相关归并测试共 12 项通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。前端 lint 保留 1 条既有的 TanStack Virtual / React Compiler 警告；未关闭规则或削弱检查。与现有图片预览样式不一致的 CSS 选择器断言已同步，保留完整显示及缩略图裁切检查。
- Codex 0.154.0 原生测试验证共享 HOME、原生历史恢复、插件更新时旧进程的在途 MCP 正常完成，以及进程意外退出后的原生终态读取。测试只使用临时 HOME 和本地模拟服务，不调用外部模型。

这些验证使用临时测试资源，不删除正式用户环境。
