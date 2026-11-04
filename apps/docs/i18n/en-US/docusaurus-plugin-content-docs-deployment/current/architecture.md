---
title: Architecture and execution boundaries
description: Understand the application, API, Runner, per-user Workers, and Knowledge services.
---

# Architecture and execution boundaries

## Task execution path

The Web workspace submits tasks to the API. The API manages identity, permissions, usage, and task state, then schedules work through a queue. The Runner starts and reuses Docker Workers per user and runs the upstream open-source Codex `app-server` in those Workers. Events stream back to the workspace through the API.

| Layer | Components |
| --- | --- |
| Workspace | React, TypeScript, Vite, TanStack Query |
| Services and storage | Node.js, Fastify, PostgreSQL, Redis, MinIO |
| Execution | Per-user Docker Workers, Codex `app-server` |
| Full Knowledge | Docling document parsing, Elasticsearch indexing and retrieval |

[System diagram](https://github.com/LingX-AI/linksense/blob/main/docs/diagrams/system-architecture.svg) · [Execution path](https://github.com/LingX-AI/linksense/blob/main/docs/diagrams/realtime-execution-path.svg) · [Event delivery](https://github.com/LingX-AI/linksense/blob/main/docs/diagrams/event-delivery.svg)

## Execution boundaries

The isolation boundary is the **per-user Worker**. Tasks owned by the same user can share `HOME`, `CODEX_HOME`, and project files. Normal tasks allow outbound internet access without per-command approval. Plan mode uses a read-only sandbox with network access disabled. External models and tools receive applicable data according to your configuration.

Treat the Runner controller as trusted because it can access the Docker daemon. Task Workers do not mount the Docker socket. Read the repository's [security policy](https://github.com/LingX-AI/linksense/blob/main/.github/SECURITY.md#execution-boundaries) before configuring HTTPS, model access, and resource limits.

## Connect organizational resources

Administrators can grant access to knowledge, skills, plugins, and applications by user and group. Authorized connectors can access documents and email, and MCP can integrate other business systems where needed. Check protocol and tool compatibility when selecting a model; reachability or a model list alone is not enough.
