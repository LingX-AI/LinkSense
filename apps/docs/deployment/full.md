---
title: 安装 Full
description: 在 Linux 或 macOS 上安装带内置知识库的 LinkSense Full。
---

# 安装 Full

Full 在 Core 的基础上增加内置知识库解析、索引和检索服务。

## 检查环境

确认满足 [Docker 要求](./operations.md#环境与网络)，并按[资源建议](./overview.md#规划资源)给 OCR、大文档和并发留余量。`x86_64` 主机或虚拟机须向 Elasticsearch 与 Docling 暴露 `x86-64-v2` 指令集；原生 ARM64 不受这项 x86 要求约束。排查方法见[主机兼容性说明](./operations.md#虚拟机与知识库)。

只在新部署目录安装。已有 Core / Full 不应直接覆盖或换用另一版安装器。下载成功后才执行；如需审阅脚本，可分开运行。

## Linux {#linux}

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh &&
sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-full.sh
```

## macOS {#macos}

先启动 Docker Desktop，使用当前账号执行，不使用 `sudo`。

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh &&
sh install-full.sh
```

## 初始化

按[首次配置](./first-setup.md)验证基础任务。配置知识库所需模型后，用代表性文档验证解析、检索和引用。
