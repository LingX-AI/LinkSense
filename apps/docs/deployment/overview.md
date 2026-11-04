---
title: 选择部署方案
description: 按知识库需求选择 Core 或 Full，并了解安装和组织容量规划的区别。
slug: /deploy/
---

# 选择部署方案

LinkSense 可运行在自有服务器或私有云中。Core 和 Full 使用同一套产品代码，区别在于是否随部署提供内置知识库服务。

## Core 和 Full 的区别

| 方案 | 包含能力 | 选择依据 |
| --- | --- | --- |
| [Core](./core.md) | Agent 工作空间、任务附件、技能、插件、MCP、应用与组织管理 | 不需要内置的组织知识库解析、索引和检索。 |
| [Full](./full.md) | Core 的能力，加上 Elasticsearch 和 Docling 支持的内置知识库 | 需要处理、检索并引用组织文档。 |

## 规划资源

| 方案 | 建议的评估起点 | Docker 内存预检 |
| --- | --- | --- |
| Core | 4 vCPU、60 GiB 可用 SSD | 8 GiB |
| Full | 8 vCPU、120 GiB 可用 SSD | v0.3.13 新安装为 10 GiB；以所选发行版清单为准 |

Docker Desktop 分配内存时需给虚拟机开销留余量。16 GiB 的 Mac 建议先试 Core，Docker Desktop 可先分配 10–12 GB，再确认 Docker Engine 报告的可用内存。

Full 组织部署可从 16 vCPU、32 GiB 内存和 200 GiB 可用 SSD 开始规划。以上以外部模型 API 为前提；本地模型的算力与 GPU 另行规划。用实际任务测试峰值并发、大文档和 OCR 后再调整配置。内存预检通过不代表具备相应的高峰容量。

## 选择安装方式

- 安装已发布的 Docker 镜像：进入 [Core](./core.md) 或 [Full](./full.md) 安装页，无需克隆仓库。
- 使用编程助手：将[仓库中的安装指引](https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md)和你的部署目标交给助手。
- 修改代码或构建镜像：按[源码开发](./development.md)进行。
- 已有部署：先查看[运维、修复与升级](./operations.md)。
