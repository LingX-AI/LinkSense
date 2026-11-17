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
pnpm desktop:dev
pnpm desktop:test
pnpm desktop:whitebox
pnpm desktop:build
pnpm desktop:build -- --platform windows/amd64
```

The first launch asks for a LinkSense server origin. Only HTTPS is accepted,
with HTTP allowed for loopback development servers. The optional
`LINKSENSE_DESKTOP_SERVER_URL` environment variable selects a server for an
isolated development run; it is not written to the saved configuration.

The native HTTP transport accepts only the selected server's `/api/v1/` routes.
It preserves API authentication and authorization, streams SSE, propagates
cancellation, and does not follow redirects. Refresh credentials are stored
in the OS credential store, scoped to the selected server. Access tokens are
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

On the matching host platform, the completed package is checked again:
critical modules must resolve inside the package, and a separate smoke test
copies the runtime outside the repository, starts its pinned Codex and real
Core MCP, calls the rich-output catalog, completes a native turn against a
local model fixture, and checks process exit. No provider key is needed.
This verifies the packaged filesystem closure; clean-system installation
and device-specific behavior have separate acceptance gates.

The macOS ARM64 development build measured 174.6 MB for the DMG and 601.6 MB
for the expanded application. Node and Codex account for approximately
122.5 MB and 273.6 MB of the expanded files. The original size estimate
understated installed size; download size and installed size are tracked
separately for release review.

Production signing/notarization, the local runner supervisor, device execution
and the updater remain subject to their task acceptance gates. The native
WebView whitebox uses an in-memory credential store; actual OS credential-store
interaction is still a separate check.

The reference implementation is `feat-computer-use` at
`7041e026032b948c5e4e3bae5c0a5b9d5148bdfb`. This module is implemented for the
current `feat` architecture; the companion application's Go files are not copied.
