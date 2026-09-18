# 应用环境迁移后的启动权限

## 故障原因

旧应用 HOME 合并时保留或创建的 `workspace`、`.codex` 根目录可能只有 `0750` 权限。转换后的目录属于任务用户，而 worker 健康检查由管理用户执行。管理用户属于共享组，但没有组写权限，`/health/state` 因而返回 `WORKSPACE_ROOT_UNAVAILABLE` 和 `CODEX_HOME_ROOT_UNAVAILABLE`。

控制器等候 worker 就绪，API 的环境准备请求先达到 15 秒超时；表面上表现为“执行服务暂不可用”。容器能启动和正常发送心跳并不代表目录检查通过。

## 修复边界

- 转换工具在暂存 HOME 完成后，将上述两个根目录显式设为共享目录权限 `0770`，不受部署进程 umask 影响。
- 控制器在创建 worker 前，用现有安全目录检查和任务用户权限整理逻辑处理这两个目录。已转换环境在下一次创建 worker 时也会得到修复，无需重新转换或导入应用。
- 符号链接根目录拒绝启动，不跟随链接修改目标。
- 不修改数据库结构、不删除文件、不重写历史、不递归放宽 `.codex` 内部凭证文件权限。

## 验证

回归测试覆盖迁移后共享可写权限、已存在环境在创建 worker 前完成整理、文件保留，以及两个根目录的符号链接拒绝路径。

```sh
pnpm --filter @linksense/api test test/application-environment-conversion.test.ts
pnpm --filter @linksense/runner test test/controller-worker-manager.test.ts test/workspace-permission-repair.test.ts
```

现网恢复时，只在确认真实目录、任务用户及共享组身份后，将受影响根目录从 `0750` 调整为 `0770`，并保存原权限记录。随后分别验证 worker 健康检查和 API 到 runner 的环境准备请求；这不等同于执行真实模型任务。
