# LinkSense

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <strong>面向组织的开源Agent工作平台</strong>（企业级开源WorkBuddy替代方案）
</p>

<p align="center">
  LinkSense 是面向组织的开源 Agent 工作平台，可部署在自有服务器或私有云中。<strong>内置完整的 Agent 执行能力</strong>，支持网页浏览、代码执行、文件处理与数据分析。管理员统一部署平台，管理成员、模型、权限与用量；技能和应用配置发布后，其他成员无需重新编写即可安装和运行。成员可通过网页访问各自的 AI 工作空间，发起并执行任务、发布技能和应用。成员也可接入微信、飞书、企业微信、钉钉和 Microsoft Teams 等<a href="./apps/docs/docs/user-guide/message-channels/overview.md">消息渠道</a>发起任务。
</p>

<p align="center">
  <strong>自主部署，模型自选，组织级能力开源。</strong> 您可以选择不同厂商或本地模型，在自己的基础设施上存储任务记录、文件、知识索引与凭据。接入外部模型、工具或消息渠道时，相关数据会按配置发送至对应服务。具体说明见<a href="./docs/product-guide.zh-CN.md#开源自主部署由你掌控">部署与数据边界</a>，使用与分发条件见<a href="./docs/license-guide.zh-CN.md">开源许可说明</a>。
</p>

<p align="center">
  <a href="https://explore.linksense.org/">在线体验</a> · <a href="./apps/docs/docs/user-guide/overview.md">用户指南</a> · <a href="#为什么使用-linksense">为什么使用 LinkSense</a> · <a href="#安装">安装</a> · <a href="#文档导航">文档导航</a>
</p>

## 为什么使用 LinkSense

- **完整的 Agent 工作空间**：研究、浏览、执行代码、分析数据和处理文件，生成文档、表格、演示文稿等成果，支持[定时任务](./apps/docs/docs/user-guide/automations/create-and-manage.md)。
- **可复用的团队知识与经验**：将知识、技能和工具按用户或用户组共享，支持审核、发布与版本维护。[了解共享机制](./docs/capabilities.zh-CN.md)
- **灵活组合的场景应用**：提供聊天式与自定义交互界面，支持安装包、在线服务及[外部系统嵌入](./apps/docs/docs/user-guide/plugin-center/application-access.md)。
- **开放的业务连接**：通过连接器与 MCP 接入文档、邮件及业务 API，在授权范围内读取数据、调用操作。[了解系统接入](./docs/product-guide.zh-CN.md#构建基于-mcp-的插件)
- **统一的组织管理**：集中管理成员、模型、凭据、权限和使用额度，支持用量统计与操作审计。[管理员指南](./apps/docs/docs/admin-guide/overview.md)
- **自主部署与模型选择**：在自有服务器或私有云运行，自由接入云端或本地模型，组织级能力完整开源。[部署与数据边界](./docs/product-guide.zh-CN.md#开源自主部署由你掌控)

## 安装

**以下两种安装方式任选其一，无需重复执行。**

### 方式一：编程助手安装

```text
请按照 https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md 帮我安装并启动 LinkSense。
```

### 方式二：手动安装

同一开源产品，两种部署方案。先选择所需能力，再进入对应的独立安装流程：

#### 部署方案与配置要求

| 部署方案 | 包含能力 | 起步配置 | 推荐配置（适合团队） | 额外要求 | 安装入口 |
| --- | --- | --- | --- | --- | --- |
| **Core** | Agent 工作空间、技能、插件、MCP、应用共享与组织管理 | 4+ vCPU、8+ GiB 内存、60+ GiB 可用 SSD | 16 vCPU、32 GiB 内存、200 GiB 可用 SSD | — | [安装 Core](./docs/setup/core.zh-CN.md) |
| **Full** | Core 全部能力，加上完整知识库解析、索引与检索服务 | 8+ vCPU、10+ GiB 内存、120+ GiB 可用 SSD | 16 vCPU、32 GiB 内存、200 GiB 可用 SSD | x86_64 / amd64 主机或虚拟机需支持并暴露 `x86-64-v2`。<br>10 GiB 为当前源码发行配置的内存下限，允许内存超配；大文档、OCR 和并发任务需额外余量，以所选发行包预检为准。 | [安装 Full](./docs/setup/full.zh-CN.md) |

- **运行环境**：Linux 或 macOS，支持 x86_64 / ARM64；Docker Engine API v1.45+、Docker Compose v2.24.4+，并安装 `curl`。macOS 使用 Docker Desktop。
- **内存与容量**：内存指 Docker Engine 实际可用值，Docker Desktop 需预留虚拟机开销。以上为使用外部模型 API 时的规划建议，不是并发用户数保证，团队部署需按实际并发与任务负载调整；本地模型与 GPU 另行配置。

详细检查方法见[环境与 CPU 要求](./docs/setup/operations.zh-CN.md)。

已有安装的诊断、修复与升级：[运维参考](./docs/setup/operations.zh-CN.md)。

## 快速开始

### 启动后

1. 打开安装器打印的地址，使用初始化凭据创建首位管理员。默认地址：Linux 为 `http://<server-address>:18081`，macOS 为 `http://localhost:18081`。
2. 在管理界面配置模型渠道，验证一次简短对话和一次使用工具的任务。
3. 参照[首个任务指南](./apps/docs/docs/user-guide/getting-started/first-task.md)开始使用；Full 用户还需配置[知识库所需模型与文档处理](./apps/docs/docs/user-guide/knowledge-bases/create-and-manage.md)。

服务启动后，还需配置模型并测试对话与工具任务能否正常运行。详细步骤见 [Core 安装指南](./docs/setup/core.zh-CN.md)或 [Full 安装指南](./docs/setup/full.zh-CN.md)。

## 安全

隔离边界是用户 Worker，同一用户的普通任务可访问该用户的其他任务文件。普通执行允许互联网出站，不逐条要求命令审批；接入外部模型或工具时，相关数据会按配置发送至对应服务。

向更多用户开放或对外部署前，请阅读[安全边界](./SECURITY.md#execution-boundaries)与[部署要求](./docs/setup/operations.zh-CN.md)。安全问题报告：`security@linksense.org`。

## 文档导航

| 我想要…… | 阅读文档 |
| --- | --- |
| 完成任务、创建自动化或接入 IM | [用户指南](./apps/docs/docs/user-guide/overview.md) |
| 管理成员、模型、权限与用量 | [管理员指南](./apps/docs/docs/admin-guide/overview.md) |
| 共享知识、技能、插件与应用 | [组织能力详解](./docs/capabilities.zh-CN.md) |
| 连接业务系统、构建应用 | [扩展指南](./docs/product-guide.zh-CN.md#基于-linksense-扩展) · [交互式应用](./apps/docs/docs/developer-guide/interactive-application.md) |
| 部署、排查、升级与迁移 | [Core](./docs/setup/core.zh-CN.md) · [Full](./docs/setup/full.zh-CN.md) · [运维参考](./docs/setup/operations.zh-CN.md) |
| 了解架构与执行机制 | [系统架构与运行时](./docs/architecture.zh-CN.md) |

## 开发

修改源码或构建镜像，请参阅[源码开发与镜像构建](./docs/setup/development.zh-CN.md)。参与开发前阅读 [AGENTS.md](./AGENTS.md) 与[贡献指南](./CONTRIBUTING.md)；代码贡献需要签署 [CLA](./CLA.md)。

## 社区与支持

使用问题与需求交流：[GitHub Discussions](../../discussions) · [支持说明](./SUPPORT.md)。组织部署与合作：`hello@linksense.org`。

欢迎自愿在 [ADOPTERS.md](./ADOPTERS.md) 登记使用 LinkSense 的组织。

## 开源协议

LinkSense 采用 [CPAL-1.0](./LICENSE) 开源。内部部署、署名、定制品牌与商标的具体规定，请阅读[许可说明](./docs/license-guide.zh-CN.md)、[内部部署例外](./LICENSE-EXCEPTIONS.md)、[署名要求](./ATTRIBUTION.md)与[商标政策](./TRADEMARK.md)。其他许可需求：`licensing@linksense.org`。

平台使用的官方开源 Codex 运行时以 Apache-2.0 许可原样交付。LinkSense 是独立项目，与 OpenAI 无关联，也未获得其赞助或认可。参阅[第三方声明](./THIRD-PARTY-NOTICES.md)。
