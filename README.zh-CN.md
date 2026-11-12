<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./apps/web/src/assets/brand/linksense-lockup-on-dark.svg">
    <img src="./docs/brand/linksense-lockup-primary.svg" alt="LinkSense" width="280">
  </picture>
</p>

<h2 align="center">
  WorkBuddy / ChatGPT Enterprise 的开源替代方案<br>
  <sub>面向组织的 Agent 工作平台，基于共享知识和工具</sub>
</h2>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  <a href="https://linksense.org/doc/zh-CN/">官方文档</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="https://explore.linksense.org/">在线体验</a> ·
  <a href="mailto:hello@linksense.org">联系我们</a>
</p>

LinkSense 为组织提供统一、可治理的 Agent 工作空间。成员可以执行任务，按权限共享
知识库、技能、插件和应用，并通过受控连接访问业务系统，无需获取底层凭据。你可以将
LinkSense 部署在自有服务器或私有云中，接入云端模型或兼容的自建模型端点，并让任务
数据与文件保留在自己的基础设施上。

## 快速开始

LinkSense 支持安装了 Docker 的 Linux 和 macOS。Core 体验环境至少需要 4 vCPU、Docker
可用内存 8 GiB、可用 SSD 60 GiB；Full 增加内置文档解析、索引与检索，需要更多资源。

最快的安装方式是将下面的提示词交给编程助手：

```text
Help me install and start LinkSense Core by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

手动安装时，可选择 [Core](https://linksense.org/doc/zh-CN/deploy/core/) 或
[Full](https://linksense.org/doc/zh-CN/deploy/full/)。主机检查、Docker 要求、
安装命令和[首次配置](https://linksense.org/doc/zh-CN/deploy/first-setup/)都在站点中维护。

## 核心能力

- 🤖 **智能体执行与成果交付：** 检索资料、调用工具、运行代码、分析数据，并在独立的 Worker 环境中生成文档、电子表格、演示文稿及其他文件。
- 🧩 **组织级 AI 能力共享：** 将知识库（Knowledge）、技能（Skills）、插件（Plugins）和应用（Applications）发布为可复用的组织能力，并按用户或用户组进行授权和共享。
- 🔗 **业务系统集成：** 通过连接器或 MCP，在受控权限下连接文档、邮件、ERP、CRM 及其他业务系统，让 AI 融入现有业务流程。
- 🛡️ **权限管理与组织治理：** 通过统一管理后台，集中管理组织成员、模型凭据、资源配额、使用情况及审计日志。
- 🏠 **私有化部署与模型自由选择：** 支持在自有基础设施上部署，灵活接入外部大模型 API 或兼容的本地模型服务，并支持用户级运行资源限制。
- ⚡ **灵活的使用入口：** 支持通过 Web 工作空间、消息渠道或定时任务启动 AI 工作流。

## 文档导航

| 我想要…… | 阅读文档 |
| --- | --- |
| 对比部署方案 | [Core 与 Full](https://linksense.org/doc/zh-CN/deploy/) |
| 运维、修复或升级现有部署 | [运维参考](https://linksense.org/doc/zh-CN/deploy/operations/) |
| 执行任务并使用组织共享资源 | [用户指南](https://linksense.org/doc/zh-CN/user-guide/overview/) |
| 管理成员、模型、权限与用量 | [管理员指南](https://linksense.org/doc/zh-CN/admin-guide/overview/) |
| 构建应用或连接外部系统 | [开发者指南](https://linksense.org/doc/zh-CN/developer-guide/interactive-application/) |
| 从源码开发或了解运行机制 | [源码开发](https://linksense.org/doc/zh-CN/deploy/development/) · [系统架构](https://linksense.org/doc/zh-CN/deploy/architecture/) |

如需私有化部署或业务系统集成，请发送邮件至
[hello@linksense.org](mailto:hello@linksense.org)，说明部署环境、预计使用规模和希望接入的系统。

## 参与贡献

提交 PR 前，请阅读[贡献指南](./.github/CONTRIBUTING.md)和[仓库开发规范](./AGENTS.md)。
代码贡献需要签署[贡献者许可协议](./docs/legal/CLA.md)。

使用问题和功能建议请前往 [GitHub Discussions](../../discussions)。使用 LinkSense 的组织可自愿加入[使用组织列表](./docs/community/ADOPTERS.md)。

## 安全

隔离边界是用户 Worker，同一用户的任务可以访问该用户共享的文件。普通执行允许互联网
出站，不逐条审批命令；接入外部服务时，相关数据会按配置发送至对应服务。对外开放部署前，
请阅读[安全策略](./.github/SECURITY.md)。安全问题请私下报告至
[security@linksense.org](mailto:security@linksense.org)。

## 开源协议

LinkSense 自有代码采用 [CPAL-1.0](./LICENSE) 许可。内部部署、署名和品牌使用分别参阅
[内部部署例外](./LICENSE-EXCEPTIONS.md)、[署名要求](./ATTRIBUTION.md)和
[商标政策](./TRADEMARK.md)。许可相关问题：[licensing@linksense.org](mailto:licensing@linksense.org)。

上游 Codex 运行时采用 Apache-2.0 许可。LinkSense 是独立项目，详情见[第三方声明](./THIRD-PARTY-NOTICES.md)。

## 加入用户群

<img src="./docs/brand/wechat-group-2026-11-17.jpg" alt="LinkSense 用户群二维码" width="400">

该二维码 7 天内有效。过期或无法入群时，请发送邮件至
[hello@linksense.org](mailto:hello@linksense.org) 获取最新入群方式。

## 致谢

感谢 [Linux.do](https://linux.do) 社区的支持。

感谢所有为 LinkSense 做出贡献的开发者。

<!-- contributors:start -->
<table role="presentation">
  <tr>
    <td align="center"><a href="https://github.com/Metrolive"><img src="https://avatars.githubusercontent.com/u/44701445?s=128" width="64" height="64" alt="" /><br />@Metrolive</a></td>
    <td align="center"><a href="https://github.com/guygubaby"><img src="https://avatars.githubusercontent.com/u/21158055?s=128" width="64" height="64" alt="" /><br />@guygubaby</a></td>
    <td align="center"><a href="https://github.com/Bo-infocare"><img src="https://avatars.githubusercontent.com/u/146154905?s=128" width="64" height="64" alt="" /><br />@Bo-infocare</a></td>
  </tr>
</table>
<!-- contributors:end -->
