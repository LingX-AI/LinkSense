# 部署后的页面更新

Web 和 API 根据同一份源码快照生成 SHA-256 构建标识，涵盖两端代码、共享协议、依赖锁文件和构建配置。生成的 Prisma 文件不参与摘要，避免不同平台的产物造成误报。同一份输入重复构建会得到相同标识。此机制不涉及数据库结构或业务数据迁移。

Docker 构建通过只读 BuildKit 源码挂载计算标识，不依赖 Git 元数据或人工维护的 `latest` 标签。API 构建将标识写入 `dist/build-info.json`，Web 构建将其编译到页面代码并输出 `/build-info.json`。本地 `pnpm build` 使用相同的摘要逻辑。生产 API 缺失或损坏构建元数据时启动失败；开发环境继续使用热更新，不执行构建版本拦截。

第一方网页请求携带 `x-linksense-client-build`，API 通过 `x-linksense-build` 返回自身标识。版本不一致时，API 在解析请求内容和执行业务逻辑前返回 `409 CLIENT_UPDATE_REQUIRED`。网页在解析业务响应前检查标识，避免旧 Zod schema 将新响应误判为无效数据。普通请求、上传、下载、任务事件流与知识库事件流均参与检查。发现更新后阻止后续业务请求，保留 bootstrap 检查，不自动重放写操作。

此标识用于协调网页更新，不是身份凭证。没有该请求头的外部调用、嵌入 SDK、OAuth 回调、健康检查和浏览器资源导航继续执行其原有认证授权规则。既有业务记录、安装资源和公开 API 数据结构不因该机制改变。

现有 bootstrap 每 30 秒检查 API 状态，并在窗口恢复焦点和网络恢复时检查。额外监听 Web 资源加载失败、窗口恢复、联网和从浏览历史缓存恢复，读取不缓存的 Web 构建元数据。离线、维护响应和同版本资源错误不会被当成系统更新；路由加载错误显示可重试的本地化提示。

更新弹窗复用管理员系统维护弹窗的布局、渐变背景、遮罩与滚动区域，顶部使用刷新图标，描述为“系统有更新，请刷新页面后继续”。显示“更新页面”“稍后更新”按钮，强制刷新帮助按 Windows/Linux、Mac、手机/平板分为三行，不显示浏览器名称。弹窗出现不会自动刷新或卸载现有页面；选择稍后更新后仍有入口重新打开。用户应先复制未提交内容。点击更新后，确认 Web 和 API 均可访问且构建标识一致，再以带构建标识的 URL 重新加载，保留原路由、查询参数和片段；新版加载后移除临时参数。不会清空登录信息、站点存储或循环自动刷新。

HTML、Web 构建元数据和错误资源响应禁止缓存；带哈希的成功静态资源继续长期缓存。API 默认使用 `private, no-store`，保留有明确用途的资源缓存策略。代理层应保留这些响应头，CDN 不应缓存 HTML、构建元数据或业务 JSON。

源码生产部署脚本逐个在 API 容器内执行 `node dist/commands/verify-web-build.js http://web:80/build-info.json`。Web/API 不一致则部署校验失败，生产部署保持维护状态。发行安装继续使用同一份已校验发布清单中的不可变镜像；没有把新的容器命令加入通用修复脚本，因为修复脚本还支持修复不包含该命令的历史镜像。需要额外校验新版发行部署时可逐个执行上述命令。禁止混用不同构建的 Web/API 镜像。

首次启用该机制时，升级前已打开的页面没有版本检查代码，仍可能需要手工刷新一次。后续版本由弹窗接管更新。刷新不迁移未提交表单，也不替代未来业务 Schema 变更所需的兼容性评估。

验证使用 Vitest、Fastify inject 和 Node 单元测试，覆盖旧页面跨部署、无效响应分类、重复部署、更新失败与重试、草稿保留、请求不重放、CORS、构建摘要、缓存策略及发布检查。依照项目约定，不默认运行浏览器自动验证。

## 本次实现验证（2026-09-17）

- 前端相关 Vitest 测试 13 个文件、186 项通过；后端 `test/client-build.test.ts`、`test/cors.test.ts`、`test/system.routes.test.ts` 共 44 项通过。
- `pnpm --filter @linksense/shared test`：470 项通过。
- `pnpm exec node --test scripts/application-build.test.mjs scripts/dev.test.mjs scripts/production-deployment-control.test.mjs`：55 项通过；此前包含部署、发行安装和强制停止的扩展脚本测试共 157 项通过，后续新增的逐副本失败回归包含在前述 55 项中。
- 本次修改的前后端文件均通过 ESLint；`git diff --check` 通过。
- 最后单独执行 `pnpm --filter @linksense/web typecheck`：通过。
- 过程中前后端类型检查与生产构建曾通过。最终复查时，共享工作区其他正在进行的改动导致 `pnpm --filter @linksense/api typecheck` 失败：`applications/development-service.ts` 引用了不存在的 `sharedFile`，`interactive-dependency-lifecycle.test.ts` 缺少 `developmentOnly`，`web-sites.routes.test.ts` 使用了未定义的错误码 `UNAUTHORIZED`。这些文件没有因本任务被改写。
- 因共享工作区仍在变动，不能将当前构建目录视为已验证的发布产物。待其他改动完成后，执行 `pnpm --filter @linksense/api typecheck`、`pnpm --filter @linksense/api build` 和 `pnpm --filter @linksense/web build`，并检查两端 `build-info.json` 一致，再发布。
- 未执行生产部署、数据库操作或浏览器自动验证。
