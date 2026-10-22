# 应用安装后的配置指南

应用中心和组织共享的普通应用安装包使用同一套配置指南。安装或更新成功后自动打开；安装副本卡片的“完成配置”和菜单中的“应用配置指南”可再次进入。在线应用服务沿用创建者配置，不进入个人资源配置流程。

## 依赖与状态

- 必需项来自安装记录固定的源版本，不读取作者尚未分发的草稿或更新版本。插件、Skill 的名称与用途取自发布快照；知识库和 MCP 的要求来自快照中的资源引用。已有安装无需重新发布。
- 资源名称只作为配置提示，不授予安装者访问作者资源的权限。原资源已删除时，用资源类型和序号标识要求，保留使用说明；不会把要求视为已经完成。
- 指南展示尚未绑定的要求，以及当前个人资源和配置状态。插件凭据复用现有凭据解析器，知识库与 MCP 校验归属和可用状态，模型通过现有模型设置服务检查。
- 指南不会从自然语言指令推断新的强制依赖。它覆盖已发布版本明确绑定的资源与模型；没有声明的外部业务要求仍由作者的使用说明补充。
- “已就绪”表示资源与授权配置满足要求。该检查不会发起外部业务调用，也不代表外部服务当前一定可访问。

## 保存与生效

每次资源选择独立保存到既有应用绑定表，使用 `selection_order` 保留未配置步骤的位置。可以先配置后面的步骤、关闭页面、回来继续；模型单独保存，不重写其他资源绑定。创建资源或配置凭据的页面在新标签页打开，返回后使用 TanStack Query 刷新状态，也可手动重新检查。

完成配置时，后端重新检查全部必需项，保存应用版本并选中该版本后启用应用。草稿配置和当前运行版本有差异时，列表继续提示“完成配置”；重复完成已生效的配置不会新增版本。

所有修改复用现有运行环境门控和数据库事务；存在正在执行的正式任务时禁止修改。请求必须携带源安装版本 ID 和配置修订时间，过期请求返回冲突，不能覆盖最新配置。

## 升级与权限

更新安装包时按源资源身份保留个人绑定。缺少个人绑定的新增要求保留为空步骤，允许安装新版后补配；未完成前应用停用。资源重排保留对应的个人资源，移除的绑定不删除个人资源或凭据。

指南只允许安装副本的所有者访问；管理员身份不替代所有权。资源候选项和绑定始终限制在安装者自己的资源内。源共享撤销后，独立副本仍可查看指南和使用已经配置的资源。接口不返回作者的凭据、连接设置、包路径、Manifest 或私有应用指令。

本功能使用已有表、安装基线和发布快照，无数据库结构迁移或历史数据改写。

## 接口

所有路径以 `/applications/:id/installation/setup` 为前缀：

| 方法 | 后缀 | 用途 |
| --- | --- | --- |
| GET | 无 | 读取配置指南和就绪状态 |
| PATCH | 无 | 保存单个个人资源绑定或清空绑定 |
| PATCH | `/model` | 保存模型和推理强度，或使用个人模型偏好 |
| POST | `/complete` | 检查配置、保存版本并启用应用 |

响应使用 `Cache-Control: private, no-store`。共享 Zod 契约位于 `packages/shared/src/application-setup.ts`；前端文案按六种语言分别存放于 `apps/web/src/i18n/<locale>/application-setup.ts`。

## 验证

单元测试覆盖契约、权限、缺失依赖、凭据状态、模型检查、部分保存、过期修订、重复资源、完成条件、前端交互及六种语言的键与插值一致性。

真实数据库验证复用 `application-distribution-postgres.ts` 的临时 PostgreSQL，包含迁移前的代表性应用和安装记录，以及 `application-setup-scenarios.ts` 的新安装、配置、生效和升级流程。模型服务与凭据解析在集成测试中使用可控测试适配器，不访问外部服务。

```sh
pnpm --filter @linksense/shared test
pnpm --filter @linksense/api exec vitest run test/application-installation-setup.test.ts test/application-installation-merge.test.ts test/applications.routes.test.ts
pnpm --filter @linksense/web exec vitest run --project components src/features/applications/application-setup-dialog.test.tsx src/features/applications/application-center.test.tsx src/features/applications/applications-workspace-panel.test.tsx
pnpm --filter @linksense/api exec tsx test/integration/application-distribution-postgres.ts
```

前端验证使用组件测试。浏览器视觉验收按项目约定保留为手动步骤。
