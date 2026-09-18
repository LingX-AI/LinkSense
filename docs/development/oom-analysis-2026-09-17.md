# 开发环境 OOM 排查与优化方案（2026-09-17）

本报告基于这台机器的 Docker 配置、运行容器、cgroup、Node 内存采样、隔离导入实验及当前代码。下列优化参数是待压测的开发环境方案，尚未写入 `.env` 或修改 Docker Desktop 设置。此前完成的进程恢复修复不能替代内存容量治理。

**结论与证据边界**

- Docker Desktop 设置为 `MemoryMiB=6144`、`SwapMiB=1024`、6 CPU。这是所有容器及构建共享的 Linux VM 总预算。Docker 实际报告可用总物理内存约 5.79 GiB，不能给每个服务分别按 6 GiB 计算。官方说明见 [Docker Desktop 资源设置](https://docs.docker.com/desktop/settings-and-maintenance/settings/#advanced)。
- 本任务前半段已在故障 API 容器确认 `OOMKilled=true`、`memory.events` 的 `oom_kill=1`，API 服务子进程消失，而 pnpm/tsx watch 父进程继续存活，导致容器没有重启、4000 端口持续拒绝连接。Runner heartbeat 转发到 API 失败，随后返回 503。这解释了截图中的连续代理错误。
- 故障 API 当时 `memory.max=max`，容器历史峰值约 1.32 GiB。当前 API、Runner、Web、Postgres、Redis 的 Docker `HostConfig.Memory` 仍为 0，即没有独立硬上限。整体内存竞争需要治理，不能把 API 被选中杀死等同于 API 独自耗尽了 6 GiB。
- Docker 日志保留了 07:17:10 UTC 的 OOM 通知，但读取内核环形日志时，原始故障的进程明细已被后续日志覆盖。剩余明确的 cgroup OOM 明细属于本任务此前主动执行的 192 MiB 隔离回归测试，不能拿来证明用户故障的触发进程。因此目前不能断言“每次都是 docs 构建”或“确定存在某个内存泄漏”。
- 当前资源配置缺少跨 Worker、后台处理和构建的统一预算；驻留内存和峰值叠加是已经确认的容量风险。确定每次 OOM 的直接触发者，还需要保留故障前后的连续指标。

**现场内存占用**

以下是本轮多个时刻的 `docker stats --no-stream` 快照范围，不是固定预留，也不是严格压测上限；开发过程中存在其他代码热更新。

| 组件 | 观测占用 | 说明 |
| --- | ---: | --- |
| API，含 Office 子进程 | 634–864 MiB | 包含热更新重启采样；启动即加载完整服务图 |
| Web 开发服务 | 507–1187 MiB | 启动和模块预处理后显著变化；此前排查还观察到约 1.6 GiB 峰值 |
| Runner controller | 192–321 MiB | 不包含动态任务 Worker |
| PostgreSQL | 170–264 MiB | 当前数据和连接负载下的快照 |
| Redis | 12–17 MiB | 未配置容器硬上限 |
| MinIO | 231–286 MiB | 独立容器，允许使用最高 2 GiB |
| OnlyOffice | 102–129 MiB | 独立容器，允许使用最高 4 GiB；4 GiB 不是已经占满 |
| 静态帮助站点 | 7–9 MiB | 文档的构建进程不计入此 nginx 容器 |
| 一个动态任务 Worker | 约 690 MiB | 一次现场快照；硬上限为 4 GiB，禁用额外 swap |

没有动态任务 Worker 时，容器合计已观察到约 2.1–2.9 GiB。Docker daemon、BuildKit、内核和文件缓存还会占用 VM 内存。`docker stats` 会扣除部分可回收文件缓存，因此不能用容器数值相加来代替 VM 的 `MemAvailable`。

VM 的 1 GiB swap 曾只剩约 67 MiB，后续一度约 12 MiB。它说明此前有明显内存压力；单凭 swap 已用空间不能证明当前仍在缺内存。文件缓存和可回收 slab 也不能直接判定为泄漏，应同时看 `MemAvailable`、内存 PSI、swap 读写速率和 OOM 计数。

**API 为什么还没执行任务就比较大**

一次运行进程采样：API Node RSS 约 731 MiB，主线程 JS `heapUsed` 约 353 MiB，`external` 约 94 MiB。RSS 包含整个进程的原生内存和其他线程；其他字段的范围不同，不能简单相加。`--max-old-space-size=768` 仅约束 V8 老生代，无法约束整个 Node 进程，更不包含 Office 子进程。参见 [Node 内存指标定义](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage)。

为拆分启动成本，使用 API 当时的同一镜像，分别启动全新隔离容器；每个容器无网络、无业务数据挂载，限制 1280 MiB RAM 且无额外 swap，执行 Node 24 + tsx，导入一个入口后主动 GC。没有连接数据库、创建服务或发起模型请求。

| 单独导入的入口 | GC 后进程 RSS | GC 后主线程 heapUsed |
| --- | ---: | ---: |
| Node + tsx 基线 | 56 MiB | 7 MiB |
| `@linksense/shared` | 143 MiB | 49 MiB |
| `gpt-tokenizer/encoding/cl100k_base` | 90 MiB | 16 MiB |
| `exceljs` | 83 MiB | 15 MiB |
| `@larksuiteoapi/node-sdk` | 144 MiB | 35 MiB |
| `@microsoft/teams.apps` | 102 MiB | 23 MiB |
| API `src/index.ts`，未执行 main | 226 MiB | 70 MiB |
| API `src/services.ts`，未创建服务 | 471 MiB | 223 MiB |
| API `src/app.ts`，未创建 Fastify 实例 | 275 MiB | 100 MiB |

9 个实验全部正常退出，cgroup OOM 计数均为 0。结果包含各自依赖和重复基线，不能相加，也不能直接承诺拆分能省掉相同数值。它们证明服务图和模块初始化本身已有较高成本；单个 tokenizer 不是全部原因。原始实验仅使用启动时镜像，后续工作区改动不属于该固定实验。

**代码中的内存放大路径**

1. `apps/api/src/services.ts` 静态导入聊天渠道、Office/知识库处理、多个模型 SDK 等服务图；`packages/shared/src/index.ts` 是统一导出入口。应先按调用域测量，再拆分可选依赖，避免所有进程加载全部运行时 schema 和 SDK。
2. `apps/api/src/modules/knowledge-processing/pipeline.ts` 在 API 进程中启动 BullMQ 消费者。现场配置解析并发 4、切块/父块/embedding/indexing 各 8、activation 16、维护重建 5；普通队列与文档重建队列分别设置并发，当前不存在覆盖所有阶段的统一字节预算。大文档、图片解码、Buffer、向量数组可能同时驻留。并发数字不是当时的实际执行数，也不能全部按等量内存相乘。
3. `apps/runner/src/controller/docker-worker-provider.ts` 为每个 Worker 设定 4096 MiB 内存上限；`worker-manager.ts` 按用户或服务会话获取 Worker，没有 VM 总内存准入检查。全局并发任务上限 20 是数量限制，不是内存预留。
4. app-server 进程上限 20 被传入每个 Worker，并不是整台 VM 只允许 20 个进程。原生进程和 Worker 的空闲 TTL 都是 900 秒；任务执行结束后，资源还可能继续驻留。Worker 回收还会等待其中用户进程、任务和 app-server 全部空闲。
5. Worker `/tmp` 允许 4096 MiB，`/dev/shm` 允许 2048 MiB。这是按需使用的容量上限，实际使用计入 Worker 内存限制，不能误算成每个 Worker 启动就额外分配 6 GiB。它们仍可能让临时文件与进程争抢同一个 4 GiB 配额。
6. 文档 nginx 很小，但 Docusaurus/Webpack/Terser 构建不在该容器的运行期账上。项目安装版本支持 `TERSER_PARALLEL=false`；此前已使用此现成功能关闭压缩进程池并串行构建服务。BuildKit 内部阶段、依赖安装及其他任务同时构建仍需要另外预算。

**实施顺序**

| 优先级 | 措施 | 收益和必要约束 |
| --- | --- | --- |
| P0 | 把 Docker VM、所有常驻容器、动态 Worker 和构建纳入同一容量预算 | 限制总量，优先保证 API 可响应。复用 Docker/cgroup 指标和现有 Redis 协调；并发准入必须原子化，不能多个请求都看到相同余量后同时放行 |
| P0 | 将构建设为有界任务，和重 Worker/知识库批处理错峰 | 保留串行 rebuild、docs 1024 MiB 老生代及禁用 Terser 并行；另外评估专用 BuildKit builder 的内存、CPU及 `max-parallelism`，不能误以为 Compose 服务内存上限会限制镜像构建 |
| P0 | 开发环境先降低任务并发与空闲驻留 | 下表为压测起点；延迟非必要预热，低内存时优先回收符合现有空闲条件的进程，不中断活动任务，不重放 Codex turn |
| P1 | 拆分 API 的可选 SDK 加载及共享包导出边界 | 优先处理未启用的渠道、按需导入导出功能、知识库专属依赖；懒加载只降低未使用时的成本，模块用过后仍会缓存，不能当成卸载机制 |
| P1 | 把知识库队列消费者和 Office 转换放到独立进程/容器预算 | 复用已有 BullMQ 队列和处理器，API 保留提交、查询和接口；普通/重建队列应共享总预算，避免处理文档时挤死 HTTP 服务 |
| P1 | 单独测量 Vite 冷启动、依赖预处理和反复 HMR | JS 堆、原生内存与进程总 RSS 分开看；审查大体积预览插件和依赖扫描范围。先复用当前 Vite 配置能力，不凭猜测降级或大范围升级依赖 |
| P2 | 增加可持续的内存诊断指标与故障快照 | 保存 VM available/PSI、容器 current/peak/events/swap、Node heap/external、Worker 数、构建阶段、启动时间。仅记录数值和阶段，不导出业务堆内容或环境密钥 |

BuildKit 的配置能力已核对官方文档：[并行度控制](https://docs.docker.com/build/buildkit/configure/#max-parallelism)、[docker-container driver 资源选项](https://docs.docker.com/build/builders/drivers/docker-container/)。应显式指定开发专用 builder，并验证镜像导出到本地，避免影响发布构建和其他项目。

**坚持 6 GiB 的开发配置候选**

这些是起始压测值，不是已经验证可承载全部工作负载的保证，也没有自动修改用户环境：

| 配置/约束 | 当前值 | 建议起点 |
| --- | ---: | ---: |
| `LINKSENSE_MAX_CONCURRENT_CONVERSATIONS` | 20 | 2 |
| `LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT` | 每 Worker 20 | 每 Worker 2 |
| `LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS` | 900 | 60–120 |
| `LINKSENSE_WORKER_IDLE_TTL_SECONDS` | 900 | 120 |
| `LINKSENSE_WORKER_MEMORY_MB` | 4096 | 2048，先验证典型任务 |
| Worker tmpfs / shm | 4096 / 2048 MiB | 512 / 512 MiB，验证浏览器、解压和大文件任务 |
| KB parsing / chunking / parenting | 4 / 8 / 8 | 1 / 2 / 1 |
| KB embedding / indexing / activation | 8 / 8 / 16 | 2 / 2 / 2 |
| KB maintenance rebuild | 5 | 1 |
| 同时驻留 Worker 总数 | 无独立全局准入上限 | 先以 1 个为开发验收场景，控制器启动探针也计入预算 |

最后一行需要实现真正的全局准入，不能伪造一个尚不存在的环境变量。减少任务并发也不会自动清除已有的空闲 Worker。降低 TTL 会增加下一次冷启动的等待；降低 tmpfs/内存上限可能使原先可完成的大任务失败，所以必须验证具体工作负载，不能把 OOM 转移到 Worker 后就宣布解决。

实测高位常驻已经约 2.9 GiB，加一个允许达到 4 GiB 的 Worker 就可能超过 5.79 GiB，尚未计入构建和 VM 开销。最后一段没有任务 Worker 的采样中，VM `MemAvailable` 最低约 2.24 GiB；若要求保留 0.75 GiB 余量，此时也不能安全承诺再分配完整的 2 GiB。必须先降低常驻占用或等待余量恢复，不能仅改小 Worker 上限就放行。再叠加文档/依赖构建或批量文档处理，更没有可靠余量。若要保留当前 4 GiB Worker、并行构建和多任务能力，应改用更大的 VM 或独立构建/Worker 宿主，而不是承诺 6 GiB 无条件承载。

容器硬上限必须与服务实测峰值、Worker 总准入配合；不能给每个容器各设一个看似合理但总和远超 VM 的上限。API/Web 上限应在冷启动和热更新压测后确定，不能按空闲 RSS 直接设置。增加 swap 只能缓冲部分压力，会增加延迟；它不是内存泄漏修复，也不能帮助已经禁止额外 swap 的任务 Worker。

**验收与本轮验证**

- 验收应固定一份代码和测试数据，分别覆盖：5 次冷启动、10 次热更新、3 次双语 docs 重建、典型任务及浏览器任务、知识库大文件处理、任务结束后的空闲回收。再测试允许的组合，重点是构建与任务同时到来时准入能否正确排队/拒绝。
- 建议门槛：完整测试窗口没有新的 `oom_kill`；服务不因内存被杀；VM `MemAvailable` 最低仍保留约 768 MiB；空闲 TTL 后进程/Worker 数回落；相同负载多轮后 GC 后堆基线不持续抬升。该数值是验收目标，需要按测量调整，不是自动扩容策略。
- 本轮已完成 Docker 配置、容器限制、进程/cgroup/VM 指标检查及上述 9 个隔离导入实验。原生依赖和服务图的留存占用已量化；长期泄漏、2 GiB Worker 对全部现有任务的适用性、低内存组合负载尚未验证。
- 最后于北京时间 16:03:50–16:05:50 采集 18 个快照：没有任务 Worker，容器总占用约 2269–3004 MiB，VM 最低 `MemAvailable=2292 MiB`；API 有两次源码热更新启动记录。最终 API/Runner/Web 的 cgroup `oom`、`oom_kill` 均为 0。这只能证明该短窗口没有 OOM，不能替代长期泄漏或组合负载测试。
- 本轮采样脚本关闭 inspector 时错误地在调试表达式中使用动态 import，触发 Node `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`，造成 API/Runner/Web 各重启一次；已确认调试端口关闭，后续实验全部改在隔离容器执行。这些重启不是业务 OOM。
- 期间并发开发引入 `apps/api/src/modules/web-sites/resources.ts` 的括号未闭合，造成 `TransformError` 和 API 重启。已补齐括号；相关资源测试最终 14/14 通过。最新容器检查 API、Runner、Web 均健康且 OOM=false。这一语法修正不改变网页资源接口契约或存储结构。
- 验证命令：`pnpm --filter @linksense/api exec vitest run test/web-sites.resources.test.ts` 最终 14/14 通过；`pnpm --filter @linksense/api exec eslint src/modules/web-sites/resources.ts --max-warnings=0` 通过；`pnpm --filter @linksense/api exec tsc -p tsconfig.json --noEmit --pretty false` 初次被并发开发的其他类型错误阻断，工作区更新后最终复跑通过。Web 同源 bootstrap 和 API readiness 最终均 HTTP 200。本轮没有运行全量测试、迁移、删除数据或修改全局 Docker 内存设置。

此前已经落地并验证的是：API/Runner 直接作为 init 子进程运行、OOM/SIGKILL 自动恢复、完整就绪检查、源码同步后重启、串行重建和 docs 构建堆限制。它们解决故障恢复及部分峰值；本报告 P0/P1 的全局预算与常驻内存优化仍是下一阶段实施项。
