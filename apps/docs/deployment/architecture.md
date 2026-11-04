---
title: 系统架构与执行边界
description: 了解 LinkSense 的应用、API、Runner、用户 Worker 与知识库。
---

# 系统架构与执行边界

## 运行链路

Web 工作台向 API 提交任务。API 管理身份、权限、用量与任务状态，通过队列调度 Runner。Runner 按用户启动和复用 Docker Worker，在 Worker 中通过官方开源 Codex `app-server` 执行任务，事件经 API 流式返回 Web。

| 层 | 组件 |
| --- | --- |
| 工作台 | React、TypeScript、Vite、TanStack Query |
| 服务与存储 | Node.js、Fastify、PostgreSQL、Redis、MinIO |
| 任务运行 | Docker 用户 Worker、Codex `app-server` |
| Full 知识库 | Docling 文档解析、Elasticsearch 索引与检索 |

[系统架构图](https://github.com/LingX-AI/linksense/blob/main/docs/diagrams/system-architecture.svg) · [任务执行链路](https://github.com/LingX-AI/linksense/blob/main/docs/diagrams/realtime-execution-path.svg) · [事件传递](https://github.com/LingX-AI/linksense/blob/main/docs/diagrams/event-delivery.svg)

## 执行边界

隔离单位是**用户 Worker**。同一用户的任务可共享 `HOME`、`CODEX_HOME` 和项目文件。普通任务允许互联网出站，不逐条审批命令；Plan 模式使用只读、禁网策略。接入外部模型或工具时，相应数据会按配置发送给服务提供方。

Runner 控制器访问 Docker daemon，应作为可信组件管理。普通任务 Worker 不挂载 Docker socket。配置 HTTPS、模型权限及资源限制前，阅读仓库的[安全策略](https://github.com/LingX-AI/linksense/blob/main/.github/SECURITY.md#执行安全边界)。

## 连接组织资源

管理员可按用户和用户组授权知识、技能、插件和应用。可通过已授权的连接器访问文档与邮件，其他业务系统可按需通过 MCP 接入。配置模型时核对服务协议和工具能力，不能只凭网络连通或模型列表判断是否可用。
