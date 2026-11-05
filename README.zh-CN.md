# LinkSense

[English](./README.md) | 简体中文

**面向组织的开源 Agent 工作平台。**

在自有服务器或私有云部署 LinkSense，为成员提供各自的 AI 工作空间，并按权限共享经过审核的知识、技能、工具和应用。

[官方文档](https://linksense.guygubaby.top/doc/zh-CN/) · [自主部署](https://linksense.guygubaby.top/install/) · [在线体验](https://explore.linksense.org/)

<p align="center">
  <img src="./docs/demo/Hero.gif" alt="在工作空间中构建技能并发布给组织成员使用" width="960" />
</p>

## 为什么选择 LinkSense

- **执行任务并交付成果。** Agent 基于开源 Codex 运行时，可处理网页资料、代码和文件，生成文档、表格与演示文稿。
- **共享可复用的能力。** 将技能、插件和 MCP 工具沉淀为可治理的资源，并发布聊天式或自定义交互应用。
- **连接工具并管理权限。** 通过授权的连接器访问文档和邮件，按需通过 MCP 接入其他业务系统。管理员可集中管理资源授权、模型、额度、用量与审计。
- **部署在自己的基础设施。** 可配置云端模型服务或自建的兼容模型端点。用户 Worker 提供用户级运行隔离，可设置 CPU 和内存限制。
- **从常用入口发起任务。** 使用 Web 工作台、已配置的消息渠道或定时任务。

## 如何选择部署方案

[Core](https://linksense.guygubaby.top/doc/zh-CN/deploy/core/) 包含工作空间、任务附件与组织能力；[Full](https://linksense.guygubaby.top/doc/zh-CN/deploy/full/) 增加内置知识库的文档解析、索引和检索。[对比部署方案](https://linksense.guygubaby.top/doc/zh-CN/deploy/)。

## 部署与集成服务

如需私有化部署或业务系统集成，请联系 [hello@linksense.org](mailto:hello@linksense.org)，说明部署环境、预计使用规模和希望接入的系统。

## 快速开始

如需编程助手安装，将[助手安装指引](https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md)和目标版本交给助手。安装后按[首次配置](https://linksense.guygubaby.top/doc/zh-CN/deploy/first-setup/)创建管理员、配置模型，并验证一次工具任务。

## 开发

先阅读[源码开发](https://linksense.guygubaby.top/doc/zh-CN/deploy/development/)、[贡献指南](./.github/CONTRIBUTING.md)和[仓库开发规范](./AGENTS.md)。贡献代码需要签署[贡献者许可协议](./docs/legal/CLA.md)。

## 安全

隔离边界是用户 Worker，同一用户的任务可以共享文件。普通执行允许互联网出站，不逐条审批命令。开放访问前阅读[执行边界及报告方式](./.github/SECURITY.md)，安全问题请私下报告至 [security@linksense.org](mailto:security@linksense.org)。

## 文档导航

| 我想要…… | 阅读文档 |
| --- | --- |
| 完成任务、使用组织共享资源 | [用户指南](https://linksense.guygubaby.top/doc/zh-CN/user-guide/overview/) |
| 管理模型、成员与权限 | [管理员指南](https://linksense.guygubaby.top/doc/zh-CN/admin-guide/overview/) |
| 修复、升级或排查现有部署 | [运维参考](https://linksense.guygubaby.top/doc/zh-CN/deploy/operations/) |
| 构建应用、修改源码或了解运行机制 | [应用开发](https://linksense.guygubaby.top/doc/zh-CN/developer-guide/interactive-application/) · [源码开发](https://linksense.guygubaby.top/doc/zh-CN/deploy/development/) · [系统架构](https://linksense.guygubaby.top/doc/zh-CN/deploy/architecture/) |

## 社区与支持

使用问题：[GitHub Discussions](../../discussions)及[支持渠道](./.github/SUPPORT.md)。使用 LinkSense 的组织可自愿加入[使用组织列表](./docs/community/ADOPTERS.md)。

## 开源协议

LinkSense 自有代码采用 [CPAL-1.0](./LICENSE) 许可。内部部署、署名和品牌使用分别参阅[内部部署例外](./LICENSE-EXCEPTIONS.md)、[署名要求](./ATTRIBUTION.md)和[商标政策](./TRADEMARK.md)。许可相关问题：[licensing@linksense.org](mailto:licensing@linksense.org)。

上游 Codex 运行时采用 Apache-2.0 许可。LinkSense 是独立项目，详情见[第三方声明](./THIRD-PARTY-NOTICES.md)。
