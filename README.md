<p align="center">
  <img src="apps/web/public/attribution/linksense-mark.svg" alt="LinkSense" width="180">
</p>

<p align="center">
  <strong>Open-source agentic work platform for organizations.</strong>
</p>

English | [简体中文](./README.zh-CN.md)

Give everyone in your organization a Codex-powered AI agent — deployed on your infrastructure, with the models you choose.

[Live Demo](https://explore.linksense.org/) · [Quick Start](#quick-start) · [How it works](#organizational-capabilities) · [Architecture](#architecture) · [Build with LinkSense](#build-with-linksense)

https://github.com/user-attachments/assets/5b61e639-e222-42eb-8e9a-536905d659e0

<p align="center"><em>Open-source, self-hosted WorkBuddy alternative for organizations.</em></p>

---

## Why LinkSense

### Codex-powered agents that get work done
Give every user a full agentic workspace to research, browse, run code, analyze data, work with files, and create documents and artifacts.

### Your infrastructure. Your models.
Deploy LinkSense on your own servers or private cloud. Use OpenAI, Anthropic, Gemini, DeepSeek, Qwen, or your own local LLM.

### Fully open source — including enpterprise capabilities
Users, groups, Knowledge, Skills, Plugins, MCP, Applications, governance, and more are part of the open-source platform — not locked behind an enterprise edition.

### Built for the whole organization
Centrally manage access, models, knowledge, credentials, and capabilities. What works for one person can be shared, governed, and reused across teams.


---

## Quick Start

Two deployment profiles ship from the same repository:

**Core** — AI workspace + organizational capability platform
**Full** — Core + complete document processing and Knowledge retrieval

Core needs 4+ vCPU, 8+ GiB memory, and 60+ GiB free SSD. Full needs 8+ vCPU, 10+ GiB,
and 120+ GiB. Docker Engine API v1.45+ and Docker Compose v2.24.4+ are required.
The memory check reads the memory actually available to Docker Engine. With Docker
Desktop, this is the VM allocation, rather than the host's total RAM. An 8 GB
allocation can report less than 8 GiB of usable memory. Adjust Settings → Resources
→ Advanced → Memory limit, then apply the changes and restart Docker Desktop;
allocate at least 10–12 GB for Core and leave room
above Full's 10 GiB usable-memory requirement.
See [Deployment reference](#deployment-reference) for the full list.

### Linux

```bash
# Core
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh

# Full
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

Then open `http://<server-address>:18081`.

### macOS

```bash
# Core
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh

# Full
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

Then open `http://localhost:18081`.

### Prefer to read the script first

```bash
curl -fsSL -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh
less install-core.sh
sudo sh install-core.sh
```

The installer validates the host before writing persistent state, generates runtime
secrets automatically, and prints a one-time initialization credential for creating the
first administrator.

Linux stores deployment files under `/opt/linksense`; macOS uses `~/.linksense`.

A domain and HTTPS are optional for local startup. Public deployments should place an
HTTPS reverse proxy in front of port `18081`.

### Not ready to install?

Open a [Discussion](../../discussions) and tell us what you are trying to do — we read
all of them. If you are evaluating LinkSense for an organization, we are working with a
small number of early design partners and will help you deploy: `hello@linksense.org`.

Already running LinkSense? Add your organization to [ADOPTERS.md](./ADOPTERS.md).

---

## Organizational Capabilities

LinkSense gives every user their own AI workspace — and provides the organizational layer
for turning what individuals build into capabilities that can be shared, governed, and
reused across teams.

| Capability object | Organizational role |
| --- | --- |
| **Knowledge Bases** | Make organizational context available to AI with controlled access |
| **Skills** | Turn effective ways of working into reusable capabilities |
| **MCP Servers** | Connect AI to organizational systems and actions |
| **Plugins** | Package Skills and MCP integrations for reviewed distribution |

These capabilities can start with an individual and become reusable across the organization.

<p align="center">
  <img src="./docs/diagrams/organizational-capability-lifecycle.svg" alt="Personal Workspace → Create &amp; Test → Organizational Capability. Release → Review → Publish; Authorize → Users / Groups; Connect → Systems. All paths lead to Shared &amp; Reusable." width="680" />
</p>

Skills and Plugins can move from personal development to immutable releases,
administrative review, organizational publishing, installation, and explicit updates.

Knowledge Bases can be authorized to selected users and groups. MCP connections and
credentials remain separately managed, allowing AI capabilities to connect to
organizational systems without distributing underlying credentials to every user.

**Delegated execution, not credential sharing.**

### Applications — turn capabilities into experiences for others

Applications are where these capabilities come together.

An Application combines maintained instructions and model configuration with
organizational Knowledge, Skills, Plugins, and MCP connections, then makes that
experience available to authorized users and groups.

<p align="center">
  <img src="./docs/diagrams/application-composition.svg" alt="Instructions and Model configuration combine with Knowledge Bases, Skills, Plugins, and MCP Servers in an Application. Authorized Users / Groups start each user&#x27;s own Task." width="960" />
</p>

For example:

<p align="center">
  <img src="./docs/diagrams/finance-application.svg" alt="Finance Knowledge + Finance Skill + ERP Integration → Finance Application → Finance Team." width="900" />
</p>

Users don't need to reconstruct the underlying setup themselves. They open an authorized
Application and start their own Task with the maintained capabilities already composed
for that use case.

Applications are **not autonomous agents**. They are reusable AI work entry points. Each
authorized user starts and owns their own Task, while the Application provides the
maintained configuration and organizational capabilities behind the experience.

Applications can also provide controlled access to creator-maintained Knowledge and MCP
capabilities without giving users direct management access or exposing underlying
credentials through normal LinkSense interfaces.

LinkSense adds identity, ownership, user/group authorization, publishing and review,
credential management, model management, usage, audit, and runtime operations around
these capabilities.

Together, they form **the open capability layer between frontier AI and the organization.**

<p align="center">
  <img src="./docs/diagrams/open-capability-layer.svg" alt="Frontier AI, Models, and Codex feed LinkSense: Personal AI Workspace; organizational Knowledge Bases, Skills, MCP Servers, Plugins, and Applications; identity, sharing, governance, credentials, runtime, and operations. LinkSense connects People with Data and Systems." width="840" />
</p>

---

## Built on the Open-source Codex Runtime

LinkSense runs the open-source Codex runtime inside its own managed Workers. It does not
depend on the Codex web application or a LinkSense-hosted Codex service.

LinkSense directly runs the official `@openai/codex` package through:

```bash
codex app-server --stdio
```

and communicates with it through the Codex app-server JSON-RPC protocol.

The Codex runtime executes inside the LinkSense deployment. Model inference is configured
separately: organizations can connect the model providers or compatible private endpoints
they choose.

LinkSense does **not** fork Codex, patch its source, or reimplement the agent loop.

| Codex | LinkSense |
| --- | --- |
| Agent reasoning and Turns | Organizational workspace |
| Native tools and execution | Identity, sharing, and governance |
| Skills and Plugins | Publishing and organizational lifecycle |
| Models and sub-agents | Applications, Knowledge, and MCP management |
| Sandbox semantics | Workers, persistence, usage, and operations |

> **Codex decides how the agent executes. LinkSense decides what it can access, where it
> runs, how capabilities are shared and governed, and how execution is persisted and
> operated.**

The Codex runtime is licensed by OpenAI under Apache-2.0 and ships unmodified; its
`NOTICE` file travels with our images. See
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

*Codex is a trademark of OpenAI. LinkSense is an independent project and is not
affiliated with, sponsored by, or endorsed by OpenAI.*

---

## Open Source. Self-hosted. Under Your Control.

The organizational capability layer itself is open source. Applications, Skills and
Plugins, MCP management, Knowledge, identity and groups, governance, credentials, usage
and audit, Runner, Workers, and the Core and Full deployment profiles are part of the
open-source project.

Organizational features are not separated into a required closed enterprise runtime or
LinkSense-operated cloud control plane.

Run the complete platform on your own servers, private cloud, or VPC. Inspect the source,
modify the platform, choose your models and integrations, and operate the environment on
infrastructure you control. There is no required online runtime license activation
heartbeat.

With private models, local Knowledge, and local MCP services, prompts, files, Task state,
Knowledge indexes, credentials, audit records, and results can remain inside
infrastructure you control.

Configured external services may still make external network calls, so LinkSense describes
itself as **self-hosted and private-network friendly**, not formally air-gapped.

**Models:** OpenAI · Azure OpenAI · Anthropic · Google / Vertex · Alibaba · DeepSeek ·
OpenRouter · OpenAI-compatible endpoints

### What LinkSense asks in return

One thing: a small attribution notice — the words `Powered by` and our mark, 18–24px
tall. The bundled interface links it to our site, but the license does not require a URL.
No copyright line or visible URL is required. It lives in a single area
at the foot of the interface and stays there as people move around, so no screen needs
its own copy. [Here is exactly what it looks like](./ATTRIBUTION.md).

Where it is **not** required, written into the licence rather than left to interpretation:

| | |
|---|---|
| Dialogs, menus, tooltips | not repeated — the screen underneath already carries it |
| Full-screen editing, preview, presentation | may be hidden, as long as it returns on exit |
| **Documents, decks and images your people export** | **no watermark of any kind, ever** |
| Command-line, headless, API-only | no display obligation at all |

Deploying internally, at any scale, modified or not, creates **no obligation to publish
anything** — see the [Internal Deployment Exception](./LICENSE-EXCEPTIONS.md).

Your own branding is fine and needs no permission — product name, logo, colours, wording,
all yours to change. Your name at the top, ours in the footer. If you need the notice gone
entirely, that is a commercial arrangement: `licensing@linksense.org`.

---

## Architecture

<p align="center">
  <img src="./docs/diagrams/system-architecture.svg" alt="Browser → Gateway / Nginx → Web and API. API connects to PostgreSQL, Redis, MinIO, BullMQ, and the Full Knowledge Stack, and uses authenticated HTTP to control Runner. Runner uses Docker Engine to manage a per-user Worker with shared user workspaces and CODEX_HOME, official Codex app-server, model gateway, MCP, and Chromium / Playwright." width="960" />
</p>

### Worker model

LinkSense dynamically manages one Docker Worker per active user.

Multiple Tasks belonging to the same user may reuse that Worker and share the user's
`HOME` and `HOME/.codex` (`CODEX_HOME`). Tasks without a project share `workspace`;
Tasks in the same project share `projects/<projectId>`. Task control data is stored
separately for each Task.

**The isolation boundary is the user's Worker, rather than individual Task directories.**
Ordinary execution Tasks can access the same user's other project and Task files.

Inactive Workers are reclaimed. Per-user package environments can persist across
reclamation, while generated artifacts persist independently in object storage.

Worker controls include configurable CPU/memory/PID limits, read-only root filesystems,
`no-new-privileges`, dropped Linux capabilities, non-privileged containers, non-root Task
processes, and separate control and egress networks.

Workers do not directly join PostgreSQL or Redis service networks. Internet egress is
currently allowed; LinkSense does not enforce a universal domain allowlist or deny-all
egress policy.

Ordinary execution uses Codex's `approvalPolicy: never` and full-access sandbox policy,
without per-command approval. If prompt injection in a webpage, uploaded file or tool
response successfully induces command execution, it can lead to reading, modifying or
exfiltrating that user's shared files. Plan mode uses a read-only sandbox with network
access disabled; it does not change ordinary execution permissions.

The application does not block cloud metadata addresses by default. Cloud deployments
should restrict metadata access and outbound traffic through network or instance
configuration, and grant instance roles only the permissions they need. The controller
also holds the Docker socket and must be treated as a trusted management component;
Task Workers do not mount that socket. See [Execution boundaries](./SECURITY.md#execution-boundaries).

### Execution path

Real-time Tasks normally follow:

<p align="center">
  <img src="./docs/diagrams/realtime-execution-path.svg" alt="Normal real-time execution: User → API, which persists Task / PendingRequest → Runner → Per-user Worker → Codex." width="960" />
</p>

They do not normally enter BullMQ before execution.

BullMQ primarily handles Automations, scheduled/background jobs, worker maintenance,
recovery, email, billing, Knowledge synchronization and processing, and cleanup.

### Event delivery

<p align="center">
  <img src="./docs/diagrams/event-delivery.svg" alt="Codex → Worker → Runner mapping / redaction → Durable event outbox → API → PostgreSQL → Redis Pub/Sub → SSE → Browser." width="680" />
</p>

---

## Build with LinkSense

LinkSense provides three primary extension paths without requiring changes to LinkSense
source.

### Build a Skill

Teach AI reusable methods, workflows, domain practices, scripts, references, and
supporting resources using the native Codex Skill format.

<p align="center">
  <img src="./docs/diagrams/skill-directory-structure.svg" alt="my-skill/ contains SKILL.md, agents/openai.yaml, scripts/, references/, and assets/." width="600" />
</p>

Skills can be discovered natively by Codex or explicitly selected by users and Applications.

### Build an MCP-backed Plugin

Connect external systems and APIs through MCP, then package MCP declarations together with
Skills and supporting resources.

<p align="center">
  <img src="./docs/diagrams/plugin-package-structure.svg" alt="Plugin contains Skills, MCP declarations, scripts / resources, and .codex-plugin/plugin.json." width="339" />
</p>

For CRM, ERP, SaaS, monitoring systems, and internal APIs, MCP is generally the
recommended integration boundary.

Credentials remain separate from Plugin packages.

### Build an Interactive Application

Build purpose-specific interfaces and workflows on top of authorized LinkSense capabilities.

Interactive Applications are packaged with `manifest.json`, HTML, JavaScript, CSS, and
assets, and run inside sandboxed iframes.

Their SDK can request explicitly permitted capabilities such as user profile access,
capability discovery, Knowledge Base access, MCP Server discovery, and Task creation.

Interactive Applications are separate from normal Applications, which are primarily
configuration and capability-composition objects.

---

## Deployment reference

### Requirements

| Profile | CPU | Memory | Free SSD |
| --- | ---: | ---: | ---: |
| Core | 4+ vCPU | 8+ GiB | 60+ GiB |
| Full | 8+ vCPU | 10+ GiB | 120+ GiB |

- Linux: Ubuntu, Debian, Fedora, RHEL, Rocky Linux, AlmaLinux, or CentOS on x86_64 or ARM64
- macOS: Intel or Apple Silicon with Docker Desktop
- Release images support `linux/amd64` and `linux/arm64`
- Docker Engine API v1.45+
- Docker Compose v2.24.4+
- `curl`
- TCP port `18081` available by default

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

Linux requests `sudo` when needed. On macOS, add `$HOME/.local/bin` to `PATH` and run
commands without `sudo`.

### Repair and upgrade

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

Run the same commands without `sudo` on macOS.

Repair stays on the installed release. Upgrade detects Core/Full, waits for active work,
and stores a validated PostgreSQL backup under `volume://linksense-backups/postgres/`
before migration.

No data volume is deleted. A failure after migration begins does not trigger an automatic
database rollback; retain the printed backup location and rerun the upgrade after
reviewing diagnostics.

---

## Technology Stack

| Layer | Stack |
| --- | --- |
| Web | React 19 · TypeScript · Vite · React Router · TanStack Query · shadcn/ui · Base UI · Tailwind · i18next |
| API | Node.js · TypeScript · Fastify 5 · Zod · Prisma · PostgreSQL · Redis · BullMQ · MinIO |
| Runner | Node.js · TypeScript · Fastify · Docker · official Codex app-server · Chromium / Playwright |
| Knowledge | Docling · Elasticsearch · BM25 + vector retrieval · RRF · optional reranking |

Third-party components keep their own licenses; exact versions are recorded in
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

---

## Local Development

Requires Node.js 24+, pnpm 10.34.6, Docker Engine/Compose, and rsync.

Applications and dependencies run in Linux containers; host rsync only synchronizes source
files.

```bash
corepack enable
corepack prepare pnpm@10.34.6 --activate
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm dev
```

Default addresses:

- Web: `http://localhost:18172`
- Web HTTPS: `https://localhost:18173`
- API: `http://localhost:4000`
- Runner: `http://localhost:4010`

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

`pnpm dev:prepare` builds application images, the production Task Worker, and the bilingual
Help Center; checks infrastructure and database initialization; starts services; and warms
runtime caches.

`pnpm dev` prepares missing inputs automatically.

### AI development guide

Before using Codex or another AI coding tool, read [`AGENTS.md`](./AGENTS.md).

AI-generated features and behavior changes require tests like any other contribution. Run
affected tests, type checking, linting, and builds before committing.

Never commit secrets, personal data, internal requirement documents, or generated artifacts.

---

## Building from Source with Docker

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

For production, prefer verified release images pinned to immutable digests rather than
building source directly on the production host.

---

## Security

See [SECURITY.md](./SECURITY.md).

Security reports: `security@linksense.org`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md).

Contributions require a [Contributor License Agreement](./CLA.md) — CONTRIBUTING.md
explains exactly why, and what we committed to in return.

## Who is using LinkSense

If your organization runs LinkSense, we would like to know — add a row to
[ADOPTERS.md](./ADOPTERS.md). Listing is entirely optional, and we never add anyone who
did not ask. Would rather not be public? `hello@linksense.org`.

## Support

See [SUPPORT.md](./SUPPORT.md).

## License

LinkSense is open source under [CPAL-1.0](./LICENSE) — an
[OSI-approved](https://opensource.org/licenses) license (Mozilla Public License 1.1 plus a
small attribution notice and a network-use clause).

**Run it internally, at any scale, modified or not — with no obligation to publish
anything.** Our [Internal Deployment Exception](./LICENSE-EXCEPTIONS.md) puts that beyond
doubt. Proprietary plugins and extensions written in your own files stay yours; CPAL's
copyleft is per-file and does not reach your code.

**Two obligations, and they trigger differently** — this is the part people most often
get backwards:

| | Triggered by | Internal deployment |
|---|---|---|
| Publish your changes | redistributing, or serving third parties | **no** |
| Show the attribution | launching through a graphical interface | **yes** |

So an organization running LinkSense on its own network owes no source disclosure at all,
and keeps the one-line notice.
[Here is exactly what that looks like](./ATTRIBUTION.md).

**Trademarks are licensed separately.** Fork it, rename it, ship it, compete with us —
just don't call it LinkSense. See [TRADEMARK.md](./TRADEMARK.md).

**No rug-pulls.** Every version released under CPAL-1.0 stays under CPAL-1.0, permanently.
We will never retroactively tighten terms, and that promise is
[written down](./LICENSE-EXCEPTIONS.md).

**Deploy it under your own brand.** Rename it, restyle it, put your own logo in the
header — no permission needed. The one-line notice is what stays. Need that gone too, or
need different terms? `licensing@linksense.org`.

Third-party components retain their own licenses; see
[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
