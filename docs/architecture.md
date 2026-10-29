# Architecture and Runtime

[Back to README](../README.md)

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
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

*Codex is a trademark of OpenAI. LinkSense is an independent project and is not
affiliated with, sponsored by, or endorsed by OpenAI.*

---

## Architecture

<p align="center">
  <img src="../docs/diagrams/system-architecture.svg" alt="Browser → Gateway / Nginx → Web and API. API connects to PostgreSQL, Redis, MinIO, BullMQ, and the Full Knowledge Stack, and uses authenticated HTTP to control Runner. Runner uses Docker Engine to manage a per-user Worker with shared user workspaces and CODEX_HOME, official Codex app-server, model gateway, MCP, and Chromium / Playwright." width="960" />
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
Task Workers do not mount that socket. See [Execution boundaries](../SECURITY.md#execution-boundaries).

### Execution path

Real-time Tasks normally follow:

<p align="center">
  <img src="../docs/diagrams/realtime-execution-path.svg" alt="Normal real-time execution: User → API, which persists Task / PendingRequest → Runner → Per-user Worker → Codex." width="960" />
</p>

They do not normally enter BullMQ before execution.

BullMQ primarily handles Automations, scheduled/background jobs, worker maintenance,
recovery, email, billing, Knowledge synchronization and processing, and cleanup.

### Event delivery

<p align="center">
  <img src="../docs/diagrams/event-delivery.svg" alt="Codex → Worker → Runner mapping / redaction → Durable event outbox → API → PostgreSQL → Redis Pub/Sub → SSE → Browser." width="680" />
</p>

---

## Technology Stack

| Layer | Stack |
| --- | --- |
| Web | React 19 · TypeScript · Vite · React Router · TanStack Query · shadcn/ui · Base UI · Tailwind · i18next |
| API | Node.js · TypeScript · Fastify 5 · Zod · Prisma · PostgreSQL · Redis · BullMQ · MinIO |
| Runner | Node.js · TypeScript · Fastify · Docker · official Codex app-server · Chromium / Playwright |
| Knowledge | Docling · Elasticsearch · BM25 + vector retrieval · RRF · optional reranking |
