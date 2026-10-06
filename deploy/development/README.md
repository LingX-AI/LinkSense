# Development startup and environment consistency

The default `pnpm dev` applications continue to run in Linux containers. Development, API, Runner and Web builds pin the same Node base-image digest, and Prisma Client is generated inside Linux. PostgreSQL and Redis use the base Compose configuration, while task workers use the production Dockerfile. Development retains source hot reload; production runs compiled artifacts. Before release, run `pnpm build` and validate production images with `pnpm dev:prod`.

## Host development without local Docker

`pnpm dev:host` runs Web, API, Help Center, the Runner controller, and per-user
task workers as host Node.js processes. It does not invoke Docker. Use this mode
for trusted local development when Docker Desktop or a local Docker Engine would
be too heavy. It is not a production deployment mode.

The controller provisions a host-only `linksense-plugin-stdio` launcher under
`LINKSENSE_USER_DATA_ROOT` so credential-bound STDIO plugins use the same
credential projection as Docker workers. The launcher points to the current
checkout and Node.js runtime; it does not install a global command.

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
corepack prepare pnpm@10.34.6 --activate
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

Host mode also disables the built-in `linksense-browser` Skill, managed browser
MCP server, and browser-specific prompt context because the bundled Chromium
runtime is available only in Docker Workers. Use `pnpm dev` for tasks that need
the managed browser.

The normal `pnpm dev`, production Compose files, and release installation remain
Docker-based. Their Runner configuration defaults to the `docker` provider and
continues to create the existing per-user worker containers. `.env.host` is
ignored by Git and is read only by `pnpm dev:host`; Docker workflows continue to
use `.env` or their explicit Compose environment file.

## Container development and production parity

Run `pnpm dev:prepare` once to build images, prepare infrastructure and the database, synchronize source, and start every application until ready, warming runtime caches. Services remain running when preparation finishes; `pnpm dev` then attaches logs and source watching. Running `pnpm dev` directly also performs any missing preparation.

After preparation, daily startup targets readiness within 10 seconds when build inputs and database state are unchanged. Startup checks images and effective build arguments, queries the actual migration history, and starts applications in parallel. Pending migrations run Prisma's native deployment command. Historical checksum differences retain a visible warning and Prisma validation; successful validation is cached against the database target, live migration rows, local migration files and migration-image fingerprint. Any change triggers validation again. Migration history is never rewritten, and the cache never replaces querying the database. Initial setup, dependency/documentation/worker input changes, missing images or caches, and starting Docker Engine itself are outside this target.

Source reconciliation applies edits and deletions made while development was stopped, preserving image-installed dependencies and the generated Prisma Client. Chokidar watches subsequent edits using the `develop.watch` rules from the resolved Compose configuration, and rsync mirrors source edits and deletions. The independent Help Center uses the same bilingual static build and routing rules as production. Documentation changes rebuild its image without restarting Web. `LINKSENSE_DEV_READY` is emitted only after source reconciliation, Watch startup, and successful Runner/API/Web/bilingual Help Center checks. Web checks include actual compiled entry-module, application-module and stylesheet responses. The marker includes total and per-stage timings.

The development launcher owns prerequisite preparation and readiness, including after source synchronization. The development override clears application `depends_on` entries; production retains its dependency graph. Startup and Watch use the same image groups and recalculate fingerprints from current inputs before each rebuild. API, Runner and Web share one dependency build group; docs, migration and task-worker images have separate groups. Changed groups build sequentially, followed by `up -d --no-build --no-deps <affected services>`; unchanged images are reused. Source reconciliation after the build preserves edits made while the image was building. Changes are batched and applied serially; a failed build leaves the existing containers running and reports the failed update. Watching continues so a subsequent correcting edit can be applied, including edits queued during the failed build. There are no automatic rebuild retries without another edit. Use `pnpm dev` for this flow, rather than invoking Compose Watch directly.

Successful startup and Watch rebuilds apply project-scoped image retention. Development builds carry ownership labels derived from the checkout and environment-file paths. Cleanup removes only untagged images with that exact owner and a recognized role, keeping the newest unused previous image per role. Current tags and images referenced by any running or stopped container are always protected. Missing inventory skips cleanup; deletion never uses `--force`. Existing unlabelled images, volumes and global Docker cache settings are untouched. This bounds removable image history, not total Docker disk usage: BuildKit cache, saved tags and container references can still retain layers. See [development storage policy](../../docs/development/docker-development-storage.md) for scope and checks.

Clearing dependencies alone does not prevent the Compose 5.2.0 Watch failure: its rebuild step reconciles other selected services whose configurations or images differ, but starts only the rebuilt services, potentially leaving Runner in `Created`. The scoped commands above restrict both recreation and startup. Run `pnpm exec node scripts/dev-watch-smoke.mjs` to verify three real docs rebuilds in an isolated Docker project while the Runner configuration differs. API, Runner and Web must retain their running container IDs. `--native-watch` reproduces the failing native path on Compose 5.2.0. The check uses `alpine:3.22`, needs Docker, and removes only its own temporary containers, network, and images.

API and Runner run `node --import tsx src/index.ts` as Docker init's direct child. There is no in-container watch parent: an OOM or SIGKILL now exits the container and activates Docker's `unless-stopped` restart policy. Host Chokidar owns hot reload, synchronizes a complete source batch, then restarts the affected services once. Shared source changes restart API, Runner and Web. Host-only `pnpm dev:host` retains its existing watch behavior. Reattaching still checks liveness and reconciles offline edits.

Every hot-update batch, including documentation rebuilds and unchanged-content events, waits up to 60 seconds for Runner/API/Web, both Help Center languages, compiled Web modules, bootstrap and session restoration checks before printing `[dev] update complete`. Failures report the unavailable endpoint and leave the batch failed while watching for a correcting edit. Health checks alone do not restart a living but stalled process; development API/Runner checks run every five seconds and report unhealthy after three failures.

Development Node old-space budgets are 768 MiB for API/Web, 512 MiB for Runner and 1024 MiB for documentation builds. Documentation uses Docusaurus's existing `TERSER_PARALLEL=false` setting to avoid a CPU-count-sized JavaScript minifier pool, and watch rebuilds are serialized across services. These are JavaScript heap budgets, not total container memory limits; native allocations, Office, database, external services, workers and Docker builds also consume memory. Production build defaults are unchanged. If Docker records an OOM, inspect the VM's available memory and workload as well as container restart counts; an application should recover instead of remaining hidden behind a surviving watcher.

Run `pnpm exec node scripts/dev-lifecycle-smoke.mjs <development-image>` after building the development image (for example `linksense-api-dev:local`). This isolated test confines each OOM to a 192 MiB container with swap disabled. It reproduces the old `tsx watch` failure and verifies real OOM and SIGKILL recovery for both configured API/Runner commands. It checks Docker OOM events, restart counts and live HTTP responses, then removes only its own temporary containers/files.

Before starting the applications, the launcher verifies the configured object storage using the API's own configuration and adapter in an ephemeral API container. This checks container network access, credentials and the existing bucket, with a ten-second bound. A refused connection, unavailable bucket or invalid credentials stops startup with a specific error instead of leaving Vite to repeatedly proxy to an API that has exited. MinIO remains an independently operated prerequisite: start its existing deployment before `pnpm dev`; stopping all Docker containers also stops MinIO. This check does not create buckets or change the storage provider. API startup errors include the failed stage and a safe reason code without printing credentials or connection strings.

If Vite repeatedly reports `ECONNREFUSED` and API logs show `RUNNER_UNAVAILABLE`, inspect Runner state before changing proxy settings. Restart the development session with `pnpm dev` to load the current Compose configuration and recover unhealthy applications. Persistent data is retained. A `javaldx` warning from LibreOffice alone does not explain an unavailable Runner.

API module loading overlaps Office converter warmup. Historical knowledge-index reconciliation runs as tracked background work, retaining distributed locks, periodic scans and shutdown draining. These behaviors are shared by development and production. Readiness checks actual required dependencies and Runner execution capability; SMTP, model diagnostics and Docker resource sampling remain available through full health diagnostics. Resource sampling does not gate readiness. Readiness checks do not replace business acceptance tests such as real model calls.

Docker development serves both `http://localhost:18172` and `https://localhost:18173` at the same time, without redirecting HTTP to HTTPS. Set `LINKSENSE_DEV_WEB_ORIGIN=http://localhost:18172`, `LINKSENSE_DEV_WEB_PORT=18172`, and `LINKSENSE_DEV_WEB_HTTPS_PORT=18173` in `.env`. Both entries use the configured Web hostname and bind address. Choose HTTPS when testing concurrent SSE tasks: the browser negotiates HTTP/2 at that entry.

Use Node.js 24.5+ and install [mkcert](https://github.com/FiloSottile/mkcert) on the host (on macOS: `brew install mkcert`). Before the first launch, run `mkcert -install` in your terminal and complete the system trust prompt. Then run `pnpm dev`. Startup verifies CA installation and generates a certificate for localhost, loopback addresses, and the configured Web hostname/bind address. It renews the certificate when fewer than 30 days remain or the hosts/issuer/key change. Generated files live in the Git-ignored `.data/dev/tls`; the directory is owner-only (0700), and the leaf key is owner-readable/writable (0600). The directory containing the leaf files and public CA is mounted read-only into the development gateway. The CA signing key stays in mkcert's host directory.

The `dev-gateway` service reuses Nginx 1.28 and terminates HTTPS/HTTP2, forwarding requests to the same Vite HTTP server. [SSE buffering is disabled](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering), and [WebSocket upgrades](https://nginx.org/en/docs/http/websocket.html) carry HMR over WSS. Docker DNS resolution tracks Web container replacements. Gateway configuration edits restart only the gateway. Startup recreates the gateway when its configuration or certificate changes; ordinary reattachment preserves existing streams.

Both browser entries use relative `/api`, `/web`, and `/help` requests through Vite. The canonical development URL remains the HTTP origin, including generated external sign-in redirects. HTTP and HTTPS have separate browser origins, so switching may require signing in again. The authentication routes validate each actual request origin and set Secure cookies for HTTPS. Production deployment and the separate HTTP-only `pnpm dev:host` workflow are unaffected.

Startup and post-update readiness check both entries, bootstrap and cookie-free session restoration on each (expecting `AUTH_SESSION_EXPIRED`), and actual HTTP/2 negotiation. The launcher adds only the local CA to its existing Node trust roots; certificate verification remains enabled. Run `pnpm exec node scripts/dev-http2-smoke.mjs` after building `linksense-api-dev:local` to verify the committed Nginx configuration with eight persistent SSE streams on one HTTP/2 session, concurrent HTTP/HTTPS requests, and WSS messages. This isolated transport check uses a temporary CA without installing it and removes its own containers, network and files. It does not start application tasks or touch the database.

Use `pnpm dev:stop` for daily shutdown: it stops services and dynamic workers while retaining containers, caches, and persistent data. `pnpm dev:down` removes development containers and networks but retains persistent data. Ctrl+C only detaches the current Watch/log session; services remain running.

Run `pnpm dev:benchmark --runs=5 --mode=restart` to prepare the environment and measure five stop/start cycles. Use `--mode=reattach` for reconnecting or `--mode=recreate` for starting after container removal. Timing starts when invoking `pnpm dev` and includes command overhead. Any sample exceeding the default 10000 ms budget fails the command. Reports are saved to `.data/dev/startup-benchmark-<mode>.json`. Benchmarking operates on development services; run it when no tasks are executing.

Local acceptance on 2026-09-06 (Docker Desktop, Linux ARM64, 8 CPUs, about 7.65 GiB Docker memory): five stop/start cycles had a median of 8781 ms and maximum of 9400 ms; five reattachments had a median of 2055 ms and maximum of 2123 ms. All passed the 10000 ms budget, including every readiness check above. Measure other machines with the same command.
