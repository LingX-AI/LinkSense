---
title: Install Core
description: Install published LinkSense Core Docker images on Linux or macOS.
---

# Install Core

Core provides task execution and organizational sharing. Choose [Full](./full.md) if you need built-in Knowledge parsing and retrieval.

## Check prerequisites

Check the [sizing guidance](./overview.md#plan-resources) and [Docker requirements](./operations.md#environment-and-network). The commands below are for fresh installations. For an existing deployment, run `linksense status` first and follow [repair and upgrades](./operations.md#repair-and-upgrades).

Run the script only after the download succeeds. Run the steps separately if you want to inspect the script before execution.

## Linux {#linux}

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

## macOS {#macos}

Start Docker Desktop and run as your current user, without `sudo`.

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sh install-core.sh
```

## Initialize

After startup the installer prints the actual address and a one-time credential. Follow [first-time setup](./first-setup.md) to create an administrator, configure a model, and verify your first task.
