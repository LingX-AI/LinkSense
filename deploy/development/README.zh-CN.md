# 开发启动与环境一致性

默认的 `pnpm dev` 仍让开发应用在 Linux 容器中运行，开发、API、Runner 和 Web 构建固定使用同一 Node 基础镜像摘要，Prisma Client 在容器内生成；数据库与 Redis 复用基础 Compose 配置，任务 Worker 使用生产 Dockerfile。开发仍保留源码热更新，生产运行编译产物，因此发布前仍需执行 `pnpm build`，并通过 `pnpm dev:prod` 验收生产镜像。

## 不依赖本机 Docker 的 Host 开发模式

`pnpm dev:host` 会把 Web、API、帮助中心、Runner Controller 和每个用户的任务
Worker 都作为宿主机 Node.js 进程运行，不会调用 Docker。适合 Docker Desktop 或
本机 Docker Engine 负担较重时，在可信电脑上进行本地开发；不能用作生产部署模式。

Controller 会在 `LINKSENSE_USER_DATA_ROOT` 下生成 Host 专用的
`linksense-plugin-stdio` 启动器，使绑定凭据的 STDIO Plugin 与 Docker Worker 使用
相同的凭据投影。该启动器只指向当前代码目录和 Node.js 运行时，不会安装全局命令。

### 需要提前准备

- Node.js 24+，以及根目录 `package.json` 声明的 pnpm 版本。
- Python 3.12+，并且标准库 `venv` 模块可用。宿主机任务 Worker 会通过
  `python3 -m venv` 为每个用户创建虚拟环境；启动器不会安装 Python 或系统依赖。
- 与 `.env.example` 中 `CODEX_VERSION` 兼容的 Codex CLI；确保 `codex` 在
  `PATH` 中，或通过 `CODEX_BIN` 指定。
- 宿主机可访问且已运行的 PostgreSQL 数据库和 Redis。PostgreSQL 账号需要能够执行
  已提交的 Prisma migration，并且目标数据库需要提前创建。
- 使用 `pnpm install --frozen-lockfile` 安装仓库依赖。

Host 模式不会替你安装或管理 PostgreSQL、Redis、Codex 或其他可选远程服务。

### Core 最小配置

Core 模式不启用知识库处理，因此不需要 Elasticsearch 和 Docling。开发专用的本地
文件存储适配器也可以替代 MinIO。先复制仓库内的最小模板：

```bash
cp deploy/development/env.host.example .env.host
```

通常只需要按本机情况调整：

- `DATABASE_URL`：宿主机可访问的 PostgreSQL URL；URL 内的特殊字符需要编码。
- `REDIS_URL`：宿主机可访问的 Redis URL，客户端支持 `redis://` 和 `rediss://`。
- 五个互不相同的 `LINKSENSE_*_SECRET` 或密钥值；模板值只适合私人本机开发。
- 如果 5273 被占用，同时修改 `LINKSENSE_DEV_WEB_ORIGIN` 和
  `LINKSENSE_DEV_WEB_PORT`。API 4000 和 Runner 4010 有对应的
  `LINKSENSE_DEV_*` 覆盖项；帮助中心目前固定使用 3001。

最小配置不要填写 MinIO、Elasticsearch 或 Docling 变量。本地对象保存在
`LINKSENSE_USER_DATA_ROOT/.object-storage`；默认根目录是仓库内的 `.data/users`。

### 启动和停止

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
pnpm dev:host
```

每次启动时，脚本读取 `.env.host`，检查依赖地址和回环端口，执行
Prisma Client 生成、`prisma migrate deploy` 与可重复运行的 seed，然后启动四个应用。
只有 Runner、API、Web 和通过代理访问的中英文帮助中心全部响应后，才会输出就绪信息。

正常停止直接按 `Ctrl+C`，当前会话和子进程会一并退出。只有终端丢失、父进程异常
退出或已登记的子进程仍占用开发端口时，才需要执行 `pnpm dev:host:cleanup`。

默认地址：

- Web：`http://localhost:5273`
- API：`http://localhost:4000`
- Runner：`http://localhost:4010`
- 帮助中心：`http://localhost:5273/help/`

### 可选远程服务与 Full 版本

Host 模式可以连接远程 PostgreSQL、Redis 和 S3 兼容的 MinIO。如需远程对象存储，
设置 `LINKSENSE_OBJECT_STORAGE_PROVIDER=minio` 并填写文档要求的全部 `MINIO_*`
变量。Full 版本还必须配置宿主机可访问的 Elasticsearch 和 Docling，不属于最小
配置。脚本会拒绝 `postgres`、`redis`、`minio`、`api`、`runner` 和
`host.docker.internal` 等容器专用地址，不会静默切换 Provider。

### 隔离边界与生产不变量

`local-process` Worker Provider 使用 Node.js 子进程并复用与 Docker 相同的 Worker
契约，但不提供容器、cgroup、文件系统或网络隔离，只能运行可信任务和插件。启动器
会强制使用开发环境和回环监听；Runner 配置会拒绝在非开发环境或非回环 Controller
上启用 `local-process`，API 配置也会拒绝在生产或 Full 版本中使用本地文件存储。

Host 模式还会关闭内置 `linksense-browser` Skill、托管浏览器 MCP 和浏览器专用提示
上下文，因为随包提供的 Chromium 运行时只存在于 Docker Worker 中。需要托管浏览器
的任务请使用 `pnpm dev`。

常规 `pnpm dev`、生产 Compose 与发行版安装流程仍完全基于 Docker；Runner 默认
选择 `docker` Provider，并继续创建现有的每用户 Worker 容器。`.env.host` 已被 Git
忽略且只由 `pnpm dev:host` 读取，Docker 流程继续使用 `.env` 或明确指定的 Compose
环境文件。

## 容器开发与生产一致性

首次执行 `pnpm dev:prepare` 会构建镜像、准备基础设施与数据库、校准源码，并启动所有应用直至就绪，预热运行时缓存。命令完成后服务保持运行，随后执行 `pnpm dev` 接入日志和源码监听。也可直接执行 `pnpm dev`，自动完成缺少的准备步骤。

准备完成、构建输入和数据库状态未变化时，日常启动目标为 10 秒内就绪。启动时会核对镜像及有效构建参数、查询实际数据库迁移记录，再并行启动服务。存在待执行迁移时运行 Prisma 原生迁移命令；历史校验差异由 Prisma 检查并持续提示，成功结果按数据库目标、真实迁移记录、本地迁移文件和迁移镜像指纹缓存，任一变化都会重新检查。不会修改迁移历史，也不以缓存代替数据库查询。首次初始化、依赖/文档/Worker 输入变化、镜像或缓存缺失，以及 Docker Engine 尚未启动，不属于这个时间目标。

启动时的源码校准会同步停机期间的修改与删除，保留镜像内的依赖及 Prisma Client；运行期间继续使用 Compose Watch。帮助中心独立提供与生产相同的中英文静态页面和路由规则，文档变化时重建其镜像，不会重启 Web。日志中的 `LINKSENSE_DEV_READY` 只会在源码校准、Watch 启用以及 Runner/API/Web/双语帮助中心全部通过检查后输出，Web 检查包括入口模块、应用模块和样式的实际编译响应，并包含总耗时和各阶段耗时。

API 模块加载与 Office 转换器预热并行进行；历史知识索引巡检在受控后台任务中执行，不阻塞启动，并保留分布式锁、周期巡检和关闭等待。开发和生产共用这些行为。就绪接口验证实际必需依赖及 Runner 执行能力；SMTP、模型诊断和 Docker 资源采样仍由完整健康诊断提供，资源采样失败不会阻塞就绪。就绪检查不替代真实模型调用等业务验收。

Docker 开发模式同时提供 `http://localhost:18172` 和 `https://localhost:18173`，HTTP 不会强制跳转。请在 `.env` 中设置 `LINKSENSE_DEV_WEB_ORIGIN=http://localhost:18172`、`LINKSENSE_DEV_WEB_PORT=18172` 和 `LINKSENSE_DEV_WEB_HTTPS_PORT=18173`。两个入口使用相同的 Web 主机名和绑定地址；验证多任务 SSE 并发时使用 HTTPS 的 HTTP/2 入口。

宿主机需要 Node.js 24.5+ 和 [mkcert](https://github.com/FiloSottile/mkcert)（macOS：`brew install mkcert`）。首次启动前在终端运行 `mkcert -install`，按系统提示完成授权，再运行 `pnpm dev`。启动器自动生成、复用或更新开发证书，文件保存在已被 Git 忽略的 `.data/dev/tls`；目录权限为 0700，证书私钥权限为 0600。开发网关只读挂载证书目录，CA 签名私钥保留在宿主机的 mkcert 目录中。

`dev-gateway` 使用 Nginx 接入 HTTPS/HTTP2，并代理到同一个 Vite HTTP 服务；SSE 关闭响应缓冲，热更新通过 WSS 连接。浏览器在两个入口都通过 Vite 的 `/api` 代理发送同源请求，`VITE_API_BASE_URL` 为空字符串。就绪检查会分别读取初始化状态、发送不带 Cookie 的会话刷新请求，确认返回 `AUTH_SESSION_EXPIRED`，并验证实际协商为 HTTP/2；证书验证保持开启。开发环境的规范 URL 和外部登录回跳地址仍使用配置的 HTTP 地址。生产配置和单独的 HTTP `pnpm dev:host` 模式不受影响。

`pnpm dev:stop` 停止开发服务与动态 Worker，保留容器、缓存和持久数据，适合日常使用；`pnpm dev:down` 删除开发容器与网络，仍保留持久数据。Ctrl+C 仅结束当前终端的 Watch/日志会话，服务继续运行。

可以自动测量当前机器：`pnpm dev:benchmark --runs=5 --mode=restart`。该命令先准备环境，再执行 5 次停止后启动；`--mode=reattach` 测量重新连接，`--mode=recreate` 测量删除容器后的重建启动。计时从调用 `pnpm dev` 开始，包含命令开销；任意一次超过默认 10000 毫秒都会返回失败。报告保存在 `.data/dev/startup-benchmark-<mode>.json`。基准测试会操作开发服务，请在没有运行中任务时执行。

2026-09-06 本机验收（Docker Desktop、Linux ARM64、8 核、约 7.65 GiB Docker 内存）：停止后启动 5 次，中位数 8781 ms、最慢 9400 ms；重新连接 5 次，中位数 2055 ms、最慢 2123 ms，全部通过 10000 ms 门槛。此结果包括上述全部就绪检查；其他机器应使用同一命令实测。
