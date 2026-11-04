---
title: Operations, repair, and upgrades
description: Check the Docker host, manage an existing deployment, and handle upgrades safely.
---

# Operations, repair, and upgrades

## Environment and network

- Linux x86_64 / ARM64 and macOS Intel / Apple Silicon are supported. Use Linux containers in Docker Desktop on macOS; prefer Linux for a long-running shared deployment.
- Use a local Docker Engine with API v1.45+, Docker Compose v2.24.4+, and `curl`. Check the **Server** section of `docker version`. Some releases can adapt a private Docker client or Compose binary; the installer does not upgrade a shared Docker daemon.
- Check downloads and registry pulls separately. Shell proxy settings do not configure the Docker Engine proxy. Linux installation commands explicitly preserve only the listed proxy variables under `sudo`. See [host adaptation and network diagnostics](https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies).
- Default installation directories: `/opt/linksense` on Linux and `~/.linksense` on macOS. Configure an HTTPS reverse proxy and review [execution boundaries](./architecture.md#execution-boundaries) before opening access publicly.

## Concurrency and Workers

Fresh deployments default to one concurrent conversation and a 4 GiB per-user Worker memory limit. Before adjusting task concurrency in [system settings](/admin-guide/system-settings/), budget for active Workers, document processing, and other services. Existing deployments retain configured limits; adding hardware does not automatically increase concurrency.

## Custom port

Pass `LINKSENSE_HTTP_PORT` to the downloaded installer. This example uses Core; use `install-full.sh` for Full:

```bash
# Linux
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
# macOS
env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
```

## CLI management

| Action | Command |
| --- | --- |
| Status and address | `linksense status`, `linksense address` |
| Start, stop, or restart | `linksense start`, `linksense stop`, `linksense restart` |
| Change the port | `linksense port 19090` |
| Show the one-time initialization credential | `linksense credential` |
| Read logs | `linksense logs api`, `linksense logs runner` |
| Check health and network | `linksense doctor`, `linksense doctor --network` |
| Repair or upgrade | `linksense repair`, `linksense upgrade` |

Run `linksense` without arguments for the interactive menu. If the command is missing on macOS, add `$HOME/.local/bin` to `PATH`. Network checks can pull and cache images without starting services.

## Repair and upgrades

Repair uses the installed release. Upgrade drains running tasks and saves a database backup to `volume://linksense-backups/postgres/` before migration. Keep the backup location and maintain a separate off-host backup. A failure after migration starts does not automatically roll back the database; inspect logs and backups and follow the [host adaptation guide](https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md).

Do not run the other edition's installer against an existing deployment. If the management command is unavailable, use the repair entry point for your installed edition: [Core](https://github.com/LingX-AI/linksense/blob/main/repair-core.sh) or [Full](https://github.com/LingX-AI/linksense/blob/main/repair-full.sh). Follow the target release's notes for first-time upgrades from older installations.

## Virtual machines and Knowledge

Full on x86_64 requires Docker hosts to expose `x86-64-v2`. Check inside the VM that runs Elasticsearch and Docling, including any separate host for those services:

```bash
LC_ALL=C lscpu
grep -m1 '^flags' /proc/cpuinfo
```

Look for `cx16`, `lahf_lm`, `popcnt`, `ssse3`, `sse4_1`, `sse4_2`, and `pni` (or `sse3`). If flags are missing or a container reports `Fatal glibc error: CPU does not support x86-64-v2`, shut down the VM, select a compatible CPU mode (e.g. Proxmox `host` / `x86-64-v2-AES` or libvirt `host-passthrough`), then boot and check again. Adding vCPUs does not add instructions missing from the host.
