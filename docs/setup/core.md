# Install Core

[Back to README](../../README.md) · [Other edition](full.md) · [Operations](operations.md)

Core provides the AI workspace, Skills, Plugins, MCP, Applications, and organizational management. Start here to evaluate task execution, application sharing, and system connections. Choose Full when you need the complete built-in Knowledge parsing and retrieval stack.

## 1. Check prerequisites and resources

Check the [shared prerequisites](operations.md#requirements) first. The following are planning suggestions, not measured user-capacity guarantees, and exclude local models and GPUs.

[See README for Core evaluation and shared-server starting and recommended configurations](../../README.md#deployment-profiles-and-requirements).

Fresh installations default to one concurrent conversation. Each active user Worker has a default 4 GiB memory limit; size concurrency separately. A 16 GiB Mac should start with Core. Allocate at least 10–12 GB to Docker Desktop to meet the 8 GiB usable-memory check after VM overhead.

## 2. Install Core

Use released Docker images; no source clone or host Node.js / pnpm is required. Run only the command for your OS. Execute the script only after a successful download; to inspect it first, run the download and execution parts separately.

### Linux

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

### macOS

Start Docker Desktop, then run as the current user without `sudo`.

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sh install-core.sh
```

### Install with a coding agent

Alternatively, give this prompt to Codex, Claude Code, Cursor, or another coding agent to select this edition explicitly:

```text
Help me install and start LinkSense Core using released Docker images by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

## 3. Complete first-time setup

The installer starts services and prints the actual access address and initialization credential. Follow [After startup](../../README.md#after-startup) to create an administrator, configure models, and verify your first task.

For ports, logs, network diagnostics, repair, and upgrades, see [Installation and operations](operations.md). Inspect an existing installation before using its repair or upgrade workflow. Check the selected release’s supported migration path before switching editions; do not run the other edition’s installer over an existing installation.
