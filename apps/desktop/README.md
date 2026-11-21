# LinkSense desktop

The desktop client embeds the existing `apps/web` application in a Go/mygo
window. It remains part of this repository, with no separate Web UI.

The implementation follows the [desktop plan](../../docs/research/linksense-desktop-dual-mode-plan-2026-11-16.md)
and [task breakdown](../../docs/development/linksense-desktop-dual-mode-task-breakdown-2026-11-16.md).
Phase 0 is in progress; the shell alone is not a completed local execution environment.

## Development

Use the repository's Node/pnpm versions and Go's automatic toolchain selection.
The Go module pins Go 1.27.3 and mygo 0.10.0. The frontend uses the matching
official `mygo-runtime` and `@mygo-plugins/fetch` packages.

Before starting a macOS integration, have Claude Code check the
[MyGo docs](https://mygo.run/) and the
[latest stable release](https://github.com/egoist/mygo/releases/latest).
Verify the API against the version pinned here and keep the Go module and
both frontend packages aligned on upgrade. Reuse MyGo's native features
and plugins; add only the LinkSense behavior they do not cover.

```sh
pnpm desktop:generate
pnpm desktop:prepare
pnpm desktop:dev -- --server-url http://localhost:18173
pnpm desktop:test
pnpm desktop:whitebox
pnpm desktop:whitebox:os
pnpm desktop:whitebox:engine
pnpm desktop:build -- --server-url https://linksense.example.com
pnpm desktop:build -- --platform windows/amd64 --server-url https://linksense.example.com
```

The server origin is supplied by the packager with `--server-url` (or the
build-time `LINKSENSE_DESKTOP_SERVER_URL` environment variable) and linked into
the executable. End users are never asked for a URL. Only HTTPS is accepted,
with HTTP allowed for loopback development servers. Installed releases ignore
runtime URL environment variables and the former `config.json`; development
uses the origin passed to `desktop:dev`.

Sign-in opens the system browser at the packaged server. An existing browser
session continues automatically; otherwise the existing Web login, registration
and enterprise/social sign-in flows are used. The browser returns a one-time
authorization code through the OS-registered `linksense-desktop://auth/callback`
link. If the browser blocks automatic app launch, the same page offers a
Return to the app link. The native client checks random state and exchanges the
code with an S256 PKCE verifier kept only in Go memory. Codes expire after
60 seconds and are consumed atomically across API replicas; the browser flow
times out after five minutes and can be cancelled. Neither access nor refresh
tokens appear in callback URLs.

The desktop gets an independent refresh session. Browser cookies are not copied
into the WebView, and signing out of the desktop preserves the browser session.
Refresh restores subsequent app launches without opening the browser again.
Deploy the matching API and Web authorization routes before distributing this
client. Existing Web sessions and refresh-token records need no migration.

On macOS the LinkSense menu bar item can reopen the main window, open
Settings or New Task, and quit. To keep tasks running when the window closes,
enable **Keep Running in the Menu Bar When the Window Closes** there. The
choice persists on this Mac and is off for new and upgraded installs.
**Quit** still exits the app. The native Settings (`Command+,`) and New Task
(`Command+N`) actions work after sign-in and respect the app's unsaved-change
prompts.

### Local workspaces

On macOS, local task files live under the app's private runtime directory.
Startup maintenance keeps the most recent 14 days and caps eligible task files
at 10 GiB, evicting the oldest workspaces first. **Settings → General** shows
only the signed-in account's current-server total and offers the same policy as
a one-click cleanup.

Only sessions created by this build for the current server origin are measured
or evicted. Legacy v1 sessions (which never recorded an origin), sessions bound
to another origin, other accounts, active turns, and sessions with unresolved
start journals, attachment staging, or event outbox entries are retained. A
cleanup removes only `home/workspace`; the session marker, control state, Codex
history, managed files, and uploaded artifacts stay.

A confirmed eviction is recorded in the session marker. Opening that
conversation on the Mac shows one inline notice; the next local turn rebuilds an
empty workspace and removes the notice. Because v1 sessions have no origin
binding, a missing v1 workspace is never reported as cleared. The notice is
answered read-only from the marker, so it survives an app restart until the
workspace is rebuilt.

The WKWebView workspace whitebox runs only when a prepared runtime is selected:

```sh
LINKSENSE_DESKTOP_RUNTIME_DIST="$PWD/apps/desktop/resources/darwin-arm64/runtime" \
  pnpm desktop:whitebox
```

It drives Settings and a cleared conversation with a disposable supervised
runner and fixtures for another account, a foreign origin, a legacy v1 session,
and an unresolved outbox. Without the variable that test is skipped; the
remaining whitebox tests still run.

Enable **macOS notifications** in **Settings → General**. Turning it on
sends a test notification and can open the system permission prompt. A saved
browser preference does not enable Mac notifications. While the app runs
in the background, it shows task and automation results without task names
or content. Clicking a notification opens the task only on the matching
server and account, with the same unsaved-change prompt as in-app navigation.

### Window chrome

The macOS main window uses mygo's `TitleBarHidden` style, so the shared Web
page fills the window while the native red/yellow/green controls stay at the
top left. Sidebar and settings lockups start at the reported controls bottom
(`--mygo-titlebar-controls-bottom`) and shrink only when the remaining header
height is smaller; other top-area controls reserve the reported horizontal
inset (`--mygo-titlebar-inset-left`). Otherwise unused surfaces are
`--app-region: drag`, and interactive elements keep their events.

Every added rule is scoped to `html[data-desktop-platform="darwin"]`, which
the desktop adapter sets from the native platform before host info resolves.
A markerless Web layout and the Windows host keep their original cascades,
geometry, and drag behavior. The title-bar values are zero in full screen, so
no phantom inset remains.

To enable **Check for updates**, supply both
`LINKSENSE_DESKTOP_UPDATE_FEED` (the target's full update manifest URL) and
`LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY` (the base64 Ed25519 public key) at build
time. The client queries the feed through mygo and reports the release version
in Settings and the protocol update notice. This stage only checks for
updates; it does not download or install them. mygo requires a writable
installation location for update checks. Read-only installations and releases
without a feed show that update checks are unavailable.

The native HTTP transport accepts only the packaged server's `/api/v1/` routes.
It preserves API authentication and authorization, streams SSE, propagates
cancellation, and does not follow redirects. Refresh credentials are stored
in the OS credential store, scoped to the packaged server. Access tokens are
kept only in memory in desktop mode; browser session storage is unchanged.

Builds embed the Web application's current build and bundle fixed Node.js
24.22.1, Codex 0.170.0, agent-desktop 1.3.1, and the runner's production
dependency closure. The release manifest pins upstream download SHA-256
checksums; the generated runtime manifest records executable hashes.
Preparation checks executable versions and native imports on the build host.
The runner uses pnpm's portable, hoisted deployment so mygo's resource copier
retains its complete dependency tree. Runtime license texts ship alongside
the repository and the target Go application's dependency notices. Local
macOS builds use ad hoc signing by default. See [macOS releases](#macos-releases)
for Developer ID signing and notarization.

Windows ARM64 keeps the native Go shell and agent-desktop engine, and uses
x64 Node/Codex and npm bindings under Windows 11's built-in x64 emulation.
The current `@firecrawl/anydoc` dependency has no Windows ARM64 binding.
The runtime architecture is explicit in the manifest; Windows 10 ARM64
cannot provide this x64 runtime.

On the matching host platform, the completed package is checked again. The
smoke test copies it outside the repository, launches an actual desktop
worker, verifies its authenticated Codex health check and session boundary,
and stops it. It also starts the bundled Codex and Core MCP, calls the
rich-output catalog and completes a native turn against a local model
fixture. The Go supervisor is tested against the bundled Node entrypoint
through one complete heartbeat window. No provider key is needed.
Clean-system installation and device behavior have separate acceptance gates.

The macOS ARM64 development build measured 174.6 MB for the DMG and 601.6 MB
for the expanded application. Node and Codex account for approximately
122.5 MB and 273.6 MB of the expanded files. The original size estimate
understated installed size; download size and installed size are tracked
separately for release review.

### macOS releases

Build on an Apple silicon Mac with Xcode command-line tools, a standard
packaging umask (`022`), a Developer ID
Application certificate and the `linksense-desktop-notary` Keychain profile.
Set up the profile interactively with `xcrun notarytool store-credentials
linksense-desktop-notary`. Keep credentials in Keychain or the release runner's
secret store.

```sh
LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY='Developer ID Application: Organization (TEAMID)' \
  pnpm desktop:build -- --macos-release --platform darwin/arm64 --server-url https://linksense.example.com
```

MyGo signs the app and its helpers with the hardened runtime, then notarizes and
staples the app and DMG. The build verifies pinned runtime bytes before signing
and the final bundle, runtime signatures, tickets and native runtime afterward.
Verified releases appear in separate `apps/desktop/build/macos-release-*`
directories; an unsuccessful or ad hoc build leaves them alone.

Before distribution, test a quarantined DMG on an isolated Apple silicon Mac:
install by dragging to Applications, verify Gatekeeper and the first browser
sign-in and callback, pair the device and start the bundled runtime from a
standard account other than the installer. Then replace
the previous verified app in place with the new one for the **same server
origin**. Check saved sign-in, pairing, deep links and a new local turn. A
change of signing identity can prompt macOS to authorize Keychain access again.
Keep the previous verified DMG separately; after local turns settle, verify the
same checks when replacing the new app with that previous package. Verify API
compatibility before rollback; consult the feature gates below.

### Local execution

The app supervises the bundled Node process over a private pipe. Mac device
execution is off by default and `LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED=true`
is accepted only by the development/test API. The gateway negotiates execution
protocol v2; clients below v2 retain device presence. Upgrade every API replica
and task-recovery consumer before enabling the switch in a shared environment.
The PostgreSQL fixture can also verify the packaged Go bridge and local Codex
using `LINKSENSE_DESKTOP_RUNTIME_DIST` pointed at the built app's
`Contents/Resources/runtime` directory and `pnpm test:desktop:postgres`.
The fixture uses a local synthetic provider. Separate acceptance is required
for orphaned Shell processes after a force quit, installed upgrades and
production signing/notarization.

Mac artifact registration is separately disabled by default. To
enable it in development/test, upgrade all serving API replicas and
`linksense-maintenance` consumers first, then set
`LINKSENSE_DESKTOP_ARTIFACTS_ENABLED=true` uniformly and reconnect the Mac.
Older clients keep their existing negotiated tools. The API confirms the size,
MIME type and checksum before publishing the existing download card. If the
confirmation response is lost, check the task's artifacts for the original ID.

Mac builds that negotiate `artifact.multipart` send files above the
configured single-upload limit as 32 MiB signed parts, up to 5 GiB per file.
To allow signed uploads, add enabled MinIO bucket lifecycle rules for
`desktop-artifact-staging/` and `desktop-artifact-parts/`. Use exact prefix
filters with no tags, one day for current object expiration and one day for
noncurrent version expiration. Merge these rules with the bucket's existing
configuration; never apply them to the whole bucket. The API storage identity
needs permission to read the lifecycle configuration. The rules catch uploads
that finish after delayed cleanup, and must stay in place even after disabling
artifact registration. Without the rules, single-file uploads use the API
fallback and files above its limit are rejected.

Website artifact grants (`artifact.website`) negotiate separately and stay off
until `LINKSENSE_DESKTOP_WEBSITE_ARTIFACTS_ENABLED=true`, which requires
`LINKSENSE_DESKTOP_ARTIFACTS_ENABLED=true`. Upgrade every serving API replica
and `linksense-maintenance` consumer before enabling it uniformly, then
reconnect the Mac. Replicas from before this rollout can neither consume a
website grant nor run its delayed cleanup, so do not route traffic to them
while grants exist. Older clients, and Macs that do not offer
`artifact.website`, keep their existing negotiated tools. Disabling the switch
stops new negotiation only; upload and confirmation remain available under
`LINKSENSE_DESKTOP_ARTIFACTS_ENABLED`, so issued grants can drain. Before
disabling or rolling back, stop starting website artifacts, disable the switch
uniformly and reconnect the Mac so new sockets omit `artifact.website`, then
keep the updated API replicas and maintenance workers running until
outstanding grants expire and delayed cleanup jobs drain. Retry failed cleanup
in system maintenance before running pre-rollout replicas.

Before running mixed API versions or rolling back, stop starting new artifact
work and let active confirmations finish. Then disable artifact registration
uniformly: the flag also disables confirmation routes, and older replicas
cannot confirm a multipart grant. Keep updated consumers running until
remaining grants have expired and delayed cleanup jobs have drained. Retry
failed cleanup in system maintenance before rolling back.

Apply `20261120100000_add_desktop_artifact_path_digest` before starting API
replicas that resolve desktop file activities. Retain the nullable column on
binary rollback. Older Macs omit the binding and older APIs ignore it; existing
artifacts need no backfill and keep their download cards. A native file creation
links only when a single confirmed artifact matches its verified snapshot. The
task detail adds the association without changing the native event or its SSE
cursor. Edits, files produced by commands, and creations outside the retained
activity window keep their download cards.

Mac one-time command and file approvals use the bundled Codex's native
requests. Apply `20261120130000_add_conversation_desktop_approvals` before
upgrading API replicas and `linksense-maintenance` consumers. After all have
upgraded, set `LINKSENSE_DESKTOP_NATIVE_APPROVALS_ENABLED=true` uniformly
alongside development/test local execution and reconnect upgraded Macs.
Older clients do not negotiate `approval.respond`. Cloud approval policy is
unchanged. The strict profile keeps workspace write limits even after
approval. Saved rules and full access are not enabled. An unconfirmed
reply must not be retried automatically; check the outcome on the Mac.

Before downgrading, stop starting local turns and let active approvals and
turns settle. Turn off the approval flag uniformly and reconnect with the new
Mac app. Keep the upgraded components running until pending local recovery
has finished and the affected turns' `desktop-outbox` queues are empty.
The new runtime drains queued events and discards obsolete approval prompts.
An older runtime cannot read those prompts if it starts before the drain.
Do not delete outbox files by hand or drop the approval table on rollback.

By default the packaged fixture uses the local filesystem to verify API
streaming. Set `LINKSENSE_TEST_MINIO_BIN` to an absolute path to a local MinIO
executable to verify signed multipart upload instead. The fixture starts a
private server on loopback, installs the lifecycle rules, and checks that the
packaged Mac did not use the API fallback.

`desktop:whitebox` uses an in-memory credential store. On macOS,
`desktop:whitebox:os` additionally opens the real system browser twice, verifies
reuse of an isolated fixture session, delivers callbacks through Launch Services
to the exact running test bundle, and checks real Keychain storage, refresh
after a WebView reload, and sign-out deletion. It also forces a child-process
exit after storage and verifies parent-owned cleanup of that unique fixture
service. Temporary Go data and window state belong to the fixture directory;
the test does not claim to remove WebKit's system-managed caches.

A fresh process of the same signed test executable also starts a separate
WebView and authenticates from the stored Keychain session without opening
the browser. The parent fixture server stays running to validate the refresh
cookie; access tokens are not passed to the new process.

This is an ad hoc signed acceptance bundle with a synthetic authorization
endpoint. It does not change the default URL handler or verify an installed
release's default scheme routing, full quit/relaunch lifecycle, cross-version
credential access, real identity providers, or clean-system installation.
The real authorization SPA has a separate browser-to-WebView fixture test.

`desktop:whitebox:engine` checks the staged macOS engine and helper against the
checksum-pinned archive retained by `desktop:prepare`. It types Unicode into an
owned AppKit window, clicks its button and checks both the AX result and the
file written by the click handler. Run it in an unlocked, isolated macOS login
with Xcode command-line tools and Accessibility permission. Do not run another
agent-desktop process in that login: the pinned engine can stop legacy command
hosts owned by the same account. Windows UIA and installed app validation are
separate acceptance gates.

The reference implementation is `feat-computer-use` at
`7041e026032b948c5e4e3bae5c0a5b9d5148bdfb`. This module is implemented for the
current `feat` architecture; the companion application's Go files are not copied.
