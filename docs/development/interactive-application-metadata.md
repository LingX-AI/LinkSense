# 交互式应用图标与信息编辑

## 行为

- 开发界面点击名称左侧的图标，可选择预设图标、上传 PNG/JPEG/WebP，并编辑名称和描述。名称、描述原有的行内编辑继续可用。
- “我的应用”中，交互式应用的“编辑”和开发草稿的“编辑应用信息”提供相同的图标选择器。开发草稿卡片展示实际图标和描述。
- 开发修改保存到源码清单和应用资源，随后同步预览；发布使用同一份资源。已安装应用的信息编辑修改当前应用，不改动运行配置或历史任务。共享、上架和开发草稿仍遵循现有的独立发布规则。
- 开发 Skill 使用 `inspect_application_development` 获取源码摘要，再调用 `update_application_metadata`。工具仅访问当前用户、当前开发任务及活动轮次，支持省略字段保留原值、清空描述、选择预设图标或读取工作区图片。

## 数据与安全

复用现有图标存储与字段，无数据库结构迁移。Manifest 新增可选 `icon_preset`；`icon` 继续表示包内图片路径。显式选择预设图标会清空图片引用，旧包未提供该字段时保持既有更新行为。

复用普通应用的图标限制：PNG/JPEG/WebP、512 KiB、1024 像素。工作区读取拒绝绝对路径、目录穿越、隐藏路径、符号链接、非图片、过大文件和读取中变化的文件。源码更新受共享文件锁与摘要校验保护，图片使用独立资源文件，不修改用户上传的原图。临时写入失败会清理本次创建的资源。名称或描述编辑不会意外替换未修改的图标。

内置 Skill 的内容版本标记已更新，已有任务的能力快照会在后续加载时更新。

## 验证（2026-09-18）

执行并通过：

- `pnpm --filter @linksense/shared test tests/application-development.test.ts tests/application-catalog.test.ts tests/applications.test.ts tests/interactive-applications.test.ts tests/contracts.test.ts`：94 项。
- `pnpm --filter @linksense/api test application-development application-catalog interactive-dependency-lifecycle applications.service applications.routes interactive-package built-in-application-builder user-home-capability-materializer`：178 项；目录投影整理后另行重跑相关测试通过。
- `pnpm --filter @linksense/runner test test/application-builder-service.test.ts test/application-builder-route.test.ts test/core-service-registry.test.ts`：30 项。
- `pnpm --filter @linksense/web exec vitest run`，按组件项目筛选元信息编辑器、开发面板、草稿卡片、应用目录和普通应用编辑相关文件：通过；另行执行 `src/i18n.test.ts` 与应用工作区测试，验证双语与缺失资源回退。
- `pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts`：通过。使用独立临时 PostgreSQL 容器，验证真实 SQL、已有数据升级、图标上传与发布、应用目录展示、编辑后运行配置保留；结束后清理容器与临时目录。
- Shared 构建，API/Web/Runner 类型检查，受影响文件 ESLint，API/Web/Runner 生产构建，以及 `git diff --check`：通过。Web 构建仍有既有大资源包提示。

遵循项目约定，未使用浏览器自动化，也未在本次验证中调用真实模型生成回复；对话工具通过 MCP 转发、请求校验、权限和服务集成测试验证。
