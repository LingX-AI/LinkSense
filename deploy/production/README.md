# LinkSense 生产 Git 发布

生产服务器使用 `main` 分支和仓库内的平台无关入口 `docker-compose.production-stack.yml`。不要把用户名、密码或访问令牌写入 Git remote URL、`.env.production`、Compose 文件或发布日志。

> Git remote 应使用 HTTPS 或 SSH deploy key。若使用凭据文件，它必须只允许 root 读取，并优先使用只具备仓库读取权限的专用部署凭据。

## 首次接管

生产用户数据与 PostgreSQL 备份使用 Docker 管理的 external named volume，不再 bind mount 到 Git checkout 或宿主机管理目录。默认卷名为：

```bash
LINKSENSE_USER_DATA_VOLUME=linksense-user-data
LINKSENSE_BACKUP_VOLUME=linksense-backups
```

`bootstrap-production.sh` 会显式创建两个 `local` driver 卷并写入 `managed-by=linksense-production`、`persistence=critical` 和角色标签。它只接受 `Options=null/{}` 的真正 Docker-managed volume，并在启动前校验 Docker Engine API >= 1.45 和 Docker Compose >= 2.24.4。生产 Compose 将卷声明为 `external: true`，所以项目级 `docker compose down -v` 不会删除它们。

每个关键卷都有一个确定名称、只读挂卷的长期 guard 容器。guard 使用 `network=none`、只读根文件系统、`cap-drop=ALL`、`no-new-privileges`、16 MiB 内存和 16 PID，并设置 `restart=unless-stopped`。普通发布会严格校验 guard 的镜像、标签、挂载、权限和运行状态；合法但停止的 guard 会被重新启动，同名但契约不一致的容器会让发布 fail closed。它能阻止卷因为“当前无引用”被误 prune，但不能阻止管理员显式执行 `docker volume rm <精确卷名>`。

不要手工创建同名但无标签的卷，也不要直接操作 Docker data-root 下的 `_data`。named volume 是持久存储而不是异机备份；仍需保留 MinIO/异机备份与恢复演练。生产服务器禁止执行未精确限定目标的 `docker volume prune -a` 或 `docker system prune --volumes`。

`bootstrap-production.sh` 只初始化生产凭据、环境文件、external volume 与 guard，不把当前提交标记为已部署，也不启动业务服务。全新实例 bootstrap 成功后仍必须执行一次 `deploy-production.sh`，由正式发布流程构建镜像、执行 migration、启动并完成健康与 Worker 验证；不能把“环境初始化完成”当成“服务已上线”。

部署目录必须是 `main` 分支的干净 Git checkout，`origin` 只能保存不含凭据的仓库地址：

```bash
cd "$LINKSENSE_DEPLOYMENT_ROOT"
git remote -v
git status --short --branch
```

全新实例在外部 MinIO、Elasticsearch 和 Docker 网络已按生产要求就绪后，先初始化，再紧接着执行首次正式发布。初始化需要 Elasticsearch 管理凭据来创建 LinkSense 专用角色和用户；通过交互式读取传入，避免密码进入 shell 历史。首次版本包含尚未审查的 Prisma migration 时需要显式加 `--allow-migrations`：

```bash
read -r -s -p 'Elasticsearch admin password: ' linksense_elasticsearch_admin_password
printf '\n'
sudo env \
  LINKSENSE_PUBLIC_BASE_URL=https://linksense.example.com \
  LINKSENSE_SOURCE_REVISION="$(git rev-parse HEAD)" \
  LINKSENSE_ELASTICSEARCH_ADMIN_PASSWORD="$linksense_elasticsearch_admin_password" \
  ./deploy/production/bootstrap-production.sh
unset linksense_elasticsearch_admin_password

sudo ./deploy/production/deploy-production.sh --allow-migrations
```

`LINKSENSE_PUBLIC_BASE_URL` 接受 HTTP 或 HTTPS。HTTP 仅适合本机或可信内网，核心功能可以运行，但管理健康页会持续提示传输未加密，OIDC 与 Teams 登录不可用；通过公网访问时仍应使用 HTTPS。初始化脚本会按该 URL 的协议同步网关转发协议。

若仓库当前 migration 已在目标数据库审查并应用，可去掉 `--allow-migrations`；脚本仍会执行幂等的 migration deploy 与 seed。全新实例路径会验证不存在任何既有 Compose 容器，也没有残留的 PostgreSQL/Redis 项目数据卷，才跳过旧服务的维护、任务中止与预发布备份；如果部署元数据缺失但任何生产状态仍然存在，脚本会 fail closed，不能把它误判为全新安装。

### 强制切换运行环境

普通 `sudo sh ./deploy/production/deploy-production.sh` 默认以部署优先，不等待运行中的任务自然结束，也不需要另加强制参数。先构建镜像，构建失败不会停止原有服务。构建成功后才进入维护，停止全部 API 实例（包括后台调度与恢复），在共享的 10 秒宽限窗口内尝试原生中断，随后停止控制器并并行停止当前部署的 Worker；宽限期用完后直接强制停止。这个窗口不是整个部署的耗时上限，Docker 操作、状态保存、备份、迁移和健康检查另有独立时限。

执行容器确认停止后，新 API 镜像中的独立命令在事务中标记未完成任务为 `DEPLOYMENT_STOPPED`、暂停目标、阻断排队请求并释放执行占用。未投影的输入和附件保留为待手动处理的请求，旧启动意图不会在重启后重发。历史消息、已完成任务和文件不会删除；已发生的外部操作无法回滚，用户应检查实际进度后再继续。旧 Worker 的延迟事件不能重新激活已中止任务。

部署锁、迁移审批、数据库备份和上线健康检查仍然生效。若无法确认容器停止或无法保存任务状态，脚本明确失败并保留维护，不自动恢复可能重发任务的旧服务；排除报错后重新运行相同部署命令。主机需要 GNU `timeout`（Linux coreutils），以免 Docker 或独立命令失联后无限等待。此行为适用于 Git 生产部署脚本，不改变发行包的 `upgrade.sh` 流程。

部署辅助容器必须使用 `--interactive=false -T` 并将标准输入重定向到 `/dev/null`。`-T` 只关闭伪终端，不会关闭 Compose 默认启用的标准输入连接；在 SSH 终端中被 GNU `timeout` 放入后台进程组后，读取终端可能触发 `SIGTTIN`，导致命令已经输出结果却仍超时。辅助命令保持非交互执行，超时、非零退出和容器清理失败分别记录，不根据输出的 JSON 推断成功。

开发验证：先运行 `pnpm --filter @linksense/shared build` 和 `pnpm --filter @linksense/api build`，再执行 `pnpm exec node scripts/smoke-deployment-task-stop.mjs`。该检查只使用新建的临时 PostgreSQL 和 Redis 容器，验证完整命令入口的退出、事务回滚、历史保留、延迟事件隔离与重复执行；要求 Docker 中已存在 `postgres:16-alpine` 和 `redis:7.4-alpine` 镜像，不访问业务数据库或 Redis，结束后移除测试容器及其临时数据卷。`pnpm exec node --test scripts/deployment-force-stop.test.mjs` 另行验证非交互参数、输入隔离、退出码传递、超时清理和停止顺序。

如果服务器必须通过 HTTP token 拉取，可在 root shell 中交互保存凭据，避免令牌进入 shell 历史：

```bash
sudo -i
install -d -m 0700 /root/.config/git
git config --global credential.useHttpPath true
git config --global credential.helper \
  'store --file /root/.config/git/linksense-credentials'
read -r -p 'Git username: ' git_username
read -r -p 'Git host: ' git_host
read -r -p 'Git repository path: ' git_repository_path
read -r -s -p 'Git access token: ' git_token
printf '\n'
printf 'protocol=http\nhost=%s\npath=%s\nusername=%s\npassword=%s\n\n' \
  "$git_host" "$git_repository_path" "$git_username" "$git_token" | \
  git credential approve
unset git_username git_host git_repository_path git_token
chmod 0600 /root/.config/git/linksense-credentials
```

首次把既有生产实例接管到 Git checkout 时，必须保留原来的 `.env.production`、用户目录与备份目录，不能重新生成密钥或数据库卷。旧 bind 实例不能直接执行普通发布：脚本会要求显式的一次性卷迁移。

先确认 `.env.production` 中的旧路径，例如：

```bash
grep -E '^LINKSENSE_(USER_DATA_ROOT|BACKUP_ROOT)=' .env.production
```

然后在维护窗口执行。两个源目录只读挂入临时迁移容器，原目录不会被删除或修改：

```bash
git fetch origin main
git pull --ff-only origin main
git status --short --branch

sudo LINKSENSE_FORCE_REBUILD=1 \
  ./deploy/production/deploy-production.sh \
  --allow-migrations \
  --migrate-user-data-from /srv/linksense-legacy/users \
  --migrate-backups-from /srv/linksense-legacy/backups
```

上述 pull 必须在服务仍在线时先单独完成，确认当前 `main` 已包含 named-volume 部署脚本且工作区干净，再执行迁移命令；不要依赖旧版本部署脚本在运行过程中拉取并“自我升级”。

`--migrate-backups-from` 可省略；省略时新备份卷从本次预发布 PostgreSQL 备份开始使用，旧备份目录继续原样保留。迁移必须满足以下全部条件才切换 `.env.production`：

- 新卷不存在其他容器引用且内容为空；迁移过程中以 hold 容器引用，避免被 prune。
- 进入维护前按旧用户目录、可选旧备份目录、当前 PostgreSQL 数据库大小及额外安全余量校验 Docker data-root 剩余空间；不足时不创建卷、不切维护。
- API、Runner、动态 Worker 和备份服务已在维护模式下停止写入。
- 先按原 UID/GID 和 mode 原样复制，再逐项校验条目数、文件数、总字节与包含文件内容的 SHA-256 清单。
- 原始副本校验后，保留并归一化 API 管理的全局 `.capabilities` 持久源数据；仅在新卷清理可再生的旧 `home/.agents`、`home/.codex/plugins` 投影，并按新的单一所有者契约归一化 UID/GID/mode；旧源完全不动。
- 切换前建立长期只读 guard，随后新运行时健康、Worker 卷 subpath、API readiness 与网关均验证成功。

如果在新版本 migration/seed **尚未启动前**失败，脚本使用临时 legacy Compose override 重新挂载旧目录、恢复旧镜像和环境文件。migration 服务一旦可能启动，脚本无法证明新数据库状态仍兼容旧镜像，因此会保持维护页和当前运行状态，要求依据即时备份人工决定恢复方式，不会盲目自动降级数据库或旧镜像。为避免删除已复制的用户数据或刚生成的即时数据库备份，脚本**绝不自动清空失败目标卷**；它会为目标卷建立或保留只读 guard/hold，将目标卷作为 quarantine 证据保留。旧目录至少保留到完成独立备份和一次人工回滚演练后再决定是否删除。

失败后不要直接重跑迁移，也不要对 quarantine 卷执行宽泛 prune。先分别核对旧源、`linksense-user-data`、`linksense-backups` 和最新 dump，导出需要保留的数据；只有确认旧源与独立备份完整、失败卷不再需要后，才精确删除对应 guard/hold 容器和失败卷，再让脚本创建空白目标卷：

```bash
docker ps -a --filter label=com.linksense.volume-guard=true \
  --filter label=com.linksense.managed-by=linksense-production
docker ps -a --filter label=com.linksense.migration-hold=true
docker volume inspect linksense-user-data linksense-backups

# 完成数据核对和外部备份后，再逐个使用 docker rm 和 docker volume rm；
# 不要复制粘贴未核实的容器 ID，也不要运行 docker volume prune。
```

## 日常发布

没有 Prisma migration 的正常更新只需：

```bash
cd "$LINKSENSE_DEPLOYMENT_ROOT"
sudo ./deploy/production/deploy-production.sh
```

脚本固定拉取 `origin/main`，只接受 fast-forward；如果 checkout 有本地改动、remote URL 内嵌凭据、已有另一个发布进程或分支不是 `main`，会直接拒绝发布。

不能依赖 SSH 断开自动终止服务器上的发布进程；终端、`sudo` 和当前前台子进程的状态都可能让发布继续运行或延后退出。再次执行发布前，应先查询真实锁持有者，不要删除 `/run/lock/linksense-deploy.lock`；删除一个仍被持有的锁文件会创建新的 inode，反而可能放行第二个并发发布：

```bash
sudo ./deploy/production/control-production-deployment.sh status
```

确认需要取消时，先使用 `stop`。它会终止当前发布命令树，并给发布脚本最多 180 秒执行已有的回滚和维护状态清理：

```bash
sudo ./deploy/production/control-production-deployment.sh stop
```

只有 `stop` 明确超时且确认不再等待清理时，才使用强制模式：

```bash
sudo ./deploy/production/control-production-deployment.sh kill
```

`kill` 会先给予 15 秒正常清理时间，再向经过锁文件和命令行双重校验的发布进程树发送 `SIGKILL`。强制终止可能发生在数据库 migration 已启动或维护页已开启之后，因此它不会擅自回滚数据库或关闭维护状态；强制终止后必须先核对 Compose 服务、数据库 migration 和网关维护状态，再决定继续发布或人工恢复。控制脚本不会通过删除锁文件解锁，锁只会在原进程树退出后由内核释放。

如果脚本报告 migration 有变化或无法验证，先审查迁移：

```bash
git diff HEAD origin/main -- prisma/migrations
```

确认迁移的数据兼容性、锁表范围和回滚影响后再执行：

```bash
sudo ./deploy/production/deploy-production.sh --allow-migrations
```

发布流程会先校验两个 external volume 的 driver、Options、标签以及 Docker data-root，再在旧服务在线时构建固定生产标签 `pro-latest` 的镜像；随后让**现有 Gateway 容器持续监听端口并保持维护标记**，阻止新请求，按共享短暂宽限窗口停止 API/Runner、精确移除本部署的动态 Worker，并保存任务中止状态，不等待任务自然结束；随后把经过 `pg_restore --list` 验证的 PostgreSQL custom-format 备份直接发布到 backup external volume。Web/API 更新完成后只 reload Gateway 配置，不重建 Gateway；脚本在维护状态下验证 migration、Compose 健康、网关探针及 Worker 镜像指纹，并原子提交发布元数据，最后才关闭维护页。这样服务替换期间不会因为 Gateway 被删除而暴露 Nginx 502。

为缩短日常发布时间，Worker 镜像不再按每个 Git 提交重建。脚本会根据上一次成功部署 revision 到本次 target revision 之间的 `Dockerfile.runner`、runner/shared 源码、基线清单、公共 Python/Node/浏览器运行时、Codex 模板、lockfile 以及相关构建输入判断是否需要重建；只有这些路径变化、`pro-latest` 镜像缺失，或显式设置 `LINKSENSE_FORCE_REBUILD=1` 时才重建 `linksense-runner-worker:pro-latest`。普通 API/Web 修改复用现有 Worker 镜像。重建应用 Worker 时固定继承已经独立验证的环境基线，不再重新下载 Chromium、安装系统工具或编译公共运行时。环境变更先通过 GitHub Actions 的 `Maintain image baselines` 维护，并提交 `deploy/baselines/images.lock.json` 与同步的 Docker 默认摘要。旧的 `worker-cached-browser`、`LINKSENSE_WORKER_BUILD_TARGET` 和 `LINKSENSE_BROWSER_RUNTIME_CACHE_IMAGE` 路径已移除；既有环境文件中的这些旧键不再控制构建。

如果只是从历史提交标签切换到固定 `pro-latest`，且本次发布没有改变 runner/shared/runtime/lockfile 等 Worker 运行时输入，可以临时设置 `LINKSENSE_REUSE_PREVIOUS_WORKER_IMAGE=1`。脚本会先校验这些输入路径没有变化，再把上一版已验证 Worker 镜像重新标记为 `linksense-runner-worker:pro-latest`；一旦运行时输入发生变化会拒绝复用，要求正常重建。

在 migration/seed 可能启动之前失败时，脚本会恢复上一版 `.env.production` 镜像配置并尝试重新启动上一组镜像。migration 服务每次都会执行 migration deploy 与 seed；它一旦可能启动，后续失败就不会自动启动旧镜像，而会保留维护页并提示人工恢复，以免新数据库状态被不兼容的旧代码写坏。Git checkout 会保留在已经快进的提交，数据库 migration 不会自动降级或自动恢复备份；需要数据恢复时必须按备份时间点和迁移性质人工评估，不能直接覆盖生产数据。

## 发布后核对

```bash
docker compose -f docker-compose.production-stack.yml --env-file .env.production ps
curl --fail http://127.0.0.1:8080/health/live
git status --short --branch
```

每次成功发布会在维护仍开启时原子更新 root-only 的 `.data/deployment-metadata`，记录提交号、固定镜像 tag、Worker 输入指纹、卷名、上一提交和一次性迁移来源；元数据提交后才关闭维护页。预发布 PostgreSQL 备份保存在 `volume://linksense-backups/postgres/`。发布脚本不会执行 `docker compose down`、删除数据卷或全局 prune。由于生产标签固定为 `pro-latest`，脚本会在构建前记录上一组 image ID；仅当 migration/seed 尚未启动、可证明旧代码与数据库仍匹配时，失败处理才会把旧 image ID 重新标记为 `pro-latest` 并尝试恢复上一版运行配置。
