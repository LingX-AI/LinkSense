# LinkSense

[English](./README.md) | 简体中文

**面向组织的开源 AI 工作空间。**

**让每个人都能使用前沿 AI，让个人能力沉淀为组织能力，并由组织自主掌控。**

LinkSense 基于开源 Codex 运行时构建，Codex 在你部署的 LinkSense 环境中运行。

**Codex 的工作体验，组织级的能力管理。**

[快速开始](#快速开始) · [系统架构](#系统架构) · [基于-linksense-扩展](#基于-linksense-扩展)

---

## 为什么选择 LinkSense

### 让每个人都能使用前沿 AI

为每位用户提供基于 Codex 的工作空间，完成真实的研究、开发和内容生产任务。

### 将个人实践转化为组织能力

把经过验证的技能、组织知识、系统连接和 AI 使用场景，沉淀为可共享、可管理、可复用的能力。

### 开源，并由你掌控

在自己的基础设施上部署 LinkSense，自主选择模型与集成服务，查看并修改源码，无需依赖 LinkSense 的云端控制平面。

---

## LinkSense 可以做什么

### 完成实际工作

```text
调研 → 浏览器 → 代码 / 数据 → 电子表格 → 报告 → 交付成果
```

### 从个人技能到组织能力

```text
创建 → 测试 → 发布版本 → 审核 → 组织发布 → 安装
```

### 从能力组合到团队应用

```text
知识库 + 技能 + MCP
        ↓
       应用
        ↓
   用户 / 用户组
        ↓
     用户任务
```

---

## 组织能力

LinkSense 为每位用户提供独立的 AI 工作空间，也让组织能够把个人创建的能力共享给团队，并统一管理。

| 能力 | 在组织中的作用 |
| --- | --- |
| **知识库** | 在权限控制下，为 AI 提供组织知识 |
| **技能（Skills）** | 将有效的工作方法沉淀为可复用的能力 |
| **MCP 服务** | 将 AI 连接到组织的系统与操作 |
| **插件（Plugins）** | 将技能和 MCP 集成打包，经审核后分发 |

知识库的文档处理和检索需要 Full 部署方案。Core 提供工作空间、技能、插件、MCP 连接和应用，不包含完整知识处理组件。

这些能力可以从个人工作空间起步，再逐步成为组织共享资源：

```text
                    个人工作空间
                         │
                    创建与测试
                         │
                         ▼
                      组织能力
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       发布版本         授权访问        连接系统
          │              │              │
       管理员审核      用户 / 用户组      业务系统
          │
       组织发布
          │
          └──────────────┬──────────────┘
                         ▼
                    共享与复用
```

技能和插件可从个人开发进入不可变版本发布、管理员审核、组织发布、安装和显式更新的流程。

知识库可以授权给指定用户和用户组。MCP 连接与凭据分别管理，让 AI 使用组织系统时，无需向每位用户分发底层凭据。

**通过受控授权执行操作，无需共享凭据。**

### 应用：把组织能力交付给更多人

应用将这些能力组合成可直接使用的入口。

一个应用可以包含由创建者维护的指令和模型配置，并组合组织知识库、技能、插件及 MCP 连接，再授权给用户和用户组。

```text
                    指令 · 模型
                         +
                       知识库
                         +
                        技能
                         +
                        插件
                         +
                      MCP 服务
                         │
                         ▼
                       ┌──────┐
                       │ 应用 │
                       └──────┘
                         │
                    用户 / 用户组
                         │
                         ▼
                     用户自己的任务
```

例如，财务团队可以使用一个由财务知识库、财务技能和 ERP 集成组成的应用：

```text
财务知识库 + 财务技能 + ERP 集成
                 ↓
              财务应用
                 ↓
              财务团队
```

用户无需自行重新配置底层能力。打开已获授权的应用，就能用预先组合好的能力发起自己的任务。

应用是可复用的 AI 工作入口。每位授权用户都在自己的任务中工作，应用负责提供持续维护的配置与组织能力。

应用还可以让用户在受控范围内使用创建者维护的知识和 MCP 能力，而无需授予其直接管理权限，也不会通过 LinkSense 的常规界面暴露底层凭据。

围绕这些能力，LinkSense 提供身份与归属管理、用户和用户组授权、发布审核、凭据与模型管理、用量统计、审计及运行维护。

这些部分共同构成了**连接前沿 AI 与组织的开源能力平台**。

```text
                    前沿 AI
                  模型 · Codex
                        │
                        ▼
┌──────────────────────────────────────────┐
│                 LinkSense                │
│                                          │
│              个人 AI 工作空间             │
│                                          │
│  ────────────── 组织能力 ──────────────── │
│                                          │
│   知识库       技能       MCP 服务         │
│   插件         应用                       │
│                                          │
│   身份 · 共享 · 治理 · 凭据 · 运行维护       │
└──────────────────────────────────────────┘
          │                         │
          ▼                         ▼
         用户                    数据 · 系统
```

---

## 基于开源 Codex 运行时

LinkSense 在自身管理的 Worker 中运行开源 Codex，无需依赖 Codex 网页应用或由 LinkSense 托管的 Codex 服务。

LinkSense 直接运行官方 `@openai/codex` 包：

```bash
codex app-server --stdio
```

并通过 Codex app-server 的 JSON-RPC 协议与之通信。

Codex 运行时位于 LinkSense 部署环境中；模型推理服务单独配置，组织可以接入自行选择的模型提供商或兼容的私有服务端点。

LinkSense 不分叉 Codex、不修改其源码，也不重新实现智能体执行循环。

| Codex 负责 | LinkSense 负责 |
| --- | --- |
| 智能体推理与任务轮次 | 组织工作空间 |
| 原生工具与执行 | 身份、共享和治理 |
| 技能与插件 | 发布及组织内生命周期 |
| 模型与子智能体 | 应用、知识库和 MCP 管理 |
| 沙箱语义 | Worker、持久化、用量和运维 |

> Codex 决定智能体如何执行；LinkSense 管理其可访问的资源、运行位置、能力共享与治理，以及执行数据的持久化和运行维护。

---

## 开源、自托管、自主掌控

组织能力层本身也是开源的。应用、技能、插件、MCP 管理、知识库、身份与用户组、治理、凭据、用量与审计、Runner、Worker，以及 Core 和 Full 两种部署方案，均包含在开源项目中。

组织功能不依赖单独的闭源企业运行时，也无需连接 LinkSense 运营的云端控制平面。

你可以在自己的服务器、私有云或 VPC 中运行完整平台，查看源码、修改平台，并自主选择模型与集成服务。运行时不要求定期在线验证许可证。

使用私有模型、本地知识库和本地 MCP 服务时，提示词、文件、任务状态、知识索引、凭据、审计记录及成果可以保留在你掌控的基础设施中。

如配置了外部服务，仍可能产生对外网络请求。因此，LinkSense 适合自托管和私有网络环境，但并不宣称默认具备完全离线的隔离能力。

**可接入的模型服务：** OpenAI · Azure OpenAI · Anthropic · Google / Vertex · 阿里云 · DeepSeek · OpenRouter · 兼容 OpenAI 接口的服务端点

---

## 快速开始

正式发行版的一键安装脚本提供两种部署方案：

- **Core**：AI 工作空间与组织能力平台。
- **Full**：在 Core 基础上增加完整的文档处理和知识检索能力。

### Linux

```bash
# 安装 Core
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh

# 安装 Full
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

安装后访问 `http://<服务器地址>:18081`。安装器会显示一次性初始化凭据，用于创建首个管理员。

### macOS

```bash
# 安装 Core
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh

# 安装 Full
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

安装后访问 `http://localhost:18081`。Linux 部署文件位于 `/opt/linksense`，macOS 部署文件位于 `~/.linksense`。这里的 `18081` 是一键安装脚本的默认端口；从源码运行和开发使用的端口见下表。

### 环境要求

| 部署方案 | 推荐 CPU | Docker 最低可用内存 | 推荐 SSD 可用空间 |
| --- | ---: | ---: | ---: |
| Core | 4 vCPU+ | 8 GiB+ | 60 GiB+ |
| Full | 8 vCPU+ | 16 GiB+ | 120 GiB+ |

其他要求：

- Linux：x86_64 或 ARM64 架构，使用本机 Docker Engine；常见发行版包括 Ubuntu、Debian、Fedora、RHEL、Rocky Linux、AlmaLinux 和 CentOS。使用 `sudo` 或 `root` 安装。
- macOS：Intel Mac 或 Apple Silicon，已安装 Docker Desktop；使用当前登录账户安装，无需 `sudo`。
- 发行镜像支持 `linux/amd64` 和 `linux/arm64`，Docker 会自动选择匹配的镜像。
- Linux 和 macOS 上的 Docker Engine API 均不低于 v1.45，Docker Compose 不低于 v2.24.4。
- 已安装 `curl`，并可访问 GitHub、GHCR、上游镜像仓库以及 Full 所需的 tokenizer 文件。一键安装时默认 TCP 端口 `18081` 需要空闲。

安装器会检查 Docker 可用内存是否达到上表下限；CPU 和 SSD 容量是建议值，不作为安装检查条件。安装器会在写入持久数据前检查主机环境，并自动生成运行密钥。macOS 用户应先在 Docker Desktop 中分配足够的内存和磁盘。本地启动无需域名和 HTTPS；公网部署建议在端口 `18081` 前配置 HTTPS 反向代理。

### 自定义端口

将 `LINKSENSE_HTTP_PORT` 传给安装器进程，而不是传给 `curl`：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh \
  | sudo env LINKSENSE_HTTP_PORT=19090 sh
```

### 命令行管理

运行 `linksense` 可打开交互式管理菜单，也可以直接使用子命令：

```bash
linksense status
linksense start
linksense stop
linksense restart
linksense port 19090
linksense credential
linksense logs api
linksense doctor
linksense repair
linksense upgrade
```

Linux 会在需要时请求 `sudo`；macOS 用户需将 `$HOME/.local/bin` 加入 `PATH`，并且不要使用 `sudo`。

### 修复与升级

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

macOS 使用相同命令，但不加 `sudo`。

修复脚本沿用已安装的发行版本。升级脚本会识别 Core 或 Full，等待运行中的任务结束，并在迁移前将经过校验的 PostgreSQL 备份保存到 `volume://linksense-backups/postgres/`。

脚本不会删除数据卷。数据库迁移开始后如发生故障，脚本不会自动回滚；请保留终端显示的备份位置，排查问题后重新执行升级。

### 不同运行方式的端口

| 运行方式 | Web 入口 | 端口配置 |
| --- | --- | --- |
| 正式发行版 Core / Full 一键安装 | `http://localhost:18081` | 安装时设置 `LINKSENSE_HTTP_PORT`；安装后使用 `linksense port` 修改 |
| Docker 开发（`pnpm dev`） | `http://localhost:18172` 和 `https://localhost:18173` | 在 `.env` 中设置 `LINKSENSE_DEV_WEB_PORT` 和 `LINKSENSE_DEV_WEB_HTTPS_PORT` |
| 宿主机开发（`pnpm dev:host`） | `http://localhost:5273` | 在 `.env.host` 中设置 `LINKSENSE_DEV_WEB_PORT` |
| 源码 Compose / `pnpm dev:prod` | `http://localhost:8080` | 在 `.env` 中设置 `LINKSENSE_HTTP_PORT`；`.env.example` 默认为 `8080` |
| Git 生产部署 | 默认由反向代理连接 `127.0.0.1:8080` | 在 `.env.production` 中设置 `LINKSENSE_GATEWAY_BIND_ADDRESS` 和 `LINKSENSE_HTTP_PORT` |

开发模式下，API 和 Runner 分别使用 `4000`、`4010` 端口。正式发行版中的这两个服务仅供内部访问，请通过 Web 入口使用 LinkSense。源码 Compose 和 Git 生产部署所需的外部服务不同，启动前应阅读对应的部署指南。

如果从其他设备访问 Linux 上的一键安装实例，请把表中的 `localhost` 换成服务器地址。

---

## 系统架构

下图展示正式发行版的 Full 部署。Core 不包含完整知识处理组件；宿主机开发模式使用本地进程 Worker，不创建 Docker Worker。

```text
浏览器
  │ HTTPS / REST / SSE
  ▼
网关 / Nginx
  │
  ├── Web
  │     React 单页应用 + 帮助中心
  │
  ├── API
  │     Fastify REST API + SSE
  │       ├── PostgreSQL
  │       ├── Redis
  │       ├── MinIO
  │       ├── BullMQ
  │       └── Full 知识处理组件
  │             ├── Docling
  │             ├── Tokenizer
  │             └── Elasticsearch
  │
  └── API ── 经认证的 HTTP 请求 ──▶ Runner 控制器
                                        │
                                        │ Docker Engine
                                        ▼
                                  按用户动态创建的 Worker
                                    ├── 按任务隔离的工作目录
                                    ├── 按任务隔离的 CODEX_HOME
                                    ├── 官方 Codex app-server
                                    ├── 模型网关
                                    ├── LinkSense Core MCP
                                    ├── 用户 / 插件 MCP
                                    └── Chromium / Playwright
```

### Worker 模型

对于个人任务，LinkSense 按活跃用户动态管理 Docker Worker；单独隔离的服务会话可以使用自己的 Worker。同一用户的多个个人任务可以复用 Worker，但每个任务拥有独立的工作目录和 `CODEX_HOME`。

任务工作目录是相互隔离的目录，**不是各自独立的容器或内核隔离边界**。

不活跃的 Worker 会被回收。每位用户的包环境可以在回收后保留，生成的成果则独立持久化到对象存储中。

Worker 支持配置 CPU、内存和 PID 限额，并采用只读根文件系统、`no-new-privileges`、移除 Linux capabilities、非特权容器、非 root 任务进程，以及分离的控制网络与出站网络。

Worker 不直接接入 PostgreSQL 或 Redis 所在的服务网络。目前允许互联网出站访问，LinkSense 不提供适用于所有连接的域名白名单或默认拒绝出站策略。

### 执行路径

实时任务通常沿以下路径执行：

```text
用户
 ↓
API — 持久化任务 / 待处理请求
 ↓
Runner
 ↓
用户 Worker
 ↓
Codex
```

这类任务通常不会先进入 BullMQ。BullMQ 主要处理自动化、定时与后台作业、Worker 维护、故障恢复、邮件、计费、知识库同步与处理，以及清理工作。

### 事件传递

```text
Codex
  ↓
Worker
  ↓
Runner 映射事件并过滤敏感信息
  ↓
持久化事件发件箱
  ↓
API
  ↓
PostgreSQL
  ↓
Redis Pub/Sub
  ↓
SSE
  ↓
浏览器
```

---

## 基于 LinkSense 扩展

无需修改 LinkSense 源码，即可通过以下三种方式扩展平台。

### 创建技能

使用 Codex 原生的 Skill 格式，为 AI 提供可复用的方法、流程、领域实践、脚本和参考资料。

```text
my-skill/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
├── references/
└── assets/
```

Codex 可以原生发现技能，用户和应用也可以明确选择使用它们。

### 创建基于 MCP 的插件

通过 MCP 连接外部系统和 API，再将 MCP 声明、技能及支持资源打包为插件。

```text
插件
├── 技能
├── MCP 声明
├── 脚本 / 资源
└── .codex-plugin/plugin.json
```

对于 CRM、ERP、SaaS、监控系统和内部 API，通常建议以 MCP 作为集成边界。凭据与插件包分别管理。

### 创建交互式应用

基于已授权的 LinkSense 能力，为特定用途构建界面和流程。

交互式应用以 ZIP 文件打包，根目录必须包含 `manifest.json` 和 `index.html`，还可加入所需的 JavaScript、CSS 和资源文件。应用显示在 iframe 中。目前 LinkSense 将这类应用包作为可信 Web 应用运行，iframe 不提供浏览器沙箱隔离；请只安装和发布来自可信来源的应用包。其 SDK 可以请求经过明确授权的能力，例如获取用户资料、发现能力、访问知识库、发现 MCP 服务和创建任务。

交互式应用不同于上文的普通应用；普通应用主要用于组合配置和能力。

---

## 技术栈

| 层次 | 技术 |
| --- | --- |
| Web | React 19 · TypeScript · Vite · React Router · TanStack Query · shadcn/ui · Base UI · Tailwind · i18next |
| API | Node.js · TypeScript · Fastify 5 · Zod · Prisma · PostgreSQL · Redis · BullMQ · MinIO |
| Runner | Node.js · TypeScript · Fastify · Docker · 官方 Codex app-server · Chromium / Playwright |
| 知识处理 | Docling · Elasticsearch · BM25 与向量混合检索 · RRF · 可选重排 |

---

## 本地开发

需要 Node.js 24.5+、pnpm 10.6.4、Docker Engine/Compose、rsync 和宿主机上的 [mkcert](https://github.com/FiloSottile/mkcert)。macOS 可通过 `brew install mkcert` 安装。应用及依赖在 Linux 容器中运行；宿主机上的 rsync 只负责同步源码。首次启动前，请运行 `mkcert -install` 并按系统提示信任证书。

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
mkcert -install
pnpm dev:prepare
pnpm dev
```

Docker 开发（`pnpm dev`）的默认地址：

- Web HTTP：`http://localhost:18172`
- Web HTTPS（HTTP/2）：`https://localhost:18173`
- API：`http://localhost:4000`
- Runner：`http://localhost:4010`

HTTP 与 HTTPS 可同时使用，均支持 API 请求、SSE 和热更新。验证 HTTP/2 下的并发 SSE 任务时，请使用 HTTPS。可在 `.env` 中通过 `LINKSENSE_DEV_WEB_ORIGIN`、`LINKSENSE_DEV_WEB_PORT` 和 `LINKSENSE_DEV_WEB_HTTPS_PORT` 配置地址与端口。

如需不使用 Docker 的 Core 开发模式，参阅[宿主机开发指南](./deploy/development/README.zh-CN.md#不依赖本机-docker-的-host-开发模式)。`pnpm dev:host` 默认在 `http://localhost:5273` 提供 Web 服务，读取 `.env.host`，并使用没有容器隔离和内置托管浏览器的本地进程 Worker。

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

`pnpm dev:prepare` 会构建应用镜像、正式任务 Worker 和双语帮助中心，检查基础设施与数据库初始化，启动服务并预热运行时缓存。`pnpm dev` 也会自动补齐缺失的准备步骤。

### AI 开发指南

使用 Codex 或其他 AI 编码工具前，请阅读并遵守 [`AGENTS.md`](./AGENTS.md)。新增功能和行为变更需要配套测试；提交前应运行受影响的测试、类型检查、lint 和构建。不要提交密钥、个人数据、内部需求文档或生成产物。

---

## 从源码构建 Docker 镜像

下方命令只构建镜像，不会启动应用。仓库根目录的 Compose 将 Web 容器映射到 `LINKSENSE_HTTP_PORT`；`.env.example` 中该值为 `8080`。示例环境文件包含占位凭据和外部服务地址，运行前必须完成配置。独立的 Git 生产部署默认只在 `127.0.0.1:8080` 上提供网关入口，其前置条件和启动步骤请参阅[生产部署指南](./deploy/production/README.md)。

为当前 Docker 平台构建镜像：

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

构建并发布多平台镜像：

```bash
docker buildx build --platform linux/amd64,linux/arm64 --target runtime \
  -f Dockerfile.api -t <registry>/linksense-api:<tag> --push .
```

| 文件 | 构建目标 | 产物 |
| --- | --- | --- |
| `Dockerfile.api` | `runtime` / `migration` | API / 数据库迁移镜像 |
| `Dockerfile.web` | `runtime` | Web 与帮助中心镜像 |
| `Dockerfile.runner` | `controller` / `worker` | Runner 控制器 / 任务 Worker 镜像 |

在本地启动接近生产环境的服务：

```bash
pnpm dev:prod
pnpm dev:prod:stop
```

生产部署建议使用经过验证、固定到不可变摘要的发行镜像。

---

## 安全

参阅 [SECURITY.md](./SECURITY.md)。安全问题请发送至 `developer@linksense.org`。

## 参与贡献

参阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [`AGENTS.md`](./AGENTS.md)。

## 获取支持

参阅 [SUPPORT.md](./SUPPORT.md)。

## 开源协议

本仓库中由 LinkSense 持有权利的源码采用 [CPAL-1.0](./LICENSE) 发布，许可证包含已填写的 Attribution Information 和附加许可。使用、修改、分发 LinkSense 或通过网络提供服务前，请阅读完整许可证。

第三方组件各自适用其原有许可证。如果 CPAL 条款不适合你的部署需求，也可以咨询商业许可或白标合作。

## 贡献者

感谢所有为 LinkSense 作出贡献的开发者！

<!-- contributors:start -->
<p>
  <a href="https://github.com/Metrolive"><img src="https://avatars.githubusercontent.com/u/44701445?s=128" width="64" height="64" alt="Metrolive" title="Metrolive" /></a>
  <a href="https://github.com/guygubaby"><img src="https://avatars.githubusercontent.com/u/21158055?s=128" width="64" height="64" alt="guygubaby" title="guygubaby" /></a>
</p>
<!-- contributors:end -->
