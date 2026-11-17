# LinkSense desktop

The desktop client embeds the existing `apps/web` application in a Go/mygo
window. It remains part of this repository, with no separate Web UI.

The implementation follows the [desktop plan](../../docs/research/linksense-desktop-dual-mode-plan-2026-11-16.md)
and [task breakdown](../../docs/development/linksense-desktop-dual-mode-task-breakdown-2026-11-16.md).
Phase 0 is in progress; the shell alone is not a completed local execution environment.

## Development

Use the repository's Node/pnpm versions and Go's automatic toolchain selection.
The Go module pins Go 1.27.3 and mygo 0.7.4. The frontend uses the matching
official `mygo-runtime` and `@mygo-plugins/fetch` packages.

```sh
pnpm desktop:generate
pnpm desktop:prepare
pnpm desktop:dev -- --server-url http://localhost:18173
pnpm desktop:test
pnpm desktop:whitebox
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

The native HTTP transport accepts only the packaged server's `/api/v1/` routes.
It preserves API authentication and authorization, streams SSE, propagates
cancellation, and does not follow redirects. Refresh credentials are stored
in the OS credential store, scoped to the packaged server. Access tokens are
kept only in memory in desktop mode; browser session storage is unchanged.

Builds embed the Web application's current build and bundle fixed Node.js
24.22.1, Codex 0.168.0, agent-desktop 1.3.1, and the runner's production
dependency closure. The release manifest pins upstream download SHA-256
checksums; the generated runtime manifest records executable hashes.
Preparation checks executable versions and native imports on the build host.
The runner uses pnpm's portable, hoisted deployment so mygo's resource copier
retains its complete dependency tree. Runtime license texts ship alongside
the repository and Go dependency notices.

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

The app supervises the bundled Node process over a private pipe. The macOS
process group and the Windows Job Object bound the child tree. Device
execution stays unavailable until the authorized device channel is wired.
Production signing/notarization, installed Windows runtime, device execution
and the updater remain subject to their task acceptance gates. The native
WebView whitebox uses an in-memory credential store; actual OS credential-store
interaction is still a separate check.

The reference implementation is `feat-computer-use` at
`7041e026032b948c5e4e3bae5c0a5b9d5148bdfb`. This module is implemented for the
current `feat` architecture; the companion application's Go files are not copied.
