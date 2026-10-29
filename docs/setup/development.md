# Source Development and Image Builds

[Back to README](../../README.md)

For source development, start with 8 vCPU, 24 GiB memory, and 120 GiB free SSD; 16 vCPU, 32 GiB, and 200 GiB free SSD are recommended. These are planning suggestions; size for actual build and concurrency workloads.

## Local Development

Requires Node.js 24+, pnpm 10.34.6, Docker Engine/Compose, rsync, and
[mkcert](https://github.com/FiloSottile/mkcert) for the local HTTPS certificate.
The first launch may request system trust for mkcert's local certificate authority.

Applications and dependencies run in Linux containers; host rsync only synchronizes source
files. Development defaults must not be used for public production deployments.

The API and development images include FFmpeg for voice transcription. Recordings
are normalized to 16 kHz mono PCM WAV before being sent to the configured service;
OpenAI-compatible services receive `response_format=json` without timestamps.
Host-based API development requires `ffmpeg` on `PATH`. After upgrading, deploy the
new API image; existing model settings and gateway credentials remain usable.
Run `pnpm --filter @linksense/api test:voice:audio` for native audio-format checks.

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

`pnpm dev` prepares missing inputs automatically and attaches source watching and logs.

### AI development guide

Before using Codex or another AI coding tool, read [`AGENTS.md`](../../AGENTS.md).

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
