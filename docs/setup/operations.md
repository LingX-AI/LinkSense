# Installation and Operations Reference

[Back to README](../../README.md) · [Install Core](core.md) · [Install Full](full.md)

## Requirements

- Linux: x86_64 or ARM64 with the required Docker/kernel capabilities; macOS: Intel or Apple Silicon with Docker Desktop running Linux containers.
- Docker Engine API v1.45+, Docker Compose v2.24.4+, and `curl`; Docker must already be running.
- Release images support `linux/amd64` and `linux/arm64`; the default TCP port is `18081`.
- Prefer Linux for a persistent shared deployment; macOS is suitable for evaluation and development. This workflow does not provide native Windows installation steps.

Terminal downloads and Docker image pulls are separate network channels and need separate proxy configuration. Linux installation commands preserve only named proxy variables through `sudo`; if policy refuses this, ask the host administrator to configure the elevated environment's proxy. See the [network and proxy guide](../../deploy/release/HOST-ADAPTATION.md#network-and-proxies).

The installer checks the host, generates runtime secrets, and starts services. The default installation directory is `/opt/linksense` on Linux and `~/.linksense` on macOS. Local startup does not require a domain or HTTPS; public deployments should use an HTTPS reverse proxy and follow the [security guide](../../SECURITY.md).

Memory checks use memory actually available to Docker Engine. With Docker Desktop, this means VM memory; allow overhead, apply changes, and restart Docker Desktop. Budget separately for local models and GPUs. The selected release manifest determines the final requirements; older releases may use different thresholds. Do not bypass preflight by editing thresholds.

## Custom port

After downloading the script from the selected edition guide, pass the port when executing it. This example uses Core; use `install-full.sh` for Full:

```bash
# Linux
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
# macOS
env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
```

---

## Command-line management

| Action | Command |
| --- | --- |
| Check service status | `linksense status` |
| Start / stop / restart | `linksense start` / `linksense stop` / `linksense restart` |
| Show the access address | `linksense address` |
| Change the HTTP port | `linksense port 19090` |
| Show the initialization credential | `linksense credential` |
| View service logs | `linksense logs api` / `linksense logs runner` |
| Check deployed service health | `linksense doctor` |
| Check downloads and image pulls | `linksense doctor --network` |
| Repair the installed release | `linksense repair` |
| Upgrade the installation | `linksense upgrade` |

Run `linksense` without arguments to open the interactive control menu.

Updated Linux management tools request `sudo` when needed and preserve only proxy
variables. On macOS, add `$HOME/.local/bin` to `PATH` and run
commands without `sudo`.

Network diagnostics require a release containing the updated installer and CLI.
They pull BusyBox/API release images without starting containers; images remain cached.

---

## Repair and upgrade

Repair stays on the installed release. Upgrade detects Core/Full, waits for active work,
and stores a validated PostgreSQL backup under `volume://linksense-backups/postgres/`
before migration.

No data volume is deleted. A failure after migration begins does not trigger an automatic
database rollback; retain the printed backup location and rerun the upgrade after
reviewing diagnostics.

If the installed CLI is unavailable, download [repair-core.sh](../../repair-core.sh) or
[repair-full.sh](../../repair-full.sh), inspect it, and run it using the execution steps for your OS in the selected edition guide linked from [Quick Start](../../README.md#quick-start). For the first upgrade of an older
installation, follow [Installer host adaptation](../../deploy/release/HOST-ADAPTATION.md#fresh-resource-profiles).

---

## Virtual machine CPU requirements

Full's RAG Knowledge Base components (Elasticsearch and Docling) require the Docker Engine host or VM to expose at least `x86-64-v2` CPU features on `x86_64` / `amd64`. The current [Docling v1.36.0 upstream image](https://github.com/docling-project/docling-serve/blob/v1.36.0/Containerfile) uses CentOS Stream 9, which has an [x86-64-v2 baseline](https://blog.centos.org/2023/08/centos-isa-sig-performance-investigation/). Elasticsearch's CPU requirements depend on its version and base image. This x86 instruction-set requirement does not apply to native ARM64 deployments.

Generic virtual CPU modes can mask features supported by the physical host. CPU model, age, vCPU count, and `uname -m` alone do not establish compatibility. Run these checks **inside the Linux VM that actually runs Docker Engine**:

```bash
LC_ALL=C lscpu
grep -m1 '^flags' /proc/cpuinfo
```

In addition to the x86-64 baseline, CPU flags must include `cx16`, `lahf_lm`, `popcnt`, `ssse3`, `sse4_1`, `sse4_2`, and SSE3 (usually shown as `pni` on Linux, or `sse3`). Checking only `sse4_1` and `popcnt` does not establish full `x86-64-v2` support.

Release install, repair, and upgrade scripts automatically check the CPU flags visible to Docker for Full on `linux/amd64`. They report missing features and exit before changing runtime configuration, creating data volumes, or stopping existing services. The check uses the release manifest's digest-pinned BusyBox image, which may need to be pulled on first use. Its temporary container is read-only, has no network or data-volume mounts, and is automatically removed on exit.

This preflight ships with releases that include this change; scripts in older installation directories are not updated automatically. To get the check before the first upgrade, download and inspect [upgrade.sh](../../upgrade.sh) from the repository root after the updated release is published, then run it using the execution steps for your OS.

If required features are missing, or container logs report `Fatal glibc error: CPU does not support x86-64-v2`:

1. Shut down the VM cleanly and change its CPU mode in the virtualization platform. In Proxmox VE, select `host` or `x86-64-v2-AES` if supported by the physical host. With KVM/libvirt, use [`host-passthrough`](https://libvirt.org/formatdomain.html#cpu-model-and-topology). Avoid `kvm64` / `qemu64` modes that mask required features.
2. Power the VM back on and check the flags again inside the guest. Restarting containers alone does not apply virtual CPU changes. For migration between hosts, choose a CPU model supported by every destination host that also meets `x86-64-v2`.
3. Once the checks pass, rerun the original Full install command for a new installation; for an existing installation, follow [Repair and upgrade](#repair-and-upgrade), then check services using [Command-line management](#command-line-management).

If the physical CPU lacks the required features, use a compatible host. Adding vCPUs or memory cannot supply missing instructions.
