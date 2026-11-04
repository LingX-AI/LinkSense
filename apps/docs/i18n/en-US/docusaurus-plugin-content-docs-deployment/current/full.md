---
title: Install Full
description: Install LinkSense Full with built-in Knowledge on Linux or macOS.
---

# Install Full

Full adds built-in Knowledge parsing, indexing, and retrieval to Core.

## Check prerequisites

Check the [Docker requirements](./operations.md#environment-and-network) and leave headroom for OCR, large documents, and concurrency using the [sizing guidance](./overview.md#plan-resources). An `x86_64` host or VM must expose `x86-64-v2` to Elasticsearch and Docling. This x86 requirement does not apply to native ARM64. See [host compatibility](./operations.md#virtual-machines-and-knowledge) for diagnostics.

Use a new deployment directory. Do not overwrite an existing Core or Full installation or run another edition's installer over it. Run the script only after the download succeeds; separate the steps if you want to inspect it first.

## Linux {#linux}

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-full.sh
```

## macOS {#macos}

Start Docker Desktop and run as your current user, without `sudo`.

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh &&
sh install-full.sh
```

## Initialize

Follow [first-time setup](./first-setup.md) to verify a basic task. Configure the required Knowledge models, then verify parsing, retrieval, and citations using a representative document.
