---
title: 运维、修复与升级
description: 核对 Docker 主机、管理现有部署并安全处理升级。
---

# 运维、修复与升级

## 环境与网络

- 支持 Linux x86_64 / ARM64 和 macOS Intel / Apple Silicon。macOS 使用 Docker Desktop 的 Linux 容器，长期共享部署优先考虑 Linux。
- 使用本地 Docker Engine API v1.45+、Docker Compose v2.24.4+ 和 `curl`。核对 `docker version` 的 **Server** 部分。部分发行版可适配私有 Docker 客户端或 Compose；安装器不会升级共享 Docker daemon。
- 检查下载和拉取镜像两条网络路径。终端代理不会自动配置 Docker Engine 代理；Linux 安装命令只通过 `sudo` 保留明确列出的代理变量。见[主机适配和网络诊断](https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies)。
- 默认安装目录：Linux `/opt/linksense`，macOS `~/.linksense`。对外开放前配置 HTTPS 反向代理，核对[执行边界](./architecture.md#执行边界)。

## 并发与 Worker

新部署默认允许一个并发对话，用户 Worker 默认内存上限为 4 GiB。通过[系统设置](/admin-guide/system-settings/)调整任务并发前，先按同时活跃的 Worker、文档处理和其他服务预留资源。旧部署会保留已配置的限制；增加机器资源不会自动提高任务并发。

## 自定义端口

安装时向已下载的脚本传入 `LINKSENSE_HTTP_PORT`。以下以 Core 为例，Full 对应 `install-full.sh`：

```bash
# Linux
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
# macOS
env LINKSENSE_HTTP_PORT=19090 sh install-core.sh
```

## 命令行管理

| 操作 | 命令 |
| --- | --- |
| 状态和地址 | `linksense status`、`linksense address` |
| 启动、停止、重启 | `linksense start`、`linksense stop`、`linksense restart` |
| 修改端口 | `linksense port 19090` |
| 查看一次性初始化凭据 | `linksense credential` |
| 查看日志 | `linksense logs api`、`linksense logs runner` |
| 健康与网络诊断 | `linksense doctor`、`linksense doctor --network` |
| 修复与升级 | `linksense repair`、`linksense upgrade` |

不带参数运行 `linksense` 可进入交互菜单。macOS 找不到命令时，将 `$HOME/.local/bin` 加入 `PATH`。网络检查可能拉取并缓存镜像，但不会启动服务。

## 修复与升级

修复使用已安装的发行版。升级等待运行中的任务结束，迁移前在 `volume://linksense-backups/postgres/` 保存数据库备份。保留备份位置，另做异机备份。迁移开始后出错不会自动回滚数据库；先核对日志和备份，再按[主机适配说明](https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md)恢复。

已有安装不要直接运行另一种部署方案的安装器。若现有管理命令不可用，使用与已安装方案对应的 [Core 修复脚本](https://github.com/LingX-AI/linksense/blob/main/repair-core.sh)或 [Full 修复脚本](https://github.com/LingX-AI/linksense/blob/main/repair-full.sh)。旧安装首次升级以目标发行版说明为准。

## 虚拟机与知识库

Full 的 x86_64 Docker 主机需要暴露 `x86-64-v2` 指令集。请在实际运行 Elasticsearch 和 Docling 的虚拟机内检查（如果服务外置，就检查外置服务主机）：

```bash
LC_ALL=C lscpu
grep -m1 '^flags' /proc/cpuinfo
```

检查 `cx16`、`lahf_lm`、`popcnt`、`ssse3`、`sse4_1`、`sse4_2` 和 `pni`（或 `sse3`）。若缺失或日志出现 `Fatal glibc error: CPU does not support x86-64-v2`，关闭虚拟机后调整虚拟 CPU 模式（如 Proxmox `host` / `x86-64-v2-AES` 或 libvirt `host-passthrough`），再开机核对 flags。宿主机本身不支持时，增加 vCPU 数无法解决。
