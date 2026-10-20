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

When an existing client can report an Engine API below 1.45, preflight stops
before downloading private clients or Compose. A client update cannot upgrade
the shared daemon. Diagnostics for CentOS Linux 7/8 point to Docker's maintained
OS requirements instead of suggesting unavailable `dnf` commands or the current
Docker convenience installer. This guidance does not introduce a distribution
whitelist; admission still depends on the actual Engine and kernel capabilities.

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
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_CPU_QUOTA_MODE=compatible sh install-full.sh
```

The mode is saved in `.env` and reused by repair, start, doctor, and upgrade.
Changing an installed mode requires an explicit upgrade invocation, for example
`sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_CPU_QUOTA_MODE=strict sh upgrade.sh` after downloading the
current root `upgrade.sh` bootstrap. It verifies the host, drains work, creates a
backup, and updates the runtime even for the same release. A target release
without `RESOURCE_HOST_ADAPTATION_FORMAT=1` cannot be used in compatible mode.

## Fresh resource profiles

Full installations require at least **10 GiB reported by Docker Engine**.
The installer warns when the aggregate upper-bound budget exceeds available
memory, including Linux `MemAvailable` for new installations, but allows Full
to continue without lowering individual container limits. This intentional
overcommit can exhaust memory during concurrent tasks or large-document processing;
the floor is not a peak-capacity guarantee. Docker Desktop allocations should
leave space above the exact byte threshold. Both `FULL_MIN_MEMORY_GIB` and
`RESOURCE_FULL_FRESH_MIN_MEMORY_GIB` record 10 for new releases. Older published
release manifests remain immutable and retain their own fresh-install floor.

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
| Aggregate upper-bound budget | 8192 | 7488 | 21504 (warning only above available memory) |

Fresh defaults allow one concurrent conversation, two app-server processes per
Worker, 60-second idle TTLs, and one job per Knowledge processing stage. CPU
allocations are capped to the detected core count. Explicit overrides are
preserved and validated. Node heaps cannot exceed 75% of a nonzero container
memory limit; this leaves room for native memory and child processes.
New Full installations also enforce Elasticsearch's 2048 MiB limit through
`LINKSENSE_ELASTICSEARCH_MEMORY_MB`, leaving space above its fixed 1024 MiB JVM
heap. Older installations without this setting remain unlimited.

Repair of a release without host-adaptation metadata keeps the runtime keys
compatible with that release's immutable repair and upgrade parsers. New resource
fields are written only for a target release declaring host-adaptation format 1.

Repair and upgrade preserve validated custom settings, credentials, volumes,
URLs, concurrency, and memory limits. They update release-owned images and
runtime identity. Missing resource fields in old installations keep their old
unlimited/default behavior (`0` memory limit and empty Node options); no new
fresh-install threshold is imposed on those installations. When every service memory
limit is absent or unlimited, repair and upgrade retain the published 8 GiB Core
or 10 GiB Full floor. Once explicit service limits are configured, admission sums
those limits (including Elasticsearch), one Worker, fixed Docling limits, and
headroom. Full reports insufficient aggregate capacity as a warning; Core retains
its aggregate admission check. Unlimited limits are unknown, so neither path guarantees peak-memory
capacity. Idle Workers, multiple users, document size and host
workload still require operational capacity planning. A running same-version
upgrade with no mode change returns without a backup or restart.

Explicit service limits can exceed the 10 GiB Full minimum. Plan capacity before
enabling them; Full repair and upgrade warn about overcommit while preserving
the configured limits. Invalid limits, oversized heaps, memory below the Engine
floor, and actual OOM/readiness failures remain blocking. Validation happens
before stopping services or running migrations, and the existing environment
and data remain intact on validation failure.

For the first upgrade of an installation created before host adaptation, use
the **current root bootstrap**, which loads the target release's installer.
An older installed management script carries its old configuration writer and
cannot retroactively gain the new preservation checks:

```sh
curl -fsSL -o upgrade.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_INSTALL_DIR=/opt/linksense sh upgrade.sh
```

Use the actual installation path and the existing compatible mode when needed.
This upgrades the existing instance and management tools; it does not require
recreating accounts, resources, or data volumes. Subsequent upgrades use the
updated installed tooling.

## Downloads and resumable installation

Script/resource downloads use HTTPS and redirect restrictions, connect and
transfer timeouts, and bounded transient retries. HTTP/2 transport failures can
fall back to HTTP/1.1. Authentication, certificate and integrity failures stop.
Digest-keyed cached resources are verified before reuse. Partial known-digest
files can resume, but must pass the final hash; rejected ranges restart cleanly.

Images are pinned by digest, reused when present, and pulled with three bounded
transient attempts per image within a 45-minute phase deadline. Docker commands
have deadlines, and readiness requests bypass shell proxies for loopback.

## Network and proxies

Configure the terminal download channel and Docker Engine image-pull channel
separately. A working `docker pull` does not establish that terminal curl works,
and a successful curl request does not establish that the Engine can pull images.

On macOS, shared installer and CLI helpers append the usual Docker Desktop
binary directories to the current process PATH, preserving any Docker CLI already
selected there. This includes `$HOME/.docker/bin`,
`/Applications/Docker.app/Contents/Resources/bin`, the corresponding user
Applications directory and `/usr/local/bin`. They do not edit shell startup files.
For manual Docker commands, if Desktop CLI integration failed, use:

```sh
export PATH="$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

Exported PATH is inherited by `curl | sh`; that child shell does not read `.zshrc`
again. macOS preflight checks the helper selected by Docker `credsStore` in
`${DOCKER_CONFIG:-$HOME/.docker}/config.json`. Missing per-registry helpers are
also reported when a pull fails. When `credHelpers` overrides are present, the
preflight defers helper selection to actual pulls, following Docker's precedence
instead of rejecting an unused global store. Keep credential configuration intact.

Find the proxy application’s actual listener; its DNS settings are not a proxy
port. HTTP and SOCKS ports may differ:

```sh
lsof -nP -iTCP -sTCP:LISTEN
# Use this only after enabling and verifying the application's HTTP port.
export http_proxy=http://127.0.0.1:10809
export https_proxy=http://127.0.0.1:10809
# With only a SOCKS5 listener, terminal curl can resolve DNS through the proxy:
# export ALL_PROXY=socks5h://127.0.0.1:10808
```

For Docker Desktop, configure **Settings → Resources → Proxies** separately.
[SOCKS5 support requires a Business subscription](https://docs.docker.com/desktop/settings-and-maintenance/settings/#proxies);
use the proxy application's HTTP listener when SOCKS5 support is unavailable.
`http.docker.internal:3128` in `docker info` is Desktop's internal forwarding
address, so test image pulls rather than comparing this value to the external
proxy. Desktop ignores daemon proxy settings in `daemon.json`. On Linux Engine,
follow the [daemon proxy guide](https://docs.docker.com/engine/daemon/proxy/).

If using a Docker Hub mirror, use an endpoint controlled or trusted by your
organization. Merge the `registry-mirrors` property into the existing Engine JSON
instead of replacing the file. For example, add this property while retaining
every existing property (the example address must be replaced):

```json
{
  "registry-mirrors": ["https://your-trusted-mirror.example"]
}
```

Mirrors can help Docker Hub pulls; they do not automatically accelerate GHCR
or GitHub downloads. The installer does not configure mirrors, restart Docker,
disable TLS checks, or print proxy credentials.

Download the bootstrap first, then execute it only after curl succeeds. This
also protects the first raw.githubusercontent.com download, which cannot be
retried by a script that has not started:

```sh
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 \
  -fsSL -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sh install-core.sh --check-network
# After reviewing the diagnostic results, run the installer:
# macOS:
sh install-core.sh
# Linux: keep the terminal proxy through elevation, without preserving all env:
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
# With installed management tools:
linksense doctor --network
```

Use `install-full.sh` for Full. Linux installers require root; macOS installers
must run under the Desktop user without sudo. Diagnostics require a release
containing these changes. The new bootstrap refuses diagnostic mode for older
downloaded installers instead of accidentally installing. Older installed CLIs
do not gain this mode until the management tools are upgraded.

Network diagnostics report each channel independently and exit nonzero if any
check fails. They GET the actual release manifest; the default GitHub release
source also checks the raw bootstrap, while custom sources do not require
GitHub connectivity. Before installation they pull the small `hello-world:latest`
diagnostic image only if release metadata cannot be validated; that fallback
does not turn a failed check into success. With valid metadata they verify its
checksum and pull the pinned BusyBox and API references, covering Docker Hub and
GHCR for the standard release. Installed tools use their configured references;
old states without those references use the verified release manifest. Pulls have a two-minute
deadline per image. No containers are executed and no installation state,
services, credentials or volumes are changed; pulled images remain cached.
This mode diagnoses download/pull connectivity, not deployed service health:
run plain `linksense doctor` for local health checks.

Linux `sudo` normally removes proxy variables. Updated management launchers and
CLI elevation preserve only `http_proxy`, `https_proxy`, `HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY`, `all_proxy`, `NO_PROXY`, and `no_proxy`, so network
diagnostics and downloads use the requested terminal proxy after elevation.
For manual install/repair/upgrade scripts, use the same `--preserve-env` list.
If host sudo policy forbids it, an administrator must configure the elevated
environment's proxy. Proxy values are not printed or persisted by this flow.

You do not need to change global `~/.curlrc`. Existing download retries and
HTTP/1.1 fallback remain, and rerunning the matching installer resumes trusted
pending state and verified resources. Preloaded digest-matching images are
reused, but this is not a complete offline installation mode: release metadata,
configuration, and Full tokenizer assets still need trusted sources.

## Storage and kernel settings

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
The release PostgreSQL image must also initialize a disposable database and
complete a SQL roundtrip under seccomp before persistent volumes are prepared
or an upgrade stops the existing services. The probe uses isolated temporary
storage, cleans up its container and anonymous volumes, and never reads the
installed database. An old runtime/libseccomp can incorrectly return `EPERM`
for newer syscalls even when the basic isolation probe passes; repair the host
runtime rather than disabling seccomp.
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

Each matrix run needs an isolated disposable Docker daemon. Core requires at
least 8 GiB allocated to Docker, and Full requires 10 GiB with aggregate capacity
warnings as described above. Native GitHub-hosted runners are used by default;
`LINKSENSE_INSTALLATION_RUNNER_AMD64` and `LINKSENSE_INSTALLATION_RUNNER_ARM64` are
optional label overrides for other disposable runners. A shared business server
is refused by the smoke harness. The expanded CI matrix
must pass before publishing; local unit tests do not certify that matrix.
