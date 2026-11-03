# Windows Computer Use Review

Date: 2026-11-03 (Asia/Shanghai).

Scope: the uncommitted Windows implementation, its native process lifecycle,
release tooling, Shared/API/Web contracts, and macOS upgrade regressions. The
repository remains on its existing `feat` branch. No commit, push, database
migration, account reset, or unrelated cleanup was performed.

The review assumes multiple API/Runner processes and users, with one paired
device and one in-flight desktop command per account. This supplements the
earlier Browser Use / Computer Use review; it does not claim another full review
or test run of every unrelated worktree change.

## Standards

Five confirmed groups were fixed:

1. **P1 - Windows snapshot refs disappeared between commands.**
   `apps/desktop/engine.go:346` created and deleted a new
   `AGENT_DESKTOP_HOME` on every process invocation. The pinned upstream
   `RefStore` persists ref maps beneath that directory, so a later click,
   focus, type, or scroll could not resolve a successful snapshot. A private
   directory now survives within one native session, and Stop/session
   replacement removes it. Regression tests persist and resolve a real fixture
   ref map across separate subprocesses; the test failed before the fix.

2. **P1 - Stop did not own the active Windows command.**
   `apps/desktop/engine.go:196` previously cleared wrapper refs without
   cancelling a Windows subprocess. Stop now cancels and waits for the owned
   command before deleting its private state. The regression calls Stop while
   the fixture is blocked, without first cancelling the caller's context.
   Deadline cancellation also removes native state. Snapshot results cannot
   repopulate refs after Stop has cleared the current session.

3. **P2 - Windows native output had no memory bound and accepted trailing JSON.**
   `apps/desktop/engine.go:339` now caps stdout at 8 MiB, bounds pipe shutdown
   with `WaitDelay`, checks cancellation before accepting a response, and
   requires exactly one protocol envelope. Oversized and trailing-envelope
   regressions both failed before the fix.

4. **P2 - Listed localized applications could not be targeted.**
   `packages/shared/src/computer-use.ts:9` and
   `apps/desktop/engine.go:74` accepted ASCII names only, whereas the Windows
   inventory returns executable image names without macOS bundle IDs.
   Both boundaries now accept bounded Unicode letters/numbers and common name
   punctuation. Shared and Go regressions cover localized executable names,
   flag prefixes, NUL/newline injection, and overlong identifiers.

5. **P2 - The native test harness was macOS-specific.**
   `apps/desktop/engine_test.go:299` replaces a POSIX shell wrapper with the
   test executable itself, supporting stdio-host and one-command transports.
   Assertions account for Windows headed text/focus and platform-specific
   permission labels in all six locales. `scripts/desktop.mjs:84` runs the
   same tests without `-race` on Windows ARM64 because the pinned Go toolchain
   rejects that flag on this target; supported targets retain race detection.

Windows process configuration also suppresses a child console window, without
changing the engine's explicit headed input policy. Its visible behavior still
requires Windows verification.

## Spec And Upgrade Compatibility

Three confirmed groups were fixed:

1. **P1 - The Windows build passed an invalid Go target.**
   `scripts/desktop.mjs:63` now maps Node's `win32` to Go's `windows`, then
   supplies `windows/amd64` or `windows/arm64` to MyGo. Target and artifact
   mapping tests cover both architectures and preserve macOS mappings.

2. **P1 - A missing installer silently became a broken standalone executable.**
   `scripts/desktop.mjs:89` now requires a non-empty installer. It never
   substitutes `LinkSense helper.exe`, which lacks its sibling engine and
   legal resources when distributed alone. A regression leaves that bare
   executable present while the installer is absent and verifies staging fails.

3. **P2 - Windows availability broke existing macOS downloads.**
   `apps/api/src/modules/computer-use/routes.ts:52` preserves the macOS meaning
   of legacy `client_available`. A request to `/computer-use/client` without a
   platform still downloads macOS; explicit `platform=win32` downloads Windows.
   `apps/web/src/features/computer-use/computer-use-settings.tsx:82` falls back
   to legacy availability only for macOS. Windows never mistakes that legacy
   boolean for a Windows installer, and explicit new availability wins.
   API tests use legacy requests and a Windows-paired account; Web tests use
   responses with the new `clients` field absent and exercise both downloads.

No persisted device credential, pairing code, native protocol version, Browser
Use pairing, or existing task resource format was changed by these fixes.
There is no database migration or requirement to recreate tasks or pair an
existing macOS client again. Deploy Shared/API/Web together using the existing
client-build update barrier. Windows installer paths still require a real,
read-only mounted artifact in deployed API containers.

## Verification

| Check | Actual result |
| --- | --- |
| `node --test scripts/desktop.test.mjs` | 8 passed |
| `pnpm --filter @linksense/shared test` | 84 files, 708 tests passed |
| API Computer Use, Redis, route and config tests | 4 files, 68 tests passed |
| Runner Computer Use and core registry tests | 2 files, 32 tests passed |
| Web Computer Use tests | 18 passed, including six locales and matching download parameters/names |
| Native `go test -race -count=1 ./...` and `go vet ./...` | Passed on macOS; includes Fastify/WebSocket and subprocess fixtures |
| Windows amd64/arm64 `go test -c` and `go vet ./...` | Both PE test executables cross-compiled; no Windows execution claimed |
| `pnpm typecheck` | Passed for all workspace packages |
| Targeted API, Runner and Web ESLint | Passed with zero warnings |
| `pnpm desktop:build` | macOS app, DMG and ZIP rebuilt successfully |
| Packaged macOS native whitebox | Passed against its disposable native window |
| Isolated MyGo Windows builds | amd64 and arm64 NSIS installers built; matching PE engine architecture and legal resources checked |
| Web formatter and `git diff --check` | Passed |

The GitHub release download attempt timed out. For isolated Windows packaging,
the cached official `agent-desktop@1.0.2` npm tarball was verified against
freshly retrieved registry SHA-512 integrity, then each executable was checked
against its packaged SHA-256. The production downloader and its pinned GitHub
archive digests were not bypassed or changed.

The x64 test installer is staged at
`outputs/desktop/LinkSense-Desktop-windows.exe` for authenticated development
downloads. It is unsigned and is not a verified public Windows release.

## Remaining Acceptance

- No Windows machine was available. Installation/uninstallation, real UIA
  actions, Credential Manager, URL-scheme activation, foreground/focus behavior,
  integrity-level restrictions, and the native Windows test suite remain unrun.
- The direct Windows GitHub download/prepare path still needs validation from a
  Windows development environment.
- Windows signing and public-distribution acceptance are not complete.
- The macOS whitebox touches only its isolated native test window; it does not
  establish compatibility with arbitrary third-party apps.
- The entire unrelated repository test suite, production containers, and a
  real account/model conversation were not rerun for this Windows-only review.

Standards: 5 fixed groups, worst severity P1. Spec/compatibility: 3 fixed groups,
worst severity P1. No confirmed code finding is left unresolved in this reviewed
scope; Windows runtime acceptance remains a release gate.
