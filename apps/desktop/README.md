# LinkSense helper

Native MyGo + Go companion for Computer Use on the user's own macOS or Windows desktop.
The client invokes `agent-desktop@1.0.2` locally; it does not embed the website or
create a second agent loop.

## Local Use

Start the existing LinkSense development application with the repository's normal
workflow. From the repository root:

```sh
pnpm desktop:prepare
pnpm desktop:dev
pnpm desktop:doctor
```

In the web app open **Settings → General → Computer Use**, generate a pairing
code, then use **Open in desktop client** for an installed `.app`, or paste the
workspace URL/code into the running development client. Confirm pairing locally.
The single-use code expires after two minutes. On macOS, permission state refreshes
automatically and when the client regains focus. Screen Recording opens a floating
panel that can be dragged directly into System Settings. Windows needs no separate grant for apps
at the client's integrity level. System permission and device pairing do not approve tasks.

Workspace addresses support HTTP and HTTPS, including LAN addresses and domain
names. HTTP uses WS; HTTPS uses WSS. HTTP/WS does not encrypt pairing codes,
device credentials, screenshots, or commands in transit; use it only on a trusted
network. Pairing still requires explicit local confirmation and task consent.

Every new conversation/turn asks for local task consent. It expires after five
minutes; Plan grants read-only access. Pause blocks further input and clears refs.
Local resume requires a new approval. Delivered OS actions cannot be rolled back;
reconnection never replays an action.

Use the snapshot's `available_actions`: focus/type text fields and click controls
that advertise Click. A scoped key brings the exact selected window forward
before sending input. There is no arbitrary coordinate fallback for inaccessible
canvases. A successful `desktop:doctor` from a terminal does not grant macOS permissions
to the independently launched `.app`; grant that client in System Settings too.

## Build and Verify

```sh
pnpm desktop:test
pnpm desktop:build
```

MyGo and its CLI are pinned to `v0.7.4`; this module selects Go `1.27.3` without
changing global Go/Node/pnpm defaults. The prepare command verifies the pinned
macOS or Windows arm64/x64 archive digest and contents before extracting its executables.
No Node/Rust/WebView runtime is required in the installed client.
The build includes LinkSense's legal documents and the bundled native
dependencies' license texts under `Contents/Resources/legal/`.

The macOS build outputs a `.app`/DMG and `outputs/desktop/LinkSense-Desktop-macos.zip`.
The Windows build outputs `outputs/desktop/LinkSense-Desktop-windows.exe`. The local API
discovers both. Deployed APIs set `LINKSENSE_DESKTOP_CLIENT_ARCHIVE` and
`LINKSENSE_DESKTOP_CLIENT_ARCHIVE_WINDOWS` to absolute read-only mounted paths. A missing
artifact disables that platform's download. macOS builds use ad-hoc signing for local
testing, not Developer ID signing or notarization. Windows builds are unsigned until a
signing command or certificate is configured, so SmartScreen may warn. Linux is not enabled.

`desktop:test` runs Go tests with the race detector where supported (Windows
ARM64 runs the same tests without `-race`), including the real
Fastify/WebSocket pairing protocol against an isolated fixture and fake engine.
It does not read existing accounts or private user content. A separate opt-in test
runs the actual packaged engine through an isolated Fastify HTTP API and
authenticated WebSocket against disposable native windows:

```sh
cd apps/desktop
LINKSENSE_DESKTOP_NATIVE_WHITEBOX=1 \
LINKSENSE_DESKTOP_APP_BIN="/absolute/LinkSense helper.app/Contents/MacOS/LinkSense helper" \
LINKSENSE_AGENT_DESKTOP_BIN="/absolute/LinkSense helper.app/Contents/Resources/bin/agent-desktop" \
GOTOOLCHAIN=go1.27.3 go test -run TestInstalledEngineAgainstIsolatedNativeWindow -count=1
```

This test checks status without task consent, lists apps/windows, focuses its
input, clicks its test button, writes only its test field, sends a scoped key,
re-observes the effects, and captures that window. It compiles a disposable
AppKit scroll view using Xcode Command Line Tools, scrolls it semantically, and
re-observes its actual offset. It then verifies a fresh ref becomes unusable after
Stop and remote release blocks further actions. All actions share exactly one
local task grant. A non-clickable text field must fail without a physical fallback.
The full test requires both macOS Accessibility and Screen Recording permissions;
without opt-in it is reported as skipped. The AppKit fixture is test-only and is
not required by the installed client. These checks do not establish arbitrary
third-party app compatibility. `-preview` remains explicitly labelled UI-only mode.

See `docs/development/computer-use.md` for the protocol/debug workflow and
`docs/reviews/computer-use-whitebox-2026-11-07.md` for the latest local verification boundaries.
Native UI uses the current LinkSense Figma tokens, six languages, built-in MyGo
springs/poses/transitions and reduced motion. Brand SVGs are unchanged copies of
existing assets; Lucide's license is included. MyGo is MIT licensed.
