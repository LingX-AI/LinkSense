# Core 安装指南

[返回 README](../../README.zh-CN.md) · [选择其他版本](full.zh-CN.md) · [运维参考](operations.zh-CN.md)

Core 提供 AI 工作空间、技能、插件、MCP、应用及组织管理能力，适合先验证任务执行、应用共享与系统连接。需要内置的完整知识库解析与检索服务时，请选择 Full。

## 1. 检查环境与资源

先确认满足[通用环境要求](operations.zh-CN.md#环境要求)。以下为容量规划建议，不是经过压测的用户数保证，且不包含本地大模型与 GPU。

[Core 评估与团队共享的起步配置与推荐配置见 README](../../README.zh-CN.md#部署方案与配置要求)。

新安装默认允许 1 个并发对话；每个活跃用户 Worker 默认内存上限为 4 GiB，需要单独规划并发容量。16 GiB Mac 建议先选 Core，Docker Desktop 建议分配至少 10–12 GB，以满足 8 GiB 实际可用内存的预检要求。

## 2. 安装 Core

使用已发布 Docker 镜像，无需克隆源码或在宿主机安装 Node.js / pnpm。选择当前操作系统的一组命令执行。只有下载成功后才执行脚本；如需先审阅，可分别运行下载部分和执行部分。

### Linux

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-core.sh
```

### macOS

先启动 Docker Desktop，使用当前账号运行，不使用 `sudo`。

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh && sh install-core.sh
```

### 交给编程助手安装

也可以将下面的指令交给 Codex、Claude Code、Cursor 等编程助手，明确指定本版本：

```text
Help me install and start LinkSense Core using released Docker images by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

## 3. 完成初始化

安装器会启动服务，并打印实际访问地址和初始化凭据。接着按 README 的[启动后设置](../../README.zh-CN.md#启动后)创建管理员、配置模型并验证首个任务。

自定义端口、日志、网络诊断、修复与升级见[安装与运维参考](operations.zh-CN.md)。已有安装请先检查状态，使用对应的修复或升级流程。切换版本前应核对所选发行版支持的迁移方式，不要在已有安装目录直接运行另一个版本的安装器。
