---
title: Choose an edition and install
description: Choose Core or Full and install LinkSense on Linux or macOS.
---

# Choose an edition and install

## Choose an edition

| Edition | Recommended resources | Intended use |
| --- | --- | --- |
| Core | 4+ vCPU, 8+ GiB memory, 60+ GiB SSD | AI tasks, models, and extensions |
| Full | 8+ vCPU, 16+ GiB memory, 120+ GiB SSD | Core plus document processing and knowledge-base retrieval |

Core requires at least 8 GiB memory and Full requires at least 16 GiB. Core excludes Elasticsearch, Docling, and the tokenizer. Choose Full when complete knowledge-base support is required.

## Before installation

- Use Ubuntu, Debian, Fedora, RHEL, Rocky Linux, AlmaLinux, or CentOS on x86_64 or ARM64. Intel Mac and Apple Silicon are supported with Docker Desktop.
- Install `curl` and start a local Linux Docker Engine. Docker API v1.45+ and Docker Compose v2.24.4+ are required.
- Keep TCP port `18081` free by default.
- Allow access to GitHub, GHCR, and upstream registries. Full also downloads tokenizer files.
- On macOS, allocate enough memory and disk to Docker Desktop first.

The installer does not enforce a disk-space or inode minimum. Deploy with the recommended SSD capacity and monitor free space. Available host storage does not guarantee adequate Docker Desktop virtual-disk capacity.

## Install on Linux

Core:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh
```

Full:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

To use a custom port, pass the environment variable to the installer. This example installs Full on `19090`:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh \
  | sudo env LINKSENSE_HTTP_PORT=19090 sh
```

## Install on macOS

Core:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh
```

Full:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

## Complete initialization

After installation:

- on Linux, open `http://<server-address>:18081`;
- on macOS, open `http://localhost:18081`;
- replace `18081` when a custom port was selected;
- use the one-time initialization credential printed in the terminal to create the first administrator, and never share it.

Linux stores deployment files under `/opt/linksense`; macOS uses `~/.linksense`. A domain and HTTPS are optional for local startup. Public deployments should place an HTTPS reverse proxy in front of LinkSense.

See [CLI administration and maintenance](./cli-and-maintenance.md) for ongoing operations.
