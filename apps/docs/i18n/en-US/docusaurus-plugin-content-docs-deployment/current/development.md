---
title: Source development and image builds
description: Start the Docker development environment, find the source entry points, and build images.
---

# Source development and image builds

## Start the development environment

Prepare Node.js 24+, pnpm 10.34.6, Docker Engine / Compose, `rsync`, and `mkcert`. Run from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm dev
```

`pnpm dev:prepare` starts services, builds images and the help center, and initializes the development database while preserving existing configuration. The first run may ask to trust the local `mkcert` CA. `pnpm dev` attaches watchers and logs; `pnpm dev:stop` stops the development stack.

Default addresses: Web `http://localhost:18172` / `https://localhost:18173`, API `http://localhost:4000`, Runner `http://localhost:4010`. Use the actual addresses reported by the launcher.

## Source entry points

- [Web workspace and administration](https://github.com/LingX-AI/linksense/tree/main/apps/web)
- [API, permissions, and business logic](https://github.com/LingX-AI/linksense/tree/main/apps/api)
- [Runner and task Workers](https://github.com/LingX-AI/linksense/tree/main/apps/runner)

See the [architecture](./architecture.md), [repository development guide](https://github.com/LingX-AI/linksense/blob/main/deploy/development/README.md), and [contribution guide](https://github.com/LingX-AI/linksense/blob/main/.github/CONTRIBUTING.md). Run affected tests, type checks, lint, and builds before submitting changes.

## Build Docker images from source

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

The API Dockerfile provides `runtime` and `migration` targets; the Runner provides `controller` and `worker`. For multi-architecture images, use `docker buildx build --platform linux/amd64,linux/arm64` with the appropriate Dockerfile and target. Prefer digest-pinned [published images](./overview.md) for normal production installations. The maintainers' [Git production runbook](https://github.com/LingX-AI/linksense/blob/main/deploy/production/README.md) covers a separate source-build workflow.
