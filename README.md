# LinkSense

English | [简体中文](./README.zh-CN.md)

**Open-source AI workspace built for organizations.**

**Bring frontier AI to every individual. Turn individual AI capabilities into organizational capabilities — on an open-source platform you control.**

Built with the open-source Codex runtime — running inside your LinkSense deployment.

**Codex Experience. Organizational Intelligence.**

[Live Demo](https://explore.linksense.org/) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Build with LinkSense](#build-with-linksense)

![A Skill built in one workspace becomes available to the organization](./docs/demo/Hero.gif)

---

## Why LinkSense

### Frontier AI for individuals

Give every user a powerful Codex-based workspace for real AI work — not a reduced enterprise chatbot experience.

### Organizational capabilities, not isolated personal setups

Turn effective Skills, organizational Knowledge, system connections, and AI experiences into capabilities that can be shared, governed, and reused across the organization.

### Open source and under your control

Self-host LinkSense on your own infrastructure. Choose your models and integrations, inspect and modify the source, and operate without a required LinkSense cloud control plane.

---

## See LinkSense in Action

### Real AI work

![Research, browser, code, data, spreadsheets, reports and artifacts](./docs/diagrams/real-ai-work.svg)

### Individual Skill → Organizational Capability

![A personal Skill moves through testing, review, publication and installation](./docs/diagrams/organizational-capability-lifecycle.svg)

### Capabilities → Team Application

![Knowledge, Skills and MCP services combine into an Application for teams](./docs/diagrams/capabilities-to-team-application.svg)

---

## Organizational Capabilities

LinkSense gives every user their own AI workspace — and provides the organizational layer for turning what individuals build into capabilities that can be shared, governed, and reused across teams.

| Capability object | Organizational role |
| --- | --- |
| **Knowledge Bases** | Make organizational context available to AI with controlled access |
| **Skills** | Turn effective ways of working into reusable capabilities |
| **MCP Servers** | Connect AI to organizational systems and actions |
| **Plugins** | Package Skills and MCP integrations for reviewed distribution |

Knowledge Base processing and search require the Full deployment profile. Core provides the workspace, Skills, Plugins, MCP connections, and Applications without the Full Knowledge Stack.

These capabilities can start with an individual and become reusable across the organization.

```text
                  Personal Workspace
                         │
                    Create & Test
                         │
                         ▼
              Organizational Capability
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       Release        Authorize       Connect
          │              │              │
       Review         Users /         Systems
          │            Groups
       Publish
          │
          └──────────────┬──────────────┘
                         ▼
                 Shared & Reusable
```

Skills and Plugins can move from personal development to immutable releases, administrative review, organizational publishing, installation, and explicit updates.

Knowledge Bases can be authorized to selected users and groups. MCP connections and credentials remain separately managed, allowing AI capabilities to connect to organizational systems without distributing underlying credentials to every user.

**Delegated execution, not credential sharing.**

### Applications — turn capabilities into experiences for others

Applications are where these capabilities come together.

An Application combines maintained instructions and model configuration with organizational Knowledge, Skills, Plugins, and MCP connections, then makes that experience available to authorized users and groups.

```text
                  Instructions · Model
                         +
                 Knowledge Bases
                         +
                      Skills
                         +
                     Plugins
                         +
                   MCP Servers
                         │
                         ▼
                 ┌─────────────┐
                 │ Application │
                 └─────────────┘
                         │
                  Users / Groups
                         │
                         ▼
                  User's own Task
```

For example:

```text
Finance Knowledge
+ Finance Skill
+ ERP Integration
        │
        ▼
Finance Application
        │
        ▼
   Finance Team
```

Users don't need to reconstruct the underlying setup themselves. They open an authorized Application and start their own Task with the maintained capabilities already composed for that use case.

Applications are **not autonomous agents**. They are reusable AI work entry points. Each authorized user starts and owns their own Task, while the Application provides the maintained configuration and organizational capabilities behind the experience.

Applications can also provide controlled access to creator-maintained Knowledge and MCP capabilities without giving users direct management access or exposing underlying credentials through normal LinkSense interfaces.

LinkSense adds identity, ownership, user/group authorization, publishing and review, credential management, model management, usage, audit, and runtime operations around these capabilities.

Together, they form **the open capability layer between frontier AI and the organization.**

```text
                    Frontier AI
                  Models · Codex
                        │
                        ▼
┌──────────────────────────────────────────┐
│                 LinkSense                │
│                                          │
│          Personal AI Workspace           │
│                                          │
│  ───── Organizational Capabilities ───── │
│                                          │
│   Knowledge Bases      Skills            │
│   MCP Servers          Plugins           │
│   Applications                           │
│                                          │
│   Identity · Sharing · Governance        │
│   Credentials · Runtime · Operations     │
└──────────────────────────────────────────┘
          │                         │
          ▼                         ▼
        People                 Data · Systems
```

---

## Built with the Open-source Codex Runtime

LinkSense runs the open-source Codex runtime inside its own managed Workers. It does not depend on the Codex web application or a LinkSense-hosted Codex service.

LinkSense directly runs the official `@openai/codex` package through:

```bash
codex app-server --stdio
```

and communicates with it through the Codex app-server JSON-RPC protocol.

The Codex runtime executes inside the LinkSense deployment. Model inference is configured separately: organizations can connect the model providers or compatible private endpoints they choose.

LinkSense does **not** fork Codex, patch its source, or reimplement the agent loop.

| Codex | LinkSense |
| --- | --- |
| Agent reasoning and Turns | Organizational workspace |
| Native tools and execution | Identity, sharing, and governance |
| Skills and Plugins | Publishing and organizational lifecycle |
| Models and sub-agents | Applications, Knowledge, and MCP management |
| Sandbox semantics | Workers, persistence, usage, and operations |

> **Codex decides how the agent executes. LinkSense decides what it can access, where it runs, how capabilities are shared and governed, and how execution is persisted and operated.**

---

## Open Source. Self-hosted. Under Your Control.

The organizational capability layer itself is open source. LinkSense-owned code for Applications, Skills and Plugins, MCP management, Knowledge, identity and groups, governance, credentials, usage and audit, Runner and Workers, together with the Core and Full deployment configurations, is part of the open-source project. The independent services used by those configurations retain their own licenses.

Organizational features are not separated into a required closed enterprise runtime or LinkSense-operated cloud control plane.

Run the complete platform on your own servers, private cloud, or VPC. Inspect the source, modify the platform, choose your models and integrations, and operate the environment on infrastructure you control. There is no required online runtime license activation heartbeat.

With private models, local Knowledge, and local MCP services, prompts, files, Task state, Knowledge indexes, credentials, audit records, and results can remain inside infrastructure you control.

Configured external services may still make external network calls, so LinkSense describes itself as **self-hosted and private-network friendly**, not formally air-gapped.

**Models:** OpenAI · Azure OpenAI · Anthropic · Google / Vertex · Alibaba · DeepSeek · OpenRouter · OpenAI-compatible endpoints

---

## Quick Start

The published release installers provide two deployment profiles from the same repository:

- **Core** — AI Workspace and organizational capability platform.
- **Full** — Core plus complete document processing and Knowledge retrieval.

### Linux

```bash
# Core
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh

# Full
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

Open:

```text
http://<server-address>:18081
```

The installer prints a one-time initialization credential for creating the first administrator.

### macOS

```bash
# Core
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh

# Full
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

Open:

```text
http://localhost:18081
```

Linux stores deployment files under `/opt/linksense`; macOS uses `~/.linksense`. The `18081` URLs above apply to the release installers; source and development workflows use different ports, listed below.

### Requirements

| Profile | Recommended CPU | Minimum Docker memory | Recommended free SSD |
| --- | ---: | ---: | ---: |
| Core | 4+ vCPU | 8+ GiB | 60+ GiB |
| Full | 8+ vCPU | 16+ GiB | 120+ GiB |

Additional requirements:

- Linux on x86_64 or ARM64 with a local Docker Engine; common distributions include Ubuntu, Debian, Fedora, RHEL, Rocky Linux, AlmaLinux, and CentOS
- macOS: Intel Mac or Apple Silicon with Docker Desktop
- Release images support `linux/amd64` and `linux/arm64`
- Docker Engine API v1.45+ on both Linux and macOS
- Docker Compose v2.24.4+
- `curl` and access to GitHub, GHCR, upstream image registries, and the Full tokenizer downloads
- TCP port `18081` available by default for the release installer

The installer checks Docker's available memory against the minimum above; CPU and SSD figures are recommendations, not installation checks. It validates the host before writing persistent state and generates runtime secrets automatically.

A domain and HTTPS are optional for local startup. Public deployments should place an HTTPS reverse proxy in front of port `18081`.

### Custom port

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh \
  | sudo env LINKSENSE_HTTP_PORT=19090 sh
```

### Command-line management

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

Run `linksense` without arguments to open the interactive control menu.

Linux requests `sudo` when needed. On macOS, add `$HOME/.local/bin` to `PATH` and run commands without `sudo`.

### Repair and upgrade

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

Run the same commands without `sudo` on macOS.

Repair stays on the installed release. Upgrade detects Core/Full, waits for active work, and stores a validated PostgreSQL backup under `volume://linksense-backups/postgres/` before migration.

No data volume is deleted. A failure after migration begins does not trigger an automatic database rollback; retain the printed backup location and rerun the upgrade after reviewing diagnostics.

### Ports by workflow

| Workflow | Web entry | Port configuration |
| --- | --- | --- |
| Published Core / Full installer | `http://localhost:18081` | `LINKSENSE_HTTP_PORT` during installation; `linksense port` after installation |
| Docker development (`pnpm dev`) | `http://localhost:18172` and `https://localhost:18173` | `LINKSENSE_DEV_WEB_PORT` and `LINKSENSE_DEV_WEB_HTTPS_PORT` in `.env` |
| Host development (`pnpm dev:host`) | `http://localhost:5273` | `LINKSENSE_DEV_WEB_PORT` in `.env.host` |
| Source Compose / `pnpm dev:prod` | `http://localhost:8080` | `LINKSENSE_HTTP_PORT` in `.env` (`8080` in `.env.example`) |
| Git production stack | Reverse proxy to `127.0.0.1:8080` by default | `LINKSENSE_GATEWAY_BIND_ADDRESS` and `LINKSENSE_HTTP_PORT` in `.env.production` |

The API and Runner use ports `4000` and `4010` in development. In release installations, they are internal services; access LinkSense through the Web entry. Source Compose and Git production have different service requirements; see their deployment guides before starting them.

For a Linux release installation accessed from another device, replace `localhost` in the table with the server address.

---

## Architecture

The diagram shows the published Full deployment. Core omits the Full Knowledge Stack, and host development uses local-process Workers instead of Docker Workers.

![Full deployment system architecture](./docs/diagrams/system-architecture.svg)

```text
Browser
  │ HTTPS / REST / SSE
  ▼
Gateway / Nginx
  │
  ├── Web
  │     React SPA + Help Center
  │
  ├── API
  │     Fastify REST API + SSE
  │       ├── PostgreSQL
  │       ├── Redis
  │       ├── MinIO
  │       ├── BullMQ
  │       └── Full Knowledge Stack
  │             ├── Docling
  │             ├── Tokenizer
  │             └── Elasticsearch
  │
  └── API ── authenticated HTTP ──▶ Runner Controller
                                        │
                                        │ Docker Engine
                                        ▼
                               Dynamic Per-user Worker
                                 ├── Per-task workspace
                                 ├── Per-task CODEX_HOME
                                 ├── Official Codex app-server
                                 ├── Model gateway
                                 ├── LinkSense Core MCP
                                 ├── User / Plugin MCP
                                 └── Chromium / Playwright
```

### Worker model

For personal tasks, LinkSense dynamically manages a Docker Worker per active user. Separately isolated service sessions can have their own Workers.

Multiple Tasks belonging to the same user may reuse that Worker. Each Task receives a separate workspace and `CODEX_HOME`.

Task workspaces are isolated directories, **not separate containers or kernel boundaries**.

Inactive Workers are reclaimed. Per-user package environments can persist across reclamation, while generated artifacts persist independently in object storage.

Worker controls include configurable CPU/memory/PID limits, read-only root filesystems, `no-new-privileges`, dropped Linux capabilities, non-privileged containers, non-root Task processes, and separate control and egress networks.

Workers do not directly join PostgreSQL or Redis service networks. Internet egress is currently allowed; LinkSense does not enforce a universal domain allowlist or deny-all egress policy.

### Execution path

Real-time Tasks normally follow:

```text
User
 ↓
API — persist Task / PendingRequest
 ↓
Runner
 ↓
Per-user Worker
 ↓
Codex
```

They do not normally enter BullMQ before execution.

BullMQ primarily handles Automations, scheduled/background jobs, worker maintenance, recovery, email, billing, Knowledge synchronization and processing, and cleanup.

### Event delivery

```text
Codex
  ↓
Worker
  ↓
Runner mapping / redaction
  ↓
Durable event outbox
  ↓
API
  ↓
PostgreSQL
  ↓
Redis Pub/Sub
  ↓
SSE
  ↓
Browser
```

---

## Build with LinkSense

LinkSense provides three primary extension paths without requiring changes to LinkSense source.

### Build a Skill

Teach AI reusable methods, workflows, domain practices, scripts, references, and supporting resources using the native Codex Skill format.

```text
my-skill/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/
├── references/
└── assets/
```

Skills can be discovered natively by Codex or explicitly selected by users and Applications.

### Build an MCP-backed Plugin

Connect external systems and APIs through MCP, then package MCP declarations together with Skills and supporting resources.

```text
Plugin
├── Skills
├── MCP declarations
├── scripts / resources
└── .codex-plugin/plugin.json
```

For CRM, ERP, SaaS, monitoring systems, and internal APIs, MCP is generally the recommended integration boundary.

Credentials remain separate from Plugin packages.

### Build an Interactive Application

Build purpose-specific interfaces and workflows on top of authorized LinkSense capabilities.

Interactive Applications are ZIP packages with `manifest.json` and `index.html` at the root, plus any JavaScript, CSS, and assets they need. They are displayed in iframes. LinkSense currently treats these packages as trusted Web applications; the iframe does not provide a browser sandbox. Install and publish packages only from sources you trust.

Their SDK can request explicitly permitted capabilities such as user profile access, capability discovery, Knowledge Base access, MCP Server discovery, and Task creation.

Interactive Applications are separate from normal Applications, which are primarily configuration and capability-composition objects.

---

## Technology Stack

| Layer | Stack |
| --- | --- |
| Web | React 19 · TypeScript · Vite · React Router · TanStack Query · shadcn/ui · Base UI · Tailwind · i18next |
| API | Node.js · TypeScript · Fastify 5 · Zod · Prisma · PostgreSQL · Redis · BullMQ · MinIO |
| Runner | Node.js · TypeScript · Fastify · Docker · official Codex app-server · Chromium / Playwright |
| Knowledge | Docling · Elasticsearch · BM25 + vector retrieval · RRF · optional reranking |

---

## Local Development

Requires Node.js 24.5+, pnpm 10.6.4, Docker Engine/Compose, rsync, and [mkcert](https://github.com/FiloSottile/mkcert). On macOS, install mkcert with `brew install mkcert`.

Applications and dependencies run in Linux containers; host rsync only synchronizes source files. Run `mkcert -install` and complete the system trust prompt before the first launch.

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
mkcert -install
pnpm dev:prepare
pnpm dev
```

Default addresses for Docker development (`pnpm dev`):

- Web HTTP: `http://localhost:18172`
- Web HTTPS (HTTP/2): `https://localhost:18173`
- API: `http://localhost:4000`
- Runner: `http://localhost:4010`

HTTP and HTTPS are available simultaneously. Both support API requests, SSE, and hot reload; use HTTPS to test concurrent SSE tasks over HTTP/2. Configure the addresses and ports with `LINKSENSE_DEV_WEB_ORIGIN`, `LINKSENSE_DEV_WEB_PORT`, and `LINKSENSE_DEV_WEB_HTTPS_PORT` in `.env`.

For Docker-free Core development, follow the [host development guide](./deploy/development/README.md#host-development-without-local-docker). `pnpm dev:host` serves Web at `http://localhost:5273` by default, uses `.env.host`, and runs local-process Workers without container isolation or the managed browser.

Common commands:

```bash
pnpm dev:stop
pnpm dev:rebuild
pnpm dev:worker:rebuild
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm dev:prepare` builds application images, the production Task Worker, and the bilingual Help Center; checks infrastructure and database initialization; starts services; and warms runtime caches.

`pnpm dev` prepares missing inputs automatically.

### AI development guide

Before using Codex or another AI coding tool, read [`AGENTS.md`](./AGENTS.md).

AI-generated features and behavior changes require tests like any other contribution. Run affected tests, type checking, linting, and builds before committing.

Never commit secrets, personal data, internal requirement documents, or generated artifacts.

---

## Building from Source with Docker

The command below builds images; it does not start the application. The root Compose file maps the Web container to `LINKSENSE_HTTP_PORT` (`8080` in `.env.example`). Its example environment contains placeholder credentials and external service addresses, so it must be configured before runtime use. The separate Git production stack binds its gateway to `127.0.0.1:8080` by default; see the [production deployment guide](./deploy/production/README.md) for its prerequisites and startup procedure.

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

Multi-platform build:

```bash
docker buildx build --platform linux/amd64,linux/arm64 --target runtime \
  -f Dockerfile.api -t <registry>/linksense-api:<tag> --push .
```

| File | Target | Output |
| --- | --- | --- |
| `Dockerfile.api` | `runtime` / `migration` | API / database migration |
| `Dockerfile.web` | `runtime` | Web + Help Center |
| `Dockerfile.runner` | `controller` / `worker` | Runner controller / Task Worker |

Production-like local stack:

```bash
pnpm dev:prod
pnpm dev:prod:stop
```

For production, prefer verified release images pinned to immutable digests rather than building source directly on the production host.

---

## Security

See [SECURITY.md](./SECURITY.md).

Security reports: `developer@linksense.org`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md).

## Support

See [SUPPORT.md](./SUPPORT.md).

## License

LinkSense-owned source code is released under [CPAL-1.0](./LICENSE), an [OSI-approved](https://opensource.org/license/CPAL-1.0) open-source license. The completed exhibits specify a small attribution notice: `Powered by` and the full LinkSense mark. Its placement and exceptions are described in [ATTRIBUTION.md](./ATTRIBUTION.md).

The [additional permissions](./LICENSE-EXCEPTIONS.md) clarify that internal deployment does not itself require source disclosure, permit your own product branding, and preserve the terms of published versions. Graphical interfaces still display the attribution. CLI, headless and API-only use, full-screen modes, and generated documents and exports do not require it.

The [trademark policy](./TRADEMARK.md) expressly permits use of the mark for this notice. [NOTICE](./NOTICE) records the project copyright. Third-party components retain their respective licenses; [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) identifies the standalone images selected for Core and Full releases. The open-source scope here is LinkSense-owned source code, not a claim that every deployment image uses an open-source license. Contributors should read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [CLA](./CLA.md).

For licensing arrangements that remove the notice or use different terms, contact `licensing@linksense.org`.

## Contributors

Thank you to everyone who contributes to LinkSense!

<!-- contributors:start -->
<p>
  <a href="https://github.com/Metrolive"><img src="https://avatars.githubusercontent.com/u/44701445?s=128" width="64" height="64" alt="Metrolive" title="Metrolive" /></a>
  <a href="https://github.com/guygubaby"><img src="https://avatars.githubusercontent.com/u/21158055?s=128" width="64" height="64" alt="guygubaby" title="guygubaby" /></a>
</p>
<!-- contributors:end -->
