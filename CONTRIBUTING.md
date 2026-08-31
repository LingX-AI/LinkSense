# Contributing to LinkSense

Thank you for contributing to LinkSense. Before submitting changes, search the existing Issues and Discussions to make sure the topic has not already been covered. For security issues, follow [SECURITY.md](./SECURITY.md) and do not disclose them publicly.

## Development setup

The project uses Node.js, a pnpm workspace, Docker Compose, and PostgreSQL. Use the pnpm version declared in the repository's `package.json`.

```bash
pnpm install
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

To run a command for a single workspace, use:

```bash
pnpm --filter <package-name> <script>
```

Use `uv` consistently for Python commands and dependencies.

## Pull requests

- Keep changes focused and do not include unrelated refactoring or generated artifacts.
- Every feature and behavior change should include corresponding tests.
- Maintain user-visible text in both `zh-CN` and `en-US`.
- Do not commit `.env` files, tokens, secrets, real personal data, runtime directories, build artifacts, or local absolute paths.
- Use Prisma migrations for database schema changes, and clearly describe data-loss and compatibility risks in the pull request.
- Before submitting, run the affected tests, type checks, linting, and build, and record the results in the pull request.

By contributing, you agree to license your contribution under this repository's [CPAL-1.0](./LICENSE).
