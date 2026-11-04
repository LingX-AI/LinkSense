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

当前内容包含 66 个中文 Markdown 文件和 66 个英文镜像文件。每个功能使用独立文件；管理员文档可以被任何访问帮助中心的人阅读，但实际管理页面和管理操作仍由 LinkSense 权限控制。

这些 Markdown 同时是平台内置 `linksense-docs` Skill 的唯一内容来源。API 构建会校验中英文路径和元数据，再把原文复制到生产包；运行时由 API 将文档、检索目录、`SKILL.md` 和 `agents/openai.yaml` 一起物化到每个用户的只读内置 Skill。不要直接维护运行时副本，也不要在 Skill 源码中复制帮助正文。

帮助中心采用编辑式极简主题：顶部品牌标题为 `16px`，左侧使用白色或近白色表面、单层细边框和低对比选中态，正文阅读宽度约为 `780px`。视口达到 `1050px` 时，正文右侧显示二、三级标题锚点；复用 Docusaurus 滚动高亮，在同一条轨道上平滑移动指示条，当前链接同步 `aria-current="location"`。较窄视口使用正文上方的可折叠目录，减少动态效果时立即定位。画布、文字、链接、输入框、Popover、边框、焦点和阴影均映射自 LinkSense 主应用语义 Token。主题沿用 Docusaurus classic 和本地搜索插件，不改变帮助 Markdown 或内置 Skill 内容。

## 官网公开文档

`deployment/` 与 `i18n/en-US/docusaurus-plugin-content-docs-deployment/current/` 是一一对应的公开部署指南。设置 `LINKSENSE_PUBLIC_DOCS=1` 时，`scripts/prepare-public-docs.mjs` 将它们与原有帮助内容合并到忽略提交的 `.public-docs/`，由同一个 Docusaurus docs 实例编译。`sidebars.public.ts` 提供完整固定目录，跨章节导航不会切换左栏；分类默认折叠，当前页面所在的父级正常展开，手动展开的其他分类在站内切换时保留。默认的产品内 `/help/` 与内置 Skill 仍只收录原有用户、管理员及应用开发文档。

官网仓库运行 `pnpm docs:build`，默认从相邻的 `../linksense` 构建并输出到官网的 `public/help/`，无需复制维护 Markdown。使用其他检出目录时设置 `LINKSENSE_REPO`。正式文档源地址通过 `LINKSENSE_DOCS_SITE_URL` 设置。官网构建完成后，中文为 `/help/`，英文为 `/help/en-US/`，部署指南分别位于这两个前缀下的 `deploy/`。

公开构建还会读取官网通过 `LINKSENSE_WEBSITE_THEME` 传入的 `src/site-theme.css`，共用 `theme-tokens.css` 的字体、颜色、留白和页头尺寸，以及 `pill.css` 的按钮填充与文字滚动动画；`src/css/website.css` 将它们映射到文档布局。公开页头沿用官网的文档、社区两个主菜单及独立体验按钮，桌面搜索移到左栏；左侧激活条目与右侧当前锚点均保持常规字重，左侧只以背景区分。产品内置帮助继续使用原来的应用主题，不加载这份公开样式。

`static/img/github.svg` 复用官网已有的官方 GitHub Invertocat，用于仓库入口；GitHub 保留其商标权。

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
