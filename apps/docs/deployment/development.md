---
title: 源码开发与镜像构建
description: 启动 Docker 开发环境，了解源码入口并构建镜像。
---

# 源码开发与镜像构建

## 启动开发环境

准备 Node.js 24+、pnpm 10.34.6、Docker Engine / Compose、`rsync` 和 `mkcert`。在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm dev
```

`pnpm dev:prepare` 会启动服务、构建镜像和帮助中心，并初始化开发数据库，保留已有配置。首次启动可能需要信任 `mkcert` 本地 CA。`pnpm dev` 接入监听和日志，`pnpm dev:stop` 停止开发栈。

默认地址：Web `http://localhost:18172` / `https://localhost:18173`，API `http://localhost:4000`，Runner `http://localhost:4010`。以启动器输出为准。

## 从哪里改起

- [Web 工作空间与管理界面](https://github.com/LingX-AI/linksense/tree/main/apps/web)
- [API、权限与业务逻辑](https://github.com/LingX-AI/linksense/tree/main/apps/api)
- [Runner 与任务 Worker](https://github.com/LingX-AI/linksense/tree/main/apps/runner)

参阅[系统架构](./architecture.md)、[仓库开发说明](https://github.com/LingX-AI/linksense/blob/main/deploy/development/README.zh-CN.md)和[贡献指南](https://github.com/LingX-AI/linksense/blob/main/.github/CONTRIBUTING.md)。提交前运行受影响的测试、类型检查、lint 和构建。

## 从源码构建 Docker 镜像

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

API 的 Dockerfile 提供 `runtime` 和 `migration`，Runner 提供 `controller` 和 `worker`。多架构镜像用 `docker buildx build --platform linux/amd64,linux/arm64`，选择对应 Dockerfile 和目标。生产安装通常使用固定摘要的[发行镜像](./overview.md)。团队维护的源码发布流程另见[生产 Git 发布手册](https://github.com/LingX-AI/linksense/blob/main/deploy/production/README.md)。
