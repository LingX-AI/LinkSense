# LinkSense

English | [简体中文](./README.md)

LinkSense is the self-hosted AI agent platform we built for organizations. We bring AI tasks, model providers, knowledge bases, Skills, Plugins, and MCP into one web workspace while isolated task workers protect runtime environments and user data.

We provide a lightweight Core edition and a Full edition with complete knowledge-base capabilities. You can deploy our prebuilt images or build and develop LinkSense from source.

## Features

- **AI task workspace**: Create, run, and resume long-running tasks while following progress and managing artifacts.
- **Centralized model management**: Configure multiple model providers, models, and reasoning levels in one place.
- **Extensible capabilities**: Use Skills, Plugins, and personal MCP servers.
- **Knowledge bases**: Our Full edition integrates Docling, Elasticsearch, and hybrid retrieval.
- **Isolated execution**: Dynamically provision per-user workers with isolated workspaces, credentials, and persistent runtimes.
- **Organization governance**: Manage users, permissions, usage, audits, and system health.

## One-line installation

Install Core:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh
```

Install Full:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

After installation, open `http://<server-address>:10080`. The terminal prints a one-time initialization credential for creating the first administrator.

Core excludes Elasticsearch, Docling, and the tokenizer. Full adds complete document processing and knowledge-base retrieval. Our installer validates the host and generates runtime secrets, but does not install or upgrade Docker for you.

Repair an existing installation:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
```

Our repair scripts use the installed version without performing implicit upgrades, downgrades, or data-volume deletion.

## Recommended configuration

Our initial release supports `linux/amd64`, Docker Engine API v1.45+, and Docker Compose v2.24.4+.

| Edition | Recommended CPU | Memory | Free SSD space | Installer disk minimum | Best for |
| --- | ---: | ---: | ---: | ---: | --- |
| Core | 4+ vCPU | 8+ GiB | 60+ GiB | 40 GiB | AI tasks, models, and extensions |
| Full | 8+ vCPU | 16+ GiB | 120+ GiB | 80 GiB | Document processing and knowledge retrieval |

Increase CPU, memory, and storage for high task concurrency, large documents, or long-term file retention. Put a reverse proxy with HTTPS in front of LinkSense for public deployments. Plain HTTP is supported on localhost or trusted private networks.

## Local development

You need Node.js 24+, pnpm 10.6.4, and a working Docker Engine/Compose installation.

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
pnpm dev
```

The first run creates development configuration and prepares PostgreSQL, Redis, migrations, Web, API, Runner, and task workers. Default addresses:

- Web: `http://localhost:5173`
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

### AI development guide

Before using Codex or another AI coding tool, read and follow [`AGENTS.md`](./AGENTS.md). We use this guide to document the project structure, technology choices, testing requirements, security practices, database migration rules, and collaboration conventions.

AI-generated features and behavior changes require tests like any other contribution. Run the affected tests, type checking, linting, and builds before committing. Never commit secrets, personal data, internal requirement documents, or generated artifacts.

## Building from source with Docker

Build all LinkSense images with Compose:

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

Main build targets:

| File | Target | Output |
| --- | --- | --- |
| `Dockerfile.api` | `runtime` / `migration` | API / database migration image |
| `Dockerfile.web` | `runtime` | Web and Help Center image |
| `Dockerfile.runner` | `controller` / `worker` | Runner controller / task worker image |

Build and run a production-like stack locally:

```bash
pnpm dev:prod
pnpm dev:prod:stop
```

For production deployments, prefer verified release images pinned to immutable digests instead of building source directly on the production host.

## License

We release LinkSense under [CPAL-1.0](./LICENSE), including our completed Attribution Information and additional permissions. Read the complete license before using, modifying, or making LinkSense available over a network.

- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security policy: [SECURITY.md](./SECURITY.md)
- Support: [SUPPORT.md](./SUPPORT.md)
- Security reports: `developer@infocare.org.cn`
