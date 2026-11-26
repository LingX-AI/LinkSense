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

On macOS, `linksense-desktop://pair?server=https%3A%2F%2Flinksense.example.com`
opens **Settings → General → This Mac** when `server` is the packaged origin
and the user is signed in. The link only opens Settings; pairing still requires
submitting the form there. Older links that carry a pairing code are not
accepted. Open LinkSense directly, sign in if needed, and use **Settings →
General → This Mac** to pair. Already paired devices do not need to be paired
again.

An optional Mac new-task guide covers pairing, the
[default run location](#local-execution) for new tasks, and the system-browser
extension ([Browser Use](../../docs/development/browser-use.md)). **Skip**
dismisses it only for the current account and server on this Mac; the guide
never pairs the device, launches a browser or requests a system permission.

On macOS the LinkSense menu bar item can reopen the main window, open
Settings or New Task, and quit. To keep tasks running when the window closes,
enable **Keep Running in the Menu Bar When the Window Closes** there. The
choice persists on this Mac and is off for new and upgraded installs.
**Quit** still exits the app. The native Settings (`Command+,`) and New Task
(`Command+N`) actions work after sign-in and respect the app's unsaved-change
prompts.

### Diagnostics export

The LinkSense app menu has **Export LinkSense Diagnostics…** next to About and
Desktop updates. It has no keyboard shortcut and is not in the menu-bar menu.
The action opens the system Save dialog, preferring the main window as its
parent, and suggests `linksense-diagnostics.json` in the user's Documents
folder (or as a bare file name when that folder is unavailable). The dialog
explains that the report contains only the app version, device connection
state, Accessibility and Screen Recording status, and the latest allowlisted
connection error code.

The report never includes the server URL, account or device identifiers,
names, hardware identifiers, paths, messages or task content, runtime output,
screenshots, keystrokes, tokens, credentials, timestamps, crash reports or raw
logs. Exporting makes no network request, starts no device connection, does not
request a macOS permission, and does not open Settings or a permission guide.
An unpaired, unpackaged or older build still exports an honest report with
`development` when the bundle has no valid version and `notPackaged`/`unknown`
permission states when no packaged permission check is available.

Cancelling the dialog writes nothing and shows no failure. On success the app
writes a private `0600` sibling temporary file, closes it, then atomically
renames it to the dialog-chosen path. An existing file is not truncated before
that rename, and a final symlink is replaced rather than followed. On an I/O or
rename failure the temporary file is removed, any existing target is left
intact, and a localized bounded failure is shown without the path or raw error.
A second menu selection while an export is in progress does not open another
save panel.

**View Crash Reports…**, next to the export action, opens macOS Console. Select
**Crash Reports** in its sidebar to look for reports about LinkSense. macOS
creates and retains those reports. LinkSense does not read or send them. Review
any report for sensitive information before sharing it. The separate opt-in
crash reporter is not implemented; it needs a reporting service and an agreed
privacy policy.

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
or content, and one quiet notice when a signed LinkSense update is available.
The update notice contains only the app name and a localized availability
message (optionally the verified version), never release notes, routes, server
or account details. Clicking a task notification opens the task only on the
matching server and account, with the same unsaved-change prompt as in-app
navigation. Clicking an update notice opens only the update section in
**Settings → General**; it never installs or restarts the app.

**Approval reminders** are a separate default-off sub-switch on supported Mac
builds. The choice is stored for the same server and account as the master
switch; turning the master off pauses reminders without clearing the choice.
While LinkSense is in the background, a live local command or file approval
head can produce one generic “A task is waiting for your approval.” notice.
It carries no command, path, task title, server, or account detail, and the app
never shows it while the main window is visible and focused. Clicking only
reopens the conversation after an exact conversation/request recheck against
the signed-in server; a resolved, expired, foreign, or unavailable request does
nothing beyond normal app activation and the click never answers the approval.

The approval snapshot route (`GET /conversations/desktop-approval-notifications`)
is additive. Deploy the API and its shared schema before enabling the client so
the opt-in works on first use. A client running against an older API receives a
missing-route response, stops asking for that login, and keeps completion and
update notifications unchanged; shipping the client first is therefore safe.
The native host also requires packaged macOS notification support and its own
current account lease. Tests use fixture delivery and a synthetic WKWebView;
they never send a real OS notification, touch TCC, use a real account, or
answer an approval.

### Window chrome

The macOS main window is fixed at the standard 100% page scale. Window
resizing, maximize/restore, minimize and full screen remain available, as do
system accessibility features. MyGo restores the main window's position and
size on the next launch. The app installs no page-zoom menu commands or
keyboard bindings and keeps MyGo's defaults (`ZoomFactor` 1, pinch zoom off).
The localized native View menu keeps Reload, Force Reload, Toggle Developer
Tools and Toggle Full Screen, and the Window menu keeps native minimize and
maximize/restore. The View menu also adds native Back and Forward
(`Command+[` / `Command+]`); they use the current main window's history and
keep the existing unsaved Settings guard.

The native red/yellow/green controls keep extra padding and share a vertical
centerline with the workspace L icon at normal sidebar widths. The layout
reserves the reported native CSS safe inset; a narrow sidebar wraps the brand
and its bell, search and collapse actions below the controls, and full screen
removes the extra lane. The Mac workspace, including its mobile drawer, shows
the L icon, while Settings and authentication keep their existing branding.
The ordinary Web and Windows layouts keep their existing behavior.

To enable **Check for updates**, supply the update directories and the
base64 Ed25519 public key at build time. Signed artifacts are a macOS build
feature; Windows keeps the legacy `LINKSENSE_DESKTOP_UPDATE_FEED` contract
below. Stable and beta are separate HTTPS directories:

| Variable | Purpose |
| --- | --- |
| `LINKSENSE_DESKTOP_UPDATE_URL` | macOS stable asset directory, e.g. `https://downloads.example.com/linksense/stable`. Enables signed artifacts and installation. |
| `LINKSENSE_DESKTOP_UPDATE_BETA_URL` | macOS beta asset directory. Additive: it requires `LINKSENSE_DESKTOP_UPDATE_URL` and is required for prerelease candidates. |
| `LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY` | Base64 Ed25519 public key embedded in the app. Required with any update source. |
| `LINKSENSE_DESKTOP_VERSION` | Optional strict SemVer version for this candidate, at most 40 characters (the `desktop_devices.app_version` column and its registration schema). It changes the bundle, artifact and manifest version. Never reuse or lower a published version; MyGo only offers a version newer than the running one. |
| `LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL` | Fixed HTTPS installer/support page, macOS only. Required for signed `--macos-release` builds; optional for development test builds. Requires `LINKSENSE_DESKTOP_UPDATE_URL`; not used for legacy check-only builds. |
| `LINKSENSE_DESKTOP_UPDATE_FEED` | Legacy full manifest URL. It remains update-check-only, including old GitHub/CDN URLs that redirect, and uses only the old `MYGO_LDFLAGS` injection. |

The checked-in default is `apps/desktop/version.mjs`; bump it with the
release. A stable version (`1.2.0`) builds for
`LINKSENSE_DESKTOP_UPDATE_URL`; a prerelease version (`1.2.0-beta.1`)
requires both directories and builds for
`LINKSENSE_DESKTOP_UPDATE_BETA_URL`. A prerelease version without any update
source is still a valid local build. The build refuses equal stable and beta
directories, a beta directory without a stable directory, a legacy feed
combined with a signed directory, URLs with credentials, queries or
fragments, and signed-update settings on a Windows target. URLs sent to the
linker are bounded and reject whitespace, quotes and control characters.

Only explicit URL-directory builds link `main.desktopUpdateFeed` (stable),
`main.desktopUpdateBetaFeed` (beta, when present) and
`main.desktopUpdateManifestKey` (the same base64 Ed25519 public key already
pinned for MyGo). Legacy builds keep the feed solely in MyGo's
`packageUpdateFeed`/`packageUpdateKey`; they do not receive the new native
variables. MyGo's own embedded `packageUpdateFeed` is the
artifact's channel directory (beta for a prerelease), so the native stable
default must come from `main.desktopUpdateFeed`, not from the embedded feed.

A signed `--macos-release` build with `LINKSENSE_DESKTOP_UPDATE_URL` must also
set `LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL`. The build refuses otherwise
instead of shipping a release whose read-only installations have no manual
fallback. Development/test builds may omit it; no URL is defaulted or
inferred.

Give MyGo the signing key through `MYGO_UPDATER_PRIVATE_KEY` or through
`LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE` (an absolute path or `~/...`).
The build moves a key supplied in the environment into a private `0600`
temporary file, removes it from every child environment, and passes MyGo only
the path. Never put the key in the repository, a Vite variable, a log line or
a command argument.

With update directories and a signing key, MyGo's official `updates`
configuration writes `linksense-desktop-<version>-<target>.tar.gz`, delta
updates and the raw `update-<target>.json`, signing the archives and deltas
with the key. The build verifies the signed app and notarization first, then
checks the exact archive, delta and previous-archive names, manifest URL,
size, Ed25519 signatures and the `<out>/SHA256SUMS` line. It also reads the
single `Info.plist` member from the archive and requires it to be byte-equal
to the verified app bundle's plist and to carry the candidate version, so it
does not extract the whole bundle a second time. After those checks and the
packaged runtime smoke, the build writes one final
`update-<target>.json.signed` envelope next to the raw manifest:

- the message is exactly `LinkSense desktop update manifest v1\n`, the
  configured raw manifest URL from `main.desktopUpdateFeed` (or
  `main.desktopUpdateBetaFeed` for a beta candidate), `\n`, and the exact raw
  MyGo JSON bytes;
- it is signed with the same pinned Ed25519 key as standard Ed25519 over
  those bytes (no prehash), using Node's `crypto` JWK import of MyGo's
  existing base64 64-byte private key; the derived public key must equal
  `LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY`;
- the file is canonical base64 of the 64-byte signature, one LF, then the
  unchanged raw JSON bytes, written to a temporary file and atomically renamed
  so a client never reads a partial envelope.

The raw manifest stays unchanged and published for MyGo's future CLI delta
builds; the `.signed` envelope authenticates the version/archive association
that the stock SDK's archive and delta signatures do not. The app fetches
`<feed>.signed` and never falls back to an unsigned manifest on the signed
path; legacy check-only builds keep their old feed and never use the
envelope. A `--macos-release` build with a stable update directory but
without a signing key or HTTPS installer URL fails instead of producing a
release that cannot update or has no manual fallback, and signing refuses to
run unless the packaged runtime smoke ran on the target platform. Release
notes come from an `apps/desktop/CHANGELOG.md` section for the version when
that file exists; without the file the manifest notes are empty.

Writable signed builds install in place. A read-only signed build cannot
check for or install a newer version: mygo's `Enabled()` is false. When the
build configured `LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL`, the app shows that
fixed page without a version; a signed release must configure it. Legacy
check-only builds
can check only when mygo's writable-location check passes and have no
installation path; move an existing check-only installation once with a
verified DMG, after which the signed updater and installer fallback apply.

Existing installations from the check-only build path only check and do not
carry an installer URL. Replace them once with a verified DMG from the
download page. After that one-time bridge, later releases use the signed
updater; the old build cannot gain installation or a fallback retroactively.

### Releasing a verified candidate

No live update destination is selected or activated by this repository. The
stable and beta directories are approved release inputs; use placeholders
until an approved HTTPS origin exists. The release operator needs a Developer
ID Application certificate, the `linksense-desktop-notary` Keychain profile,
the approved directories, the update public key, the fixed HTTPS
installer/support URL and a signing key in a secret store or a `0600` file.

1. Choose the version and channel. Set `LINKSENSE_DESKTOP_VERSION` to a
   strict SemVer version; a prerelease identifier (`-beta.1`) selects beta
   and requires both directories. Never reuse or lower a published version.
   The build does not infer a predecessor; MyGo only offers a version newer
   than the running one.
2. Build and verify on an Apple silicon Mac with umask `022`:

   ```sh
   LINKSENSE_DESKTOP_VERSION=1.2.0 \
   LINKSENSE_DESKTOP_UPDATE_URL=https://downloads.example.com/linksense/stable \
   LINKSENSE_DESKTOP_UPDATE_BETA_URL=https://downloads.example.com/linksense/beta \
   LINKSENSE_DESKTOP_UPDATE_PUBLIC_KEY='<base64 Ed25519 public key>' \
   LINKSENSE_DESKTOP_UPDATE_PRIVATE_KEY_FILE="$HOME/.config/linksense/mygo-update.key" \
   LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL=https://linksense.example.com/download \
   LINKSENSE_DESKTOP_MACOS_SIGNING_IDENTITY='Developer ID Application: Organization (TEAMID)' \
     pnpm desktop:build -- --macos-release --platform darwin/arm64 --server-url https://linksense.example.com
   ```

   `MYGO_UPDATER_PRIVATE_KEY` is accepted instead of the file variable. The
   command must not include `-upload`, `-skip-dmg`, or `-skip-notarize`.
   MyGo performs app notarization inside its DMG step, so skipping the DMG
   also skips notarization of the app that goes into the update archive.
3. Keep the verified stage as the only source of published bytes. It is
   `apps/desktop/build/macos-release-*/`: `SHA256SUMS` is at that root
   (`<out>/SHA256SUMS`, one level above the platform directory), and its
   `darwin-arm64/` directory contains the app, the DMG,
   `linksense-desktop-<version>-darwin-arm64.tar.gz`, its deltas,
   `update-darwin-arm64.json`, `update-darwin-arm64.json.signed` and
   `install.sh`.
4. Copy the exact update files into the approved staging root itself, flat:
   `linksense-desktop-<version>-darwin-arm64.tar.gz`, its deltas,
   `install.sh`, `SHA256SUMS`, `update-darwin-arm64.json` and
   `update-darwin-arm64.json.signed` at `${root}/`. Do not add the stage's
   `darwin-arm64/` level under the root; the manifest names
   `${root}/<archive>`. The DMG is for the download page and manual rollback,
   not for update checks. Do not rebuild for staging. Upload every archive,
   delta, script and `SHA256SUMS` first; verify the staged bytes, the archive
   signature recorded in the manifest and the `.signed` envelope against the
   pinned public key; upload the raw `update-darwin-arm64.json` next (the
   history manifest MyGo's future delta builds read); upload
   `update-darwin-arm64.json.signed` last. A client must
   never see an envelope or manifest whose files are missing or unverified.
5. Promote the same flat files to the production root in the same order:
   files and raw manifest first, `.signed` envelope last. Keep the current
   archive and every archive or delta named by a live manifest: with
   `deltas: 3`, retain the last three base versions and the deltas used by the
   current manifest. Never delete an archive that a served manifest or delta
   still references.

   Staging is a byte-audit and promotion queue, not a second update root.
   The manifest's `url` is absolute to the `LINKSENSE_DESKTOP_UPDATE_URL`
   (or beta URL) used at build time. Copying the manifest to another root and
   pointing an app there does not rewrite that URL; the app still fetches the
   archive from the build-time root. The audit inspects the exact bytes where
   they are and needs no second signing or build of the release. For an
   optional end-to-end update test against a test origin, use a separate
   fixture candidate built with that origin; never rewrite or re-sign the
   production manifest and archive.

6. Set `Cache-Control: no-cache` on the raw manifest, the `.signed` envelope,
   `SHA256SUMS` and `install.sh` if the origin is a CDN, matching what MyGo's
   own S3 uploader does. Do not redirect an update request to a different
   host.

Do not use `mygo build -upload` for this release. MyGo processes `-upload`
inside the same `mygo build` invocation, after compiling and packaging but
before LinkSense verifies the signed runtime, notarization tickets and
packaged runtime. With `updates.s3` it uploads files and then manifests
immediately, so an installed app can see a manifest before LinkSense's
post-build checks pass. With `updates.github` it uploads unverified bytes to a
draft release. The repository therefore configures only `updates.url`, no
`updates.github` or `updates.s3`; `-upload` is rejected by MyGo's own
pre-build check. There is no second uploader or supported upload command in
this archive; adding one needs a separate reviewed change. The staging and
promotion steps above are operational requirements for the approved release
tooling, not an automated pipeline here.

A legacy `LINKSENSE_DESKTOP_UPDATE_FEED` remains check-only exactly as in
previous releases, including old GitHub/CDN manifests that redirect.
Downloading/installing updates and the stricter stable/beta directories are
enabled only by an explicit `LINKSENSE_DESKTOP_UPDATE_URL` build.

Runtime restrictions:

- Production builds require HTTPS update URLs. Loopback HTTP is accepted
  only for the legacy `LINKSENSE_DESKTOP_UPDATE_FEED` in development, and
  `--macos-release` rejects it. The packaged server origin has the same
  restriction.
- The URL-directory source does not follow redirects; serve the directory
  directly over TLS. Legacy package feeds keep MyGo's check-only redirect
  behavior.
- Stable/beta directories, the installer URL and the private-key file setting
  are macOS-only. A Windows build keeps the legacy
  `LINKSENSE_DESKTOP_UPDATE_FEED` behavior unchanged.
- The public key is pinned at build time in MyGo's config and in
  `main.desktopUpdateManifestKey`. The app verifies the `.signed` envelope
  with that key before trusting the manifest version; unsigned, tampered and
  older versions are not installed, and `Updater.Check` only offers a version
  newer than the running one.
- Switching from stable to beta persists in the native app and selects the
  beta manifest. The first check after a switch may download the whole
  archive when the target channel has no delta from the running version.
  Switching back does not downgrade: the app stays on the prerelease until a
  newer stable release exists.
- Update URLs are compile-time values. Do not add a user-editable or
  remotely supplied update host, do not put credentials or tokens in any
  update URL (including the installer/support URL's query), keep the stable
  and beta directories distinct rather than aliases, and do not copy beta
  manifests or archives into the stable directory (or the reverse).

Rollback is manual. Keep the previous verified DMG for the same server
origin. Quit the app, replace `LinkSense.app` in Applications with the
previous bundle, and launch it. Verify Keychain sign-in, pairing, deep links
and a new local turn, and confirm API compatibility before rolling back.
Never roll back by publishing an older manifest: clients do not downgrade.

Real-Mac update fixtures are separate from Developer ID signing,
notarization and installed-upgrade acceptance:

1. Use a test key pair from `go tool mygo keygen` and a test HTTPS origin
   whose certificate the isolated Mac trusts. Build the fixture candidate
   with that origin as `LINKSENSE_DESKTOP_UPDATE_URL` (and beta URL), so its
   manifest names the test origin, plus a test HTTPS
   `LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL`. Never use the production private
   key or a live release root for fixtures. A legacy loopback HTTP feed may be used
   only for check-only development, not for signed artifacts.
2. Install the previous verified DMG on an isolated Apple silicon Mac and
   confirm the baseline: sign-in, local runtime and an update check.
3. Publish the candidate archive, deltas, raw manifest and then the
   `.signed` envelope to the test origin in the order above. Confirm the
   candidate is offered and the version is reported.
4. Exercise the delta path with the previous archive present, then remove or
   corrupt the delta file while keeping its manifest entry. The app must fall
   back to the whole archive, keep the current version on failure, and
   install the candidate after a successful download.
5. Switch stable to beta and back. Confirm the beta candidate is offered and
   switching back offers no older stable version. Confirm a read-only
   installation location still shows the fixed
   `LINKSENSE_DESKTOP_UPDATE_INSTALLER_URL` page, with no version claim and
   no attempted in-place install.
6. With a local turn running, choose Install: the app must return the
   retryable busy state and must not queue, wait for, or replay the install.
   Finish the turn or stop it explicitly, then choose Install again manually.
   Once admitted, the update stages, replaces the app on quit, and relaunch
   does not resume the old turn. Verify sign-in, Keychain, deep links and a
   new local turn after the update.
7. Repeat with the previous DMG as a manual rollback. Run Developer ID
   signing/notarization/staple acceptance and a clean-Mac installed upgrade
   as separate gates; an ad hoc fixture build does not satisfy them.
8. For the one-time bridge, start from an older check-only DMG: confirm it
   cannot install in place, replace it once with the verified signed DMG, then
   confirm subsequent checks use the signed directories and the installer
   fallback.

The native HTTP transport accepts only the packaged server's `/api/v1/` routes.
It preserves API authentication and authorization, streams SSE, propagates
cancellation, and does not follow redirects. Refresh credentials are stored
in the OS credential store, scoped to the packaged server. Access tokens are
kept only in memory in desktop mode; browser session storage is unchanged.

Builds embed the Web application's current build and bundle fixed Node.js
24.22.1, Codex 0.170.0, agent-desktop 1.3.1, and the runner's production
dependency closure. The release manifest pins upstream download SHA-256
checksums; the generated runtime manifest records executable hashes.
Preparation checks the bundled Node and Codex versions and native imports on
the build host; the pinned agent-desktop engine is verified by archive
checksum, exact file hashes and the Apple signature gate, and its GUI behavior
has a separate opt-in `desktop:whitebox:engine` smoke.
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

### Local packaging cleanup

Run packaging serially in a checkout: the frontend output and prepared
runtime directories are shared. Use isolated archives for concurrent builds.
Reuse one checksum-verified archive cache per checkout (`.data/desktop/downloads`)
and leave its directory layout in place during packaging. After successful
runtime preparation, `desktop:prepare` and `desktop:build` prune only direct
regular files named with exactly 64 lowercase hex digits that no platform in
`desktop-resources.json` still pins. Unknown entries, subdirectories, active
`.tmp` files and symlinks stay. If the cache or an ancestor redirects it away
from its expected location, pruning is skipped. A cleanup error warns without
failing preparation.

`apps/desktop/resources/<os>-<arch>/runtime` is the fixed input to packaging
and runtime tests. MyGo's `apps/desktop/build/<os>-<arch>/` holds the latest
local development output for that target, including the complete distributable
bundle with its own runtime. Keep only the latest local development output per
target and remove disposable acceptance-test outputs once nothing references
them. Do not remove files from inside bundles. Verified releases and rollback
artifacts follow the separate [release rules](#releasing-a-verified-candidate).

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
directories; an unsuccessful or ad hoc build leaves them alone. With a
stable update directory configured, the same verified stage also contains
the signed update archive, deltas and manifest described below.

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
The fixture uses a local synthetic provider. The [2026-11-21 P0-10
receipt](../../docs/development/linksense-desktop-dual-mode-task-breakdown-2026-11-16.md#10-实施记录2026-11-17)
in the task breakdown's implementation log records that after the test host was
killed, the prepared runtime's Shell and the recorded descendants in the
fixture supervisor process group were reclaimed with no replay or reconnect.
It does not cover force quit of the signed installed app, installed upgrades,
or production signing and notarization; those still require separate
acceptance.

For the joined Browser Use check on Apple silicon, run `pnpm desktop:prepare`, [build the extension](../../docs/development/browser-use.md#构建与部署), and have Playwright Chromium, `initdb`, `pg_ctl`, and `redis-server` installed. With workspace dependencies and the Prisma client ready, run from the repository root:

```sh
LINKSENSE_TEST_DESKTOP_BROWSER_EXTENSION=1 LINKSENSE_DESKTOP_RUNTIME_DIST="$PWD/apps/desktop/resources/darwin-arm64/runtime" pnpm test:desktop:postgres
```

It uses disposable PostgreSQL and Redis, a fresh Chromium profile, and simulated authentication and inference. Verify the flow in the signed, installed app separately.

On macOS, **Settings → General → This Mac** shows this Mac's native device
state and the account's paired devices. A signed-in account pairs this Mac by
naming it; the page requests a one-time pairing code and hands it to the native
host. Paired devices can be renamed or revoked there. Pairing and resume are
bound to the account proven by the native refresh; the list, rename and revoke
use the signed-in account's API session. A stored pairing alone is not reused
for another signed-in account, and losing the account hides the live device
state without deleting the still-valid Keychain credential. After the
system-browser sign-in and a verified refresh, the app resumes that account's
stored Keychain device credential. Ordinary sign-out clears the session and
disconnects this Mac while keeping its pairing. To remove the pairing, select
**Also revoke access for this Mac** when signing out; the app removes the
matching local credential after the server confirms the revoke.

New tasks default to the cloud. In **Settings → General → This Mac**, you can
set a **Default run location** for new tasks created from this Mac, even before
pairing. LinkSense remembers it on this Mac for the signed-in account and server.
The new task's **Run location** control overrides the default for that draft
only. It offers local as an override when the native host reports an online
device with `executionReady`, not for a presence-only connection. If the saved
default is local and the Mac is unavailable, the task retains that selection;
you can wait or explicitly switch to cloud.
Before a local task is created, the app re-reads the native status and requires
the same device and account. A failed, stale or changed check keeps the draft
and the selected target, reports the error, and does not create the task on the
cloud. A host that omits `executionReady` fails closed. Existing tasks keep the
target assigned by the backend and show it as a read-only badge. In the main
macOS window, a normal task also offers **Continue on the cloud computer** for
a local task and **Continue on this Mac** for a cloud task. The confirmation
says that a separate task is created on the other run location and that the
original task, its files and its artifacts stay as they are. Confirming does
not send a message, move the native thread, or copy files or attachments. The
app opens the empty destination with one removable source-task reference in
its local draft; send a message when you want the new task to read the
original text through the existing reference tool.

A cloud-to-Mac continuation needs this exact current Mac connection to report
`executionReady` and the separately negotiated `conversation_reference.read`
capability. An older desktop client can still run ordinary local tasks. To receive a
continuation it needs an update that adds this capability. A Mac-to-cloud continuation
can be created and run while this Mac is offline. An older API has no
continuation endpoint and the app reports that LinkSense must be updated; there
is no fallback to the current target. Before rollout, upgrade every API and
device gateway replica and use the Mac app with its matching bundled runner;
the existing cloud worker start body stays compatible. The bounded 15-second
reference read is not a side-chat quote. Existing route, authorization and
rollout rules apply, ordinary Web and default cloud behavior is unchanged, and
these additions include no database migration or dependency.

To check this path, run `pnpm test:desktop:postgres` with the prepared runtime
for the packaged Mac leg, `pnpm desktop:whitebox` for the native WKWebView
continuation and device-journey regressions, and
`pnpm --filter @linksense/shared build && pnpm --filter @linksense/api exec tsx test/integration/conversation-continuation-postgres.ts`
for the API and database semantics in disposable PostgreSQL and Redis.

On Mac, users can submit structured quotes directly in their own local side
chats in default mode using native Responses or Responses tool compatibility,
without cloud fallback. The Chat Completions bridge cannot start a quote or
continue a history containing one, even after the parent chat is deleted.
Older execution-capable clients still run ordinary local turns, and supported
existing history remains readable without backfill. An otherwise ready Mac
without negotiated quote support gets `DESKTOP_UPDATE_REQUIRED` before the API
records a start intent, reserves a turn slot, or dispatches the turn. Quotes
require no migration and do not change the execution switch above. Before
submitting quotes in development/test, upgrade all API and gateway replicas,
the maintenance and deployment task settlement tooling, and the Mac app with
its matching bundled runner, then reconnect the Mac. After quotes are written,
recover by deploying a compatible version forward; do not run older API or
settlement tooling or edit stored rows. If a deployment stop or device
revocation settles a quoted turn before it starts, you can restore the exact
question without the quote. Quoting again requires a fresh submission.

Mac tasks continue on the same Codex thread when the model is unchanged. When
the model changes, the source model compacts the existing context and Codex forks
the thread before starting the selected model. The fork must preserve the
post-compaction native turn IDs in their original order. The Mac worker verifies
that preservation before starting the selected model. The API validates the
fork's exact native lineage and target-turn proof for projection but does not
itself inspect the ordered turns. A missing, reordered, or different fork
history fails before target submission.

Before a mixed-version upgrade or rollback, stop admitting model switches and
drain accepted Mac starts. For an upgrade, apply
`20261125070000_add_desktop_start_transition_source` before starting the updated
API, then upgrade all API, device gateway, and recovery/settlement replicas
before releasing the Mac app with its matching runner. Old Macs can still start
and resume ordinary turns; a model switch requires a client update before the
server reserves a turn slot or stages a transfer.

Before rolling back, keep the nullable column and the Mac's native journals and
event outbox. The older API already refused to project a fork onto a different
native thread. A legacy in-flight fork with missing durable source proof remains
unsettled. Preserve its original history and journal; do not delete, release,
replay, or backfill it. If the source model configuration was removed, restore
it when available or start a separate task while keeping the existing history.
An expired or revoked run bearer fails a new authorization check and cannot
authorize inference. The scoped run/source grant authorizes dispatch admission
at the check; it does not make that check and the physical send atomic. The
current exact device can read-only settle proven native history after bearer
expiry; that is not execution authority.
Stop still addresses the original turn: it cancels a pending start or interrupts
an active native turn, and does not submit a replacement.

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

### Local computer control (M1b)

M1b adds GUI control of one user-chosen macOS window to a running local turn.
It is macOS-only and development/test-only: the API refuses
`LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED` in production, and the M1b
`LINKSENSE_DESKTOP_COMPUTER_USE_ENABLED` switch requires local execution. The
product path requires the signed packaged app with the pinned `agent-desktop`
1.3.1 runtime; a host that cannot build that runtime reports
`computerReady: false` and never offers `computer.execute`. The driver is
constructed on demand only after the user selects a window, from the release
signer token and the fixed signed runtime layout; there is no prepared-hash or
ad hoc fallback.

This section records the intended stable behavior and safe operating limits.
The slice is a development/test Accessibility path that now includes the
reviewed `computer_wait` read-only increment; it is not M1b stage completion.
The 2026-11-22 product-chain baseline and the 2026-11-23 wait increment are
recorded under [Joined fixtures and receipts](#joined-fixtures-and-receipts)
and the [task breakdown's 2026-11-23
entry](../../docs/development/linksense-desktop-dual-mode-task-breakdown-2026-11-16.md#10-实施记录2026-11-17).
The joined chain used real Codex 0.170.0 with a synthetic local model fixture,
the real Go device WebSocket, disposable PostgreSQL/Redis and a synthetic
platform/executor. This development result is not P1-13b/P1-14b, mixed-version
GUI, signed/installed/TCC, Windows, provider or production acceptance, and it
does not accept P1-23 as a whole. It also does not replace the existing GUI
smoke commands or their prerequisites (`pnpm desktop:whitebox:engine` with the
prepared signed engine, and
`pnpm desktop:whitebox` with `LINKSENSE_DESKTOP_RUNTIME_DIST` for the workspace
case), which are unchanged.

The model sees `computer_status`, `computer_observe` and `computer_act`, plus
`computer_wait` only when both the `computer.execute` and additive
`computer.wait` markers were negotiated on the same live socket. Plan turns
expose status and observe only. Observe returns a bounded accessibility tree
for the host-picked window with an observation id and opaque refs. Act accepts
one `click` or `type` (UTF-8 text up to 8 KiB) on a ref from the latest
observation, with an 8-second default and 20-second maximum effect wait. The
model cannot pass an application, window, process, path, coordinate, key,
scroll, drag, launch or CLI argument.

#### Read-only wait

`computer_wait` evaluates only the fixed `actionable` predicate for the exact
opaque ref and observation id from the same latest Accessibility observation of
the selected window. It does not click, type, press keys, use coordinates,
capture the screen, take a new observation or repeat an action. The timeout
defaults to 8 seconds and is bounded to 20 seconds; the original command
deadline and selected grant also bound the wait. Valid results are `met` or
`timed_out` with a bounded `waited_ms`; a `timed_out` result is an observation,
so re-observe before another step. Stale or superseded refs, renewal, pause,
stop or expiry fail closed. A wait never renews or replaces the observation.

The wait uses the existing authorized `computer.execute` window; it adds no
native approval, no input and no replay. Before returning a successful reply,
the service rechecks the original authorization, the same selection and live
device connection, cancellation and deadline. It never automatically repeats a
wait or sends a duplicate success.

#### Positive status attestation

`computer_status` remains read-only and no-argument. Ordinary status uses the
existing observe authorization, so Plan, observe-only, paused and act-revoked
callers still receive diagnostics with `active_grant:false`. A positive
`active_grant` is informational only: it is never an input permit, and standing
grants and the one-shot `computer.act` approval are unchanged. It can be true
only when the exact selected generation is current, the original `computer.act`
authority for the same canonical scope, session, application and selection is
still valid on the API, and the native product gate proves the same exact grant
and open input boundary before and after its driver status read. A missing
proof, pause, renewal, expiry, revoke, cancellation or lost final write yields
diagnostics with the boolean cleared or a bounded failure, never `true`.

The additive status marker is API/native only; it is not a Runner tool, is not
implied by `computer.wait`, and is offered and echoed only on the exact socket
that negotiates `computer.execute`. Old API/new Mac and new API/old Mac keep the
legacy status exchange with `active_grant:false`. Reading status acquires no
holder, approval, input or replay. These tests use synthetic fixtures and make
no hardware, installed-driver, Accessibility/TCC or real-window claim.

#### Selecting one window

The **Computer Use** card appears only for a running local turn whose persisted
device is this Mac, after the live authenticated socket negotiated
`computer.execute` and the native host reports `computerReady`. A presence-only
connection, an older server, or an ineligible host shows no card and does not
request Accessibility.

**Select window…** first performs a read-only Accessibility check. The app does
not check TCC at login, startup, ordinary tasks, or general Settings. This slice
does not request Screen Recording because it never captures the screen. If
Accessibility is not granted, the card opens its permission dialog; only the
dialog's explicit action runs MyGo 0.10.0 `permissionflow` (System Settings plus
the draggable LinkSense panel), with a manual Settings fallback. Existing grants
do not prompt. A guide that ends without a grant reports a stable reason; it
never becomes a grant, restarts the app or replays a turn, and **Continue
without GUI** leaves the task in its non-GUI mode.

The native picker lists sanitized application and window labels from the signed
driver's inventory. Only windows whose owner reports Accessibility are
candidates, and LinkSense's own windows are excluded. Choose a row and confirm
with **Use This Window** (or Return); the window must still be focused. Escape,
Cancel or closing the picker cancels. The chosen window id, PID and process
instance stay in the LinkSense process; the page, model, events, audit and logs
never receive them. The device socket sends the picked bundle id and opaque
selection ids to the server for the task-scoped grant; it does not send the
window id, PID, process instance, title or path. The page receives only state
and expiry. The model cannot name the target.

One computer-control selection is allowed per Mac at a time. A second task gets
`DEVICE_BUSY` and must wait; it is not queued or preempted.

#### Five-minute grant, renewal, pause, resume and stop

A successful selection creates one five-minute authorization
(`localComputerSessionDurationMs`) for exactly the signed-in owner, this device,
conversation, running turn, runtime generation and picked bundle. The card shows
the remaining time. The authorization covers observe and act for that window and
is separate from the macOS Accessibility grant.

- **Renew for 5 minutes** is explicit and appears only while Active. It extends
  the exact live authorization by five minutes; it never opens the picker,
  changes the window, or revives an expired, paused or stopped selection, and it
  is refused while an action is admitted. Renewal clears the previous
  observation, so the next act must start from a fresh observe; actions queued
  before the renewal cannot use the extended authorization. If the
  acknowledged extension cannot be installed on the same window (a rebind
  refusal, a closed input boundary, or an act admitted after the busy check),
  the host closes the matching local authorization and reports unavailable
  instead of presenting the old grant as current.
- **Pause** closes GUI input immediately, invalidates observation refs, and
  waits for the exact in-flight action and the native quiesce to become terminal
  before the card shows Paused. It stops GUI control only; the turn keeps
  running. It does not extend the authorization, so a paused authorization can
  expire. If the acknowledgement or terminal cannot be proven, input stays
  closed while the card still shows Active; Resume requires a proven Paused
  state, and the pause is never repeated automatically.
- **Resume** is explicit, rebinds the same immutable window, and requires a live
  authorization. It clears the previous observation, so the next act must
  observe again; the window identity is rechecked then, and a changed window
  fails closed and asks for a new selection.
- **Stop** closes input immediately, invalidates refs, cancels an in-flight
  pause, resume or renewal wait, and, when the exact link is live, sends one
  stop and revokes this task's authorization. It does not cancel or replay the
  Codex turn. Stop is a native IPC action, not an API request: while the
  WebView or API is offline it still closes input and retires the local
  selection, without sending or replaying a server stop. An exact Stop for the
  selection the Mac still has installed (for a resume, its original paused id)
  is also the one control accepted while that selection's select, renewal,
  resume or pause is still settling; the API parks it until the earlier
  transition settles and suppresses a late positive select/renewal/resume/pause
  ack (a negative result for the superseded request may still be sent). A
  parked Stop never cancels or replays a pending Pause. Only a Pause that
  completed with its holder released and no retained pending input lets the
  Stop revoke the paused selection without another quiesce; after a failed
  Pause, the Stop uses the existing exact cleanup and quiesce proof before it
  reports Stopped. This parking is the API/development behavior; it adds no
  native GUI step, and a real Mac Stop press during an unacknowledged Pause
  remains separately unverified.
  A resume that commits a new selection leaves one receipt on that same
  socket, so a Stop that still names the resume's original paused id stops
  exactly the committed successor and its quiesce, and the reply names
  the requested id. That predecessor alias is exact: it holds only while the
  committed successor is still the current active selection with the
  committed session, control epoch, expiry and application on the same
  socket and scope. Once the client has paused or stopped the successor, or a
  renewal or selection change has replaced those values, a delayed
  predecessor Stop is refused and the Mac must stop the current selection id.
  An already-active resume writes nothing and creates no receipt, so a later
  selection, renewal, expiry, pause, stop or different socket is never
  associated with an arbitrary older id. The card does not report Stopped
  until the exact in-flight action is terminal
  and the driver is closed; if that proof misses the deadline, input stays
  closed, the selection remains non-open, and no new selection is admitted
  until the real terminal. Stop never queues a retry.

The emergency controls are **Pause Computer Control** (`Cmd+Shift+Esc`) and
**Stop Computer Control** (`Ctrl+Shift+Esc`) in the LinkSense app menu; the
menu-bar menu keeps both as clickable actions. Those chords are MyGo global
shortcuts only while a computer-control selection is installed and LinkSense is
in the background: Pause only while its input gate is still open, and Stop while
the exact selection is active or paused, including an in-flight pause, resume or
renewal. Neither chord is registered while a selection is idle, still unselected
in the picker, or retiring, nor when the signed driver cannot be built. When the
app becomes active or quits, LinkSense releases its global registrations; the
app-menu accelerators remain available. Focus and selection changes are applied
on the UI thread, so an older focus or selection change is not replayed. The
operating system's key delivery is outside LinkSense's control.
Each global chord is bound to the exact installed selection it was armed for,
including through a same-selection renewal. A resume keeps the old paused
selection current while it is in flight and installs a fresh selection id only
on a successful acknowledgement, so a Stop armed for that paused id can still
supersede the in-flight resume, while a press still queued for it after the new
id installs is inert. If the armed selection has already been stopped, expired
or replaced when the press reaches the controller, the chord does nothing: it
never falls back to the host's current picker or a newer selection, even one for
the same conversation and turn, and it sends no extra stop or cancel. The
app-menu and menu-bar items keep acting on the host's current selection without
page ids. Both paths close input immediately, run off the UI thread, and never
cancel or replay the Codex turn. If either registration fails, the other chord
and the menus remain available, and that chord is tried again only on a later
focus or selection change.

The opt-in Carbon registration check is
`TestNativeMacComputerEmergencyShortcutsBindAndReleaseNatively`. From
`apps/desktop`:

```sh
LINKSENSE_DESKTOP_WEB_DIST="$PWD/../web/dist" \
  go test -tags desktop_whitebox,desktop_shortcut_whitebox -count=1 \
  -run '^TestNativeMacComputerEmergencyShortcutsBindAndReleaseNatively$' .
```

`$PWD/../web/dist` is the standard compiled Web output. If it is absent, run
`pnpm desktop:build-web` from the repository root; an existing prepared build
may be selected by its absolute path instead. `-count=1` keeps a cached result
from standing in for the registration check.

It reserves the actual `Cmd+Shift+Esc` and `Ctrl+Shift+Esc` chords for the
run, so use an isolated Mac where no other application owns them; an existing
owner fails the baseline. It drives the selection, background, activation and
quit lifecycle directly on the main thread and proves native registration and
release; it sends no keystrokes or input events, opens no window and requests
no permission.

Physical key delivery needs a signed, installed smoke, which has not been run.
With LinkSense foreground, press the Pause and Stop app-menu key equivalents
and separately click the app-menu and menu-bar items; while another app owns
focus, press the actual background chords. Do not remap macOS shortcuts or
override a system or other application shortcut. Pause and Stop must affect
only the authorized selection, and the Codex turn must continue.

#### Late results, window changes and recovery

Each act is bound to the latest observation and the pinned window identity.
Before input, the engine rechecks the bundle id, window id, PID and process
instance; a mismatch returns `COMPUTER_TARGET_CHANGED`, clears refs and requires
a new selection. A stale observation or ref returns
`COMPUTER_STALE_OBSERVATION` or `COMPUTER_STALE_REF` and is never reused.

Only one action may be in flight. A duplicate transport command id is not
executed twice; a duplicate control id that is still open is dropped, and a
finished or overlapping control id is refused with
`RUNNER_OPERATION_UNCERTAIN`. The one exact Stop described above (the current
id while a select, renewal, resume or pause settles, or a resume's original
paused id while that resume settles or after it was acknowledged) is the only
exception. Results for a superseded connection,
runtime generation, session or selection are rejected.

Product observe and wait share one locked final delivery. A read result is
still only a candidate when the native read returns. After the metadata
attempt audit, the final delivery rechecks the original grant, selection epoch
and expiry, adopted holder, live runtime/device, cancellation and deadline;
only that exact identity may authorize one successful socket send. A Pause,
Stop, same-ID renewal or cancellation already applied on the server can
therefore withhold stale AX text. The read is never replayed, and this adds no
protocol, opt-in or act change.

A timed-out, disconnected or unparseable action can return
`RUNNER_OPERATION_UNCERTAIN`; it may already have happened. The model is told
not to repeat it and to observe again. `no_effect` is also not retried. The page
never automatically repeats select, renew, pause, resume or stop; after an
uncertain renewal, pause or stop it may perform one read-only status refresh.

- **Device revoke** closes the socket, invalidates the credential and clears the
  selection. Local input closes and the driver retires without retrying a server
  side effect. Reconnecting never resumes or replays the old selection; after
  pairing/sign-in and a live local turn, select the window again.
- **Disconnect or runtime-generation change** retires the selection on the Mac
  and does not revive it on the new socket. A reconnect starts from no
  selection.
- **Turn terminal or five-minute expiry** closes input and retires the
  selection; the terminal frame also causes the API to clean up the matching
  turn scope. A new selection is admitted only after the exact action is
  terminal and the driver is closed.
- **Window close or identity change** returns `COMPUTER_TARGET_CHANGED`; select
  the window again. This slice has no automatic re-selection or coordinate
  fallback.

Quitting or crashing the app leaves no resumable selection. The next launch
requires a new explicit selection.

#### What this slice does not include

The documented slice is `computer_status`, bounded `computer_observe` of the
chosen window, `computer_act` click/type on refs from the latest observation,
and the read-only `computer_wait` above. It still does not capture screenshots
(including any signed native AX/model screenshot fallback), click arbitrary
coordinates or canvas targets, press keys, scroll, drag, launch applications,
use the clipboard, wait on other predicates, or run on Windows. Other action
types and the signed native AX/model screenshot and coordinate fallbacks remain
unverified and out of scope for this increment. Signed Accessibility/TCC
behavior, Developer ID signing/notarization, an installed update or upgrade,
clean-Mac installed acceptance, Windows and any real provider remain separate
gates. Do not describe those capabilities as available or verified.

#### Audit and native Codex history

LinkSense audit is metadata-only: it records lifecycle-scoped computer-session
and grant action codes with resource ids and a strict allowlist (operation,
conversation/turn/device ids, request kind, click or type, duration, stable
reason code). It is not a transcript of typed or observed text, element values,
titles, paths, screenshots, clipboard content or native driver output. Each
status, observe or wait attempt writes its single attempt row with the exact
`computer_request=status`, `computer_request=observe` or
`computer_request=wait` and `delivery=unconfirmed`; that row is written before
final delivery, is not a published-success claim, and excludes observation ids,
refs, timeouts, AX contents, screenshots and other contents. The
`computer.control` frames carry opaque selection ids and the picked bundle id;
they do not carry the window id, PID, process instance, title or path. The
2026-11-22 product-chain receipt checked events and audit for a private native
marker, screenshot payloads, device tokens and provider keys, and checked Redis
for the marker, screenshot payloads and provider key; none appeared.

That boundary does not cover native Codex history, and LinkSense audit
redaction is therefore not an erasure promise. The bundled Codex 0.170.0
runs persistent local threads and retains its rollout under the app's private
runtime directory (`home/.codex`). The 14-day / 10 GiB workspace retention
removes only `home/workspace`: control state, `home/.codex`, managed files,
session markers and pending outboxes stay. Tests confirm native history
survives that prune and the next preparation, and this slice has no retention
or delete control for it. Quit, sign-out, device revoke, Stop and workspace
cleanup are not erasure of native history. Any future screenshot or richer
input support would sit under the same native Codex persistence boundary. Do
not tell users that Stop or sign-out erases native Codex history, including any
typed or observed text or images stored there.

#### Client and server negotiation, enable and disable

`computer.execute` is an additive tool operation. `computer.wait` is an
additive negotiation marker for the read-only wait kind, and the positive
status marker is a separate exact-socket offer/echo; neither is a second wire
operation or a Runner tool, and neither has a separate user-managed flag. A new
Mac offers them on the authenticated device socket only when its host can build
the signed packaged driver. The API accepts the wait kind only when
`LINKSENSE_DESKTOP_COMPUTER_USE_ENABLED` is on and this exact socket generation
offered `computer.execute` and `computer.wait` together, and sends exact status
attestation only when the status marker was echoed identically with
`computer.execute`. An immediate
pre-wait Mac or API still negotiates and supports `computer.execute`
(status/observe/act), but an old/new link does not negotiate the additive
markers; an older API ignores the unknown markers and an older Mac never offers
them. If either side lacks `computer.execute`, or the switch is
off, the new Mac sees no computer operation, reports `computerReady: false`,
hides the card and does not request Accessibility; existing users keep their
local and cloud modes, tools and approvals, and this is not an
update-required error. With both new, the card appears only after the live
socket reports `computerReady`, which also requires the runtime link and the
signed runtime layout. A presence-only socket fails closed.

For development/test, apply any required forward migrations and build the
shared package first; this slice adds no migration. Keep the computer-use
switch off while upgrading every serving API replica, every
task-recovery/maintenance consumer and the complete matching Go host/Runner
bundle. Then set both local-execution and computer-use variables uniformly;
reconnect the Mac so the new socket negotiates `computer.execute` and
`computer.wait`; confirm `computerReady`; then select a window. Do not claim
mixed-version operational acceptance or enable the switch on a mixed-version
fleet or with a partial bundle; a socket connected while the switch was off
does not gain the markers. Older command and Redis formats and existing
authentication and privacy are unchanged; the strict old Redis decode of
legacy producers is verified only by targeted fixtures.

To disable or roll back: stop starting new computer-control selections; pause or
stop active selections and let active turns and approvals settle; turn the
computer-use switch off uniformly; reconnect the Mac so the new socket omits
both `computer.execute` and `computer.wait`; keep the updated API replicas and
recovery consumers running until selections have expired or retired and cleanup
has drained; then roll back. Do not delete selection, quiesce or outbox records
by hand. A reconnect never resumes an old selection.

Production is intentionally not enabled. The API refuses local execution when
`NODE_ENV=production`, so the computer-use switch cannot be turned on there.
Enabling it would require the gates above plus an explicit privacy disclosure,
not just this documentation. Native Codex history has no retention or delete
control in this slice, so any typed or observed text or images Codex stored
there remain outside LinkSense audit redaction.

#### Joined fixtures and receipts

The older fixture-only joined harness remains:

```sh
CODEX_BIN=<pinned Codex 0.170.0> pnpm --filter @linksense/api exec tsx \
  ../../scripts/desktop-computer-use-joined.mts
```

It requires the pinned Codex binary, local `initdb`/`pg_ctl`, `redis-server`, a
built `@linksense/shared`, and loopback ports. It uses a synthetic Mac executor
and the fixture-only `computer.execute` lane; it does not exercise the product
picker, AX/TCC, the signed driver, or `computer.control`. This fixture-only
legacy observation still verifies run authorization after audit before
relaying a success. Run it only in an isolated development/test environment.

The separate product-chain development receipt is:

```sh
pnpm --filter @linksense/shared build
pnpm --filter @linksense/runner build
LINKSENSE_JOINED_RUNTIME=<staged-read-only-runtime> \
  pnpm --filter @linksense/api exec tsx test/integration/desktop-computer-product-chain.ts
```

It requires a local Mac with `initdb`/`pg_ctl` and `redis-server`, a built
shared package and runner, an absolute read-only `LINKSENSE_JOINED_RUNTIME`
staged runtime, loopback ports, and the pinned Go 1.27.3 toolchain installed
locally with its module cache populated (the test compiles the Go bridge with
`GOPROXY=off`).
It boots the real Fastify device socket, Go device bridge, supervised runner,
official Core MCP and Codex 0.170.0 against a local model fixture, with
disposable PostgreSQL/Redis and a synthetic platform/executor. It does not
touch a real driver, app, window, permission dialog, TCC, installed app, real
provider or secret.

The 2026-11-22 baseline product-chain receipt is
`m1b-cleanup-product-joined.log` (exit 0): 1 turn, 11 model requests,
6 approvals, 4 observes, 1 approved act, 4 failed acts and 2 renewals. Renewal
stayed blocked before and while Stop was pending, no stop reply was sent during
the pending renewal, the superseded renewal failed with `COMPUTER_CANCELED`,
Stop advanced the lease epoch, `driverTouched` was false, the private marker and
screenshot payloads stayed absent, and gateway/Redis/PostgreSQL/scratch cleanup
was clean. The measured expiry advance after Stop is fixture timing, so no
duration threshold is claimed.

The 2026-11-23 `computer_wait` development result uses that same product-chain
command. Its final joined build is `m1b-wait-owner-build-joined-final.log`
(exit 0): 1 turn, 13 model requests, 6 approvals and two waits (one `met`, one
`timed_out`), with clean teardown. The owner acceptance run is
`m1b-wait-owner-api-accepted.log`: API 396 files/5,567 tests passed, typecheck
and lint passed, API build passed; Shared 896, Runner 1,634 with one
pre-existing skip, and Go race from existing owner logs. The joined chain uses
the real Codex 0.170.0 protocol with a synthetic platform/executor and synthetic
local model fixture against disposable
PostgreSQL/Redis. None of these touch the signed native AX/TCC path, an
installed app, Windows, a real provider or production, and they are not
P1-13b/P1-14b, mixed-version GUI, or P1-23 whole acceptance.

The final 2026-11-23 observe-delivery receipt uses the accepted owner logs:
`owner-observe-final-api-test.log` (API 396 files, 5,567 tests passed),
`owner-observe-final-api-lint.log`, `owner-observe-api-typecheck.log` and
`owner-observe-api-build.log` all exited 0. The product chain
(`owner-observe-joined.log`, exit 0) used the fixed Codex 0.170.0, the real Go
bridge with a synthetic Mac platform, executor and local model, and disposable
PostgreSQL/Redis. The legacy `computer.execute` fixture chain
(`owner-observe-legacy-joined.log`) also exited 0. These receipted runs do not
cover Developer ID signing, TCC, the signed real driver, installed updates,
real providers, production or Windows, and they are not M1b completion.

The native app whitebox is a separate receipt: `titlebar-unlocked-full-suite.log`
(2026-11-22, exit 0) ran 295 top-level tests in 118.171s on an unlocked Mac. It
includes `TestNativeImmersiveTitleBarKeepsControlsAndTopAreaUsable` (6.06s),
which waits for MyGo's fullscreen completion events and recorded zero title-bar
insets in full screen. This is the native app/WKWebView whitebox, not the
synthetic product chain above, and it is not Developer ID
signing/notarization, TCC, real-provider or clean-Mac installed-upgrade
acceptance; those gates remain open.

The disposable authority fixture is separate:

```sh
pnpm test:desktop:computer:postgres
```

It uses disposable PostgreSQL/Redis and covers the real conversation lock,
terminal proof and cleanup, and final-ack suppression.

The reference implementation is `feat-computer-use` at
`7041e026032b948c5e4e3bae5c0a5b9d5148bdfb`. This module is implemented for the
current `feat` architecture; the companion application's Go files are not copied.
