# LinkSense

[English](./README.md) | 简体中文

LinkSense 是我们面向组织打造的自托管 AI Agent 平台。我们将 AI 任务、模型服务、知识库、Skills、Plugins 和 MCP 集中到统一的 Web 工作区中，并通过隔离的任务 Worker 管理运行环境与用户数据。

我们提供轻量的 Core 版本和包含完整知识库能力的 Full 版本，既可以通过预构建镜像快速部署，也支持从源码进行本地开发和 Docker 构建。

## 特性

- **AI 任务工作区**：创建、执行和恢复长任务，实时查看过程并管理任务产物。
- **模型统一管理**：集中配置多个模型服务、模型和推理强度。
- **能力扩展**：支持 Skills、Plugins 和个人 MCP 服务。
- **知识库**：我们的 Full 版本集成 Docling、Elasticsearch 和混合检索。
- **隔离运行**：按用户动态创建 Worker，隔离工作区、凭据和持久运行时。
- **组织治理**：提供用户管理、权限控制、用量统计、审计和系统健康检查。

## 一键安装

### 安装环境要求

- Linux：支持 x86_64 和 ARM64 架构的 Ubuntu、Debian、Fedora、RHEL、Rocky Linux、AlmaLinux、CentOS，使用 `sudo` 或 `root` 执行。
- macOS：支持 Intel Mac 和 Apple Silicon，需要安装 Docker Desktop，并使用当前登录的 macOS 账号执行，不要使用 `sudo`。
- 发行镜像同时支持 `linux/amd64` 和 `linux/arm64`，Docker 会自动选择与当前环境匹配的镜像。
- 提前安装 `curl`，启动本机 Linux Docker Engine；Docker API 不低于 v1.45，Docker Compose 不低于 v2.24.4。
- TCP 端口 `10080` 必须空闲，并允许访问 GitHub、GHCR、上游镜像仓库；Full 还需要下载 tokenizer 文件。
- Core 至少需要 8 GiB 内存和 40 GiB 可用空间；Full 至少需要 16 GiB 内存和 80 GiB 可用空间。
- Linux 还需要为 Core 保留 100,000 个可用 inode，或为 Full 保留 200,000 个可用 inode。

安装器会在写入持久数据前检查主机与 Docker 平台，并自动生成运行密钥。macOS 用户需要先在 Docker Desktop 中分配足够的内存和磁盘。域名和 HTTPS 不是本地启动的前置条件；公网部署建议在端口 `10080` 前配置 HTTPS 反向代理。

Linux 安装：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

macOS 安装：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

安装完成后，Linux 访问 `http://<服务器地址>:10080`，macOS 访问 `http://localhost:10080`。终端会显示一次性初始化凭据，用于创建首个管理员。Linux 部署文件位于 `/opt/linksense`，macOS 部署文件位于 `~/.linksense`。

Core 不包含 Elasticsearch、Docling 和 tokenizer；Full 在 Core 的基础上启用完整的文档解析和知识库检索。

在 Linux 上修复或升级到最新版本：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

macOS 使用相同命令但不加 `sudo`。修复脚本固定使用已安装版本；升级脚本自动识别 Core/Full，在数据库迁移前等待运行中的任务结束，并把经过校验的 PostgreSQL 备份保存到 `volume://linksense-backups/postgres/`。脚本不会删除数据卷；迁移开始后的失败不会自动回滚数据库，请保留终端显示的备份地址并在排查后重新执行升级脚本。

## 推荐配置

| 版本 | 推荐 CPU | 推荐内存 | 推荐 SSD 可用空间 | 适用场景 |
| --- | ---: | ---: | ---: | --- |
| Core | 4 vCPU+ | 8 GiB+ | 60 GiB+ | AI 任务、模型与扩展能力 |
| Full | 8 vCPU+ | 16 GiB+ | 120 GiB+ | 包含文档解析和知识库检索 |

高并发任务、大型文档或长期保留大量文件时，应进一步增加 CPU、内存和磁盘。macOS 需要在 Docker Desktop 设置中分配这些资源；主机可用空间充足不代表 Docker 虚拟磁盘配额足够。

## 本地开发

需要 Node.js 24+、pnpm 10.6.4 和可用的 Docker Engine/Compose。

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
pnpm dev
```

首次运行会自动创建开发配置并准备 PostgreSQL、Redis、migration、Web、API、Runner 和任务 Worker。默认地址：

- Web：`http://localhost:5173`
- API：`http://localhost:4000`
- Runner：`http://localhost:4010`

常用命令：

```bash
pnpm dev:stop
pnpm dev:rebuild
pnpm dev:worker:rebuild
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

### AI 开发指南

使用 Codex 或其他 AI 编码工具前，请先阅读并遵守 [`AGENTS.md`](./AGENTS.md)。我们在这份指南中记录了项目结构、技术栈、测试、安全、数据库迁移和协作规则。

AI 生成的功能与行为修改同样必须包含测试，并在提交前运行相关测试、类型检查、lint 和构建。不要把密钥、个人数据、内部需求文档或生成产物提交到仓库。

## 源码构建（Docker）

使用 Compose 为当前 Docker 平台构建全部 LinkSense 镜像：

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

使用 Buildx 构建并发布多平台目标：

```bash
docker buildx build --platform linux/amd64,linux/arm64 --target runtime \
  -f Dockerfile.api -t <registry>/linksense-api:<tag> --push .
```

主要构建目标：

| 文件 | Target | 产物 |
| --- | --- | --- |
| `Dockerfile.api` | `runtime` / `migration` | API / 数据库迁移镜像 |
| `Dockerfile.web` | `runtime` | Web 与帮助中心镜像 |
| `Dockerfile.runner` | `controller` / `worker` | Runner Controller / 任务 Worker 镜像 |

在本机以接近正式环境的方式构建并启动：

```bash
pnpm dev:prod
pnpm dev:prod:stop
```

正式部署优先使用经过完整验证、固定到不可变摘要的发行镜像，而不是在生产服务器临时构建源码。

## 开源协议

我们使用 [CPAL-1.0](./LICENSE) 发布 LinkSense，并提供项目完整的 Attribution Information 和附加许可。使用、修改或通过网络提供 LinkSense 前，请阅读完整许可证。

- 贡献指南：[CONTRIBUTING.md](./CONTRIBUTING.md)
- 安全策略：[SECURITY.md](./SECURITY.md)
- 支持渠道：[SUPPORT.md](./SUPPORT.md)
- 安全问题：`developer@linksense.org`
