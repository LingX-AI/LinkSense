# 查看图像只显示路径的排查与修复

## 原因

托管浏览器允许命令从当前用户的 HOME 或另一个项目启动。浏览器原先将启动目录同时用作输出目录，因此截图可能写入 HOME 的 `temp/browser`，而不是任务指定工作目录的 `temp/browser`。

原生 `imageView` 事件正确携带了原图路径，但 Runner 的图片投影只允许当前工作目录和已授权 Skill 的 assets。工作目录之外的截图因此被拒绝登记，完成事件没有 `fileId`，前端只能显示脱敏路径 `$ABSOLUTE/文件名`。原图本身没有损坏。

已核对运行镜像中的 Codex 0.154.0 schema 以及[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server#items)：`imageView` 原生载荷为 `id`、`path`。本次不改变原生事件语义。

## 修复范围

浏览器所有受管理输出统一保存到任务指定工作目录；启动目录仍用于现有命令的路径解析。默认截图和显式 `--filename` 都使用同一输出目录。复用既有图片投影、文件登记、鉴权和前端预览，不增加依赖，不放宽图片读取边界，无数据库结构变更。

升级需更新 worker 镜像，使后续浏览器会话使用修复后的输出目录。此前缺少 `fileId` 的事件不会凭脱敏文件名自动猜测原图。此次报障任务的四张原图仍存在，已逐一核对原始调用、任务所有权和已完成回合，备份旧事件后，将图片存入对象存储并在事务中补回文件记录、事件关联及登记审计；对象存储回读校验和一致，无重复文件记录。历史事件修复后需刷新任务页面。

## 验证

新增两组回归：从 HOME、从同用户的另一个项目启动浏览器，并分别模拟默认截图和指定文件名截图，随后调用真实图片投影函数检查能够登记为 inline artifact。修复前均报 `inline_image_source_forbidden`，修复后通过。

- Runner 浏览器、图片投影、原生事件映射与执行池：252 项通过。
- 前端原生活动及图片预览组件：25 项通过。
- Runner 类型检查、涉及文件的 ESLint、构建通过。
- 在确认当前无运行中或排队回合后，执行本地 worker 重建，镜像既有 Chromium smoke 与 controller 健康检查通过，并确认运行中的 worker 包含本次修复。
- 未对用户任务页面运行浏览器自动化，未运行全仓测试；本次未修改前端代码。

```sh
pnpm --filter @linksense/runner test test/browser-cli-wrapper.test.ts test/assistant-message-assets.test.ts test/event-mapper.test.ts test/process-pool.test.ts
pnpm --filter @linksense/web exec vitest run src/features/conversations/native-activity-item.test.tsx
pnpm --filter @linksense/runner typecheck
pnpm --filter @linksense/runner exec eslint src/browser/cli-wrapper.ts test/browser-cli-wrapper.test.ts --max-warnings=0
pnpm --filter @linksense/runner build
pnpm dev:worker:rebuild
```
