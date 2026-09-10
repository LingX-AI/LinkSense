# LinkSense AI 工作空间概念演示

直接打开 `index.html`。样式已经由项目现有的 Tailwind CSS 4 编译并内联；图片为内联 SVG，无 CDN、字体或运行时包依赖，可离线查看。界面仅中文。

演示范围：

- 默认展示创意工作室：作品主区、空间导航、AI 协作面板。
- 总览、成果库、资料阅读、持续运行页面均可切换。
- 支持四季、速度、播放暂停、选中背景和专注预览。
- 示例指令按关键词调整季节和速度，无模型或外部服务调用。
- 可保存及恢复版本；版本、输入与开关状态仅在本次页面会话中保留，刷新后重置。
- 下载按钮导出当前画面的静态 SVG。
- 计划开关仅演示状态，不调度任务、不发送通知。
- 搜索入口支持 Cmd/Ctrl + K；版本列表与对话框使用原生 HTML 元素。

独立演示文件，未接入产品路由、API 或数据库，也未修改现有业务实现。

## 源文件

- `app.mjs`：页面、SVG 场景与 DOM 交互。
- `model.mjs`：指令解析和版本状态。
- `copy.mjs`：中文文案。
- `theme.css`：Tailwind 主题与全局焦点样式；动画关键帧只用于作品的车轮旋转。
- `build.mjs`：使用已有 Tailwind 编译器生成单文件 HTML。

布局、颜色、间距、响应式和控件状态均使用 Tailwind utility classes。实现参考 [Tailwind 官方文档](https://tailwindcss.com/docs/styling-with-utility-classes)。

在仓库根目录运行：

```sh
pnpm exec node examples/ai-workspace-demo/build.mjs
pnpm --filter @linksense/web exec vitest run --root ../.. --config examples/ai-workspace-demo/vitest.config.mjs
pnpm exec node apps/web/node_modules/eslint/bin/eslint.js --config examples/ai-workspace-demo/eslint.config.mjs examples/ai-workspace-demo/*.mjs
```

依照项目要求，未使用 Playwright 或内置浏览器自动验证；单元测试通过 JSDOM 检查交互和输出契约，不验证实际像素布局。
