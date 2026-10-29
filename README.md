<p align="center">
  <img src="apps/web/public/attribution/linksense-mark.svg" alt="LinkSense" width="180">
</p>

<p align="center">
  <strong>Open-source agentic work platform for organizations.</strong>
</p>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  LinkSense is an open-source agentic work platform for organizations, deployed on your servers or private cloud. <strong>It includes a full agent execution environment</strong> for web browsing, code execution, file processing, and data analysis. Administrators deploy the platform and manage members, models, access, and usage. Once Skills and Applications are configured and published, other members can install and run them without rewriting them. Members can access their individual AI workspace through the browser to start and execute tasks and publish Skills and Applications. Members can also start tasks through supported <a href="./apps/docs/docs/user-guide/message-channels/overview.md">messaging channels</a>, including WeChat, Feishu, WeCom, DingTalk, and Microsoft Teams.
</p>

<p align="center">
  <strong>Self-hosted, with your choice of models and open-source organizational capabilities.</strong> Choose hosted or local models and store task records, files, Knowledge indexes, and credentials on your infrastructure. Configured external models, tools, and messaging services receive the data sent to those services. See <a href="./docs/product-guide.md#open-source-self-hosted-under-your-control">deployment and data boundaries</a> and the <a href="./docs/license-guide.md">license guide</a> for usage and distribution terms.
</p>

<p align="center">
  <a href="https://explore.linksense.org/">Live Demo</a> · <a href="./apps/docs/docs/user-guide/overview.md">User guide</a> · <a href="#why-use-linksense">Why use LinkSense</a> · <a href="#install">Install</a> · <a href="#documentation">Documentation</a>
</p>

## Why Use LinkSense

- **A complete agent workspace** — Research, browse, run code, analyze data, and create documents, spreadsheets, and presentations, with [scheduled tasks](./apps/docs/docs/user-guide/automations/create-and-manage.md).
- **Reusable team knowledge and expertise** — Share Knowledge, Skills, and tools with users or groups, with review, publishing, and version maintenance. [Sharing and capabilities](./docs/capabilities.md)
- **Composable applications** — Chat or custom interfaces, installable packages, online services, and [external embedding](./apps/docs/docs/user-guide/plugin-center/application-access.md).
- **Business system connections** — Use connectors and MCP for documents, email, and business APIs; retrieve data and invoke operations within configured permissions. [System integration](./docs/product-guide.md#build-an-mcp-backed-plugin)
- **Organizational management** — Manage members, models, credentials, access, and allowances, with usage reporting and operational audit records. [Administrator guide](./apps/docs/docs/admin-guide/overview.md)
- **Self-hosting and model choice** — Run on your servers or private cloud, choose hosted or local models, and use open-source organizational capabilities. [Deployment and data boundaries](./docs/product-guide.md#open-source-self-hosted-under-your-control)

## Install

**Choose one of the following installation methods. You do not need to run both.**

### Option 1: Install with a Coding Agent

```text
Help me install and start LinkSense by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

### Option 2: Manual Installation

One open-source product, two deployment profiles. Choose the capabilities you need, then follow that profile’s separate installation guide:

#### Deployment Profiles and Requirements

| Deployment profile | Includes | Starting point | Recommended for teams | Additional requirements | Install |
| --- | --- | --- | --- | --- | --- |
| **Core** | Agent workspace, Skills, Plugins, MCP, Application sharing, and organizational management | 4+ vCPU, 8+ GiB memory, 60+ GiB free SSD | 16 vCPU, 32 GiB memory, 200 GiB free SSD | — | [Install Core](./docs/setup/core.md) |
| **Full** | Everything in Core, plus complete Knowledge parsing, indexing, and retrieval services | 8+ vCPU, 10+ GiB memory, 120+ GiB free SSD | 16 vCPU, 32 GiB memory, 200 GiB free SSD | x86_64 / amd64 hosts or VMs must expose `x86-64-v2`.<br>The current source release configuration has a 10 GiB memory floor and permits overcommit. Large documents, OCR, and concurrent tasks need extra headroom; the selected release’s preflight is authoritative. | [Install Full](./docs/setup/full.md) |

- **Environment:** Linux or macOS on x86_64 / ARM64; Docker Engine API v1.45+, Docker Compose v2.24.4+, and `curl`. Use Docker Desktop on macOS.
- **Memory and capacity:** Memory means the amount actually available to Docker Engine; allow VM overhead in Docker Desktop. These are planning suggestions for external model APIs, not concurrent-user guarantees; size team deployments for actual concurrency and task workloads. Budget separately for local models and GPUs.

See [environment and CPU requirements](./docs/setup/operations.md) for detailed checks.

For diagnostics, repair, and upgrades of an existing installation, see [Operations](./docs/setup/operations.md).

## Quick Start

### After startup

1. Open the address printed by the installer and create the first administrator with the initialization credential. Defaults: `http://<server-address>:18081` on Linux and `http://localhost:18081` on macOS.
2. Configure a model channel in administration and verify both a short chat and a task with tools.
3. Follow the [first task guide](./apps/docs/docs/user-guide/getting-started/first-task.md). For Full, also configure [Knowledge models and document processing](./apps/docs/docs/user-guide/knowledge-bases/create-and-manage.md).

After services start, configure a model and test both chat and tool tasks. For the complete procedure, see the [Core installation guide](./docs/setup/core.md) or [Full installation guide](./docs/setup/full.md).

## Security

The isolation boundary is the user Worker; ordinary tasks can access the same user’s other task files. Ordinary execution permits internet egress without per-command approval. Configured external models and tools receive the data sent to those services.

Before adding users or exposing a deployment, read the [execution boundaries](./SECURITY.md#execution-boundaries) and [deployment requirements](./docs/setup/operations.md). Report security issues to `security@linksense.org`.

## Documentation

| Goal | Start here |
| --- | --- |
| Run tasks, schedule work, or connect messaging | [User guide](./apps/docs/docs/user-guide/overview.md) |
| Manage members, models, access, and usage | [Administrator guide](./apps/docs/docs/admin-guide/overview.md) |
| Share Knowledge, Skills, Plugins, and Applications | [Organizational capabilities](./docs/capabilities.md) |
| Connect business systems or build applications | [Extensions](./docs/product-guide.md#build-with-linksense) · [Interactive applications](./apps/docs/docs/developer-guide/interactive-application.md) |
| Deploy, troubleshoot, upgrade, or migrate | [Core](./docs/setup/core.md) · [Full](./docs/setup/full.md) · [Operations](./docs/setup/operations.md) |
| Understand architecture and execution | [Architecture and runtime](./docs/architecture.md) |

## Development

For source setup and image builds, see [Source development](./docs/setup/development.md). Read [AGENTS.md](./AGENTS.md) and [Contributing](./CONTRIBUTING.md) before making changes. Code contributions require the [CLA](./CLA.md).

## Community and Support

For questions and feedback, use [GitHub Discussions](../../discussions) or see [Support](./SUPPORT.md). For organizational deployment and collaboration: `hello@linksense.org`.

Organizations using LinkSense can opt in to a listing in [ADOPTERS.md](./ADOPTERS.md).

## License

LinkSense is open source under [CPAL-1.0](./LICENSE). For internal deployment, attribution, custom branding, and trademarks, see the [license guide](./docs/license-guide.md), [internal deployment exception](./LICENSE-EXCEPTIONS.md), [attribution requirements](./ATTRIBUTION.md), and [trademark policy](./TRADEMARK.md). For other licensing needs: `licensing@linksense.org`.

The official open-source Codex runtime ships unmodified under Apache-2.0. LinkSense is independent and is not affiliated with, sponsored by, or endorsed by OpenAI. See [third-party notices](./THIRD-PARTY-NOTICES.md).
