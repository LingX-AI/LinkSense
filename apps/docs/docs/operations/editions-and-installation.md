---
title: 版本选择与安装
description: 选择 Core 或 Full，并在 Linux 或 macOS 上安装 LinkSense。
---

# 版本选择与安装

## 选择版本

| 版本 | 建议资源 | 适用范围 |
| --- | --- | --- |
| Core | 4 vCPU+、8 GiB+ 内存、60 GiB+ SSD | AI 任务、模型与扩展能力 |
| Full | 8 vCPU+、16 GiB+ 内存、120 GiB+ SSD | 在 Core 基础上增加文档解析和知识库检索 |

Core 最低需要 8 GiB 内存，Full 最低需要 16 GiB。Core 不包含 Elasticsearch、Docling 和 tokenizer；需要知识库完整能力时请选择 Full。

## 安装前检查

- 使用 x86_64 或 ARM64 的 Ubuntu、Debian、Fedora、RHEL、Rocky Linux、AlmaLinux 或 CentOS；也支持安装了 Docker Desktop 的 Intel Mac 和 Apple Silicon。
- 安装 `curl`，并启动 Linux Docker Engine。Docker API 需要 v1.45 或更高版本，Docker Compose 需要 v2.24.4 或更高版本。
- 默认 TCP 端口 `18081` 应空闲。
- 允许访问 GitHub、GHCR 和上游镜像仓库；Full 还需要下载 tokenizer 文件。
- macOS 应先为 Docker Desktop 分配足够的内存和磁盘。

安装器不设置磁盘空间或 inode 的硬性下限。应按推荐 SSD 容量部署并持续监控剩余空间；主机空间充足也不代表 Docker Desktop 的虚拟磁盘配额足够。

## 安装到 Linux

Core：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sudo sh
```

Full：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sudo sh
```

需要自定义端口时，把环境变量传给安装器，例如安装 Full 并使用 `19090`：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh \
  | sudo env LINKSENSE_HTTP_PORT=19090 sh
```

## 安装到 macOS

Core：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh | sh
```

Full：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh | sh
```

## 完成初始化

安装完成后：

- Linux 打开 `http://<服务器地址>:18081`；
- macOS 打开 `http://localhost:18081`；
- 自定义端口时替换地址中的 `18081`；
- 使用终端打印的一次性初始化凭据创建首个管理员，不要把它发给他人。

Linux 部署文件位于 `/opt/linksense`，macOS 位于 `~/.linksense`。域名和 HTTPS 不是本地启动的前置条件；公网部署应在 LinkSense 前配置 HTTPS 反向代理。

安装后管理见[命令行管理与维护](./cli-and-maintenance.md)。
