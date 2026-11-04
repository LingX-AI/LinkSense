# LinkSense

English | [简体中文](./README.zh-CN.md)

**Open-source agentic work platform for organizations.**

Deploy LinkSense on your own infrastructure. Give members their own AI workspaces, and share approved knowledge, skills, tools, and applications with the people who need them.

[Documentation](https://linksense.guygubaby.top/help/en-US/) · [Self-host](https://linksense.guygubaby.top/install) · [Live demo](https://explore.linksense.org/)

https://github.com/user-attachments/assets/5b61e639-e222-42eb-8e9a-536905d659e0

## Why LinkSense

- **Run tasks and deliver results.** Use agents powered by the open-source Codex runtime to work with web sources, code, and files, and produce documents, spreadsheets, and presentations.
- **Share reusable capabilities.** Package skills, plugins, and MCP tools into governed resources and publish applications with chat or custom interfaces.
- **Connect tools and manage access.** Use authorized connectors for documents and email, or integrate other business systems through MCP. Administrators manage resource access, model settings, quotas, usage, and audit logs.
- **Work on your infrastructure.** Configure cloud model providers or compatible endpoints you host. Users run tasks in separate Workers with configurable CPU and memory limits.
- **Start work where you are.** Use the workspace, configured messaging channels, or scheduled tasks.

## Choose a deployment

[Core](https://linksense.guygubaby.top/help/en-US/deploy/core/) includes the workspace, task attachments, and organizational capabilities. [Full](https://linksense.guygubaby.top/help/en-US/deploy/full/) adds built-in document parsing, indexing, and retrieval. [Compare deployment options](https://linksense.guygubaby.top/help/en-US/deploy/).

## Deployment and integration services

For private deployment or system integrations, contact [hello@linksense.org](mailto:hello@linksense.org) with your environment, expected usage, and the systems you want to connect.

## Quick Start

For coding-agent installation, give your assistant the [agent installation guide](https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md) and your target edition. After installation, follow [first-time setup](https://linksense.guygubaby.top/help/en-US/deploy/first-setup/) to configure an administrator and a model and verify a tool task.

## Development

Start with [source development](https://linksense.guygubaby.top/help/en-US/deploy/development/), then read the [contribution guide](./.github/CONTRIBUTING.md) and [repository instructions](./AGENTS.md). Contributions require a [CLA](./docs/legal/CLA.md).

## Security

The isolation boundary is the user Worker; tasks owned by the same user can share files. Normal execution allows outbound internet access without per-command approval. Read the [execution boundaries and reporting policy](./.github/SECURITY.md) before opening access. Report vulnerabilities privately to [security@linksense.org](mailto:security@linksense.org).

## Documentation

| I want to… | Read |
| --- | --- |
| Run a task and use organizational resources | [User guide](https://linksense.guygubaby.top/help/en-US/user-guide/overview/) |
| Manage models, members, and permissions | [Administrator guide](https://linksense.guygubaby.top/help/en-US/admin-guide/overview/) |
| Repair, upgrade, or troubleshoot a deployment | [Operations](https://linksense.guygubaby.top/help/en-US/deploy/operations/) |
| Build applications, develop from source, or understand the runtime | [Application development](https://linksense.guygubaby.top/help/en-US/developer-guide/interactive-application/) · [Source development](https://linksense.guygubaby.top/help/en-US/deploy/development/) · [Architecture](https://linksense.guygubaby.top/help/en-US/deploy/architecture/) |

## Community and support

Questions: [GitHub Discussions](../../discussions) and [support](./.github/SUPPORT.md). Organizations can opt in to the [adopters list](./docs/community/ADOPTERS.md).

## License

LinkSense-owned code is licensed under [CPAL-1.0](./LICENSE). See the [internal deployment exception](./LICENSE-EXCEPTIONS.md), [attribution requirements](./ATTRIBUTION.md), and [trademark policy](./TRADEMARK.md) for details. Licensing questions: [licensing@linksense.org](mailto:licensing@linksense.org).

The upstream Codex runtime is licensed under Apache-2.0. LinkSense is an independent project; see [third-party notices](./THIRD-PARTY-NOTICES.md).
