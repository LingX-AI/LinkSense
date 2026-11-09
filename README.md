<p align="center">
  <img src="./apps/web/public/attribution/linksense-mark.svg" alt="LinkSense" width="180">
</p>

<h2 align="center">
  Open-source agentic work platform for organizations.<br>
  <sub>An enterprise-grade, open-source WorkBuddy alternative.</sub>
</h2>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://linksense.guygubaby.top/doc/"><img src="https://img.shields.io/badge/Website-LinkSense-2563EB?style=flat-square" alt="LinkSense documentation"></a>
  <a href="https://explore.linksense.org/"><img src="https://img.shields.io/badge/Live_Demo-Try_Now-16A34A?style=flat-square" alt="Live demo"></a>
  <a href="mailto:hello@linksense.org"><img src="https://img.shields.io/badge/Contact-Email-7C3AED?style=flat-square" alt="Contact the team"></a>
</p>

<p align="center">
  LinkSense is an open-source agentic work platform for organizations, deployed on your servers or private cloud.<br>
  Administrators deploy the platform; members have their own AI workspaces to run tasks and share Knowledge, Skills, Plugins, and Applications within their permissions.<br>
  The platform manages access and credentials centrally, so members can use authorized system connections without receiving the underlying credentials.<br>
  Each user's dedicated Worker provides user-level runtime isolation with configurable CPU and memory limits.
</p>

<p align="center">
  <a href="#why-use-linksense">Features</a> · <a href="#choose-a-deployment">Deployments</a> · <a href="#deployment-and-integration-services">Deployment services</a> · <a href="#quick-installation">Quick installation</a> · <a href="#development">Development</a><br>
  <a href="#security">Security</a> · <a href="#documentation">Documentation</a> · <a href="#community-and-support">Community and support</a> · <a href="#license">License</a>
</p>

## Why Use LinkSense

- **Agent execution and deliverables** — Powered by the open-source Codex runtime, agents research web sources, operate browsers, run code, analyze data, and process files in each user's Worker to produce documents, spreadsheets, presentations, and other results.
- **Reusable knowledge and expertise** — Knowledge libraries support document parsing, indexing, and retrieval. Skills and Plugins package working methods and tool integrations as installable resources with version maintenance, review, and publishing.
- **Ready-to-use applications** — Preconfigure instructions, models, and resources as online application services. Authorized members install a service and start their own tasks without configuring each resource. Chat and custom interfaces are supported; application packages create personal copies that may need credential and resource configuration.
- **Business system connections** — Connect documents and email through connectors, and integrate ERP, CRM, and other business systems through MCP as needed. Agents read data and perform operations within configured permissions.
- **Organizational access and governance** — Grant access to users and groups; manage members, model credentials, and allowances centrally, with usage reporting and operational audit records.
- **Self-hosting and model choice** — Run on your servers or private cloud, connect compatible hosted or local model services, and store task records, files, Knowledge indexes, and credentials on your infrastructure.
- **Messaging and scheduled tasks** — Start tasks through Web, WeChat, Feishu, WeCom, DingTalk, or Microsoft Teams, or schedule tasks to run automatically.

**From personal work to team-wide reuse.** See [Organizational capabilities and architecture](https://linksense.guygubaby.top/doc/deploy/architecture/) for the illustrated guide to sharing capabilities, building a finance application, and running tasks on your own infrastructure.

## Choose a deployment

LinkSense provides **Core** and **Full** deployment profiles in the same repository. They differ in whether they include built-in Knowledge services, not in whether they are free or paid.

| Profile | Includes | When to choose it |
| --- | --- | --- |
| **Core** | Complete agent workspace, Skills, Plugins, MCP, Application sharing, and organizational management | **Personal evaluation or organizations without built-in Knowledge needs:** browse the web, run code, analyze data, process files, and share Skills and Applications. |
| **Full** | Everything in Core, plus built-in Knowledge document parsing, indexing, and retrieval | **Organizations that need built-in Knowledge:** turn organizational documents into searchable, reusable knowledge libraries. |

### Start with Core for evaluation; choose Full when you need built-in Knowledge.

The complete Core and Full installation workflows are below, without a separate installation page.

LinkSense supports centralized organizational management, permission-based sharing, and work across multiple members. Administrators manage resource access for users and groups, models, credentials, and allowances, and review usage and audit records. Members across departments work in their own AI workspaces and share reviewed Skills, Applications, and Knowledge within their permissions.

**For organizational Full deployments, start planning with 16 vCPU, 32 GiB memory, and 200 GiB free SSD**, preferably on Linux with Docker. This is a planning reference for external model APIs, not a fixed user or concurrency limit.

Before a large rollout, test representative tasks and budget for **peak active users, concurrent tasks, document volume, and OCR workloads**. Hardware upgrades do not automatically increase task concurrency; see [Operations, repair, and upgrades](#9-operations-repair-and-upgrades) below. Plan separately for local models and GPUs.

Full deployments on x86_64 hosts or VMs must expose `x86-64-v2`; this x86 requirement does not apply to native ARM64. See [Check the host](#2-check-the-host) below.

## Deployment and integration services

LinkSense supports self-hosting. For organizations that want implementation assistance, the LinkSense team provides **private deployment and business system integration services**. Our forward-deployed engineers (FDEs) can work with your IT and business teams to clarify requirements, connect existing systems, configure access, and validate representative workflows.

**Need deployment or integration assistance?** Email [hello@linksense.org](mailto:hello@linksense.org) with your environment, expected usage, and the systems you want to connect so we can discuss the implementation scope.

## Quick installation

**Supports Linux and macOS on x86_64 / ARM64. This workflow does not provide native Windows installation steps.**

This workflow keeps Core / Full selection, host checks, installation, first-time setup, and the first task on one page. The installer downloads released images and starts the services without a source checkout or local compilation.

### Option 1: Install with a coding agent

**The installation guide in this prompt defaults to Core.** Give Codex, Claude Code, Cursor, Windsurf, or another coding agent this prompt:

```text
Help me install and start LinkSense by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

The assistant checks the installation environment, preserves existing installations, and reports the actual launch result.

For Full, explicitly request `LinkSense Full`. The agent must report the observed address and health state; downloading the installer alone does not establish success.

### Option 2: Manual installation

#### 1. Choose an edition and confirm resources

| Scenario | CPU | Memory available to Docker | Free SSD |
| --- | --- | --- | --- |
| Core evaluation | 4 vCPU | 8 GiB | 60 GiB |
| Fresh Full installation | 8 vCPU | 10 GiB installer hard preflight; plan 24 GiB | 120 GiB |
| Full organization planning baseline | 16 vCPU | 32 GiB | 200 GiB |

These figures assume external model APIs and do not establish a fixed concurrency or user limit. Plan local model GPU, VRAM, and compute separately.

#### 2. Check the host

Linux uses Docker Engine and the Compose plugin; follow the [official Docker guide](https://docs.docker.com/get-docker/) to install and start them. On macOS, complete the steps below before checking the host.

##### Install and configure Docker Desktop on macOS

Docker Desktop provides the Docker Engine, command-line tools, and Compose together. You do not need to create containers manually; the LinkSense installer does that after these checks.

1. Open **Apple menu → About This Mac** to check the chip and installed memory. Download the matching **Apple silicon** or **Intel** edition from the [Docker Desktop for Mac installation page](https://docs.docker.com/desktop/setup/install/mac-install/).
2. Open the downloaded `Docker.dmg`, drag **Docker** into **Applications**, then open **Applications → Docker**. Complete the first-run prompts and wait until Docker Engine is running.
3. In Docker Desktop, select the gear icon to open **Settings → Resources → Advanced**. This is the **Advanced** section under **Resources**, not the separate top-level Advanced settings. Configure:

| Docker Desktop setting | What to enter |
| --- | --- |
| **CPU limit** / **CPUs** | At least **4** for Core or **8** for Full, if the Mac has enough CPU cores. |
| **Memory limit** | Start with **10–12 GB** for Core. For Full, plan **24 GB or more** and leave additional memory for macOS and other applications. A 16 GB Mac should start with Core; a 32 GB or larger Mac is a better starting point for Full. |
| **Disk usage limit** | Allow enough capacity for existing Docker data plus at least **60 GiB free** for Core or **120 GiB free** for Full. The Mac's storage must also have that free space. |

4. Select **Apply & Restart** and wait for Docker Engine to restart. Restarting Docker temporarily stops other running local containers, so save any work first.
5. Reopen Terminal if necessary and run the following check. Run LinkSense installation commands as your current macOS account, without `sudo`.

```bash
docker info --format '{{.NCPU}} {{.MemTotal}}' |
  awk '{printf "CPUs=%s\nDocker memory=%.2f GiB\n", $1, $2 / 1024 / 1024 / 1024}'
```

Example output for Core; the actual numbers depend on your Mac:

```text
CPUs=4
Docker memory=10.00 GiB
```

Core needs at least **8 GiB reported by Docker Engine**. Full must satisfy the selected release's preflight requirement; the current documented floor is **10 GiB**, while the recommended capacity above is higher. The value in Docker Desktop's slider is an allocation limit, not necessarily the memory reported by the Engine. Increase it and restart again if the check or installer reports insufficient memory.

**Disk usage limit is a maximum, not a free-space reading.** Include existing image and container usage when choosing it. Do not lower an existing disk limit just to match this guide, reset Docker, or delete volumes to pass a check; these actions can remove existing containers, images, and data. See [Docker Desktop resource settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/#advanced) for the controls.

##### Verify the host

After Docker is running, run:

```bash
uname -s
uname -m
docker version
docker compose version
docker info --format 'CPUs={{.NCPU}} MemoryBytes={{.MemTotal}} DockerRoot={{.DockerRootDir}}'
curl --version
df -h
```

Confirm that:

- The system is `Linux` or `Darwin`, and the architecture is `x86_64`, `aarch64`, or `arm64`.
- Docker reports a **Server** section with **API version ≥ 1.45**.
- Docker Compose is **≥ 2.24.4**.
- `curl` prints its version, and disk plus Docker VM resources meet the selected edition.

If `docker` is not found, reopen Terminal after Docker Desktop has finished its initial setup. If there is no Server section or the daemon cannot be reached, open Docker Desktop and wait for the Engine to start before retrying.

A Full x86_64 host must also run the commands below inside the Linux host or VM that will run Elasticsearch and Docling, not the macOS Terminal. On an Intel Mac, the installer checks the CPU features inside Docker Desktop's Linux VM:

```bash
LC_ALL=C lscpu
grep -m1 '^flags' /proc/cpuinfo
```

Confirm the flags include `cx16`, `lahf_lm`, `popcnt`, `ssse3`, `sse4_1`, `sse4_2`, and `pni` (or `sse3`). If they are missing, change the virtual CPU mode first.

#### 3. Download the installer and check networking

Set `edition` to `core` or `full`:

```bash
edition=core
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o "install-${edition}.sh" "https://raw.githubusercontent.com/LingX-AI/linksense/main/install-${edition}.sh" &&
sh "install-${edition}.sh" --check-network
```

The network check should exit with status `0` and no `[LS_HOST_*]` error. Terminal GitHub downloads and Docker Engine image pulls are separate network paths. The check may cache images, but it does not create an installation.

If pulls are blocked, see [registry mirror and Docker proxy configuration](deploy/release/HOST-ADAPTATION.md#registry-mirrors-for-release-images). Automatic mirror fallback requires a release that includes the updated installer.

#### 4. Install Core

Run only the block for your operating system. Each block downloads the installer before running it.

**Linux**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

**macOS**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sh install-core.sh
```

#### 5. Install Full

After confirming the resource and `x86-64-v2` requirements, run the block for your operating system.

**Linux**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-full.sh
```

**macOS**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh &&
sh install-full.sh
```

#### 6. Confirm successful output

After image verification, database initialization, startup, and health checks, the installer prints output similar to:

```text
[linksense-installer] Installed LinkSense core vX.Y.Z successfully.
LinkSense is ready at: http://<server-address>:18081

Copy and securely save the credential below before continuing:
<one-time initialization credential>
```

Full also prints `Full release probe passed.`. The actual address and one-time credential shown in the terminal are authoritative. Do not paste the credential into chats, tickets, or public logs.

#### 7. Handle common errors

| Symptom | Cause | Fix |
| --- | --- | --- |
| `docker version` has no Server section, or cannot connect to the Docker daemon | Docker is stopped, or the account cannot access the Docker socket | Start Docker and check Linux permissions or Docker Desktop state. |
| Docker API or Compose is too old | Server API is below `1.45`, or Compose is below `2.24.4` | Upgrade the relevant component through Docker's official installation path. |
| `[LS_HOST_memory]` | The host or Docker VM lacks available memory | Increase Docker Desktop memory or move to a larger host. |
| `[LS_HOST_storage]` | The host, Docker VM, or backup location lacks space | Remove only confirmed disposable files or expand storage; do not run broad Docker cleanup blindly. |
| `[LS_HOST_pull]`, timeouts, or TLS errors | Docker Engine networking or proxy is not configured | Rerun `--check-network`; diagnose terminal and Docker Engine networking separately. |
| `CPU does not support x86-64-v2` | The Full VM does not expose required CPU flags | Power off the VM and select host passthrough or a compatible x86-64-v2 CPU mode. |
| The port is occupied | Another process uses `18081` | Set `LINKSENSE_HTTP_PORT` for a fresh install; use `linksense port <port>` for an existing install. |
| An installation exists or was interrupted | Rerunning the wrong edition can break installation identity | Run `linksense status` and `linksense doctor`; rerun only the same edition for an interrupted installation. |

For a fresh Core installation on port `19090`, run the block for your operating system. For Full, replace every `install-core.sh` in the block (including in the URL) with `install-full.sh`. For an existing installation, use `linksense port 19090` instead.

**Linux**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy \
  env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
```

**macOS**

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
```

#### 8. Complete first-time setup and the first task

1. Open the actual address printed by the installer. Defaults are `http://<server-address>:18081` on Linux and [http://localhost:18081](http://localhost:18081) on macOS, but terminal output is authoritative.
2. Use the one-time initialization credential to create the first administrator.
3. Add at least one chat model channel in administration. Full also needs an embedding model for Knowledge.
4. Run `linksense status` and `linksense doctor` and confirm the deployment is healthy.
5. Test a short chat, then run a tool task that creates a small file. On Full, upload a representative document and verify parsing, retrieval, and citations.

See [model configuration](https://linksense.guygubaby.top/doc/admin-guide/model-settings/) and [the first task](https://linksense.guygubaby.top/doc/user-guide/getting-started/first-task/) for product-specific fields and interactions.

#### 9. Operations, repair, and upgrades

| Operation | Command |
| --- | --- |
| Status and actual address | `linksense status`, `linksense address` |
| Start, stop, restart | `linksense start`, `linksense stop`, `linksense restart` |
| Change port | `linksense port 19090` |
| Show initialization credential | `linksense credential` |
| View logs | `linksense logs api`, `linksense logs runner` |
| Health and network diagnostics | `linksense doctor`, `linksense doctor --network` |
| Repair and upgrade | `linksense repair`, `linksense upgrade` |

An upgrade waits for running tasks and stores a database backup before migration. Migration failures do not automatically roll back the database. Retain the generated backup and make an off-host copy before upgrading. Do not reinstall or switch Core / Full in place.

## Development

For local development, source changes, and image builds, see [Source development and image builds](https://linksense.guygubaby.top/doc/deploy/development/).

### Where to start

| What to change | Source |
| --- | --- |
| Web workspace and administration UI | [apps/web](./apps/web) |
| APIs, access control, and business logic | [apps/api](./apps/api) |
| Agent execution and Workers | [apps/runner](./apps/runner) |

See [Architecture and execution boundaries](https://linksense.guygubaby.top/doc/deploy/architecture/) for the architecture, and [Source development](https://linksense.guygubaby.top/doc/deploy/development/) for environment configuration, commands, and image builds.

### Contributing

Before submitting changes, run the affected tests and check types, lint, and builds. Read [AGENTS.md](./AGENTS.md) and the [contribution guide](./.github/CONTRIBUTING.md). Code contributions require a [CLA](./docs/legal/CLA.md).

## Security

The isolation boundary is the user Worker; ordinary tasks can access the same user's other task files. Ordinary execution permits internet egress without per-command approval. Configured external models and tools receive the data sent to those services.

Before adding users or exposing a deployment, read the [execution boundaries](./.github/SECURITY.md#execution-boundaries) and [deployment requirements](https://linksense.guygubaby.top/doc/deploy/operations/). Report security issues privately to `security@linksense.org`.

## Documentation

| I want to… | Read |
| --- | --- |
| Run tasks, schedule work, or connect messaging | [User guide](https://linksense.guygubaby.top/doc/user-guide/overview/) |
| Manage members, models, access, and usage | [Administrator guide](https://linksense.guygubaby.top/doc/admin-guide/overview/) |
| Share Knowledge, Skills, Plugins, and Applications | [Skills, Plugins, and Applications](https://linksense.guygubaby.top/doc/user-guide/plugin-center/discover-and-install/) · [Knowledge sharing](https://linksense.guygubaby.top/doc/user-guide/knowledge-bases/sharing/) |
| Connect business systems or build applications | [Application development](https://linksense.guygubaby.top/doc/developer-guide/interactive-application/) |
| Deploy, troubleshoot, upgrade, or migrate | [Core](https://linksense.guygubaby.top/doc/deploy/core/) · [Full](https://linksense.guygubaby.top/doc/deploy/full/) · [Operations](https://linksense.guygubaby.top/doc/deploy/operations/) |
| Understand architecture and execution | [Architecture](https://linksense.guygubaby.top/doc/deploy/architecture/) |

## Community and support

Find questions and feedback in [GitHub Discussions](../../discussions) or see [Support](./.github/SUPPORT.md).

For organizational deployment and collaboration: `hello@linksense.org`.

Organizations using LinkSense can opt in to a listing in [ADOPTERS.md](./docs/community/ADOPTERS.md).

## License

LinkSense is open source under [CPAL-1.0](./LICENSE). For internal deployment, attribution, custom branding, and trademarks, see the [license](./LICENSE), [internal deployment exception](./LICENSE-EXCEPTIONS.md), [attribution requirements](./ATTRIBUTION.md), and [trademark policy](./TRADEMARK.md). For other licensing needs: `licensing@linksense.org`.

The official open-source Codex runtime ships unmodified under Apache-2.0. LinkSense is independent and is not affiliated with, sponsored by, or endorsed by OpenAI. See [third-party notices](./THIRD-PARTY-NOTICES.md).
