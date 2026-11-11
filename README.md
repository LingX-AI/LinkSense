<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./apps/web/src/assets/brand/linksense-lockup-on-dark.svg">
    <img src="./apps/web/public/attribution/linksense-mark.svg" alt="LinkSense" width="180">
  </picture>
</p>

<h2 align="center">
  Open-source agentic work platform for organizations.<br>
  <sub>Help teams get work done with AI, shared knowledge, and tools.</sub>
</h2>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://linksense.org/doc/">Documentation</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="https://explore.linksense.org/">Live demo</a> ·
  <a href="mailto:hello@linksense.org">Contact</a>
</p>

LinkSense gives organizations one governed place to run agent tasks, share reusable Knowledge,
Skills, Plugins, and Applications, and connect business systems without handing members the underlying
credentials. Deploy it on your servers or private cloud, choose hosted or compatible local models, and
keep task data and files on your own infrastructure.

## Quick start

LinkSense supports Linux and macOS hosts with Docker. A Core evaluation needs at least 4 vCPU, 8 GiB of memory
available to Docker, and 60 GiB of free SSD. Full adds built-in document parsing, indexing, and retrieval and needs more capacity.

The fastest installation path is to give a coding agent this prompt:

```text
Help me install and start LinkSense Core by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

For a manual installation, choose [Core](https://linksense.org/doc/deploy/core/)
or [Full](https://linksense.org/doc/deploy/full/). The site covers host checks,
Docker requirements, installation commands, and
[first-time setup](https://linksense.org/doc/deploy/first-setup/).

## Key features

- 🤖 **Agent execution and deliverables:** research sources, operate tools, run code, analyze data, and produce documents, spreadsheets, presentations, and other files in a user Worker.
- 🧩 **Shared organizational capabilities:** publish governed Knowledge, Skills, Plugins, and Applications for specific users and groups.
- 🔗 **Business system connections:** connect documents, email, ERP, CRM, and other systems through connectors or MCP within configured permissions.
- 🛡️ **Access and governance:** manage members, model credentials, quotas, usage, and audit records from one administration surface.
- 🏠 **Self-hosting and model choice:** use your own infrastructure, external model APIs, or compatible self-hosted endpoints with per-user runtime resource limits.
- ⚡ **Flexible entry points:** start work from the web workspace, messaging channels, or scheduled tasks.
  
## Documentation

| I want to… | Read |
| --- | --- |
| Compare deployment profiles | [Core and Full](https://linksense.org/doc/deploy/) |
| Operate, repair, or upgrade a deployment | [Operations](https://linksense.org/doc/deploy/operations/) |
| Run tasks and use shared resources | [User guide](https://linksense.org/doc/user-guide/overview/) |
| Manage members, models, permissions, and usage | [Administrator guide](https://linksense.org/doc/admin-guide/overview/) |
| Build applications or connect external systems | [Developer guide](https://linksense.org/doc/developer-guide/interactive-application/) |
| Work from source or understand the runtime | [Source development](https://linksense.org/doc/deploy/development/) · [Architecture](https://linksense.org/doc/deploy/architecture/) |

For private deployment or business system integration, email
[hello@linksense.org](mailto:hello@linksense.org) with your environment, expected usage,
and the systems you want to connect.

## Contributing

Read the [contribution guide](./.github/CONTRIBUTING.md) and [repository instructions](./AGENTS.md)
before opening a pull request. Code contributions require a [Contributor License Agreement](./docs/legal/CLA.md).

Questions and feature ideas belong in [GitHub Discussions](../../discussions). Organizations can opt in to the [adopters list](./docs/community/ADOPTERS.md).

## Security

The isolation boundary is the user Worker; tasks owned by the same user can access their shared files. Normal execution allows outbound internet access without per-command
approval, and configured external services receive the data sent to them. Read the [security policy](./.github/SECURITY.md) before exposing a deployment. Report vulnerabilities
privately to [security@linksense.org](mailto:security@linksense.org).

## License

LinkSense-owned code is licensed under [CPAL-1.0](./LICENSE). See the
[internal deployment exception](./LICENSE-EXCEPTIONS.md), [attribution requirements](./ATTRIBUTION.md), and [trademark policy](./TRADEMARK.md).
Licensing questions: [licensing@linksense.org](mailto:licensing@linksense.org).

The upstream Codex runtime is licensed under Apache-2.0. LinkSense is an independent project; see the [third-party notices](./THIRD-PARTY-NOTICES.md).

## Join the WeChat group

<img src="./docs/brand/wechat-group-2026-11-17.jpg" alt="LinkSense WeChat group QR code" width="400">

The QR code is valid for 7 days. If it has expired or you cannot join, email [hello@linksense.org](mailto:hello@linksense.org) for the latest invite.

## Acknowledgements

Thanks to the [Linux.do](https://linux.do) community for its support.

Thanks to all the developers who contribute to LinkSense.

<!-- contributors:start -->
<table role="presentation">
  <tr>
    <td align="center"><a href="https://github.com/Metrolive"><img src="https://avatars.githubusercontent.com/u/44701445?s=128" width="64" height="64" alt="" /><br /><sub>@Metrolive</sub></a></td>
    <td align="center"><a href="https://github.com/guygubaby"><img src="https://avatars.githubusercontent.com/u/21158055?s=128" width="64" height="64" alt="" /><br /><sub>@guygubaby</sub></a></td>
    <td align="center"><a href="https://github.com/Bo-infocare"><img src="https://avatars.githubusercontent.com/u/146154905?s=128" width="64" height="64" alt="" /><br /><sub>@Bo-infocare</sub></a></td>
  </tr>
</table>
<!-- contributors:end -->
