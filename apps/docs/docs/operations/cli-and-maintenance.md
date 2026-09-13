---
title: 命令行管理与维护
description: 使用 linksense 命令查看状态、诊断、修复和升级部署。
---

# 命令行管理与维护

安装器会提供 `linksense` 管理命令。Linux 上命令需要权限时会提示使用 `sudo`；macOS 不使用 `sudo`，并应确保 `$HOME/.local/bin` 已加入 `PATH`。

## 常用命令

```bash
linksense status
linksense start
linksense stop
linksense restart
linksense port 19090
linksense credential
linksense logs api
linksense doctor
linksense repair
linksense upgrade v0.3.0
```

- `status`：查看部署状态。
- `start`、`stop`、`restart`：控制服务。
- `port 19090`：修改 HTTP 端口；之后使用新端口访问。
- `credential`：仅在首个管理员创建前显示一次性初始化凭据。
- `logs api`：查看指定服务日志；不要公开包含敏感信息的完整日志。
- `doctor`：检查主机、Docker、服务和关键依赖。
- `repair`：按当前已安装版本修复部署，不会把系统升级到新版本。
- `upgrade <版本>`：升级到指定版本，脚本会自动识别 Core 或 Full。

修改端口前会检查占用，只重建受影响的服务；健康检查失败时会自动恢复原端口配置。停止、修复和升级仍可能影响服务可用性，应安排维护窗口并先通知用户。

也可以在 Linux 上直接运行对应维护脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

macOS 使用相同脚本但不加 `sudo`。Core 与 Full 应使用各自的修复脚本；升级脚本会自动识别当前版本。

## 升级的数据边界

升级脚本会等待运行中的任务结束，并在数据库迁移前创建和校验 PostgreSQL 备份。备份地址会显示为 `volume://linksense-backups/postgres/` 下的位置；请保留终端打印的具体地址。

脚本不会删除数据卷。数据库迁移一旦开始，后续失败不会自动回滚数据库。此时不要手动删除卷或运行未记录的数据库命令，应先查看诊断与日志，确认备份可用，再修复问题并重新执行升级。

Web 管理页面中的更新检查与升级行为见[系统更新](../admin-guide/system-update.md)。

## 排查顺序

1. 运行 `linksense status` 确认服务状态。
2. 运行 `linksense doctor` 获取可执行的诊断结论。
3. 只查看相关服务日志，例如 `linksense logs api`。
4. 当前版本文件损坏或配置不完整时运行 `linksense repair`。
5. 需要版本升级时使用明确的目标版本运行 `linksense upgrade <版本>`。

不要在工单或聊天中粘贴一次性凭据、API Key、数据库连接串、完整环境文件或未经检查的日志。
