# LinkSense

English | [简体中文](./README.zh-CN.md)

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

### Host requirements

- Linux: Ubuntu, Debian, Fedora, RHEL, Rocky Linux, AlmaLinux, or CentOS on x86_64 or ARM64; run through `sudo` or as `root`.
- macOS: Intel Mac or Apple Silicon with Docker Desktop; run from the signed-in macOS account without `sudo`.
- Release images support both `linux/amd64` and `linux/arm64`. Docker automatically selects the matching image.
- Install `curl`; start a local Linux Docker Engine with API v1.45+ and Docker Compose v2.24.4+.
- Keep TCP port `18081` free by default and allow access to GitHub, GHCR, upstream registries, and Full tokenizer files.
- Core requires at least 8 GiB memory, and Full requires at least 16 GiB memory.
- The installer does not enforce a free-disk-space or inode minimum. Use the recommended SSD capacity below and monitor available space because Docker will fail if storage is exhausted.

The installer validates the host and Docker platform before writing persistent state, then generates runtime secrets. On macOS, allocate enough memory and disk to Docker Desktop first. A domain and HTTPS are optional for local startup; public deployments should place an HTTPS reverse proxy in front of port `18081`.

Linux installation:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

To choose another unused TCP port during installation, pass `LINKSENSE_HTTP_PORT` to the installer process, not to `curl`:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh \
  | sudo env LINKSENSE_HTTP_PORT=19090 sh
```
macOS installation:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```
After installation, open `http://<server-address>:18081` on Linux or `http://localhost:18081` on macOS. When a custom port is selected, replace `18081` with that value. The terminal prints a one-time initialization credential for creating the first administrator. Linux stores deployment files under `/opt/linksense`; macOS uses `~/.linksense`.

Core excludes Elasticsearch, Docling, and the tokenizer. Full adds complete document processing and knowledge-base retrieval.

Repair or upgrade to the latest release on Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

Run the same commands without `sudo` on macOS. Repair scripts stay on the installed release. The upgrade script detects Core/Full, waits for active work, and stores a validated PostgreSQL backup under `volume://linksense-backups/postgres/` before migration. No data volume is deleted. A failure after migration begins does not trigger an automatic database rollback; retain the printed backup location and rerun the upgrade after reviewing diagnostics.

## Command-line management

After installation, run `linksense` to open the interactive control menu, or use direct commands:

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
linksense upgrade v0.3.0
```

Linux requests `sudo` when needed. On macOS, add `$HOME/.local/bin` to `PATH` and run the command without `sudo`. Port changes validate availability, recreate only affected services, and automatically restore the previous configuration after a failed health check. The credential command displays the one-time credential only before the first administrator is created.

## Recommended configuration

| Edition | Recommended CPU | Recommended memory | Recommended free SSD space | Best for |
| --- | ---: | ---: | ---: | --- |
| Core | 4+ vCPU | 8+ GiB | 60+ GiB | AI tasks, models, and extensions |
| Full | 8+ vCPU | 16+ GiB | 120+ GiB | Document processing and knowledge retrieval |

Increase CPU, memory, and storage for high task concurrency, large documents, or long-term file retention. On macOS, configure these resources under Docker Desktop settings; host free space alone does not guarantee an adequate Docker disk allocation.

## Local development

You need Node.js 24.5+, pnpm 10.6.4, Docker Engine/Compose, rsync (included with macOS; install your distribution's rsync package on Linux), and [mkcert](https://github.com/FiloSottile/mkcert) on the host (macOS: `brew install mkcert`). Applications and dependencies run in Linux containers; host rsync only synchronizes source files. Complete the system trust prompt when running `mkcert -install` for the first time.

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
mkcert -install
pnpm dev:prepare
pnpm dev
```

Preparation builds application images, the production task worker, and the bilingual Help Center using the production build stage, checks infrastructure and database initialization, then starts services and warms runtime caches until ready. `pnpm dev` also prepares missing inputs automatically. For lighter local development without Docker, Core mode needs only host-reachable PostgreSQL and Redis, development-only local file storage, and non-isolated child-process workers. Copy the minimal environment template and follow the [`dev:host` startup guide](./deploy/development/README.md#host-development-without-local-docker). Daily container startup targets 10 seconds after preparation. Default addresses:

- Web HTTP: `http://localhost:18172`
- Web HTTPS (HTTP/2): `https://localhost:18173`
- API: `http://localhost:4000`
- Runner: `http://localhost:4010`

HTTP and HTTPS are available simultaneously without redirects. Both support API requests, SSE, and hot reload; use HTTPS to test concurrent SSE tasks over HTTP/2. Configure the HTTP origin and port with `LINKSENSE_DEV_WEB_ORIGIN` and `LINKSENSE_DEV_WEB_PORT`, and the HTTPS port with `LINKSENSE_DEV_WEB_HTTPS_PORT` in `.env`. Development certificates are generated automatically and excluded from Git.

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

`pnpm test` builds shared contracts, then runs service, shared, documentation, and deployment tests in parallel. The complete frontend unit and browser E2E suites run together afterwards to bound resource contention. E2E always builds the current frontend and serves the build with Vite preview. To inspect individual durations, use `pnpm --filter @linksense/web test:unit --reporter=verbose`; measure the entire command with `/usr/bin/time -p pnpm test`.

Frontend tests reuse environments only for explicitly approved files. New component tests remain isolated; tests that mock modules must stay isolated. Shared fixtures reset DOM, timers, globals, storage, and session state. Materializer rule tests simulate disk flushes, while a separate durability test retains real filesystem flushes.

### AI development guide

Before using Codex or another AI coding tool, read and follow [`AGENTS.md`](./AGENTS.md). We use this guide to document the project structure, technology choices, testing requirements, security practices, database migration rules, and collaboration conventions.

AI-generated features and behavior changes require tests like any other contribution. Run the affected tests, type checking, linting, and builds before committing. Never commit secrets, personal data, internal requirement documents, or generated artifacts.

## Building from source with Docker

Build native images for the current Docker platform with Compose:

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

Build and publish a multi-platform target with Buildx:

```bash
docker buildx build --platform linux/amd64,linux/arm64 --target runtime \
  -f Dockerfile.api -t <registry>/linksense-api:<tag> --push .
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
- Security reports: `developer@linksense.org`

## Contributors

Thank you to everyone who contributes to LinkSense!

<!-- contributors:start -->
<p>
  <a href="https://github.com/Metrolive"><img src="https://avatars.githubusercontent.com/u/44701445?s=128" width="64" height="64" alt="Metrolive" title="Metrolive" /></a>
  <a href="https://github.com/guygubaby"><img src="https://avatars.githubusercontent.com/u/21158055?s=128" width="64" height="64" alt="guygubaby" title="guygubaby" /></a>
</p>
<!-- contributors:end -->
