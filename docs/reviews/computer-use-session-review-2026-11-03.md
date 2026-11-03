# Browser Use And Computer Use Session Review

Date: 2026-11-03 (Asia/Shanghai).

Scope: all current uncommitted changes against
`8c73cb35019ef74910bd5198f5f9b7f100ae1b2e`, including new files. The review covers
Browser Use naming and compatibility, Shared/API/Runner/Web integration, the
MyGo desktop client, macOS permissions, Windows packaging, and deployment.
The existing `feat` branch is retained. No commit, push, database migration,
credential reset, or production deployment was performed.

This record supersedes older review conclusions about the current worktree,
especially claims that the renamed Skill identity was already compatible.

## Standards

Six confirmed groups were fixed:

1. **P1 - Passive permission refresh destroyed active task state.**
   `apps/desktop/engine.go` used the task engine for permission probing, which
   replaced its native session and stopped its host. The three-second refresh
   therefore invalidated a snapshot between observation and the next action.
   Probes now use a separate, short-lived engine. A regression first reproduced
   the lost session and now verifies that a snapshot remains actionable after
   refresh. Permission failures still discard the denied task host, preventing
   its cached denial from surviving a later user grant.

2. **P1 - Commands could dispatch after authority was withdrawn.**
   `apps/api/src/modules/computer-use/routes.ts` removed a queued command before
   awaiting database checks. Release, cancellation, reconnect, revocation, or
   expiry during that await did not prevent dispatch. The final send now checks
   the current connection, pause state, active request, deadline, and socket.
   Five deterministic blocked-database WebSocket regressions failed before the
   fix. Consumed stale commands are discarded, never replayed.

3. **P1 - Browser Skill renaming rejected persisted selections.**
   `packages/shared/src/capabilities.ts` removed the old built-in ID, breaking
   stored start intents, historical capability events, message chips, and
   priority execution. The existing `linksense-local-browser` internal
   ID/slug/native directory is retained. The UI and canonical MCP tool remain
   Browser Use and `browser_use`; discovery does not show duplicate tools.
   Regressions exercise the actual old identifier and stored start-intent
   recovery, rather than only records created with the new code.

4. **P1 - New reserved names broke existing custom resources.**
   `linksense-browser-use` and `linksense-computer-use` were valid custom Skill
   and plugin names before these changes. They remain valid, with unchanged
   UUIDs, manifests, names, and content. The new Computer Use built-in selects
   the first unused native name, using a bounded `-builtin-N` suffix when
   necessary. API publication/context generation and Runner validation/catalog
   admission share the mapping. Explicit Computer Use selection also verifies
   the authored built-in path. Tests cover multiple collisions, both resource
   types, existing snapshot refresh, and actual priority submission.

5. **P2 - A window-scoped key could fail even after semantic input succeeded.**
   Native whitebox returned `STALE_REF` with the confirmed cause
   `exact_window_focus_unconfirmed`; no key was delivered. A scoped key now
   requests headed execution for the exact selected app/window before sending.
   It remains a write action requiring task consent, with no retry or arbitrary
   coordinate fallback. Argument and native window regressions cover the change.

6. **P2 - The permission panel's close control was not keyboard accessible.**
   `apps/desktop/view.go` used an unfocusable clickable box. It now uses the
   native button and handles Escape within the panel. Closing the native window
   clears its cached handle so it can be recreated. A keyboard regression first
   failed and now covers Tab/Space and Escape. The existing icon, drag payload,
   six-language label, and automatic permission refresh remain intact.

## Spec

Two additional confirmed groups were fixed:

1. **P2 - Relay failures lost delivery uncertainty.**
   The MCP and event-sink relays converted every non-2xx response to
   `ACCESS_DENIED/not_delivered`, including an actual
   `COMMAND_FAILED/unknown` response after possible desktop input.
   `apps/runner/src/computer-use-response.ts` now preserves validated failure
   results; malformed or non-authorization relay failures retain unknown
   delivery. Both relay boundaries have regressions for structured 503,
   malformed 502, and genuine 403 responses. No retry was added.

2. **P2 - Release installations omitted the documented archive settings.**
   The release Compose environment and installer's strict environment handling
   did not carry either desktop archive path. Both optional settings now survive
   fresh configuration and upgrades. Old installations with neither setting
   remain unchanged. Six focused regressions cover pass-through and old/new
   configuration. The operator still supplies and mounts the actual installer;
   these changes do not build or upload clients in the public release workflow.

## Compatibility And Verification

No existing task, capability, Browser Use pairing, or desktop credential must be
recreated. The generated built-in runtime revision is
`0708009e2301fa47b867ea3124da2184a44da37ba3ddeb65896e0dbf79cfc1ef`;
fingerprint and existing-snapshot refresh tests pass. Shared/API/Runner/Web must
be deployed together so publication and execution use the same native-name
mapping. Existing Browser Use network paths, credential namespaces, and legacy
tool dispatch retain their previous authorization checks.

| Check | Result |
| --- | --- |
| Shared full suite | 84 files, 712 tests passed |
| API import/publication/conversation compatibility suites | 493 tests passed |
| API Browser Use, Computer Use, Redis, and config suites | 9 files, 190 tests passed |
| Runner runtime/priority/context suites | 341 passed; one existing platform-specific skip |
| Runner MCP/relay/registry/controller suites | 5 files, 111 tests passed |
| Web Browser Use/Computer Use/presentation/activity/application suites | 12 files, 190 tests passed |
| Desktop packaging script suite | 8 tests passed |
| Release archive configuration regressions | 6 focused tests passed |
| Workspace `pnpm typecheck` | Passed |
| Workspace `pnpm lint` | No errors; existing TanStack Virtual React Compiler warning retained |
| Shared/API/Runner/Web production builds | Passed; existing browser externalization and bundle-size notices retained |
| Final desktop `go test -race -count=1 ./...` and `go vet ./...` | Passed on macOS |
| Final packaged macOS native whitebox | Passed: focus, click, type, key, screenshot, refresh between snapshot/action, and stopped-ref rejection |
| macOS build and `codesign --verify --deep --strict` | Passed with ad-hoc signing |
| Windows amd64/arm64 native test cross-compilation and `go vet` | Passed; Windows test execution not claimed |
| Final Windows amd64/arm64 MyGo/NSIS builds | Both rebuilt successfully with matching native engine architectures and legal resources |

The Windows builds use the official `agent-desktop@1.0.2` npm archive, verified
against freshly retrieved registry SHA-512 integrity, with each PE executable
also checked against its packaged SHA-256. The production GitHub downloader and
its pinned archive checksums were not bypassed or modified.

Final local artifacts:

| Artifact | SHA-256 |
| --- | --- |
| `outputs/desktop/LinkSense-Desktop-macos.zip` | `b35cdcb8c8035e39dcee5eebbd1d3303b9994df63ee59239ea71ee3187ccc26e` |
| `outputs/desktop/LinkSense-Desktop-windows.exe` | `7bfc8743554c474cd173ca05b381695c57000f18fe85440b5d482d52693353db` |
| `outputs/desktop/LinkSense-Desktop-windows-arm64.exe` | `718cbe0744bf2164edcb04f900d0de9957278c11ef69a3c5371947256728eab0` |

## Acceptance Boundaries

- This is not a full `pnpm test` run or production release approval. The complete
  release-installation test file encountered three `docker ENOENT` failures;
  its focused archive configuration regressions pass. Docker/container rollout
  requires an environment with Docker and a rerun of
  `node --test scripts/release-installation.test.mjs`.
- Windows UIA, installation/uninstallation, Credential Manager, deep links, and
  real desktop behavior require Windows execution. Cross-compilation is not a
  substitute for that acceptance; run `pnpm desktop:test` on each Windows
  architecture and exercise the installed client.
- The macOS native whitebox uses only its disposable test window. It does not
  establish arbitrary third-party app compatibility or verify dragging the app
  into System Settings. The latter still requires a manual OS interaction.
- macOS packages use ad-hoc signing and Windows installers are unsigned.
  Developer ID/notarization and Windows signing are not completed. macOS may
  require renewed permission or restart after an app/signature update.
- A real-account/model conversation and live discovery with the repository's
  pinned Codex were not run. Local PATH Codex differs from the repository pin;
  deterministic tests exercise the integration contracts.
- The automatically served local downloads are macOS arm64 and Windows x64.
  The separately rebuilt Windows ARM64 installer is available as a local file;
  architecture-specific download selection is not implemented.

Standards: six fixed groups, worst severity P1. Spec: two fixed groups, worst
severity P2. No confirmed code finding remains open in this reviewed scope;
the platform and deployment acceptance boundaries above remain unverified.
