# Core 源码 UAT

用于在独立 Linux 测试机部署尚未发布的分支。复用发行版 Core Compose 与摘要锁定的基础镜像，源码构建 API、Web、迁移器、控制器和任务 Worker；不安装 Elasticsearch 或 Docling，也不使用正式发布安装器下载的旧应用镜像。

在目标分支的干净 checkout 中执行：

```sh
LINKSENSE_PUBLIC_BASE_URL=http://YOUR_TEST_IP:19090 sh deploy/uat/deploy-uat.sh
```

主机需要 Git、Python 3、curl、GNU timeout/flock、可用 Docker Engine、Buildx 和 Compose。脚本使用容器里的固定 Node 工具链，不要求主机安装 Node/pnpm。Core 下载预检要求 Docker 存储至少有 20 GiB 空闲；源码构建需要额外缓存空间，实际使用时应按仓库容量表预留余量。脚本不会清理其他应用的镜像、缓存或卷。

默认项目为 `linksense-uat`，端口为 `19090`，全站并发任务和单用户任务进程上限均为 4。可通过 `COMPOSE_PROJECT_NAME` 和 `LINKSENSE_HTTP_PORT` 在首次部署时指定项目和端口。项目名隔离网络和 external named volumes；既有无归属标记的同名卷会被拒绝，数据卷不随 Compose 项目删除。

并发可在「管理后台 → 系统设置 → 任务并发」调整，保存后对新启动的任务生效。重新部署会保留 `runtime.env` 中已有的两项并发默认值和后台设置；旧 UAT 中的上限 1 不会被自动提高，需要在后台调整。并发指不同任务可同时运行的数量；同一任务内仍由 Codex 串行执行消息。

配置和初始化凭据位于 `.data/uat/runtime.env`、`.data/uat/initialization.txt`，权限为 0600，不进入 Git。首次访问 Web 后使用初始化凭据创建管理员，再在管理界面配置模型；脚本不复制其他服务的账户或模型密钥。

再次执行同一命令会保留密钥与数据身份，按当前已提交源码构建新镜像。构建失败不会停止现有 UAT。更新前检查运行中 turn、启动意图和正在派发的自动化，有任何一项时拒绝更新；空闲后先停止 API（包含调度器），再停止 Runner 控制器，并确认两者已停止、没有期间新接受的任务，才保存 PostgreSQL custom-format 备份并应用 Prisma 迁移。不会主动移除动态 Worker、中断或重试原生 turn。首次安装没有既有任务表时跳过停机检查和备份。

停机失败或停机后的复查失败会在备份、迁移前退出，API / Runner 可能保持停止。需要恢复原运行时处理尚未完成的工作时，沿用下方 Compose 参数，将末尾 `ps` 改为 `start api runner`，启动已有容器；不要用 `up` 提前应用新镜像或迁移。任务正常结束后重新执行部署。备份在 `.data/uat/` 下；迁移不自动降级，脚本也不回滚数据库。测试库同样不允许未确认的数据清空或破坏性迁移。

状态检查使用相同 Compose 文件和配置：

```sh
docker compose --project-directory "$PWD" --env-file .data/uat/runtime.env -p linksense-uat \
  -f deploy/release/compose.common.yml -f deploy/release/compose.core.yml \
  -f deploy/uat/compose.yml ps
```

公开访问时应使用 HTTPS；HTTP 适合本机或可信测试网络，部分浏览器能力和第三方登录需要 HTTPS。
