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

应用服务就绪后会单独重建网关，让更新后的挂载模板和 WebSocket 路由生效，再执行最终健康检查；此步骤不会重建数据库等依赖服务。

停机失败或停机后的复查失败会在备份、迁移前退出，API / Runner 可能保持停止。需要恢复原运行时处理尚未完成的工作时，沿用下方 Compose 参数，将末尾 `ps` 改为 `start api runner`，启动已有容器；不要用 `up` 提前应用新镜像或迁移。任务正常结束后重新执行部署。备份在 `.data/uat/` 下；迁移不自动降级，脚本也不回滚数据库。测试库同样不允许未确认的数据清空或破坏性迁移。

状态检查使用相同 Compose 文件和配置：

```sh
docker compose --project-directory "$PWD" --env-file .data/uat/runtime.env -p linksense-uat \
  -f deploy/release/compose.common.yml -f deploy/release/compose.core.yml \
  -f deploy/uat/compose.yml ps
```

公开访问时应使用 HTTPS；HTTP 适合本机或可信测试网络，部分浏览器能力和第三方登录需要 HTTPS。

## 可选：关闭桌面端云目标入口

桌面端云目标入口默认开启。如需在 UAT 关闭该入口，在 `.data/uat/runtime.env` 中设置 `LINKSENSE_DESKTOP_CLOUD_TARGET_ENABLED=false`；`prepare.mjs` 会在后续部署中保留该值。关闭后，Mac 新任务界面会拦截云端预热和云端提交，已认证的任务续接接口也会在服务创建任务前以 `RUNNER_UNAVAILABLE` 拒绝云目标。已有云任务仍可打开和运行，Web 普通新建云任务与 `POST /api/v1/conversations` 不受影响；该开关不是通用的云端准入或安全控制，也不改变单独的本地执行开关。

## 可选：动态应用（Appwrite）接入

UAT 默认关闭动态应用。在 `.data/uat/runtime.env` 中提供 `LINKSENSE_APPWRITE_ENDPOINT`、`LINKSENSE_APPWRITE_ADMIN_EMAIL`、`LINKSENSE_APPWRITE_ADMIN_PASSWORD`（管理员属于多个组织时再加 `LINKSENSE_APPWRITE_ORGANIZATION_ID`）后，`prepare.mjs` 会在后续部署中保留这些值。新建应用使用主站 `/app/{address}` 沙箱和 SDK，无需额外泛域名或证书。历史独立域名应用仍须保留 `LINKSENSE_DYNAMIC_APPS_BASE_URL` 和原入口；不要清空既有配置来切换运行模式。相关配置全为空时保持关闭。

这些配置沿用 Docker Compose 的 `.env` 语法并保留原始写法；密码中的字面量 `$` 请使用单引号或 `$$`，避免被解释为环境变量。

Appwrite 位于另一个 Compose 项目时，可用 `LINKSENSE_UAT_COMPOSE_OVERRIDE` 追加一个 Git 之外的覆盖文件，让 API 加入 Appwrite 网关网络。新沙箱应用复用主站入口；仅历史独立域名应用需要另外的 HTTPS 入口：

```sh
LINKSENSE_UAT_COMPOSE_OVERRIDE=.data/uat/appwrite.override.yml \
  LINKSENSE_PUBLIC_BASE_URL=http://192.168.2.210:19090 sh deploy/uat/deploy-uat.sh
```

覆盖文件路径相对仓库根目录。历史独立域名应用可继续使用 `deploy/uat/apps-tls.conf.template`：将通配证书放在 `.data/uat/tls/cert.pem` 和 `key.pem`，由覆盖文件挂载并转发到 API 的 `/api/v1/public-app-gateway/`；其地址必须使用 HTTPS（`*.localhost` 除外），且与控制台、Appwrite 管理端属于不同可注册域名。新沙箱模式的会话、SDK 限制及数据库迁移顺序见[动态应用文档](../../docs/development/web-site-sharing.md#沙箱-sdk-与会话边界)。
