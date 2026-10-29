# Install Full

[Back to README](../../README.md) · [Other edition](core.md) · [Operations](operations.md)

Full adds document parsing, indexing, and Knowledge retrieval services to Core’s AI workspace, shared capabilities, and organizational management. Choose it when you need organizational Knowledge Bases, document retrieval, and source citations.

## 1. Check prerequisites and resources

Check the [shared prerequisites](operations.md#requirements) first. The following are planning suggestions, not measured user-capacity guarantees, and exclude local models and GPUs.

[See README for Full starting and recommended configurations](../../README.md#deployment-profiles-and-requirements).

10 GiB is the Docker Engine memory floor in the current source release configuration. This permits memory overcommit and does not guarantee peak capacity. OCR, large documents, and concurrent tasks need extra headroom. Full warns and continues when configured service memory limits exceed available memory. Repair and upgrade retain existing installation settings.

**x86_64 / amd64 VMs must expose `x86-64-v2` CPU features.** Check the actual Docker host using [Virtual machine CPU requirements](operations.md#virtual-machine-cpu-requirements) before installing. This x86 requirement does not apply to native ARM64.

## 2. Install Full

Use released Docker images; no source clone or host Node.js / pnpm is required. Run only the command for your OS. Execute the script only after a successful download; to inspect it first, run the download and execution parts separately.

### Linux

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh && sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-full.sh
```

### macOS

Start Docker Desktop, then run as the current user without `sudo`.

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh && sh install-full.sh
```

### Install with a coding agent

Alternatively, give this prompt to Codex, Claude Code, Cursor, or another coding agent to select this edition explicitly:

```text
Help me install and start LinkSense Full using released Docker images by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

## 3. Complete first-time setup

The installer starts services and prints the actual access address and initialization credential. Follow [After startup](../../README.md#after-startup) to create an administrator, configure models, and verify your first task.

For ports, logs, network diagnostics, repair, and upgrades, see [Installation and operations](operations.md). Inspect an existing installation before using its repair or upgrade workflow. Check the selected release’s supported migration path before switching editions; do not run the other edition’s installer over an existing installation.
