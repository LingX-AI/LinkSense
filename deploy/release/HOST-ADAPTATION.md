# Installer host adaptation

This describes the formal prebuilt-image installer. The source-build deployment
under `deploy/production` has its own workflow. These changes become available
in the next release containing this installer and its matching Runner images.

## Prerequisites and automatic adaptation

A working, local Linux Docker Engine with API 1.45+ is required. On macOS, start
Docker Desktop with Linux containers and enough VM memory. The installer does
not install, upgrade, restart, or reconfigure a shared Docker daemon.

Linux admission depends on architecture and actual Docker/kernel capabilities,
not a distribution whitelist. Deepin can pass when its capabilities meet the
selected policy. Missing memory or PID limits always block deployment.

If the Linux Docker client is missing or too old, the installer prepares a
private Docker 26.1.4 client. Missing/old Compose uses a private Compose 2.40.3.
Downloads have fixed SHA-256 values for each supported platform; only the client
is extracted from Docker's archive. System binaries, Docker contexts, registry
credentials, and existing containers are retained. macOS requires a functioning
Docker Desktop client; its Compose client can also be adapted privately.

After successful installation, private tools and hashes live in the protected
`<install-dir>/tools` directory. `linksense` reuses them. Untrusted ownership,
permissions, symlinks, or checksum failures stop execution. Release maintainers
must update these pins deliberately; static clients do not update themselves.

A fresh installation using the default port can choose another free port within
18081–18100. The printed address and persisted port are authoritative. Explicit
ports, explicit public origins, interrupted installations, repair, and upgrades
never silently move to another port.

## CPU policy

`LINKSENSE_CPU_QUOTA_MODE=strict` is the default, including old installations
without the field. It requires effective CPU quotas. Only an explicit
`compatible` selection removes CPU time quotas from task Workers and Full's
Docling containers. Memory, PID, read-only filesystem, capability restrictions,
and network isolation remain in force. CPUSet/shares are not substituted for
quotas. Compatibility mode is displayed whenever the instance is managed.

For a host with broken CPU quota support:

```sh
curl -fsSL -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh
sudo env LINKSENSE_CPU_QUOTA_MODE=compatible sh install-full.sh
```

The mode is saved in `.env` and reused by repair, start, doctor, and upgrade.
Changing an installed mode requires an explicit upgrade invocation, for example
`sudo env LINKSENSE_CPU_QUOTA_MODE=strict sh upgrade.sh` after downloading the
current root `upgrade.sh` bootstrap. It verifies the host, drains work, creates a
backup, and updates the runtime even for the same release. A target release
without `RESOURCE_HOST_ADAPTATION_FORMAT=1` cannot be used in compatible mode.

## Fresh resource profiles

New Full installations require at least **24 GiB reported by Docker Engine**.
For fresh Linux installations, the budget must also fit current `MemAvailable`.
Docker Desktop allocations should leave space above the exact byte threshold.
The manifest retains the legacy `FULL_MIN_MEMORY_GIB=10` for older upgrade
readers, and records the fresh-install floor separately as
`RESOURCE_FULL_FRESH_MIN_MEMORY_GIB=24`. The current installer enforces that
fresh floor before creating persistent state.

| Limit (MiB) | Core | Core with less than 8 GiB currently free | Full |
| --- | ---: | ---: | ---: |
| API / Node old-space heap | 1536 / 1024 | 1280 / 896 | 2048 / 1536 |
| Runner / Node old-space heap | 512 / 256 | 384 / 256 | 512 / 256 |
| PostgreSQL | 512 | 384 | 768 |
| Redis | 256 | 192 | 512 |
| MinIO | 512 | 384 | 512 |
| One task Worker | 4096 | 4096 | 4096 |
| Elasticsearch + Docling API + Docling Worker | — | — | 2048 + 2048 + 8192 |
| Host/control headroom | 768 | 768 | 768 |
| Admission budget | 8192 | 7488 | 21504 |

Fresh defaults allow one concurrent conversation, two app-server processes per
Worker, 60-second idle TTLs, and one job per Knowledge processing stage. CPU
allocations are capped to the detected core count. Explicit overrides are
preserved and validated. Node heaps cannot exceed 75% of a nonzero container
memory limit; this leaves room for native memory and child processes.
New Full installations also enforce Elasticsearch's 2048 MiB limit through
`LINKSENSE_ELASTICSEARCH_MEMORY_MB`, leaving space above its fixed 1024 MiB JVM
heap. Older installations without this setting remain unlimited.

Repair and upgrade preserve validated custom settings, credentials, volumes,
URLs, concurrency, and memory limits. They update release-owned images and
runtime identity. Missing resource fields in old installations keep their old
unlimited/default behavior (`0` memory limit and empty Node options); no new
24 GiB threshold is imposed on those installations. Their admission check sums
configured limits (including Elasticsearch), one Worker, fixed Docling limits,
and headroom. Missing
unlimited limits are unknown, so this is a minimum admission budget, not a
peak-memory guarantee. Idle Workers, multiple users, document size and host
workload still require operational capacity planning. A running same-version
upgrade with no mode change returns without a backup or restart.

For the first upgrade of an installation created before host adaptation, use
the **current root bootstrap**, which loads the target release's installer.
An older installed management script carries its old configuration writer and
cannot retroactively gain the new preservation checks:

```sh
curl -fsSL -o upgrade.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh
sudo env LINKSENSE_INSTALL_DIR=/opt/linksense sh upgrade.sh
```

Use the actual installation path and the existing compatible mode when needed.
This upgrades the existing instance and management tools; it does not require
recreating accounts, resources, or data volumes. Subsequent upgrades use the
updated installed tooling.

## Downloads, storage, and kernel settings

Script/resource downloads use HTTPS and redirect restrictions, connect and
transfer timeouts, and bounded transient retries. HTTP/2 transport failures can
fall back to HTTP/1.1. Authentication, certificate and integrity failures stop.
Digest-keyed cached resources are verified before reuse. Partial known-digest
files can resume, but must pass the final hash; rejected ranges restart cleanly.

Images are pinned by digest, reused when present, and pulled with three bounded
transient attempts per image within a 45-minute phase deadline. Docker commands
have deadlines, and readiness requests bypass shell proxies for loopback.

The shell download proxy and Docker daemon pull proxy are separate. Use your
controlled `HTTPS_PROXY`/`https_proxy` configuration for curl, and configure the
Docker daemon's proxy according to the [official guide](https://docs.docker.com/engine/daemon/proxy/).
The installer reports pull failures without restarting Docker or exposing proxy
credentials. It does not switch to an untrusted mirror or disable TLS checks.

Preflight checks free bytes and finite inodes on the actual Docker storage
filesystem (and containerd's standard storage when present), or inside the
Docker VM. With uncached images the staging reserves are 20 GiB/100,000 inodes
for Core and 60 GiB/200,000 for Full; with all images cached, 2 GiB/10,000.
These staging reserves are separate from the recommended operational SSD sizes.
Before stopping services for an upgrade, the installer checks PostgreSQL dump
and backup space using twice the current database size plus 256 MiB. It never
prunes images, deletes volumes, or removes unrelated data to create space.

Full requires `vm.max_map_count >= 262144`. On Linux, a lower value is raised and
persisted in the dedicated `/etc/sysctl.d/90-linksense.conf`; existing higher
values remain. An unmanaged file or symlink at that path is rejected. Docker VM
settings that cannot be safely changed are reported for host/VM administration.

## Completion and recovery

A real disposable container verifies effective cgroup v1/v2 memory/PID limits,
strict CPU quotas, read-only root, writable tmpfs and restricted privileges.
Runner startup retains its native task-Worker creation and Codex app-server
handshake. Readiness checks cover each edition, then observe **every service
replica** for 30 seconds and reject restarts, OOM or unhealthy/missing containers.
Full also runs its real OCR/document parsing probe with a 10-minute deadline.
Base deployment success does not verify provider-backed AI tasks; configure
models in administration before running those checks.

Install, repair, upgrade, start, stop, restart and port changes serialize through
an instance lock. Trusted stale locks can recover; live or untrusted locks stop
with a specific diagnostic. A process killed while changing lock metadata can
leave an incomplete lock requiring inspection rather than unsafe deletion.

On failure, the installer preserves the stage, trusted pending state, credentials
and data. Rerun the matching install/repair/upgrade after correcting the reported
cause. Before migration, existing upgrade restoration remains available; after
migration starts, the existing manual recovery boundary and validated database
backup remain. Host errors use stable `LS_HOST_*` codes and six translated
languages. Secrets and complete external error responses are excluded.

## Release verification

Publication gates Core/Full × amd64/arm64 × strict/compatible installations,
repair, repeated execution, and upgrades from frozen published assets. Upgrade
fixtures include custom existing resource settings and real persistent data;
checks compare original secrets, volume identity, settings and content.

Each matrix run needs an isolated disposable Docker daemon. Full needs a runner
with at least 24 GiB allocated to Docker and enough free memory/storage. Set
`LINKSENSE_INSTALLATION_RUNNER_AMD64` and `LINKSENSE_INSTALLATION_RUNNER_ARM64` to
suitable runner labels when the default hosted machines are insufficient. A
shared business server is refused by the smoke harness. The expanded CI matrix
must pass before publishing; local unit tests do not certify that matrix.
