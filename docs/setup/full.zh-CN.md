# Full 安装指南

[返回 README](../../README.zh-CN.md) · [选择其他版本](core.zh-CN.md) · [运维参考](operations.zh-CN.md)

Full 在 Core 的 AI 工作空间、资源共享与组织管理能力之上，增加完整的文档解析、索引与知识检索服务。适合需要建设组织知识库、检索内部文档并溯源引用的部署。

## 1. 检查环境与资源

先确认满足[通用环境要求](operations.zh-CN.md#环境要求)。以下为容量规划建议，不是经过压测的用户数保证，且不包含本地大模型与 GPU。

[Full的起步配置与推荐配置见 README](../../README.zh-CN.md#部署方案与配置要求)。

10 GiB 是当前源码发行配置的 Docker 实际可用内存下限，允许内存超配，不保证峰值容量。OCR、大文档和并发任务需要额外余量；Full 的服务内存上限合计超过可用内存时会告警并继续。修复和升级保留旧安装配置。

**x86_64 / amd64 虚拟机需暴露 `x86-64-v2` 指令集。** 安装前按[虚拟机 CPU 要求](operations.zh-CN.md#虚拟机-cpu-要求)检查实际 Docker 主机；此要求不适用于原生 ARM64。

## 2. 安装 Full

使用已发布 Docker 镜像，无需克隆源码或在宿主机安装 Node.js / pnpm。选择当前操作系统的一组命令执行。只有下载成功后才执行脚本；如需先审阅，可分别运行下载部分和执行部分。

### Linux

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh && sudo --preserve-env=http_proxy,https_proxy,HTTP_PROXY,HTTPS_PROXY,ALL_PROXY,all_proxy,NO_PROXY,no_proxy sh install-full.sh
```

### macOS

先启动 Docker Desktop，使用当前账号运行，不使用 `sudo`。

```bash
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 -fsSL \
  -o install-full.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-full.sh && sh install-full.sh
```

### 交给编程助手安装

也可以将下面的指令交给 Codex、Claude Code、Cursor 等编程助手，明确指定本版本：

```text
Help me install and start LinkSense Full using released Docker images by following https://raw.githubusercontent.com/LingX-AI/linksense/main/Install.md
```

## 3. 完成初始化

安装器会启动服务，并打印实际访问地址和初始化凭据。接着按 README 的[启动后设置](../../README.zh-CN.md#启动后)创建管理员、配置模型并验证首个任务。

自定义端口、日志、网络诊断、修复与升级见[安装与运维参考](operations.zh-CN.md)。已有安装请先检查状态，使用对应的修复或升级流程。切换版本前应核对所选发行版支持的迁移方式，不要在已有安装目录直接运行另一个版本的安装器。
