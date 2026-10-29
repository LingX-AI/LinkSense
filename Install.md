# LinkSense Agent Installation Guide

This guide is for coding agents helping a user install and run LinkSense. Follow
the user's requested deployment target. Default to **Core with released Docker
images** for evaluation; use Full when document processing and Knowledge retrieval
are needed. Use source development only when the user asks to work on the code.

The workflow is inspired by [DeerFlow's agent setup guide](https://github.com/bytedance/deer-flow/blob/main/Install.md).
Commands, resource requirements, and verification below are specific to LinkSense.

## Operating rules

- Read an existing checkout's `AGENTS.md` and preserve its branch, changes, and
  configuration. Do not clone over an existing directory, switch/reset branches,
  prune Docker resources, delete volumes, or reset a database.
- Do not print or read secret-bearing `.env` files, stored initialization
  credentials, or provider keys. Check file existence and use the management tools.
  Configure model credentials through the administration UI.
- An installation request includes starting the selected application. Explain
  elevated Linux installation, image downloads, database initialization, and
  local development certificate trust before invoking the existing workflow.
  Follow the execution environment's authorization rules; if elevation or a
  system prompt cannot be completed, report the exact next command.
- Installers generate production secrets. Never deploy `.env.example` as public
  production configuration. Do not install/reconfigure Docker, system packages,
  proxies, or mirrors without the user's authorization for that change.
- Report observed results. A downloaded script, prepared dependency tree, or
  healthy API does not establish that a provider-backed tool task works.

## 1. Check the host and choose the path

Check OS/architecture, Docker CLI and `docker info`, local disk availability, and
the [deployment sizing table](README.md#deployment-sizing). On macOS, start
Docker Desktop and use the current account **without sudo**. Its VM must report
at least 8 GiB usable memory for Core or 24 GiB for a new Full installation;
leave overhead above those thresholds. A 16 GiB Mac should start with Core.

Linux x86_64/ARM64 and macOS Intel/Apple Silicon are supported. The released
installer requires a local Docker Unix socket, Engine API 1.45+, and Compose
2.24.4+ (private client/Compose adaptation is described in the host guide).
If Docker is absent, stopped, or inaccessible, report that prerequisite rather
than claiming installation succeeded. For unsupported hosts, report the limit.

Use the following decision table:

| User intent / detected state | Action |
| --- | --- |
| Evaluate or deploy, no existing installation | Released Core by default; Full if requested and adequately sized. No source clone needed. |
| Existing `/opt/linksense/install-state.env` (Linux), `~/.linksense/install-state.env` (macOS), or a user-specified installation | Run `linksense status` and `linksense doctor`; preserve it. Repair/upgrade only when requested. |
| Interrupted installation with `install.pending` | Rerun the same edition's installer at the same path; it validates pending state and reuses verified downloads/images. |
| Work on LinkSense source | Use the Docker development workflow in section 3. |

For an existing installation, use `linksense address` for its actual address.
Do not infer that the default port or path is still in use.

## 2. Released Docker images

Choose `install-core.sh` or `install-full.sh`, then download it to a temporary
directory. The example uses Core:

```sh
setup_dir=$(mktemp -d)
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 \
  -fsSL -o "$setup_dir/install-core.sh" \
  https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh
```

Execute the script only after curl succeeds. A bootstrap download failure must
be resolved before installation; an incomplete local file is not a valid installer.

Check both network channels with the downloaded script:

```sh
sh "$setup_dir/install-core.sh" --check-network
```

This also works with older releases such as v0.3.8. When the downloaded release
installer lacks diagnostics, the bootstrap downloads the shared diagnostic
helper from a fixed source revision and checks the selected release without
executing its installer. If a previously downloaded bootstrap rejects the flag with exit code
64, download the bootstrap from `main` again. Old self-contained release installers
remain unchanged; use the current bootstrap for this check. See the
[network guide](deploy/release/HOST-ADAPTATION.md#network-and-proxies) for manual checks.
Linux diagnostics can run without root when the account can access Docker.
Checks verify the release manifest checksum and pull its BusyBox and API images,
covering the actual external and application registries. If metadata validation
fails, the check remains failed and only a Docker Hub probe continues. They do not
start containers or create installation state. Image pulls may populate a sizeable
local cache. Terminal curl and Docker Engine
proxies are configured separately. Never infer one channel works from the other.

After prerequisites pass, execute the selected installer:

```sh
# Linux
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh "$setup_dir/install-core.sh"
# macOS: run this instead, without sudo
sh "$setup_dir/install-core.sh"
```

Run only the command for the current OS. For a custom install directory or port,
pass the documented `LINKSENSE_INSTALL_DIR` / `LINKSENSE_HTTP_PORT` explicitly
through `env` after `sudo` on Linux. Do not replace an existing deployment's values.
The Linux command preserves only named proxy variables; it does not preserve the
whole user environment. If sudo policy refuses this, report the blocker and have
the host administrator configure the elevated environment's proxy. Updated Linux
management launchers use the same proxy allowlist for diagnostics and upgrades.

The installer pulls pinned images, initializes the selected deployment, starts
services, runs readiness checks, and prints the real address and initialization
credential. Direct the user to that private output instead of copying the
credential into a public report. Verify `linksense status` and `linksense doctor`.
On macOS, add `$HOME/.local/bin` to the current PATH if necessary to locate
`linksense`. Remove only the temporary files this setup created when finished.

## 3. Docker source development

If a checkout is already open, use it. Otherwise clone
`https://github.com/LingX-AI/linksense.git` into a new directory and enter it.
Confirm `package.json`, `pnpm-lock.yaml`, `deploy/compose/docker-compose.dev.yml`, and `AGENTS.md`
exist; read the repository instructions before continuing.

Required host tools: Node.js 24+, pnpm 10.34.6, working Docker Engine/Compose,
rsync, and mkcert. Report missing tools; do not substitute npm/yarn or change the
project stack. Follow any checkout-specific Node path instructions.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:prepare
```

`pnpm dev:prepare` **starts services**, builds images and the help center,
initializes the development database, checks readiness, and warms runtime caches.
It may request system trust for mkcert's local CA. The launcher creates missing
development configuration from the repository examples and preserves existing
files. Do not manually overwrite `.env` or run a database reset.

The default Web addresses are `http://localhost:18172` and
`https://localhost:18173`; the launcher's output is authoritative. Use `pnpm dev`
to attach source watching/logs and `pnpm dev:stop` to stop the development stack.
This path is for development; production uses verified release images.

## 4. First use and completion report

The user creates the first administrator with the initialization credential and
configures at least one model channel in the administration UI. Link to the
[first task guide](apps/docs/docs/user-guide/getting-started/first-task.md).
Provider validation should cover a short chat and a task with tools; only run
provider-backed requests when authorized, as they can incur charges.

Return a concise report with:

1. Selected path/edition and the installation or checkout directory.
2. Checks actually completed, services started, and the observed access address.
3. Any blocker or remaining administrator/model configuration.
4. The exact next command (`linksense status`, `linksense logs runner`, or
   `pnpm dev`, depending on the achieved state).

If startup failed, say so and include a redacted error plus the smallest recovery
step. Leave model/tool compatibility unverified until those tasks actually pass.
