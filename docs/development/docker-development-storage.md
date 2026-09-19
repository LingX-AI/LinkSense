# 开发环境 Docker 存储策略

## 原因与修复

普通 Web 编辑同步源文件，API/Runner 编辑同步后重启；它们不需要构建镜像。依赖、文档和 Worker 构建输入改变时，仍需要生成新镜像。

此前 Watch 构建使用启动时保存的指纹，构建后的镜像标签无法反映最新输入。下次启动再次比较时会判定镜像过期，导致重复构建。现在启动与 Watch 共用分组和指纹判断，每次构建前重新读取输入。API、Runner、Web 共用依赖镜像构建组，一个批次只构建一次该组，完成后一起更新。各组顺序构建，避免同时与运行中的服务争抢内存。

九个一次性数据库集成测试原先删除容器时没有删除 PostgreSQL 自动创建的匿名卷。现在启动使用 Docker 原生 `--rm`，退出时使用 `docker rm --force --volumes`，并添加 `com.linksense.test.disposable=true` 标签。就绪检测明确检查 TCP 端口，避免误把数据库初始化期间的临时 Unix socket 服务当成正式服务。

## 镜像保留边界

- 开发构建写入 `com.linksense.development.owner` 和 `com.linksense.development.role` 标签；owner 是当前仓库路径与环境文件路径的摘要。
- 只管理相同 owner 下的 dependencies、docs、migrate、worker 四类镜像。
- 保留所有当前镜像、有明确标签的镜像，以及任何运行中或已停止容器引用的镜像。
- 对剩余未使用、无标签镜像，每类保留最新一份，其余使用不带 `--force` 的镜像删除命令回收。
- 在服务成功就绪后执行清理；资源清单无法完整验证时跳过。它不删除容器或数据卷，不调用全局 prune。

首次使用会为旧开发镜像补齐归属标签而触发一次构建。此后输入不变时直接复用；文档修改仍使用生产静态构建，Worker 输入改变仍会构建任务镜像。

历史无归属标签的镜像和匿名卷不会被自动接管或删除。无法仅凭“未引用”判断旧卷是否包含需要保留的数据库、工作区或用户运行环境。Docker 全局构建缓存上限保持原设置，不为本项目修改其他项目共用的缓存策略。

镜像大小包含共享层，不能逐个相加当成实际磁盘占用。删除旧镜像也不保证立即等量释放物理空间：共享层、BuildKit 缓存和 Docker Desktop 虚拟磁盘回收机制都会影响结果。本策略限制可安全清理的镜像历史，不承诺整个 Docker 的硬性磁盘上限。

## 验证

```sh
pnpm test:deployment
pnpm exec node scripts/dev-images-smoke.mjs
pnpm exec node scripts/dev-watch-smoke.mjs
pnpm --filter @linksense/api exec tsx test/integration/maintenance-period-postgres.ts
pnpm --filter @linksense/api exec tsx test/integration/interactive-files-postgres.ts
```

镜像 smoke 在独立临时目录下使用唯一标签构建四版微型镜像，检查每个新指纹只构建一次、再次启动复用，以及保留当前版本、停止容器引用和上一份镜像；最后验证清理幂等，并移除自身资源。Watch smoke 验证三次文档构建不会重建 API/Runner/Web 容器。数据库测试使用一次性数据库，可对比运行前后的 `docker volume ls -q` 确认没有新增残留卷。

2026-09-19 本机验收：部署测试 397 项通过，镜像保留和 Watch 的真实 Docker smoke 通过，上述两组数据库测试通过且新增残留卷为零。完整 `pnpm dev` 构建及就绪检查通过；随后无改动再次挂接运行中的服务耗时 4382 ms，六个镜像引用的 ID 全部不变，没有发生构建。此时间是已有服务运行时的重复启动，不代表冷构建耗时。API、Runner、Web 均为 healthy，重启次数为零；这不能替代长时间任务的 OOM 压力测试。
