# LinkSense Sandbox Provider 可行性调研

调研日期：2026-09-10

## 结论

可以实现，而且应该把它拆成两个边界清楚的问题：

1. **本地无 Docker 开发模式**：复用 LinkSense 已有的 `standalone` Runner，让 Codex app-server 由 Node.js `child_process` 启动。这能解决开发者本机没有 Docker 时的启动问题，但它不是安全沙箱，只允许单用户、可信代码、本机回环地址下使用。
2. **生产 Sandbox Provider**：由 LinkSense Runner Controller 通过 Provider 创建一个完整的远程 LinkSense Worker，Worker 内仍运行原生 Codex app-server。Vercel Sandbox、Cloudflare Sandbox、腾讯云 Agent Sandbox、阿里云 FC Agent Sandbox 都有实现所需的命令、文件和生命周期原语；Vercel、腾讯云和阿里云最适合先做适配，Cloudflare 也可行，但需要额外部署 Worker/Durable Object 网关。

不要把 Node.js `child_process` 命名成安全 Sandbox。它只是在同一操作系统用户下创建子进程，不能隔离宿主文件、网络、进程和凭据。Vercel/Cloudflare/腾讯云/阿里云的专用 Sandbox 产品才提供真正的远程隔离边界。

## 当前 LinkSense 已经具备的基础

当前代码其实已经有无 Docker 执行路径：

- Runner 配置原生支持 `controller`、`worker`、`standalone` 三种模式，且默认值是 `standalone`：[`apps/runner/src/config.ts`](../../apps/runner/src/config.ts#L72)。
- 只有 `controller` 模式会创建 `DockerEngineClient`；`standalone` 会直接进入 execution runner：[`apps/runner/src/index.ts`](../../apps/runner/src/index.ts#L60)。
- execution runner 已经使用 Node.js `spawn()` 启动 `codex app-server`，通过 stdio 维护 JSON-RPC 连接：[`apps/runner/src/codex/json-rpc-client.ts`](../../apps/runner/src/codex/json-rpc-client.ts#L101)。
- 当前真正导致 `pnpm dev` 强制依赖 Docker 的是开发编排脚本：它固定构建镜像、启动 Compose 基础设施并构建 Worker image：[`scripts/dev.mjs`](../../scripts/dev.mjs#L1291)。

因此本地模式不需要重新实现教程中的 Sandbox 工具接口。最小修复是新增一个明确标注为不隔离的 host development profile，直接启动已有 standalone Runner；PostgreSQL、Redis、MinIO 等依赖可以是本机服务，也可以使用远程开发服务。

## 应该抽象 Worker，而不是重新实现 Codex 工具

`bryce-agent-harness-tutorial` 的核心原则是工具依赖小型 `Sandbox` 接口，云端 backend 只把相同操作变成网络调用；同时强调 snapshot 只保存可持久化状态，进程和连接必须在恢复后重新探测。对 LinkSense 来说，Codex app-server 已经拥有 Shell、文件、MCP 和 turn 生命周期，所以不应在 LinkSense 再造一层 `readFile/exec` 工具语义。

推荐边界：

```text
API
  ↓ 现有 RunnerClient
Runner Controller
  ↓ WorkerProvider
  ├── DockerWorkerProvider
  ├── LocalProcessWorkerProvider      仅开发
  ├── RemoteLinkSenseWorkerProvider   普通 VM/Kubernetes
  ├── VercelSandboxWorkerProvider
  ├── CloudflareSandboxWorkerProvider
  └── E2BCompatibleWorkerProvider
       ├── Tencent Agent Sandbox
       └── Alibaba FC Agent Sandbox

远程 Worker
  └── LinkSense execution runner
       └── Codex app-server（stdio，仅存在于 Worker 内）
```

Provider 返回的是 Worker lease 和 HTTP endpoint，不是把第三方 `exec()` 暴露给业务层：

```ts
type WorkerLease = {
  provider: string
  leaseId: string
  instanceId: string
  endpoint: string
  expiresAt: string | null
  runtimeRevision: string
  workspaceRevision: string | null
}

interface WorkerProvider {
  acquire(ownerId: string): Promise<WorkerLease>
  inspect(lease: WorkerLease): Promise<"starting" | "ready" | "paused" | "stopped" | "failed">
  resume(lease: WorkerLease): Promise<WorkerLease>
  release(lease: WorkerLease): Promise<void>
  destroy(lease: WorkerLease): Promise<void>
  reconcile(): Promise<void>
}
```

所有状态操作必须幂等。恢复时先对 Worker HTTP health 和 Codex app-server 做只读 probe；远程进程不存在时重启 Worker，不把旧 PID、process handle 或连接当作仍然有效。

## 本地 Node.js child_process

### 能解决什么

它可以解决“本机没有 Docker，仍要运行 Web/API/Runner 并开发普通功能”的问题。LinkSense 已经具备 standalone runner 和 child process app-server，新增工作主要是：

- `pnpm dev --runtime=local` 或等价配置，跳过 Compose 与 Worker image。
- 用本机 Node 启动 Web、API、Runner，并在退出信号中按顺序关闭服务和 app-server 子进程。
- 允许连接远程 PostgreSQL、Redis、MinIO；若没有远程服务，则要求本机自行安装这些依赖。
- Runner/API 绑定 `127.0.0.1`，禁止从非开发环境启用。
- 启动时显示不可忽略的 “Local process mode is not isolated” 警告。

### 不能解决什么

- 不能安全运行不可信 Skill、MCP、用户代码或第三方依赖。
- 不能验证 Docker Worker 的 UID/GID、capability drop、mount、network policy 等生产隔离逻辑。
- 不能用于共享开发机、多用户环境或公网部署。
- `cwd`、路径校验、命令 allowlist 和环境变量裁剪都不是 OS 隔离，不能把它们描述成 Sandbox。

因此建议 Provider 名称使用 `LocalProcessWorkerProvider` 或 `UnsafeLocalWorkerProvider`，而不是 `LocalSandboxProvider`。允许范围应固定为 `NODE_ENV=development`、单租户、回环监听，并默认关闭。

## Provider 对比

| Provider | 真正隔离 Sandbox | 长驻 Worker 进程 | 文件持久化 | 网络控制 | LinkSense 适配判断 |
| --- | --- | --- | --- | --- | --- |
| Node.js child process | 否 | 是，依赖本机进程 | 本机目录 | 无隔离 | 只适合本地开发 |
| Vercel Sandbox | 是，Firecracker microVM | 支持 detached process 与端口 | persistent sandbox、snapshot；Drive 仍是 private beta | allow/deny、SNI/CIDR、凭据代理 | 很适合首个海外云 Provider |
| Cloudflare Sandbox | 是，Cloudflare Containers/独立 VM | 支持受监督长进程；可 `keepAlive` | 本地盘会随容器停止消失；需 R2 backup 或 bucket mount | host allow/deny、HTTP(S) handler、外部凭据注入 | 可行，但需要 Cloudflare Worker 网关，集成较重 |
| 腾讯云 Agent Sandbox | 是，专用 Agent Sandbox 产品 | Commands/进程、端口、自定义镜像 | 实例系统盘、暂停/恢复、CFS/COS/AgentBucket mount | PUBLIC/VPC/SANDBOX 与实例级 NetworkPolicy | 国内首选，E2B 兼容可降低适配成本 |
| 阿里云 FC Agent Sandbox | 是，专用 Sandbox 函数/会话隔离 | Commands、进程管理、PTY、端口、自定义模板 | 本地盘只保证 Sandbox 生命周期；NAS/OSS 外置；暂停/恢复需白名单 | 官方明确要求业务自行验证出站边界，网络更新能力受限 | 可行，建议先 PoC 再列为生产 Provider |

## Vercel Sandbox

### 产品和 API 适配度

Vercel Sandbox 是真正的隔离 API：每个 Sandbox 在有独立文件系统和网络的 Firecracker microVM 中运行，提供 TypeScript `@vercel/sandbox` SDK、命令和文件管理。官方还支持从自定义 VCR 镜像启动 Sandbox，因此可以构建包含 LinkSense Worker 和固定 Codex 版本的镜像，而不是每次在线安装。[Sandbox 概览](https://vercel.com/docs/sandbox) · [自定义镜像和 Docker](https://vercel.com/kb/guide/docker)

长驻 Worker 所需的 API 已具备：`runCommand({ detached: true })` 可启动后台服务，创建时声明端口后通过 `sandbox.domain(port)` 获得入口；官方示例直接启动 HTTP server。[后台进程和端口示例](https://vercel.com/changelog/port-8080-is-now-available-in-vercel-sandboxes)

文件可通过 `writeFiles()` 上传，并通过 `readFileToBuffer()` 或 `downloadFile()` 取回。[文件取回](https://vercel.com/changelog/simplified-file-retrieval-from-vercel-sandbox-environments)

### 生命周期和持久化

- 单次 session 默认 5 分钟；Hobby 最长 45 分钟，Pro/Enterprise 最长 24 小时，可以用 `extendTimeout()` 延长到套餐上限。[时长与持久化](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence)
- persistent sandbox 默认保存文件系统并在新 session 恢复，但恢复的是文件系统，不是旧进程和 stdio 连接。LinkSense 必须重启 Worker，再由 Codex 原生 thread 数据恢复任务。
- snapshot 会停止原 Sandbox，默认 30 天到期；它适合固化依赖和 checkpoint，不适合保留正在运行的 app-server。[Snapshots](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)
- Vercel Drive 可以作为独立持久卷，但截至调研日期仍是 Pro/Enterprise private beta、单 reader/writer，并且官方不建议承载生产数据。[Vercel Drives](https://vercel.com/kb/guide/vercel-drives)

### 安全和限制

Vercel 支持运行时更新 egress policy、域名和 CIDR allowlist，以及在 Sandbox 外部向匹配的 HTTPS 请求注入凭据；Sandbox 内代码看不到真实 token。[网络策略与凭据代理](https://vercel.com/changelog/safely-inject-credentials-in-http-headers-with-vercel-sandbox) 这与 LinkSense 的凭据不落入不可信 Worker 内容目标高度一致。

适配结论：**高可行**。首版应把 LinkSense Worker 构建为固定 digest 的自定义镜像，公开一个经过强认证的 Worker HTTPS endpoint，并将每个 turn 的持久状态放在 LinkSense 数据库/对象存储。不能假设一个 Codex app-server 进程可跨 24 小时 session 或 snapshot 存活。

## Cloudflare Sandbox

### 产品和 API 适配度

Cloudflare Sandbox SDK 建立在 Containers 上，每个 Sandbox 使用独立 VM，隔离文件系统、进程和网络。[安全模型](https://developers.cloudflare.com/sandbox/concepts/security/) 它支持自定义 Dockerfile 或任意基础镜像加官方 sandbox binary，因此可以封装 LinkSense Worker；官方说明该 binary 会作为父进程启动自定义 `CMD` 并正确转发信号。[Dockerfile reference](https://developers.cloudflare.com/sandbox/configuration/dockerfile/)

1.0 preview 的 `exec(argv)` 返回受监督的 process handle，可读取日志、等待端口、检查状态和终止。process ID 只在当前 container 有效；容器被停止或替换后，旧 handle 会 fail closed，业务必须保存完整启动参数并重新启动进程。[Process execution](https://developers.cloudflare.com/sandbox/1-0-preview/processes/)

与 Vercel 不同，Cloudflare SDK 的控制面运行在 Cloudflare Worker/Durable Object 中。LinkSense 不能直接从普通 Node Controller 使用 Durable Object binding，需要先部署一个经过认证的 Cloudflare Worker Provisioner，或者使用官方 HTTP bridge，再由 LinkSense 的 `CloudflareSandboxWorkerProvider` 调这个网关。[HTTP API bridge](https://developers.cloudflare.com/sandbox/bridge/http-api/)

### 生命周期和持久化

- 默认空闲 10 分钟后容器停止，文件、进程和 shell state 都会丢失；同一个 Sandbox ID 不保证还是同一容器。[Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)
- `keepAlive: true` 可以阻止自动 sleep，但必须显式 `destroy()`，否则会持续占用配额。[Sandbox options](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/)
- `/workspace` 可以备份到 R2 并恢复；恢复层在容器再次 sleep/restart 后仍会消失，需要每次重新 restore。[Backup and restore](https://developers.cloudflare.com/sandbox/concepts/backup-restore/)
- R2、S3、GCS、MinIO 等 S3-compatible bucket 可以挂载为目录。对象存储挂载适合数据和产物，项目工作区更适合显式 backup/restore。[Storage](https://developers.cloudflare.com/sandbox/api/storage/)

### 安全和限制

Cloudflare 支持 host allow/deny、关闭 Internet、HTTP(S) outbound handler，以及在 Worker 侧持有并注入凭据；非 80/443 流量不会经过 handler，在关闭 Internet 时会被拒绝。[Outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)

当前标准规格最大 4 vCPU、12 GiB 内存、20 GB 磁盘；Sandbox 还受 Worker subrequest 限制，高频调用应启用 RPC transport。[Containers limits](https://developers.cloudflare.com/containers/platform/limits/) · [Sandbox limits](https://developers.cloudflare.com/sandbox/platform/limits/)

适配结论：**可行但集成成本中高**。优点是自定义镜像、长进程和网络边界完整；缺点是需要 Cloudflare Worker 网关、文件恢复机制，并且 1.0 process API 仍处于 preview。Provider 必须容忍容器被替换，不能只保存 process ID。

## 腾讯云 Agent Sandbox

### 产品和 API 适配度

腾讯云 Agent Sandbox 是专门的安全隔离执行产品，而不是普通 CVM/TKE 包装。官方提供 Sandbox 生命周期、文件操作、权限控制，以及代码、浏览器和自定义 Sandbox。[产品页](https://cloud.tencent.com/product/agsx) · [服务定义](https://cloud.tencent.com/document/product/301/133536)

自定义 Sandbox 支持自定义镜像、启动命令、业务端口和健康检查，并兼容 `@e2b/code-interpreter` TypeScript SDK；SDK 可执行命令、读写文件，也能连接已有 Sandbox。[自定义 Sandbox](https://cloud.tencent.com/document/product/1814/129691)

文件传输支持 CLI 和 E2B-compatible HTTP，但直接上传/下载是单文件，不支持目录递归，所以 LinkSense 不应逐文件同步大型 workspace。[文件系统](https://cloud.tencent.com/document/product/1814/132410)

### 生命周期和持久化

- 实例有 `STARTING/RUNNING/PAUSED/RESUMING/STOPPED` 等明确状态；停止是终态，暂停后可恢复。[实例生命周期](https://cloud.tencent.com/document/product/1814/132337)
- 普通实例默认超时为 5 分钟并可更新；`Persistent=true` 的实例不依赖 timeout 自动回收，结束时需显式停止。[停止与超时](https://cloud.tencent.com/document/product/1814/132338)
- 暂停/恢复适合等待用户或外部依赖，但暂停配额需要纳入容量规划；恢复后仍应重新检查 Worker 进程和端口。[暂停与恢复](https://cloud.tencent.com/document/product/1814/132323)
- 系统盘随实例存在，实例销毁后释放；长期共享数据可以挂载 CFS、COS、AgentBucket，并通过 `SubPath` 做用户/任务隔离。[存储挂载](https://cloud.tencent.com/document/product/1814/132215)

### 安全和限制

腾讯云支持 PUBLIC、VPC、SANDBOX 网络模式和 Tool/Instance 级 `NetworkPolicy`。重要的是：未传 `NetworkPolicy` 时默认允许全部流量；LinkSense Provider 必须显式写入 `DefaultDecision: deny` 和最小 allow rules，不能沿用默认值。[网络问题与 NetworkPolicy](https://cloud.tencent.com/document/product/1814/132217)

适配结论：**高可行，国内部署优先候选**。建议实现一个经过兼容测试的 `E2BCompatibleWorkerProvider`，但把腾讯云特有的 NetworkPolicy、CFS mount、Persistent 和状态查询放在显式 capability adapter 中，不能假设所有 E2B-compatible 服务行为完全相同。

## 阿里云 FC Agent Sandbox

### 产品和 API 适配度

阿里云 FC Agent Sandbox 是有状态的隔离执行产品，每个会话可以独占函数实例，并支持代码解释器和自定义模板。[Sandbox 函数模板](https://help.aliyun.com/zh/functioncompute/create-a-sandbox-function-template) · [实例隔离](https://help.aliyun.com/zh/functioncompute/overview-of-instance-isolation)

它兼容 E2B SDK 的 Sandbox、Commands、Filesystem、Code Interpreter 和 Template 主路径。Commands 支持命令、运行中进程、stdin 和 PTY；Filesystem 支持读写、目录操作和目录监听；可以取得上传/下载 URL 和端口访问地址。[E2B 兼容说明](https://help.aliyun.com/zh/functioncompute/e2b-compatibility-explanation)

自定义模板可以从 `linux/amd64` 镜像构建，用于固化 LinkSense Worker、Codex 和依赖。官方建议每次发布创建新模板而不是覆盖生产模板。[构建自定义镜像模板](https://help.aliyun.com/zh/functioncompute/build-a-custom-image-template)

### 生命周期和持久化

- 可以保存 sandboxId 并用 `Sandbox.connect()` 从其他进程连接；若已暂停会自动恢复。[连接 Sandbox](https://help.aliyun.com/zh/functioncompute/connect-the-sandbox)
- E2B 主路径的暂停/恢复目前需要白名单；恢复后必须重新检查长连接、Worker 进程和端口。[暂停与恢复](https://help.aliyun.com/zh/functioncompute/pause-and-resume)
- E2B 兼容层当前不兼容 Snapshots、Volume、Team 和 Access Token；Network Config Update 和 Logs 也属于受限能力。[E2B 兼容说明](https://help.aliyun.com/zh/functioncompute/e2b-compatibility-explanation)
- 本地 Sandbox 文件只适用于当前生命周期。跨 Sandbox 的数据需使用 NAS、OSS 等外部存储。[使用约束](https://help.aliyun.com/zh/functioncompute/usage-constraints-of-fc-agent-sandbox)

### 安全和限制

阿里云官方明确指出 Sandbox 不能替代网络控制、最小权限和输出审查；如果当前兼容能力没有细粒度出站控制，不能假设它天然阻断所有外联风险。[安全隔离](https://help.aliyun.com/zh/functioncompute/security-isolation) 因此在没有实测默认拒绝出站、元数据地址隔离、私网隔离和短期凭据代理之前，不应把该 Provider 开放给生产多租户。

适配结论：**技术可行，先 PoC**。E2B 兼容让基本接入简单，但暂停/恢复白名单、缺少兼容 snapshot/volume 和网络控制受限会影响生产默认启用。适合作为第二个 E2B-compatible vendor 验证 Provider 抽象是否真正跨厂商。

## Alibaba OpenSandbox 和普通容器/VM 的区别

Alibaba OpenSandbox 是开源 Sandbox 平台，不等同于“购买一个阿里云托管 Sandbox”。它提供 SDK、OpenAPI、生命周期控制面、Docker/Kubernetes runtime、命令/文件/浏览器 data plane 和 egress policy，适合 LinkSense 自行部署一个厂商中立的 sandbox control plane。[OpenSandbox architecture](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/architecture.md) · [OpenSandbox repository](https://github.com/opensandbox-group/OpenSandbox)

普通 Tencent CVM/TKE、Alibaba ECS/ACK、Kubernetes Pod 或远程 Docker 只是计算资源。它们可以承载 `RemoteLinkSenseWorkerProvider`，但以下能力要由 LinkSense 或 OpenSandbox 自己负责：

- 每用户/任务隔离和资源上限。
- 镜像 digest、启动身份、capability 和 seccomp/gVisor/Kata 配置。
- 网络默认拒绝、凭据代理和元数据服务阻断。
- lease、超时、暂停/恢复、孤儿回收和计费治理。
- 文件同步、产物回传、状态持久化和恢复探测。

因此不能把“能启动容器/VM”直接等同于“已经实现 Sandbox Provider”。

## Workspace 是真正的跨云难点

远程创建进程本身并不难，难点是当前 API 和 Runner 都假定可以直接访问同一个 `LINKSENSE_USER_DATA_ROOT`。第三方 Sandbox 通常看不到 LinkSense 主机的本地路径。

推荐把存储独立成 `WorkspaceTransport`，不要塞进 `WorkerProvider`：

```text
WorkspaceTransport
├── SharedFilesystemWorkspace       NFS/CFS/NAS/PVC
└── ObjectWorkspace
     ├── prepare: 下载 snapshot/增量到远程 Worker
     ├── checkpoint: 上传 manifest + changed blobs
     └── finalize: 回传产物并原子发布 revision
```

短期实现顺序：

1. **Local process profile**：继续使用本机目录，先解决无 Docker 开发。
2. **Remote LinkSense Worker + shared filesystem**：控制面和执行面分离，但仍用 NFS/PVC，验证 Provider contract。
3. **Vercel Sandbox PoC**：使用自定义镜像、detached Worker、24 小时 session、snapshot/object sync，验证进程丢失后的恢复。
4. **E2B-compatible PoC**：先腾讯云，再用阿里云验证同一个基础 adapter；每个厂商单独声明 capability，不做静默降级。
5. **Cloudflare Provider**：待 1.0 API 稳定后，通过独立 Worker gateway 接入。

## 必须保持的安全边界

- Provider 不可用时 fail closed，不能自动退回本地 child process。
- Local process 模式必须是显式开发配置，不能通过 API 由普通用户选择。
- 远程 Worker endpoint 必须使用短期、单 lease、可撤销凭据；不能只依赖不可猜测 URL。
- 不把模型供应商、Git、MCP 或云账号长期密钥放入 Sandbox 环境变量；优先使用厂商的外部凭据代理，或 LinkSense 现有网关。
- 网络策略默认拒绝，只开放模型网关、LinkSense API callback 和明确授权的外部资源。
- Provider 状态是运行时事实来源；数据库是缓存和审计记录。reconcile 必须处理孤儿、过期 lease 和状态分歧。
- snapshot/暂停恢复后必须重新运行 health probe；不能认为 PID、stdio、WebSocket 或 app-server 仍存在。
- runtime image/template 必须版本化并固定 digest；升级时新建 revision，不能覆盖正在使用的模板。

## 最终建议

实现是可行的，并且能同时解决本地无 Docker 和多云 Sandbox 两个需求，但二者的安全等级必须明确分开：

- `local-process`：开发便利能力，不是 Sandbox。
- `remote-linkSense`：最先落地的生产抽象，用普通 VM/Kubernetes 加共享存储。
- `vercel-sandbox`：海外云 Sandbox 首选。
- `tencent-agent-sandbox`：国内云 Sandbox 首选。
- `aliyun-fc-sandbox`：可行但需先验证网络、暂停/恢复白名单和持久化策略。
- `cloudflare-sandbox`：能力完整，等 1.0 稳定并接受额外 Worker gateway 后接入。

Provider 层只负责“完整 LinkSense Worker 在哪里运行、如何恢复和释放”；Codex app-server 的线程、工具和 turn 语义继续保持原生。
