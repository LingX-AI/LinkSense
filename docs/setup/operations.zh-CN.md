# 安装与运维参考

[返回 README](../../README.zh-CN.md) · [Core 安装](core.zh-CN.md) · [Full 安装](full.zh-CN.md)

## 环境要求

- Linux：x86_64 或 ARM64，需满足 Docker 与内核能力要求；macOS：Intel 或 Apple Silicon，使用 Docker Desktop 的 Linux 容器。
- Docker Engine API v1.45+、Docker Compose v2.24.4+、`curl`；安装前确认 Docker 已启动。
- 发行镜像支持 `linux/amd64` 和 `linux/arm64`；默认使用 TCP `18081` 端口。
- 长期共享部署优先使用 Linux；macOS 适合评估和开发。此流程不提供原生 Windows 安装步骤。

终端下载与 Docker 镜像拉取是两条独立网络通道，需分别配置代理。Linux 安装命令通过 `sudo` 仅保留代理变量；若策略不允许，请由主机管理员配置提权环境的代理。详细诊断见[网络与代理说明](../../deploy/release/HOST-ADAPTATION.md#network-and-proxies)。

安装器会检查主机、生成运行时密钥并启动服务。Linux 默认安装到 `/opt/linksense`，macOS 默认安装到 `~/.linksense`。本地启动不强制要求域名和 HTTPS；公开部署应配置 HTTPS 反向代理，并阅读[安全说明](../../SECURITY.md)。

内存预检读取 Docker Engine 实际可用内存。Docker Desktop 的数值指虚拟机内存，需为虚拟机开销预留余量，分配后应用更改并重启 Docker Desktop。本地模型及 GPU 资源需要另外计算。安装器最终按所选发行包的清单校验要求，旧版本可能使用不同门槛；不要通过手动修改门槛绕过预检。

## 自定义端口

从所选版本指南下载脚本后，在执行时传入端口。以下以 Core 为例；Full 使用 `install-full.sh`：

```bash
# Linux
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
# macOS
env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
```

---

## 命令行管理

| 操作 | 命令 |
| --- | --- |
| 检查服务状态 | `linksense status` |
| 启动 / 停止 / 重启 | `linksense start` / `linksense stop` / `linksense restart` |
| 查看访问地址 | `linksense address` |
| 修改 HTTP 端口 | `linksense port 19090` |
| 查看初始化凭据 | `linksense credential` |
| 查看服务日志 | `linksense logs api` / `linksense logs runner` |
| 检查已部署服务的健康状态 | `linksense doctor` |
| 检查下载与镜像拉取 | `linksense doctor --network` |
| 修复当前发行版 | `linksense repair` |
| 升级当前安装 | `linksense upgrade` |

不带参数运行 `linksense`，可打开交互式管理菜单。

新版 Linux 管理工具会在需要时请求 `sudo`，仅保留代理变量。macOS 请将 `$HOME/.local/bin` 加入 `PATH`，并在不使用 `sudo` 的情况下执行命令。

网络诊断需要包含新版安装器和管理工具的发行版本。诊断会拉取 BusyBox/API 发行镜像，不启动容器；镜像会保留在本地缓存。

---

## 修复与升级

修复沿用已安装的发行版本。升级会识别 Core / Full，等待正在运行的工作结束，并在迁移前将经过校验的 PostgreSQL 备份保存到 `volume://linksense-backups/postgres/`。

不会删除数据卷。迁移开始后若发生失败，不会自动回滚数据库；请保留输出的备份位置，查看诊断信息后重新执行升级。

如果已安装的管理工具不可用，请下载 [repair-core.sh](../../repair-core.sh) 或 [repair-full.sh](../../repair-full.sh)，阅读后按所选版本安装指南中对应系统的执行方式运行；版本入口见[快速开始](../../README.zh-CN.md#快速开始)。旧安装的首次升级步骤见[安装器主机适配说明](../../deploy/release/HOST-ADAPTATION.md#fresh-resource-profiles)。

---

## 虚拟机 CPU 要求

Full 在 `x86_64` / `amd64` 上运行 RAG 知识库组件（Elasticsearch、Docling）时，Docker Engine 所在主机或虚拟机需要向容器暴露至少 `x86-64-v2` 指令集。当前 [Docling v1.36.0 上游镜像](https://github.com/docling-project/docling-serve/blob/v1.36.0/Containerfile)基于 CentOS Stream 9，后者采用 [x86-64-v2 基线](https://blog.centos.org/2023/08/centos-isa-sig-performance-investigation/)。Elasticsearch 的 CPU 要求取决于具体版本和基础镜像。此项 x86 指令集要求不适用于原生 ARM64 部署。

虚拟化平台的通用 CPU 模式可能屏蔽宿主机已有的指令集；CPU 型号、年代、vCPU 数量或 `uname -m` 输出不足以判断兼容性。请在**实际运行 Docker Engine 的 Linux 虚拟机内**检查：

```bash
LC_ALL=C lscpu
grep -m1 '^flags' /proc/cpuinfo
```

除 x86-64 基础能力外，CPU flags 应包含 `cx16`、`lahf_lm`、`popcnt`、`ssse3`、`sse4_1`、`sse4_2` 和 SSE3（Linux 通常显示为 `pni`，也可能为 `sse3`）。仅有 `sse4_1` 和 `popcnt` 不能证明满足完整的 `x86-64-v2` 要求。

发行包的安装、修复和升级脚本会对 Full 的 `linux/amd64` 部署自动检查 Docker 实际可见的 CPU flags，在修改运行配置、创建数据卷或停止现有服务前报告缺失项并退出。检查使用发行清单中固定摘要的 BusyBox 镜像，首次使用时可能需要拉取；临时容器只读、无网络、不挂载数据卷，结束后自动删除。

此预检随包含该变更的发行包提供，旧安装目录中的脚本不会自动更新。若要在首次升级前获得预检，请在新版发行包发布后下载并检查仓库根目录的 [upgrade.sh](../../upgrade.sh)，再按当前系统的执行方式运行。

若缺失所需指令集，或容器日志出现 `Fatal glibc error: CPU does not support x86-64-v2`：

1. 正常关闭虚拟机，在虚拟化平台调整 CPU 模式。Proxmox VE 可选择宿主机支持的 `host` 或 `x86-64-v2-AES`；KVM/libvirt 可使用 [`host-passthrough`](https://libvirt.org/formatdomain.html#cpu-model-and-topology)。避免使用屏蔽所需指令集的 `kvm64` / `qemu64` 模式。
2. 重新开机，在虚拟机内再次检查上述 flags。仅重启容器不会应用虚拟 CPU 模式变更。需要跨宿主机迁移时，应选择所有目标宿主机共同支持、且满足 `x86-64-v2` 的 CPU 模型。
3. 检查通过后，新安装重新执行原 Full 安装命令；已有安装按[修复与升级](#修复与升级)操作，再按[命令行管理](#命令行管理)检查服务状态。

宿主机物理 CPU 本身不支持所需指令集时，需要换用兼容的宿主机；增加 vCPU 或内存无法补齐指令集。
