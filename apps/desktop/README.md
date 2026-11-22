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
The fixture uses a local synthetic provider. Separate acceptance is required
for orphaned Shell processes after a force quit, installed upgrades and
production signing/notarization.

On macOS, **Settings → General → This Mac** shows this Mac's native device
state and the account's paired devices. A signed-in account pairs this Mac by
naming it; the page requests a one-time pairing code and hands it to the native
host. Paired devices can be renamed or revoked there. Pairing and resume are
bound to the account proven by the native refresh; the list, rename and revoke
use the signed-in account's API session. A stored pairing alone is not reused
for another signed-in account, and losing the account hides the live device
state without deleting the still-valid Keychain credential. After the
system-browser sign-in and a verified refresh, the app resumes that account's
stored Keychain device credential once; an explicit sign-out still deletes it.

New tasks default to the cloud. In the main macOS window, a new task shows the
**Run location** control; local is selectable only when the native host reports
an online device with `executionReady`, not for a presence-only connection.
Before a local task is created, the app re-reads the native status and requires
the same device and account. A failed, stale or changed check keeps the draft
and the selected target, reports the error, and does not create the task on the
cloud. A host that omits `executionReady` fails closed. Existing tasks keep the
target assigned by the backend and show it as a read-only badge; changing an
existing task's target, including cross-target continuation, is not wired.
This UI adds no database migration or dependency and does not change the
execution switch above.

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
The slice is a development/test click-and-type Accessibility path, not M1b
stage completion. A development product-chain receipt passed on 2026-11-22
against real Codex 0.170.0 with a local model fixture, the real Go device
WebSocket, disposable PostgreSQL/Redis and a synthetic platform/executor; see
[Joined fixtures and receipts](#joined-fixtures-and-receipts) and the
[task breakdown's 2026-11-22 entry](../../docs/development/linksense-desktop-dual-mode-task-breakdown-2026-11-16.md#10-实施记录2026-11-17).
It is not P1-13b/P1-14b acceptance and does not replace the existing GUI smoke
commands or their prerequisites (`pnpm desktop:whitebox:engine` with the
prepared signed engine, and `pnpm desktop:whitebox` with
`LINKSENSE_DESKTOP_RUNTIME_DIST` for the workspace case), which are unchanged.

The model sees only `computer_status`, `computer_observe` and `computer_act`;
Plan turns expose status and observe only. Observe returns a bounded
accessibility tree for the host-picked window with an observation id and opaque
refs. Act accepts one `click` or `type` (UTF-8 text up to 8 KiB) on a ref from
the latest observation, with an 8-second default and 20-second maximum effect
wait. The model cannot pass an application, window, process, path, coordinate,
key, scroll, drag, launch or CLI argument.

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
  selection, without sending or replaying a server stop. An exact
  same-selection Stop is also the one control accepted while that selection's
  select or renewal is still settling; the API parks it until the earlier
  transition settles and suppresses a late positive select/renew ack (a
  negative result for the superseded request may still be sent). The card does
  not report Stopped until the exact in-flight action is terminal and the
  driver is closed; if that proof misses the deadline, input stays closed, the
  selection remains non-open, and no new selection is admitted until the real
  terminal. Stop never queues a retry.

The emergency control is **Pause Computer Control** (`Cmd+Shift+Esc`) in the
LinkSense app menu and menu-bar menu. `Cmd+Shift+Esc` is a MyGo global shortcut
only while a computer-control selection is active and LinkSense is in the
background. When the app becomes active or the selection ends, the global
binding is released, so the menu accelerator is the only path and one press
cannot fire twice. It acts on the host's current selection without page ids,
closes input immediately, runs off the UI thread, and never exposes native
detail. Without an active selection, or when the signed driver cannot be built,
only the app-local menu item remains.

#### Late results, window changes and recovery

Each act is bound to the latest observation and the pinned window identity.
Before input, the engine rechecks the bundle id, window id, PID and process
instance; a mismatch returns `COMPUTER_TARGET_CHANGED`, clears refs and requires
a new selection. A stale observation or ref returns
`COMPUTER_STALE_OBSERVATION` or `COMPUTER_STALE_REF` and is never reused.

Only one action may be in flight. A duplicate transport command id is not
executed twice; a duplicate control id that is still open is dropped, and a
finished or overlapping control id is refused with
`RUNNER_OPERATION_UNCERTAIN`. The exact same-selection Stop above is the only
exception. Results for a superseded connection, runtime generation, session or
selection are rejected.

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
chosen window, and `computer_act` click/type on refs from the latest
observation. It does not capture screenshots, click arbitrary coordinates or
canvas targets, wait for elements, press keys, scroll, drag, launch
applications, use the clipboard, or run on Windows. The planned wait, other
action types, and screenshot/model and coordinate fallbacks are not
implemented. Signed Accessibility/TCC behavior, Developer ID
signing/notarization, an installed update or upgrade, clean-Mac installed
acceptance, and any real provider remain separate gates. Do not describe those
capabilities as available or verified.

#### Audit and native Codex history

LinkSense audit is metadata-only: it records lifecycle-scoped computer-session
and grant action codes with resource ids and a strict allowlist (operation,
conversation/turn/device ids, click or type, duration, stable reason code). It
is not a transcript of typed or observed text, element values, titles, paths,
screenshots, clipboard content or native driver output. The `computer.control`
frames carry opaque selection ids and the picked bundle id; they do not carry
the window id, PID, process instance, title or path. The 2026-11-22
product-chain receipt checked events and audit for a private native marker,
screenshot payloads, device tokens and provider keys, and checked Redis for the
marker, screenshot payloads and provider key; none appeared.

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

`computer.execute` is an additive tool operation. A new Mac offers it on the
authenticated device socket only when its host can build the signed packaged
driver. The API includes it only when `LINKSENSE_DESKTOP_COMPUTER_USE_ENABLED`
is on and the offer is present. Negotiation is additive: with an older Mac the
API negotiates no computer operation, and existing users keep their local and
cloud modes, tools and approvals. With an older API, the new Mac sees no
computer operation, reports `computerReady: false`, hides the card and does not
request Accessibility; this is not an update-required error. With both new,
the card appears only after the live socket reports `computerReady`, which also
requires the runtime link and the signed runtime layout. A presence-only socket
fails closed.

For development/test, enable in this order: apply any forward migration; build
the shared package; upgrade every serving API replica and every
task-recovery/maintenance consumer; set
`LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED=true`; set
`LINKSENSE_DESKTOP_COMPUTER_USE_ENABLED=true` uniformly; reconnect the Mac so
the new socket negotiates `computer.execute`; confirm `computerReady`; then
select a window. Do not enable the switch on a mixed-version fleet or before the
Mac has the signed runtime.

To disable or roll back: stop starting new computer-control selections; pause or
stop active selections and let active turns and approvals settle; turn the
computer-use switch off uniformly; reconnect the Mac so the new socket omits
`computer.execute`; keep the updated API replicas and recovery consumers running
until selections have expired or retired and cleanup has drained; then roll
back. Do not delete selection, quiesce or outbox records by hand. A reconnect
never resumes an old selection.

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
picker, AX/TCC, the signed driver, or `computer.control`. Run it only in an
isolated development/test environment.

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

The latest development receipt is `m1b-cleanup-product-joined.log`
(2026-11-22, exit 0): 1 turn, 11 model requests, 6 approvals, 4 observes, 1
approved act, 4 failed acts and 2 renewals. Renewal stayed blocked before and
while Stop was pending, no stop reply was sent during the pending renewal, the
superseded renewal failed with `COMPUTER_CANCELED`, Stop advanced the lease
epoch, `driverTouched` was false, the private marker and screenshot payloads
stayed absent, and gateway/Redis/PostgreSQL/scratch cleanup was clean. The
measured expiry advance after Stop is fixture timing, so no duration threshold
is claimed.

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
