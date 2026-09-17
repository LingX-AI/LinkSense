# 交互式应用资源匹配手动测试 / Resource matching test

测试包使用四个示例 UUID，不包含真实资源、凭证或数据。页面支持中文和英文，只通过平台 SDK 提交任务。

## 手动验证

1. 导入 `interactive-dependency-check-1.0.0.zip`，点击“检查所需资源”。通常四项名称左侧都会显示黄色圆形感叹号，表示尚未配置；配置完成后显示绿色圆形勾。
2. 不选择任何资源，直接导入：应成功保存，卡片显示 2 个插件/技能、1 个知识库和 1 个 MCP；未配置完成前无法执行任务或发布。
3. 从应用菜单打开“配置所需资源”。只匹配部分资源后保存，未选项应保留。再次打开，已选项应保留。点击选择器内部右侧的清除图标，选择应被清空，状态恢复黄色圆形感叹号；保存后再次打开应仍为空。
4. 匹配四类你拥有的有效测试资源。需要凭证的插件/MCP 须先完成它们各自的连接配置。随后打开应用并提交只读测试，在原生聊天中检查是否实际使用了所选资源；不要仅凭模型声称成功判定通过。
5. 共享给另一位组织用户，或申请上架：只能选择在线使用，接收者没有复制入口，不需重新匹配资源。不要用生产敏感数据测试。
6. 从同一应用菜单“更新应用包”上传 `interactive-dependency-check-1.1.0.zip`。前三类声明 UUID 不变，应保留映射；知识库声明 UUID 改变，应重新匹配或留空。即使留空，更新包也能成功，但新草稿不能发布。已共享版本仍应正常使用。
7. 停用一个绑定资源，检查运行失败后能在配置窗口重新选择同类资源。
8. 自动匹配测试：把源码 `manifest.json` 的示例 UUID 换成自己的资源 UUID，重新打包并作为新应用导入；应自动匹配。名称不参与匹配。

升级前先执行正式数据库迁移 `pnpm db:migrate:deploy`，再启动新版服务。本功能的迁移只新增资源映射字段，不删除原数据。

## 打包

先在仓库根目录运行 `pnpm --filter @linksense/shared build`，再运行 `pnpm --filter @linksense/api exec node ../../examples/interactive-dependency-check/build.mjs /绝对路径/输出目录`。目录中生成两个 ZIP，ZIP 根目录直接包含 `manifest.json` 和 `index.html`。为避免覆盖已有文件，输出目录中不能存在同名 ZIP。

## English

The example UUIDs are placeholders, not actual resources. Import v1.0.0 with all four entries unselected: import must succeed while task execution and publishing remain blocked. A yellow circled exclamation mark indicates an unconfigured resource; a green circled check indicates a configured resource. Use **Configure required resources** to save partial mappings, reopen, and complete setup with your own test resources. The clear icon inside the right side of each selected picker removes the selection and restores the warning icon; save and reopen to verify it stays empty. Then submit a read-only task and inspect actual tool activity in chat.

Share/list the app as an online service: recipients should not see an install option or need to remap resources. Update the same app using v1.1.0: the first three mappings should be retained, while the changed knowledge-base declaration needs a new match. Leaving it empty must not block package import or disrupt an already-published service. To test automatic matching, replace placeholder UUIDs in the source manifest with your own resource UUIDs and rebuild. Never use sensitive production data for this test.
