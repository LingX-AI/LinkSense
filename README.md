<p align="center">
  <img src="./apps/web/public/attribution/linksense-mark.svg" alt="LinkSense" width="180">
</p>

<h2 align="center">
  Open-source agentic work platform for organizations.<br>
  <sub>An enterprise-grade, open-source WorkBuddy alternative.</sub>
</h2>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://linksense.guygubaby.top/doc/"><img src="https://img.shields.io/badge/Website-LinkSense-2563EB?style=flat-square" alt="LinkSense documentation"></a>
  <a href="https://explore.linksense.org/"><img src="https://img.shields.io/badge/Live_Demo-Try_Now-16A34A?style=flat-square" alt="Live demo"></a>
  <a href="mailto:hello@linksense.org"><img src="https://img.shields.io/badge/Contact-Email-7C3AED?style=flat-square" alt="Contact the team"></a>
</p>

<p align="center">
  LinkSense is an open-source agentic work platform for organizations, deployed on your servers or private cloud.<br>
  Administrators deploy the platform; members have their own AI workspaces to run tasks and share Knowledge, Skills, Plugins, and Applications within their permissions.<br>
  The platform manages access and credentials centrally, so members can use authorized system connections without receiving the underlying credentials.<br>
  Each user's dedicated Worker provides user-level runtime isolation with configurable CPU and memory limits.
</p>

<p align="center">
  <a href="#why-use-linksense">Features</a> · <a href="#choose-a-deployment">Deployments</a> · <a href="#deployment-and-integration-services">Deployment services</a> · <a href="#quick-installation">Quick installation</a> · <a href="#development">Development</a><br>
  <a href="#security">Security</a> · <a href="#documentation">Documentation</a> · <a href="#community-and-support">Community and support</a> · <a href="#license">License</a>
</p>

## Why Use LinkSense

- **Agent execution and deliverables** — Powered by the open-source Codex runtime, agents research web sources, operate browsers, run code, analyze data, and process files in each user's Worker to produce documents, spreadsheets, presentations, and other results.
- **Reusable knowledge and expertise** — Knowledge libraries support document parsing, indexing, and retrieval. Skills and Plugins package working methods and tool integrations as installable resources with version maintenance, review, and publishing.
- **Ready-to-use applications** — Preconfigure instructions, models, and resources as online application services. Authorized members install a service and start their own tasks without configuring each resource. Chat and custom interfaces are supported; application packages create personal copies that may need credential and resource configuration.
- **Business system connections** — Connect documents and email through connectors, and integrate ERP, CRM, and other business systems through MCP as needed. Agents read data and perform operations within configured permissions.
- **Organizational access and governance** — Grant access to users and groups; manage members, model credentials, and allowances centrally, with usage reporting and operational audit records.
- **Self-hosting and model choice** — Run on your servers or private cloud, connect compatible hosted or local model services, and store task records, files, Knowledge indexes, and credentials on your infrastructure.
- **Messaging and scheduled tasks** — Start tasks through Web, WeChat, Feishu, WeCom, DingTalk, or Microsoft Teams, or schedule tasks to run automatically.

## Choose a deployment

LinkSense provides **Core** and **Full** deployment profiles in the same repository. They differ in whether they include built-in Knowledge services, not in whether they are free or paid.

| Profile | Includes | When to choose it |
| --- | --- | --- |
| **Core** | Complete agent workspace, Skills, Plugins, MCP, Application sharing, and organizational management | **Personal evaluation or organizations without built-in Knowledge needs:** browse the web, run code, analyze data, process files, and share Skills and Applications. |
| **Full** | Everything in Core, plus built-in Knowledge document parsing, indexing, and retrieval | **Organizations that need built-in Knowledge:** turn organizational documents into searchable, reusable knowledge libraries. |

### Start with Core for evaluation; choose Full when you need built-in Knowledge.

For Full deployment, see the [Full installation guide](https://linksense.guygubaby.top/doc/deploy/full/).

LinkSense supports centralized organizational management, permission-based sharing, and work across multiple members. Administrators manage resource access for users and groups, models, credentials, and allowances, and review usage and audit records. Members across departments work in their own AI workspaces and share reviewed Skills, Applications, and Knowledge within their permissions.

**For organizational Full deployments, start planning with 16 vCPU, 32 GiB memory, and 200 GiB free SSD**, preferably on Linux with Docker. This is a planning reference for external model APIs, not a fixed user or concurrency limit.

Before a large rollout, test representative tasks and budget for **peak active users, concurrent tasks, document volume, and OCR workloads**. Hardware upgrades do not automatically increase task concurrency; see [Concurrency and Workers](https://linksense.guygubaby.top/doc/deploy/operations/#concurrency-and-workers). Plan separately for local models and GPUs.

Full deployments on x86_64 hosts or VMs must expose `x86-64-v2`; this x86 requirement does not apply to native ARM64. See [Virtual machines and Knowledge](https://linksense.guygubaby.top/doc/deploy/operations/#virtual-machines-and-knowledge).

## Deployment and integration services

LinkSense supports self-hosting. For organizations that want implementation assistance, the LinkSense team provides **private deployment and business system integration services**. Our forward-deployed engineers (FDEs) can work with your IT and business teams to clarify requirements, connect existing systems, configure access, and validate representative workflows.

**Need deployment or integration assistance?** Email [hello@linksense.org](mailto:hello@linksense.org) with your environment, expected usage, and the systems you want to connect so we can discuss the implementation scope.

## Quick installation

**Supports Linux and macOS on x86_64 / ARM64. This workflow does not provide native Windows installation steps.**

Choose either of the following methods to install **Core**. The installer downloads and starts the required services without a source checkout or local compilation. For Full, see the [Full installation guide](https://linksense.guygubaby.top/doc/deploy/full/).

### Option 1: Install with a coding agent

**The installation guide in this prompt defaults to Core.** Give Codex, Claude Code, Cursor, Windsurf, or another coding agent this prompt:

```text
Help me install and start LinkSense by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

The assistant checks the installation environment, preserves existing installations, and reports the actual launch result.

**After successful installation, the terminal displays the access address and initialization credential. Save them securely.**

Open that address in your browser. Defaults are `http://<server-address>:18081` on Linux and [http://localhost:18081](http://localhost:18081) on macOS; the terminal output is authoritative. Use the initialization credential to create the first administrator.

Follow [model configuration](https://linksense.guygubaby.top/doc/admin-guide/model-settings/) in administration. Verify a short chat and a task with tools, then follow the [first task guide](https://linksense.guygubaby.top/doc/user-guide/getting-started/first-task/).

### Option 2: Manual installation

#### 1. Check resources

**Core starting point: at least 4 vCPU, 8 GiB memory available to Docker, and 60 GiB free SSD.**

These resources are for evaluation with external model APIs, not a guarantee of multi-user concurrency. See [deployment options and resource planning](https://linksense.guygubaby.top/doc/deploy/) for Full and team deployments, and [source development](https://linksense.guygubaby.top/doc/deploy/development/) for code changes and image builds.

#### 2. Install and start Docker

Follow the [official Docker installation guide](https://docs.docker.com/get-docker/):

- **Linux:** Docker Engine and the Docker Compose plugin.
- **macOS:** Docker Desktop.

Run these checks in your terminal:

```bash
docker version
docker compose version
curl --version
```

Confirm that:

- Docker reports a **Server** section with **API version ≥ 1.45**.
- Docker Compose is **≥ 2.24.4**.
- `curl` prints its version successfully.

The terminal must be able to download GitHub release assets, and Docker Engine must be able to pull images. They use separate proxy settings; see [Environment and network](https://linksense.guygubaby.top/doc/deploy/operations/#environment-and-network).

#### 3. Configure runtime resources

**macOS**

- Open Docker Desktop → **Settings → Resources → Advanced**.
- Set **CPUs ≥ 4** and **Memory limit to 10–12 GB**. Adjust **Disk usage limit** so Docker and the Mac disk each have at least **60 GiB free**.
- Select **Apply & Restart** and wait for Docker to restart.

**Linux**

Confirm at least **4 vCPU, 8 GiB memory, and 60 GiB free SSD**, allowing additional resources for the operating system and other services.

#### 4. Download and run the installer

Once the prerequisites are configured, run the single command for your operating system to install and start Core.

**Linux:**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

**macOS:** Run without `sudo`.

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sh install-core.sh
```

**Wait for installation to finish.** The terminal prints **`LinkSense is ready at:`**, followed by the access address and initialization credential, when services have started. Save the address and credential securely.

> ⚠️ **Existing deployments:** Do not reinstall or switch Core / Full in place. For upgrades, migration, and troubleshooting, see [Operations](https://linksense.guygubaby.top/doc/deploy/operations/).

#### 5. Open LinkSense and start working

Open **the actual address printed by the installer**. Defaults are `http://<server-address>:18081` on Linux and [http://localhost:18081](http://localhost:18081) on macOS. Use the initialization credential to create the first administrator.

Follow [first-time setup](https://linksense.guygubaby.top/doc/deploy/first-setup/) and [model configuration](https://linksense.guygubaby.top/doc/admin-guide/model-settings/) to configure a model channel. Verify a short chat and a task with tools, then follow the [first task guide](https://linksense.guygubaby.top/doc/user-guide/getting-started/first-task/).

## Development

For local development, source changes, and image builds, see [Source development and image builds](https://linksense.guygubaby.top/doc/deploy/development/).

### Where to start

| What to change | Source |
| --- | --- |
| Web workspace and administration UI | [apps/web](./apps/web) |
| APIs, access control, and business logic | [apps/api](./apps/api) |
| Agent execution and Workers | [apps/runner](./apps/runner) |

See [Architecture and execution boundaries](https://linksense.guygubaby.top/doc/deploy/architecture/) for the architecture, and [Source development](https://linksense.guygubaby.top/doc/deploy/development/) for environment configuration, commands, and image builds.

### Contributing

Before submitting changes, run the affected tests and check types, lint, and builds. Read [AGENTS.md](./AGENTS.md) and the [contribution guide](./.github/CONTRIBUTING.md). Code contributions require a [CLA](./docs/legal/CLA.md).

## Security

The isolation boundary is the user Worker; ordinary tasks can access the same user's other task files. Ordinary execution permits internet egress without per-command approval. Configured external models and tools receive the data sent to those services.

Before adding users or exposing a deployment, read the [execution boundaries](./.github/SECURITY.md#execution-boundaries) and [deployment requirements](https://linksense.guygubaby.top/doc/deploy/operations/). Report security issues privately to `security@linksense.org`.

## Documentation

| I want to… | Read |
| --- | --- |
| Run tasks, schedule work, or connect messaging | [User guide](https://linksense.guygubaby.top/doc/user-guide/overview/) |
| Manage members, models, access, and usage | [Administrator guide](https://linksense.guygubaby.top/doc/admin-guide/overview/) |
| Share Knowledge, Skills, Plugins, and Applications | [Skills, Plugins, and Applications](https://linksense.guygubaby.top/doc/user-guide/plugin-center/discover-and-install/) · [Knowledge sharing](https://linksense.guygubaby.top/doc/user-guide/knowledge-bases/sharing/) |
| Connect business systems or build applications | [Application development](https://linksense.guygubaby.top/doc/developer-guide/interactive-application/) |
| Deploy, troubleshoot, upgrade, or migrate | [Core](https://linksense.guygubaby.top/doc/deploy/core/) · [Full](https://linksense.guygubaby.top/doc/deploy/full/) · [Operations](https://linksense.guygubaby.top/doc/deploy/operations/) |
| Understand architecture and execution | [Architecture](https://linksense.guygubaby.top/doc/deploy/architecture/) |

## Community and support

Find questions and feedback in [GitHub Discussions](../../discussions) or see [Support](./.github/SUPPORT.md).

For organizational deployment and collaboration: `hello@linksense.org`.

Organizations using LinkSense can opt in to a listing in [ADOPTERS.md](./docs/community/ADOPTERS.md).

## License

LinkSense is open source under [CPAL-1.0](./LICENSE). For internal deployment, attribution, custom branding, and trademarks, see the [license](./LICENSE), [internal deployment exception](./LICENSE-EXCEPTIONS.md), [attribution requirements](./ATTRIBUTION.md), and [trademark policy](./TRADEMARK.md). For other licensing needs: `licensing@linksense.org`.

The official open-source Codex runtime ships unmodified under Apache-2.0. LinkSense is independent and is not affiliated with, sponsored by, or endorsed by OpenAI. See [third-party notices](./THIRD-PARTY-NOTICES.md).
