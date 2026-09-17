# LinkSense 帮助中心维护指南

`apps/docs` 是 LinkSense 面向最终用户和管理员的双语帮助中心。帮助正文使用 Markdown 编写，由 Docusaurus 渲染，并随 Web 生产镜像部署在 `/help/`。

## 内容结构

```text
docs/                                           # zh-CN，默认语言
  introduction.md
  user-guide/                                   # 普通用户指南
  admin-guide/                                  # 管理员指南，公开可读
  developer-guide/                              # 应用与嵌入开发指南
i18n/en-US/docusaurus-plugin-content-docs/current/
                                                 # en-US，与 docs/ 一一对应
sidebars.ts                                      # 显式目录与阅读顺序
src/css/custom.css                               # 极简主题、明暗模式与响应式
tests/content.test.mjs                           # 文档结构、链接和双语完整性
```

当前内容包含 65 个中文 Markdown 文件和 65 个英文镜像文件。每个功能使用独立文件；管理员文档可以被任何访问帮助中心的人阅读，但实际管理页面和管理操作仍由 LinkSense 权限控制。

这些 Markdown 同时是平台内置 `linksense-docs` Skill 的唯一内容来源。API 构建会校验中英文路径和元数据，再把原文复制到生产包；运行时由 API 将文档、检索目录、`SKILL.md` 和 `agents/openai.yaml` 一起物化到每个用户的只读内置 Skill。不要直接维护运行时副本，也不要在 Skill 源码中复制帮助正文。

帮助中心采用编辑式极简主题：顶部品牌标题为 `16px`，左侧使用白色或近白色表面、单层细边框和低对比选中态，正文阅读宽度约为 `780px`。视口达到 `1200px` 时，正文右侧显示 Docusaurus 原生二、三级标题锚点；锚点保持粘性定位并随滚动高亮，较窄视口自动隐藏以保护正文宽度。画布、文字、链接、输入框、Popover、边框、焦点和阴影均映射自 LinkSense 主应用语义 Token；hover、active 和弱化信息表面由对应主应用色与文档画布混合得到更轻的文档站状态色。普通控件保留 `0.7rem` 圆角，语言下拉和搜索结果 Popover 统一使用 `1.4 ×` 基准圆角。帮助中心使用紧凑图标层级：搜索图标、搜索清除图标与正文翻页 Chevron 为 `14px`，语言切换、搜索结果类型及跳转图标为 `16px`，正文提示框图标为 `18px`；缩小图标不会缩减交互控件的点击范围。搜索输入在本地索引与自动补全组件懒加载前后保持相同宽度；搜索结果使用连续列表，不使用插件默认的蓝色反白和独立卡片阴影。顶部搜索框与完整搜索结果页均使用自定义 SVG 清除按钮，不展示浏览器原生 `type="search"` 清除图标；完整结果页清除后会把焦点留在输入框中。正文翻页不显示 Infima 默认的 `« / »` 文字符号。主题只修改 Docusaurus classic 与本地搜索插件的视觉层，不改变 Markdown、双语路径、本地索引或静态部署结构。

## 新增或修改文档

1. 在 `docs/` 的对应功能目录创建或修改中文 Markdown。
2. 在英文目录的相同相对路径同步英文内容。
3. 每篇文档保留 `title`、`description` front matter 和一个一级标题。
4. 新增页面时同步更新 `sidebars.ts`，并保证目录顺序符合用户完成任务的顺序。
5. 站内链接使用相对 Markdown 链接，不跨越当前语言的文档根目录。
6. 如果新增 LinkSense 页面，同时更新 `apps/web/src/lib/help-center.ts` 的上下文跳转映射及测试。

帮助文档应说明用户可执行的步骤、前置条件、结果、失败处理和安全边界，不写入密钥、内部绝对路径、内部服务地址或无法从产品界面验证的承诺。

## 本地验证

在仓库根目录运行：

```bash
pnpm --filter @linksense/docs test
pnpm --filter @linksense/docs typecheck
pnpm --filter @linksense/docs build
pnpm --filter @linksense/api exec vitest run test/built-in-linksense-docs.test.ts
pnpm --filter @linksense/api build
```

运行 `pnpm dev:apps` 时，文档包先构建完整的中文和英文静态站点，再在内部端口 `3001` 提供预览，Vite 将整个 `/help/` 路径代理到该站点。Compose Watch 在 Markdown 或文档主题变更时重启文档进程并重新构建，避免两个 Docusaurus 开发进程争用生成目录。生产构建把相同的双语静态文件复制到 Web 镜像，由 Nginx 在 `/help/` 下提供。

开发启动会同时检查 Web 首页和 `/help/`。只有 Vite 与文档服务都可访问时，开发环境才会报告就绪；文档包依赖变化也会使开发镜像指纹变化并触发重建，避免旧容器只启动 Vite 后持续返回 502。

提交前必须确认：

- 中英文相对路径完全一致；
- 所有本地 Markdown 链接可解析；
- 中文和英文均可完成生产构建；
- LinkSense 中的帮助入口能按当前页面和语言打开目标文档；
- 新增页面在桌面目录、移动目录和本地搜索中可发现。
