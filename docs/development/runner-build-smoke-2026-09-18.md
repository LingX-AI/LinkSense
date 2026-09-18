# Runner 镜像构建阻断开发启动：2026-09-18

## 根因与影响

本次 `pnpm dev` 在 `Dockerfile.runner` 的 `build 5/5` 退出，错误为 `Core MCP in Default mode exposed an unexpected tool registry`，退出码为 1。

应用开发模块已经注册 `update_application_metadata`，Default 模式实际提供 15 个工具；`deploy/docker/runner-runtime-smoke.mjs` 手工维护的预期列表只有 14 个。工具注册合法，但构建检查因重复清单没有同步而失败。现有部署测试主要匹配脚本文本，没有启动实际 MCP 进程验证两者一致性。

开发启动顺序是：准备开发镜像、基础设施和存储 → 检查数据库 → 构建任务执行器镜像并校验 → 启动 API、Runner、Web 和 Docs → 验证就绪。因此失败发生在应用容器启动之前，并非执行业务接口时崩溃，也不是本次构建发生 OOM。此前的 API 恢复问题见 [2026-09-17 排查记录](startup-recovery-2026-09-17.md)，不能用本次结论替代对其他故障的判断。

## 修复

- 删除构建脚本中的重复工具清单，复用部署包内的 `coreMcpToolNamesFor` 模块声明；继续启动真实 stdio 服务，严格比较实际工具列表。
- 保留镜像中任务身份、文件只读权限、生产依赖导入和文档转换检查，以及 Default/Plan 两种模式验证。
- 工具不一致时输出预期名称和实际名称；返回格式错误时输出明确的 `tools/list` 诊断。
- 将 MCP 检查导出为可测试入口，命令行执行时仍先验证任务身份和部署目录权限。
- 新增自动纳入 `pnpm test:deployment` 的 8 项回归测试：真实源码 MCP 进程、新增模块声明、缺失/额外/重复工具、Plan 模式越界、错误列表与名称格式。真实源码测试使用开发导出条件，避免旧 `dist` 产物掩盖问题，并独立断言 Plan 模式的允许清单。

修改没有改变业务接口、工具权限、已有持久化数据、数据库结构或迁移，也没有跳过镜像检查或使用旧镜像回退。

## 验证

回归测试在修复前重现了截图中的相同错误，修复后通过。

| 验证 | 结果 |
| --- | --- |
| `node --test scripts/runner-runtime-smoke.test.mjs` | 8 项通过 |
| `pnpm test:deployment` | 364 项通过，无跳过 |
| `pnpm --filter @linksense/runner exec vitest run test/core-service-registry.test.ts test/application-builder-service.test.ts --maxWorkers=2` | 23 项通过 |
| `pnpm --filter @linksense/runner typecheck` | 通过 |
| 修复脚本与新回归测试的 ESLint recommended 检查 | 0 错误、0 警告 |
| `node --check` 与 `git diff --check` | 通过 |
| 实际 `pnpm dev` | 59.902 秒就绪，包含 Docs 和任务执行器镜像重建；共享包和 Runner 编译、生产部署包检查均通过 |
| 再次 `pnpm dev` | 2.990 秒就绪，复用已验证镜像 |

实际 HTTP 验证：Web 首页、经 Web 代理的 `/api/v1/system/bootstrap` 与 `/api/v1/system/health/ready`、直接 API 就绪接口均返回 200。API、Runner、Web、Docs 均 healthy，`OOMKilled=false`。

验证范围与既有问题：未执行全仓所有业务测试或长时间内存压测。额外对 `scripts/deployment.test.mjs` 执行 ESLint recommended 时发现 9 项既有诊断；与 HEAD 逐项比较规则、消息和列位置完全一致，本次没有新增，也没有修改不相关代码。开发启动仍提示历史迁移校验和与当前检出不一致；本次数据库检查没有执行迁移或改写历史记录。
