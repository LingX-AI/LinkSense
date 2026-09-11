# Development startup and environment consistency

The default `pnpm dev` applications continue to run in Linux containers. Development, API, Runner and Web builds pin the same Node base-image digest, and Prisma Client is generated inside Linux. PostgreSQL and Redis use the base Compose configuration, while task workers use the production Dockerfile. Development retains source hot reload; production runs compiled artifacts. Before release, run `pnpm build` and validate production images with `pnpm dev:prod`.

## Host development without local Docker

`pnpm dev:host` runs Web, API, Help Center, the Runner controller, and per-user
task workers as host Node.js processes. It does not invoke Docker. Use this mode
for trusted local development when Docker Desktop or a local Docker Engine would
be too heavy. It is not a production deployment mode.

### Requirements

- Node.js 24+ and the pnpm version declared in the root `package.json`.
- Python 3.12+ with the standard-library `venv` module available. Host task
  workers create a per-user virtual environment with `python3 -m venv`; the
  launcher does not install Python or system packages.
- A Codex CLI compatible with `CODEX_VERSION` in `.env.example`, available as
  `codex` on `PATH` or configured with `CODEX_BIN`.
- A running PostgreSQL database and Redis instance reachable from the host.
  PostgreSQL credentials must be allowed to run the committed Prisma migrations,
  and the target database must already exist.
- Repository dependencies installed with `pnpm install --frozen-lockfile`.

LinkSense does not install or manage PostgreSQL, Redis, Codex, or any optional
remote service in host mode.

### Minimal Core configuration

Core mode disables knowledge-base processing, so Elasticsearch and Docling are
not required. The development-only local filesystem storage adapter removes the
MinIO requirement. Start from the tracked minimal template:

```bash
cp deploy/development/env.host.example .env.host
```

Edit only these values when necessary:

- `DATABASE_URL`: a host-reachable PostgreSQL URL. URL-encode credentials.
- `REDIS_URL`: a host-reachable Redis URL; `redis://` and `rediss://` are
  supported by the client.
- The five distinct `LINKSENSE_*_SECRET` or key values. The template values are
  safe only for a private local machine.
- `LINKSENSE_DEV_WEB_ORIGIN` and `LINKSENSE_DEV_WEB_PORT` together if port 5273
  is unavailable. API 4000 and Runner 4010 have corresponding
  `LINKSENSE_DEV_*` overrides; the Help Center currently uses port 3001.

Do not add MinIO, Elasticsearch, or Docling variables for the minimal setup.
Local objects are persisted under
`LINKSENSE_USER_DATA_ROOT/.object-storage`; the default root is
`.data/users` inside the repository.

### Start and stop

```bash
corepack enable
corepack prepare pnpm@10.6.4 --activate
pnpm install --frozen-lockfile
pnpm dev:host
```

On every start, the launcher reads `.env.host`, validates host-reachable
dependencies and free loopback ports, generates Prisma Client, runs
`prisma migrate deploy` and the idempotent seed, then starts all four
applications. Readiness is reported only after Runner, API, Web, and the
proxied bilingual Help Center respond.

Press `Ctrl+C` to stop the active session and its child processes. Use
`pnpm dev:host:cleanup` only when the terminal was lost, the parent process
exited unexpectedly, or a registered child still holds a development port.

Default endpoints:

- Web: `http://localhost:5273`
- API: `http://localhost:4000`
- Runner: `http://localhost:4010`
- Help Center: `http://localhost:5273/help/`

### Optional remote services and Full edition

Host mode may use remote PostgreSQL, Redis, and S3-compatible MinIO endpoints.
Set `LINKSENSE_OBJECT_STORAGE_PROVIDER=minio` and provide all documented
`MINIO_*` values when remote object storage is desired. Full edition also
requires host-reachable Elasticsearch and Docling configuration; it is not part
of the minimal setup. Container-only names such as `postgres`, `redis`, `minio`,
`api`, `runner`, and `host.docker.internal` are rejected instead of silently
changing providers.

### Isolation and production invariants

The `local-process` Worker Provider uses child processes and the same Worker
contract as Docker, but provides no container, cgroup, filesystem, or network
isolation. Run only trusted tasks and plugins. The launcher forces loopback
listeners and development mode. Runner configuration rejects `local-process`
outside development or on a non-loopback controller, and API configuration
rejects local filesystem object storage in production or Full edition.

The normal `pnpm dev`, production Compose files, and release installation remain
Docker-based. Their Runner configuration defaults to the `docker` provider and
continues to create the existing per-user worker containers. `.env.host` is
ignored by Git and is read only by `pnpm dev:host`; Docker workflows continue to
use `.env` or their explicit Compose environment file.

## Container development and production parity

Run `pnpm dev:prepare` once to build images, prepare infrastructure and the database, synchronize source, and start every application until ready, warming runtime caches. Services remain running when preparation finishes; `pnpm dev` then attaches logs and source watching. Running `pnpm dev` directly also performs any missing preparation.

After preparation, daily startup targets readiness within 10 seconds when build inputs and database state are unchanged. Startup checks images and effective build arguments, queries the actual migration history, and starts applications in parallel. Pending migrations run Prisma's native deployment command. Historical checksum differences retain a visible warning and Prisma validation; successful validation is cached against the database target, live migration rows, local migration files and migration-image fingerprint. Any change triggers validation again. Migration history is never rewritten, and the cache never replaces querying the database. Initial setup, dependency/documentation/worker input changes, missing images or caches, and starting Docker Engine itself are outside this target.

Source reconciliation applies edits and deletions made while development was stopped, preserving image-installed dependencies and the generated Prisma Client; Compose Watch handles subsequent edits. The independent Help Center uses the same bilingual static build and routing rules as production. Documentation changes rebuild its image without restarting Web. `LINKSENSE_DEV_READY` is emitted only after source reconciliation, Watch startup, and successful Runner/API/Web/bilingual Help Center checks. Web checks include actual compiled entry-module, application-module and stylesheet responses. The marker includes total and per-stage timings.

API module loading overlaps Office converter warmup. Historical knowledge-index reconciliation runs as tracked background work, retaining distributed locks, periodic scans and shutdown draining. These behaviors are shared by development and production. Readiness checks actual required dependencies and Runner execution capability; SMTP, model diagnostics and Docker resource sampling remain available through full health diagnostics. Resource sampling does not gate readiness. Readiness checks do not replace business acceptance tests such as real model calls.

The development Web address defaults to `http://localhost:18173`. Browser API requests use the same origin through Vite's `/api` proxy; development sets `VITE_API_BASE_URL` to an empty string because cookie authentication rejects cross-origin session refreshes. Readiness also checks bootstrap and a cookie-free session refresh through this proxy, expecting `AUTH_SESSION_EXPIRED` rather than a cross-origin rejection. Published Web/API ports take precedence over ports in their configured development origins. Production deployment settings are unaffected.

Use `pnpm dev:stop` for daily shutdown: it stops services and dynamic workers while retaining containers, caches, and persistent data. `pnpm dev:down` removes development containers and networks but retains persistent data. Ctrl+C only detaches the current Watch/log session; services remain running.

Run `pnpm dev:benchmark --runs=5 --mode=restart` to prepare the environment and measure five stop/start cycles. Use `--mode=reattach` for reconnecting or `--mode=recreate` for starting after container removal. Timing starts when invoking `pnpm dev` and includes command overhead. Any sample exceeding the default 10000 ms budget fails the command. Reports are saved to `.data/dev/startup-benchmark-<mode>.json`. Benchmarking operates on development services; run it when no tasks are executing.

Local acceptance on 2026-09-06 (Docker Desktop, Linux ARM64, 8 CPUs, about 7.65 GiB Docker memory): five stop/start cycles had a median of 8781 ms and maximum of 9400 ms; five reattachments had a median of 2055 ms and maximum of 2123 ms. All passed the 10000 ms budget, including every readiness check above. Measure other machines with the same command.
