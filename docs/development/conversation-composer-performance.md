# 开发任务输入性能

## 原因与调整

任务输入值原先保存在 `ConversationPage` 的 React 状态中。每次输入都会重新执行任务页面及完整的消息、工具记录渲染；历史内容越多，输入时需要处理的工作越多。开发面板每 1.5 秒检查源码时，查询的加载状态还会使没有变化的应用预览及其聊天区域重新渲染。

输入值改为每个任务页面独立创建的 `ConversationComposerValue`，由 `ConversationDraftComposer` 使用 React 原生 `useSyncExternalStore` 订阅。输入事件只更新输入区域；父页面仍能读取即时输入值、恢复草稿、清空输入，以及使用函数式更新保留发送失败后新输入的内容。草稿保存订阅同一输入值，并继续检查任务范围及提交状态。

开发预览使用 React `memo`，跳过轮询状态改变造成的重复渲染。应用、测试任务、诊断回调及运行页自身查询变化仍然可以更新预览，不影响源码更新后的实时显示。

复用已有 React 与输入组件，没有新增依赖、后端接口或数据库迁移。草稿存储键及结构保持不变，原有草稿可以继续读取。开发与测试输入值各自独立。

构建同时发现测试历史面板向日期函数传入了未收窄的语言代码；该调用改为使用现有 `normalizeLanguage`，并以中文作为缺失语言的回退。

## 回归证据

- 包含 100 条报告列表项的任务中，连续输入 10 个字，修复前额外渲染历史 10 次，修复后为 0 次。输入值、发送按钮及本地草稿仍即时更新。
- 连续三轮源码检查未发现变化时，修复前额外渲染预览 3 次，修复后为 0 次；保留同一个预览节点。
- 覆盖中文输入法组合输入、提交、程序恢复及清空、失败恢复时保留新输入、光标选择保留、最新禁用状态和不同输入框之间的隔离。
- 应用流程测试项目的 21 个文件共 238 项通过，包括任务提交、草稿、规划、设置及账户切换等流程。
- 开发面板与日期、国际化回归共 102 项通过，包含中英文及缺失翻译回退。
- Web 类型检查、所改文件的 ESLint、生产构建通过。生产构建保留已有的超过 500 kB 资源块提示。

按项目要求未运行浏览器自动化，也没有执行全仓库测试。上述性能结论来自渲染次数回归，未测量真实浏览器中的逐键延迟。

主要验证命令：

```sh
pnpm --filter @linksense/web exec vitest run src/test/application/composer-performance.test.tsx src/features/conversations/conversation-draft-composer.test.tsx src/features/conversations/conversation-composer.test.tsx src/features/conversations/conversation-composer-input.test.tsx src/features/conversations/conversation-local-draft.test.ts src/pages/conversation-pages.test.tsx src/features/applications/application-development.test.tsx src/pages/conversation-workspace.test.tsx src/features/applications/interactive-application-page.ui.test.tsx --maxWorkers=3
pnpm --filter @linksense/web exec vitest run --project application --maxWorkers=3
pnpm --filter @linksense/web exec vitest run src/features/applications/application-development.test.tsx src/i18n/date.test.ts src/i18n.test.ts --maxWorkers=3
pnpm --filter @linksense/web typecheck
pnpm --filter @linksense/web exec eslint src/features/conversations/conversation-composer-value.ts src/features/conversations/conversation-draft-composer.tsx src/features/conversations/conversation-draft-composer.test.tsx src/pages/conversation-pages.tsx src/features/applications/application-development-panel.tsx src/features/applications/application-development.test.tsx src/features/applications/application-test-history.tsx src/test/application/composer-performance.test.tsx --max-warnings=0
pnpm --filter @linksense/web build
```
