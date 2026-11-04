---
title: 安装 Core
description: 在 Linux 或 macOS 上安装已发布的 LinkSense Core Docker 镜像。
---

# 安装 Core

Core 提供任务执行和组织共享。若需要内置知识库解析与检索，请选择 [Full](./full.md)。

## 检查环境

确认满足[资源建议](./overview.md#规划资源)和 [Docker 要求](./operations.md#环境与网络)。以下命令只用于新安装。已有部署先运行 `linksense status`，再按[修复与升级](./operations.md#修复与升级)处理。

下载脚本成功后再执行。如需审阅脚本，将下载和执行分开操作。

## Linux {#linux}

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

## macOS {#macos}

先启动 Docker Desktop，使用当前账号执行，不使用 `sudo`。

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh &&
sh install-core.sh
```

## 初始化

安装器启动服务后会打印实际访问地址和一次性凭据。按[首次配置](./first-setup.md)创建管理员、配置模型并验证首个任务。
