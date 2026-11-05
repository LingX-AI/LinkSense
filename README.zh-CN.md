<p align="center">
  <img src="./docs/brand/linksense-lockup-primary.svg" alt="LinkSense" width="280">
</p>

<h2 align="center">
  面向组织的开源 Agent 工作平台<br>
  <sub>（企业级开源 WorkBuddy 替代方案）</sub>
</h2>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <a href="https://linksense.guygubaby.top/doc/zh-CN/"><img src="./docs/brand/button-website.svg" alt="官方文档" width="110" height="30"></a>
  &nbsp;
  <a href="https://explore.linksense.org/"><img src="./docs/brand/button-demo.svg" alt="在线体验" width="110" height="30"></a>
  &nbsp;
  <a href="./docs/contact.zh-CN.md"><img src="./docs/brand/button-wechat.svg" alt="加入用户群" width="110" height="30"></a>
</p>

<p align="center">
  LinkSense 是面向组织的开源 Agent 工作平台，可部署在自有服务器或私有云中。<br>
  管理员统一部署，成员拥有各自的 AI 工作空间，执行任务，并按权限共享知识库、技能、插件和应用。<br>
  平台集中管理权限与凭据，成员无需获取底层凭据即可使用已授权的系统连接。<br>
  用户专属 Worker 提供用户级运行环境隔离，并支持配置 CPU、内存等资源限制。
</p>

<p align="center">
  <a href="#为什么使用-linksense">功能亮点</a> · <a href="#如何选择部署方案">部署方案</a> · <a href="#部署与集成服务">部署与集成服务</a> · <a href="#快速安装">快速安装</a> · <a href="#开发">开发</a><br>
  <a href="#安全">安全</a> · <a href="#文档导航">文档导航</a> · <a href="#社区与支持">社区与支持</a> · <a href="#开源协议">开源协议</a>
</p>

## 为什么使用 LinkSense

<p><strong><font size="4">⚙️ Agent 执行与成果交付</font></strong>：基于开源 Codex Runtime，在用户专属 Worker 中执行网页信息检索与整理、浏览器操作、代码执行、数据分析和文件处理，生成文档、表格、演示文稿等成果。</p>

<p><strong><font size="4">📚 知识与技能沉淀</font></strong>：知识库支持文档解析、索引和检索；技能与插件将工作方法和工具集成沉淀为可安装的资源，支持版本维护、审核与发布。</p>

<p><strong><font size="4">🧩 开箱即用的场景应用</font></strong>：将指令、模型和所需资源预配置成在线应用服务，授权成员安装后即可发起自己的任务，无需逐项配置。支持聊天式与自定义交互界面；应用安装包则生成个人副本，可能需要使用者补充凭据与资源配置。</p>

<p><strong><font size="4">🔌 业务系统连接</font></strong>：通过连接器对接文档和邮件，并通过 MCP 按需集成 ERP、CRM 等业务系统，让 Agent 在授权范围内读取业务数据、执行操作。</p>

<p><strong><font size="4">👥 组织权限与治理</font></strong>：按用户和用户组授权，集中管理成员、模型凭据和使用额度，提供用量统计与操作审计。</p>

<p><strong><font size="4">🏠 自主部署与模型选择</font></strong>：在自有服务器或私有云运行，自由接入兼容的云端或本地模型服务，在自有基础设施上存储任务记录、文件、知识索引与凭据。</p>


<p><strong><font size="4">💬 多渠道与定时任务</font></strong>：通过 Web、微信、飞书、企业微信、钉钉和 Microsoft Teams 发起任务，也可设置定时任务自动运行。</p>

## 如何选择部署方案

LinkSense 在同一仓库中提供 **Core** 和 **Full** 两种部署方案，区别在于是否包含内置知识库服务，并非免费版与付费版之分。

| 方案 | 包含能力 | 什么情况下选择 |
| --- | --- | --- |
| **Core** | 完整的 Agent 工作空间，以及技能、插件、MCP、应用共享与组织管理能力 | **个人试用或无需内置知识库的组织**：体验网页浏览、代码执行、数据分析与文件处理，并共享技能与应用。 |
| **Full** | Core 全部能力，加上内置知识库的文档解析、索引与检索服务 | **需要内置知识库的组织**：将组织文档沉淀为可检索、可复用的知识库。 |

### 个人试用推荐 Core，需要内置知识库的组织部署推荐使用 Full。

部署 Full 请参阅 [Full 部署指南](https://linksense.guygubaby.top/doc/zh-CN/deploy/full/)。

LinkSense 面向组织级部署设计，支持大型组织集中管理、按权限共享与多成员协作。管理员可以按用户和用户组管理资源访问权限，集中管理模型、凭据和使用额度，并查看用量和操作审计。各部门成员可在各自的 AI 工作空间执行任务，按权限共享经过审核的技能、应用与知识库，无需各自搭建一套平台。

**Full 组织部署建议从 16 vCPU、32 GiB 内存、200 GiB 可用 SSD 开始规划**，优先使用 Linux + Docker。该配置以接入外部模型 API 为前提，是容量规划参考，不代表固定的用户数或并发上限。

大型组织上线前，建议用实际任务做压测，按**峰值活跃用户数、并发任务数、文档规模和 OCR 负载**预留资源，再逐步调高并发。硬件升级不会自动提高并发上限；配置方法见[并发与 Worker 配置](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/#并发与-worker)。本地模型与 GPU 需另行规划。

Full 的 x86_64 主机或虚拟机须暴露 `x86-64-v2` 指令集；原生 ARM64 不受这项 x86 要求约束。检查方法见[虚拟机与知识库](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/#虚拟机与知识库)。

## 部署与集成服务

LinkSense 支持自主部署。如果你的组织希望由我们协助落地，LinkSense 团队可提供**私有化部署与业务系统集成服务**。我们的交付工程师（FDE）可与你的 IT 和业务团队一起梳理需求，协助接入现有系统、配置权限，并验证典型业务流程。

**有部署或集成需求？** 请发邮件至 [hello@linksense.org](mailto:hello@linksense.org)，简单说明部署环境、使用规模和计划接入的系统，我们会与你沟通实施范围。

## 快速安装

**支持 Linux 和 macOS（x86_64 / ARM64），不提供原生 Windows 安装步骤。**

下面介绍 **Core 版本**的两种安装方式，任选其一即可。安装器会自动下载并启动所需服务，无需下载源码或自行编译。Full 部署请参阅 [Full 部署指南](https://linksense.guygubaby.top/doc/zh-CN/deploy/full/)。

### 方式一：编程助手安装

**以下提示词对应的安装指引默认安装 Core。** 将提示词交给 Codex、Claude Code、Cursor、Windsurf 或其他编程助手：

```text
Help me install and start LinkSense by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

助手会检查安装环境、保留已有安装，并报告启动结果。

**安装成功后，终端会显示访问地址和初始化凭据，请妥善保存。**

在浏览器中打开该地址（默认 Linux 为 `http://<服务器地址>:18081`，macOS 为 [http://localhost:18081](http://localhost:18081)，以终端显示为准），使用初始化凭据创建首位管理员。

再按[模型配置指南](https://linksense.guygubaby.top/doc/zh-CN/admin-guide/model-settings/)在管理界面配置模型。测试一次简短对话和一次使用工具的任务，确认正常后，按[首个任务指南](https://linksense.guygubaby.top/doc/zh-CN/user-guide/getting-started/first-task/)开始使用。

### 方式二：手动安装

#### 1. 确认配置

**Core 起步配置：至少 4 vCPU、8 GiB Docker 可用内存和 60 GiB SSD 可用空间。**

以上配置用于接入外部模型 API 的起步体验，不代表多人并发容量。Full、团队并发与其他部署配置请参阅[部署方案与资源规划](https://linksense.guygubaby.top/doc/zh-CN/deploy/)，源码修改与镜像构建请参阅[源码开发](https://linksense.guygubaby.top/doc/zh-CN/deploy/development/)。

#### 2. 安装并启动 Docker

按 [Docker 官方指南](https://docs.docker.com/get-docker/)安装并启动：

- **Linux**：Docker Engine 和 Docker Compose 插件。
- **macOS**：Docker Desktop。

在终端运行：

```bash
docker version
docker compose version
curl --version
```

确认输出满足以下要求：

- Docker 有 **Server** 信息，且该部分的 **API version ≥ 1.45**。
- Docker Compose 版本 **≥ 2.24.4**。
- `curl` 正常显示版本信息。

终端须能下载 GitHub 发布资源，Docker Engine 须能拉取镜像；两者的代理配置独立，检查方法见[环境与网络](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/#环境与网络)。

#### 3. 配置运行资源

**macOS**

- 打开 Docker Desktop → **Settings → Resources → Advanced**。
- 设置 **CPUs ≥ 4、Memory limit 为 10–12 GB**，调整 **Disk usage limit**，确保 Docker 和 Mac 磁盘均有至少 **60 GiB 剩余空间**。
- 修改后点击 **Apply & Restart**，等待 Docker 重启完成。

**Linux**

确认服务器至少有 **4 vCPU、8 GiB 内存、60 GiB 可用 SSD 空间**，并为系统和其他服务预留资源。

#### 4. 下载并运行安装脚本

前期配置到位后，按操作系统执行一条命令即可安装并启动 Core。

**Linux：**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

**macOS：** 不使用 `sudo`。

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sh install-core.sh
```

**执行后请等待安装完成。** 终端显示 **`LinkSense is ready at:`**，并输出访问地址和初始化凭据，即表示服务已启动。请妥善保存地址和凭据。

> ⚠️ **已有部署请注意**：请勿重复安装或直接切换 Core / Full。升级、迁移和故障排查请参阅[运维参考](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/)。

#### 5. 打开网站并开始使用

在浏览器中打开**安装成功后终端显示的访问地址**（默认 Linux 为 `http://<服务器地址>:18081`，macOS 为 [http://localhost:18081](http://localhost:18081)），使用安装器提供的初始化凭据创建首位管理员。

按[首次配置](https://linksense.guygubaby.top/doc/zh-CN/deploy/first-setup/)中的[模型配置指南](https://linksense.guygubaby.top/doc/zh-CN/admin-guide/model-settings/)在管理界面配置模型渠道，再测试一次简短对话和一次使用工具的任务，即可按[首个任务指南](https://linksense.guygubaby.top/doc/zh-CN/user-guide/getting-started/first-task/)开始使用。

## 开发

如需搭建本地开发环境、修改源码或构建镜像，请参阅[源码开发与镜像构建](https://linksense.guygubaby.top/doc/zh-CN/deploy/development/)。

### 从哪里改起

| 想改什么 | 源码入口 |
| --- | --- |
| Web 工作空间与管理界面 | [apps/web](https://github.com/LingX-AI/LinkSense/tree/main/apps/web) |
| API、权限与业务逻辑 | [apps/api](https://github.com/LingX-AI/LinkSense/tree/main/apps/api) |
| Agent 任务执行与 Worker | [apps/runner](https://github.com/LingX-AI/LinkSense/tree/main/apps/runner) |

系统架构请参阅[系统架构与执行边界](https://linksense.guygubaby.top/doc/zh-CN/deploy/architecture/)，环境配置、常用命令和 Docker 镜像构建说明请参阅[源码开发](https://linksense.guygubaby.top/doc/zh-CN/deploy/development/)。

### 代码贡献

提交前运行受影响的测试，并检查类型、lint 和构建。请先阅读 [AGENTS.md](https://github.com/LingX-AI/LinkSense/blob/main/AGENTS.md) 与<a href="https://github.com/LingX-AI/LinkSense/blob/main/.github/CONTRIBUTING.md">贡献指南</a>；代码贡献需要签署 <a href="https://github.com/LingX-AI/LinkSense/blob/main/docs/legal/CLA.md">CLA</a>。

## 安全

隔离边界是用户 Worker，同一用户的普通任务可访问该用户的其他任务文件。普通执行允许互联网出站，不逐条要求命令审批；接入外部模型或工具时，相关数据会按配置发送至对应服务。

向更多用户开放或对外部署前，请阅读<a href="https://github.com/LingX-AI/LinkSense/blob/main/.github/SECURITY.md#execution-boundaries">安全边界</a>与[部署运维要求](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/)。安全问题报告：`security@linksense.org`。

## 文档导航

| 我想要…… | 阅读文档 |
| --- | --- |
| 完成任务、创建自动化或接入 IM | [用户指南](https://linksense.guygubaby.top/doc/zh-CN/user-guide/overview/) |
| 管理成员、模型、权限与用量 | [管理员指南](https://linksense.guygubaby.top/doc/zh-CN/admin-guide/overview/) |
| 共享知识、技能、插件与应用 | [技能、插件与应用](https://linksense.guygubaby.top/doc/zh-CN/user-guide/plugin-center/discover-and-install/) · [知识库共享](https://linksense.guygubaby.top/doc/zh-CN/user-guide/knowledge-bases/sharing/) |
| 连接业务系统、构建应用 | [应用开发](https://linksense.guygubaby.top/doc/zh-CN/developer-guide/interactive-application/) |
| 部署、排查、升级与迁移 | [Core](https://linksense.guygubaby.top/doc/zh-CN/deploy/core/) · [Full](https://linksense.guygubaby.top/doc/zh-CN/deploy/full/) · [运维参考](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/) |
| 了解架构与执行机制 | [系统架构](https://linksense.guygubaby.top/doc/zh-CN/deploy/architecture/) |

## 社区与支持

<p align="center">
  <a href="https://github.com/LingX-AI/LinkSense"><img src="./docs/brand/star-guide.zh-CN.gif" alt="欢迎在 GitHub 仓库右上角点个 Star，支持 LinkSense！" width="100%"></a>
</p>

<p align="center">觉得有帮助？欢迎点个 Star ⭐</p>

使用问题与需求交流：[GitHub Discussions](https://github.com/LingX-AI/LinkSense/discussions)。

组织部署与合作：`hello@linksense.org`。

欢迎自愿在 [ADOPTERS.md](https://github.com/LingX-AI/LinkSense/blob/main/docs/community/ADOPTERS.md) 登记使用 LinkSense 的组织。

## 开源协议

LinkSense 采用 [CPAL-1.0](https://github.com/LingX-AI/LinkSense/blob/main/LICENSE) 开源。内部部署、署名、定制品牌与商标的具体规定，请阅读[开源许可](https://github.com/LingX-AI/LinkSense/blob/main/LICENSE)、[内部部署例外](https://github.com/LingX-AI/LinkSense/blob/main/LICENSE-EXCEPTIONS.md)、[署名要求](https://github.com/LingX-AI/LinkSense/blob/main/ATTRIBUTION.md)与[商标政策](https://github.com/LingX-AI/LinkSense/blob/main/TRADEMARK.md)。其他许可需求：`licensing@linksense.org`。

平台使用的官方开源 Codex 运行时以 Apache-2.0 许可原样交付。LinkSense 是独立项目，与 OpenAI 无关联，也未获得其赞助或认可。参阅[第三方声明](https://github.com/LingX-AI/LinkSense/blob/main/THIRD-PARTY-NOTICES.md)。
