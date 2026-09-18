# 交互式应用预览标注

## 使用与边界

开发界面右上角、三点菜单左侧提供小尺寸“标注”按钮，不再占用预览顶部的独立说明栏。用户可点选或框选元素，点击选区旁的“问 LinkSense”，在浮窗中填写修改要求并添加标注，再继续选择其他位置。多条标注以编号显示，可统一发送，也可定位、删除或清空。请求进入当前开发对话，忙碌时进入该对话的待处理列表，不会创建新的试运行任务。

标注复用 HTML 预览的 Selecto 选择引擎、选区提示框、编号和批量发送组件，无新增依赖。开发应用的真实 DOM 保持可选，标注模式拦截点击和表单提交，退出后恢复应用操作。加载选择引擎不会替换应用自己使用的 Selecto 全局对象。

控制器显式接收消息输出函数：HTML 沙箱中的控制器通过 `postMessage` 回传；同源应用中的控制器由父窗口安装，通过绑定当前 iframe 和 document 的回调回传，预览卸载或页面替换后停止回传。不能将父窗口执行的 `postMessage` 误认为来自子窗口；消息来源由执行上下文决定，见 [HTML 标准的消息投递规则](https://html.spec.whatwg.org/multipage/web-messaging.html#posting-messages)。回调数据仍经相同的选区和几何结构校验。输入浮窗的标识只由选中元素的位置标识决定，滚动或布局变化不会重新创建浮窗或清空输入。

标注期间或仍有待发送标注时冻结当前预览和源码摘要、暂停自动同步。可退出标注模式操作应用后再回来继续添加，已有标注保留。发送成功后清空标注并恢复同步，失败保留标注。源码或预览包已变化时拒绝提交并提示重新标注；排队请求在实际执行前也会再次校验。标注只针对开发预览，不改变已安装应用的运行界面。

## 请求与数据

- 新增 `application_annotation` 请求和展示类型，复用现有标注请求、幂等提交、待处理请求、模型上下文和消息展示链路。
- 服务端校验当前任务所有权、开发工程与对话绑定、预览包、源码摘要和页面相对路径。实际文件位置来自服务端已授权工程，不能由选区提供绝对路径或运行地址。
- 模型接收用户修改要求与分离的、不可信的 DOM 参考内容。内置“LinkSense 交互式应用开发”Skill 要求先检查现有源码，再修改对应 HTML、CSS 或 JavaScript 并验证预览。
- 消息展示只保留应用名称、用户要求、选区数量和用于版本校验的标识；不展示 DOM 定位或内部提示词。应用改名、删除后仍保留已有消息的展示信息。
- 不涉及数据库结构迁移。已有应用无须重新导入、创建或发布；原有 HTML/Office 标注格式继续有效。新增共享协议应随 API、Web 和 Runner 一起发布，旧版本服务不支持新的标注类型。

## 验证（2026-09-18）

已执行并通过：

- `pnpm --filter @linksense/shared test`：66 个文件、535 项测试，含新请求边界、安全展示及旧 HTML 标注数据。
- `pnpm --filter @linksense/api test test/application-annotation.test.ts test/annotation-prompt.test.ts test/conversations.service.test.ts test/conversations.routes.test.ts test/built-in-application-builder.test.ts test/user-home-capability-materializer.test.ts`：6 个文件、431 项测试，覆盖直接发送、排队、排队后的版本变化、权限、磁盘变化、历史展示及 Skill 更新。
- `pnpm --filter @linksense/web exec vitest run --maxWorkers=2 --project components --project shared-components`，按应用标注、开发面板、交互式应用、开发对话、标注批量发送、HTML 预览与 i18n 文件筛选：14 个文件、374 项测试。最终加载器调整后重跑标注及 HTML 预览相关测试：6 个文件、54 项通过。加载器测试在 jsdom 子窗口中使用真实 Selecto，验证选区消息、阻止误触和退出后的恢复；UI 测试覆盖中文、英文和缺失语言回退。
- `pnpm --filter @linksense/runner test test/context.test.ts`：21 项测试。
- `pnpm --filter @linksense/api exec tsx test/integration/application-development-postgres.ts`：独立临时 PostgreSQL 验证通过。包含升级后已有应用、真实预览包绑定、跨对话拒绝、过期源码拒绝及标注不新增任务。容器和临时目录已清理。
- Shared 构建，API/Web/Runner 类型检查，受影响文件 ESLint，API/Web 生产构建及 `git diff --check`：通过。Web 构建仍有既有大资源包提示。

按项目约定，本次没有运行浏览器自动化，也未调用真实模型完成一次可视化修改。上述验证覆盖组件交互、真实选择库、请求链路、模型输入构造及数据库集成；浏览器视觉效果和真实模型修改质量未作端到端验收。

### 与 HTML 标注流程对齐后的补充验证

- 先增加回归测试，复现选区浮窗缺失及选区位置变化后输入丢失；修复后核心选择、编号与应用浮窗测试共 35 项通过。
- 完整相关 Web 回归命令：`pnpm --filter @linksense/web exec vitest run --maxWorkers=2 --project components --project shared-components src/features/applications/application-annotation-preview.test.tsx src/features/applications/application-annotation-runtime.test.ts src/features/applications/application-development.test.tsx src/features/applications/interactive-application-page.ui.test.tsx src/components/media/html-preview src/components/media/office-preview/office-selection-prompt.test.tsx src/features/conversations/conversation-office-preview.test.tsx src/features/conversations/office-annotation-batch-tray.test.tsx src/i18n.test.ts`。220 项中 219 项通过；全局术语测试因已有的 `applications.showNativeChat: "显示对话"` 文案未列入允许项而失败，本次未改动该文案或放宽测试规则。标注相关测试全部通过，覆盖真实 Selecto 子窗口选区、两处标注、弹窗输入、编号、退出和重新进入、删除和定位、批量发送、失败保留及中英文与回退文案。
- API 应用标注、内置开发 Skill 与运行时内容发布测试：3 个文件、40 项通过；用户指南内容更新后同步刷新内置运行时摘要，验证已有任务快照按摘要更新。
- Web 类型检查、受影响文件 ESLint、Web/API 生产构建及差异空白检查通过。Web 构建仍有既有的大资源包提示。
- 本次没有修改数据库或标注 API 数据结构，已有应用和 HTML 标注无需重建或重新发布。未运行浏览器自动化或真实模型端到端修改。
