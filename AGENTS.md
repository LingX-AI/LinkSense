# AGENTS.md

This file guides Codex when performing coding, refactoring, testing, and development collaboration in this project. It defines only the technology stack, engineering practices, code quality standards, and delivery requirements; it does not contain specific business requirements.

## Scope and Priority

- Before starting work, read the code, configuration, tests, and relevant technical documentation involved in the current task. Do not infer the implementation from file names or surface-level observations.
- Use the public engineering standards below as the baseline for technology choices, database conventions, and frontend visuals and layout. Do not copy internal business requirements into this file.
- When a subdirectory contains a more specific `AGENTS.md`, follow the rules closest to the target file. Personal local preferences may be placed in an uncommitted `AGENTS.local.md`.
- Explicit user instructions take precedence over this file. If rules conflict or a missing decision would materially affect the implementation, explain the conflict or assumption before continuing.
- Keep changes focused. Do not perform unrelated refactoring, renaming, formatting, dependency upgrades, or directory restructuring.
- Do not overwrite, revert, or clean up existing user changes. When concurrent changes are present, understand them and work compatibly with the current worktree.
- Multiple subagents may be used for complex tasks, but the primary agent is responsible for integrating their results, checking for conflicts, and completing final verification.
- Recurring project-level mistakes made by AI should be converted into short, explicit, verifiable rules, preferably under “Never Rules.”

## Technology Stack Baseline

- Frontend: React, TypeScript, Vite, React Router, TanStack Query, shadcn/ui Rhea, and Tailwind CSS.
- Frontend internationalization: i18next and react-i18next, supporting only `zh-CN` and `en-US`.
- Backend: Node.js, TypeScript, Fastify, Zod, and Pino.
- Authentication and security: `@fastify/jwt`, JWT, and Argon2id.
- Data and infrastructure: Prisma, PostgreSQL, Redis, BullMQ, the MinIO JavaScript SDK, and SSE.
- Backend internationalization: i18next, supporting only `zh-CN` and `en-US`.
- Codex integration: `codex app-server` JSON-RPC encapsulated behind a dedicated adapter.
- Testing: Vitest; use Fastify inject or Supertest for API tests as appropriate to the scenario.
- Date and time: dayjs.
- Use pnpm consistently for Node.js dependencies and scripts, and uv for Python environments and dependencies.

## Prefer Native Codex Capabilities

- For Codex thread, turn, item, event, error, retry, recovery, interruption, tool-call, or approval semantics, first verify the `codex app-server` schema for the version actually used by this project and the official OpenAI documentation, then follow the native protocol and behavior directly.
- LinkSense is responsible only for capabilities outside Codex, including authentication, resource authorization, logical isolation, execution scheduling, event redaction and mapping, business-data persistence, auditing, and UI adaptation. It must not duplicate or override lifecycle and execution policies already provided by Codex.
- Native Codex events may be mapped to stable internal LinkSense events, but the mapping must not change their state semantics, create extra execution attempts, or interpret request or stream reconnections for the same Codex turn as a new turn.
- A custom LinkSense supplement may be proposed only after confirming that the current Codex version does not provide the required capability. Before implementation, clearly explain the capability gap, compatibility risks, and maintenance cost, and obtain user confirmation.

## Pre-Development Checks

- Locate the actual entry points, call chains, type definitions, data boundaries, authorization checks, and existing tests before deciding where to make changes.
- Search the codebase first for reusable components, hooks, services, schemas, utilities, or dependencies.
- If no suitable implementation exists in the project, evaluate mature, actively maintained libraries with strong TypeScript support that are compatible with the current stack.
- Before adding a third-party library, assess its maintenance status, license, security risks, bundle size, runtime compatibility, and adoption cost. Do not add a heavy dependency for a small amount of simple logic.
- Prefer a mature solution when its cost is reasonable, and avoid reinventing standard functionality. If implementing something in-house, explain why existing solutions are unsuitable.
- Extract logic reused by multiple modules behind a clear shared boundary and add unit tests, but do not create abstractions in advance for one-time use.
- Define the impact scope and verification approach before making changes. For destructive database changes, first obtain user confirmation under the “Database and Migrations” rules.

## Project Structure

For a project that has not yet been initialized, prefer a pnpm workspace:

```text
apps/
  web/
  api/
  runner/
packages/
  shared/
prisma/
```

- `apps/web` contains the frontend application, `apps/api` contains the Fastify API, and `apps/runner` contains background execution processes.
- `packages/shared` contains only types, Zod schemas, constants, event contracts, and general utilities that genuinely need to be shared across applications. Do not let it become an unbounded miscellaneous directory.
- `prisma` contains the Prisma schema, migrations, and seed scripts.
- Existing projects should retain their current structure. Do not break established module boundaries merely to match the recommended directory layout.
- More detailed directory rules should live in the relevant subproject documentation or nested `AGENTS.md`; the root file should contain only cross-project constraints.

## Common Commands

- Before running commands, inspect the current directory and the relevant `package.json` scripts, and follow the repository’s actual scripts.
- Install dependencies: `pnpm install`.
- Run a package script: `pnpm --filter <package> <script>`.
- Prefer `pnpm exec` for temporarily running local Node.js tools, and use `pnpm dlx` for one-off packages.
- Unit tests: prefer `pnpm test`; use the project’s existing `test:watch` script for watch mode.
- Type checking: prefer `pnpm typecheck`.
- Linting: prefer `pnpm lint`.
- Production build: prefer `pnpm build`.
- Prefer `uv run python` for Python commands, and manage Python dependencies with uv.
- When initializing a project that lacks these capabilities, add clear, composable scripts to the relevant `package.json`.

## TypeScript Standards

- Enable and preserve strict mode. New code must not avoid type errors by weakening compiler options.
- Avoid `any`. Treat unknown external input as `unknown` until it has been validated with Zod or narrowed safely.
- Public APIs, services, repositories, queue jobs, event payloads, and shared utilities must have explicit input and output types.
- Use Zod for runtime validation at boundaries such as the network, environment variables, files, queue messages, and database JSON. Prefer deriving TypeScript types from schemas.
- Maintain a single source of truth for each enum, constant, error code, event name, and field mapping. Do not duplicate definitions across modules.
- Prefer discriminated unions for state representation. Handle branches exhaustively and do not rely on unexplained non-null assertions or type casts.
- Await or explicitly manage every Promise in asynchronous logic, propagate errors correctly, and do not swallow errors or leave unhandled rejections.
- Names should express domain intent and avoid meaningless abbreviations. Comments should explain constraints, rationale, or non-obvious logic rather than restating the code.

## Frontend Standards

- Use React function components and Hooks. Prefer React’s built-in state for page-local state, and use TanStack Query consistently for server state.
- Introduce a lightweight state library only when cross-page shared state is genuinely complex. Do not duplicate server cache in global state.
- Page components orchestrate flows, business components handle domain interactions, and shared components provide reusable UI. Do not accumulate request, authorization, and presentation logic in a single component.
- Prefer shadcn/ui components and use the Rhea preset consistently. For new projects, configure `components.json` with the Base UI-based `base-rhea` preset.
- Use a well-maintained third-party component or implement one in-house only when shadcn/ui does not provide the required component. Its style and accessibility must remain consistent with existing components.
- Extract components used by multiple pages into shared components. Expose behavior through explicit props and do not bind shared components to a single page data source.
- Use Tailwind CSS for page styling. Write a small amount of plain CSS only when Tailwind cannot express the requirement, when adapting a third-party component, or when global base styles truly require it, and explain why.
- Reuse the project’s existing class-merging and variant utilities. Avoid repeatedly concatenating conflicting Tailwind classes, and do not use inline styles to bypass the design system.
- Encapsulate requests in the API client, query or mutation hooks, or services. Query keys must be stable and centrally managed; after a successful mutation, precisely update or invalidate the relevant cache.
- Validate forms and user input with Zod. Submission flows must handle loading, disabled, success, failure, and duplicate-submission states.
- Pages and components must cover required states such as loading, empty, error, and disabled, and ensure accessibility with semantic HTML, keyboard interaction, visible focus, and appropriate ARIA attributes.
- Verify responsive layouts at common desktop and mobile viewport sizes. Text, buttons, dialogs, and fixed regions must not overflow or obscure one another.
- Encapsulate host capabilities such as the Teams SDK behind adapters. Frontend tests may mock a host adapter to bypass environment detection, but production paths must be fully implemented and verified.

## Backend Standards

- Organize Fastify routes, schemas, services, and repositories by domain. Assemble shared capabilities through Fastify plugins or explicit dependency injection.
- Routes are responsible only for protocol adaptation, authentication entry points, parameter validation, and response mapping. Business rules belong in services, and Prisma queries belong in repositories or the data-access layer.
- Validate request parameters, response structures, environment variables, external-service responses, and critical file metadata with Zod.
- Sign and verify JWT access tokens with `@fastify/jwt`. Use Argon2id for password hashing and do not implement cryptography in-house.
- Validate authentication and resource authorization separately. Every endpoint that reads, modifies, downloads, or deletes a resource by ID must check the role, resource ownership, and current state on the backend.
- Use consistent API response and error structures. Return a stable `error_code`, optional parameters, and a localized message to clients without exposing stack traces, SQL, internal paths, or raw third-party errors.
- Use Pino for structured logging and include a correlatable request or trace ID. Configure log redaction to filter sensitive fields.
- Encapsulate external services behind dedicated clients or adapters with explicit timeouts, cancellation, and bounded retries. The Codex adapter must not replay a turn beyond native app-server retry behavior, and protocol changes must remain contained within the adapter.
- Raw `codex app-server` JSON-RPC events must not leak directly into the business layer or frontend. First convert them into stable, redacted internal event contracts.
- When the API supports multiple workers, store cross-request execution state, locks, counters, and SSE fan-out in Redis or a persistent store rather than process memory.
- BullMQ jobs must be idempotent and explicitly configure their own retry count, backoff, and failure handling. Long-running jobs and asynchronous cleanup must not block HTTP requests, but BullMQ must not automatically replay a complete Codex turn.
- Encapsulate Redis, BullMQ, MinIO, and other infrastructure access. Business code must not scatter connection creation or Redis key and object-key construction logic.

## Internationalization Standards

- Implement i18n in both the frontend and backend for every completed feature. Support only `zh-CN` and `en-US`, with `zh-CN` as the default and fallback language.
- Use i18next with react-i18next on the frontend and i18next on the backend. Split translation resources by language and domain, and keep their key sets consistent.
- Do not hard-code user-visible text such as page content, buttons, menus, form labels, placeholders, validation messages, toasts, dialogs, empty states, errors, email content, or export titles.
- i18n keys must be stable and semantic. Do not use Chinese or English source text as keys, and do not construct sentences through string concatenation. Use interpolation and pluralization rules for dynamic content.
- Prefer persisting stable codes, event types, and structured parameters on the backend rather than storing text in only one language.
- API errors should return stable `error_code` values and parameters for frontend translation. When the backend must generate text, maintain both Chinese and English resources.
- Use a consistent dayjs locale and time-zone strategy for dates. Use standard internationalization formatting for numbers, percentages, and currencies.
- When adding or changing user-visible text, update both language resources and test `zh-CN`, `en-US`, and missing-key fallback behavior.

## Shared Utilities and Dates

- Place utilities used in multiple locations in shared modules with clear responsibilities. Do not create oversized `utils` files without domain boundaries.
- Prefer existing project implementations or mature third-party libraries over reimplementing common functionality such as date parsing, deep cloning, retries, validation, or class merging.
- Use dayjs consistently for date and time parsing, formatting, comparison, and conversion. Initialize plugins, locales, and time-zone configuration centrally.
- Do not scatter native `Date` formatting, implicit time-zone conversions, or manually constructed date strings throughout business code.
- Prefer pure functions for shared utilities, give them explicit input and output types, and test normal values, boundary values, empty values, and invalid input.

## Database and Migrations

- Manage schema changes with the Prisma schema and Prisma migrations. Do not replace a formal, committed migration with manual SQL or `db push`.
- Follow the database design conventions for primary keys, time values, naming, and structured fields: UUIDs, PostgreSQL `timestamptz`, `snake_case`, and bounded `jsonb`.
- This project does not use database foreign keys or cascading deletes. Services must preserve cross-table integrity, deletion order, and orphan cleanup within transactions, with tests.
- Use transactions for multi-table writes, state transitions, and deletion flows. Add appropriate constraints and indexes for high-frequency queries, uniqueness, and sorting requirements, and avoid N+1 queries.
- Treat dropping tables or columns, changing column types, making columns required, changing unique constraints, narrowing enums, performing irreversible conversions, clearing tables, or changing hard-delete policies as changes that may cause data loss or break compatibility.
- Before performing any such change, identify each risk and ask the user whether historical data and the existing field structure must remain compatible. Do not modify or execute the migration until confirmation is received.
- If the user confirms that compatibility is unnecessary, historical data does not need to be retained, but the final schema must be clean, with no temporary tables, obsolete columns, shadow columns, invalid indexes, or dirty data.
- Schema changes must update related types, repositories, seeds, tests, and documentation. Each migration must contain only changes for the current task and have a clear, semantic name.

## Security and Privacy

- Follow the principle of least privilege. Enforce authentication, authorization, resource ownership, input validation, and output redaction on the server; do not rely on hiding frontend entry points.
- Read passwords, tokens, keys, credentials, connection strings, and master keys only from controlled configuration. Do not store them in source code, plaintext database fields, logs, audit records, error responses, or test snapshots.
- Validate environment variables centrally at startup. Fail fast when critical configuration is missing instead of silently using insecure defaults.
- Normalize file paths and verify that they remain under an allowed root. Validate upload size, type, and file name to prevent path traversal and arbitrary file access.
- Validate protocols and allowed scopes for external URLs, webhooks, redirect addresses, and callback parameters to prevent SSRF, open redirects, and internal network probing.
- Record only necessary structured metadata in logs and audit trails. By default, do not record user content, file contents, download links, credentials, or complete external responses.
- Security-related changes must include failure-path tests, such as unauthenticated, unauthorized, privilege-escalation, invalid-token, invalid-input, and sensitive-data-redaction cases.

## Testing Requirements

- Every new feature and behavior change must include unit tests. Before fixing a bug, add a regression test that reproduces it.
- Tests should verify observable behavior and critical contracts rather than private implementation details. Test names must clearly describe the precondition, action, and expected result.
- Unit-test services, authorization decisions, state transitions, data transformations, shared utilities, queue jobs, and adapters in isolation.
- Prefer Fastify inject for backend endpoint tests. Use Supertest only when the real HTTP boundary must be verified.
- Use Vitest and the project’s existing test tools for frontend components, hooks, and critical interactions, covering success, failure, empty, loading, authorization, and user-interaction states.
- Mock external dependencies such as Prisma, Redis, BullMQ, and MinIO at their boundaries in unit tests. Use an isolated test environment and clean up data when real integration tests are necessary.
- Time, randomness, network access, environment variables, and queue behavior must be controllable. Tests must not depend on execution order, the real network, or the developer machine’s local state.
- i18n tests must cover `zh-CN`, `en-US`, and fallback behavior. Authorization and data-access tests must include both allowed and denied paths.
- Do not make tests pass by deleting assertions, over-mocking, skipping cases, or changing a correct expectation. If user changes alter confirmed behavior, update both the implementation and tests.
- After changes, run the smallest relevant test set first, then run type checking, linting, the full test suite, and the build according to the impact scope. Expand verification for shared contracts or common modules.
- Do not lower existing coverage thresholds or commit `.only`, `.skip`, temporary debugging code, or ineffective tests.
- If missing environment requirements prevent verification, the final response must state what was not run, the specific reason, and the recommended command. Do not claim that unrun checks passed.

## Definition of Done

Before considering a feature complete, confirm that:

- The implementation matches the current task and confirmed technical approach without unrelated changes.
- Existing implementations and mature libraries have been evaluated and reused where appropriate, without obvious reinvention.
- Frontend and backend boundaries, error handling, authorization, security, responsiveness, and required states are covered.
- All user-visible text is provided in both `zh-CN` and `en-US`, with no hard-coded text or missing keys.
- New or changed behavior has corresponding tests, and relevant tests, type checks, and linting have passed. If the build pipeline is affected, the build has also passed.
- For schema changes, migration-risk confirmation has been completed and related code, tests, and documentation have been updated.
- The actual diff has been reviewed to confirm that it contains no sensitive information, generated artifacts, unrelated formatting, or overwritten user changes.
- The final response lists completed work, commands actually run and their results, unverified items, and remaining risks.

## Dependency Management

- Before adding a dependency, inspect existing workspace dependencies and the lockfile to avoid duplicate libraries or overlapping capabilities.
- Prefer well-maintained, widely adopted libraries with strong TypeScript support and suitable licenses, and prioritize official documentation and stable APIs.
- Classify runtime and development dependencies correctly. Add them with `pnpm add`, `pnpm add -D`, or the appropriate workspace filter.
- Explain compatibility impacts separately for dependency upgrades and run the affected tests. Do not perform broad version upgrades opportunistically.
- Only pnpm may generate the lockfile. Commit dependency changes together with both `package.json` and the lockfile.

## Never Rules

- Never use npm, yarn, or npx to install dependencies, run scripts, or generate a lockfile.
- Never run Prettier from `apps/web` to format other repository packages directly. Format web files with `pnpm --filter @linksense/web format -- <path>`; this command rejects paths outside `apps/web`.
- Never edit the lockfile manually or modify dependency, cache, or build-output directories such as `node_modules/`, `dist/`, `build/`, `coverage/`, `.vite/`, or `.turbo/`.
- Never run drop, truncate, reset, irreversible migrations, historical-field deletion, or other destructive database operations without first confirming the data risks.
- Never modify a migration that has already been applied to a development, test, or deployed database. Add a new forward migration for subsequent column, constraint, or data fixes, and preserve the checksum of published migration files.
- Never accumulate complex request and business logic in frontend components, or business logic and scattered Prisma queries in backend routes.
- Never hard-code user-visible text, secrets, tokens, internal addresses, server-side absolute paths, or sensitive test data.
- Never trust external input that has not been validated with Zod, or return internal data directly to the frontend without authorization checks, redaction, and conversion.
- Never use process-local state for counters, locks, execution state, or SSE cursors shared across multiple workers.
- Never use unbounded retries, external requests without timeouts, unawaited Promises, or untraceable fire-and-forget jobs.
- Never implement custom full-turn Codex retries, input replay, extra attempts, replacement states, or other strategies that conflict with native app-server semantics unless the required capability is confirmed missing and the user has explicitly authorized the custom behavior.
- Never conceal implementation problems with `any`, type assertions, disabled linting, reduced coverage, or skipped tests.
- Never use unstable indexes as React list keys, or use inline styles or plain CSS to bypass shadcn/ui and Tailwind standards.
- Never use `git stash`, switch or reset branches, forcibly overwrite files, or revert user changes unless the user explicitly requests it.
- Never add specific feature requirements to this file. Keep feature scope in requirements documentation.

## Git and Collaboration

- Before Git operations, inspect the actual worktree, branch, and diff. Do not initialize a repository when the current directory is not already a Git repository.
- When the user requests `git commit`, split all changes into multiple semantically clear commits according to their actual content. Every commit message must be written in English, including merge commits; for example: `feat: add the xxx feature`.
- Do not include unrelated formatting, temporary files, private configuration, local environment files, or generated artifacts in a commit.
- When the user asks for an explanation of the requirements, fully describe the scope, boundaries, assumptions, and acceptance criteria, and wait for confirmation before coding.
- Base final conclusions on actual code, commands, and test results. Do not present assumptions as verified facts.
