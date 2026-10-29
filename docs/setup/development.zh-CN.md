# 源码开发与镜像构建

[返回 README](../../README.zh-CN.md)

源码开发起步建议：8 vCPU、24 GiB 内存、120 GiB 可用 SSD；推荐 16 vCPU、32 GiB、200 GiB 可用 SSD。配置是规划建议，需按实际构建与并发负载调整。

## 本地开发

需要 Node.js 24+、pnpm 10.34.6、Docker Engine / Compose、rsync，以及用于本地 HTTPS 证书的 [mkcert](https://github.com/FiloSottile/mkcert)。首次启动可能请求将 mkcert 的本地证书颁发机构加入系统信任。

应用及其依赖在 Linux 容器中运行，宿主机上的 rsync 仅用于同步源码。开发默认配置不能用于公开生产部署。

API 和开发镜像内置 FFmpeg，录音提交到所配置的服务前会统一转换为 16 kHz、单声道 PCM WAV；OpenAI 兼容语音服务使用 `response_format=json`，不请求时间戳。直接在宿主机运行 API 时，需要确保 `PATH` 中可以找到 `ffmpeg`。升级时需部署新的 API 镜像，已有模型配置和网关密钥继续使用。可运行 `pnpm --filter @linksense/api test:voice:audio` 验证实际音频格式转换。

```bash
corepack enable
corepack prepare pnpm@10.34.6 --activate
pnpm install --frozen-lockfile
pnpm dev:prepare
pnpm dev
```

默认地址：

- Web：`http://localhost:18172`
- Web HTTPS：`https://localhost:18173`
- API：`http://localhost:4000`
- Runner：`http://localhost:4010`

常用命令：

```bash
pnpm dev:stop
pnpm dev:rebuild
pnpm dev:worker:rebuild
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm dev:prepare` 会构建应用镜像、生产任务 Worker 和双语帮助中心，检查基础设施与数据库初始化，启动服务，并预热运行时缓存。

`pnpm dev` 会自动准备缺失的输入，并接入源码监听和日志。

### AI 开发指南

使用 Codex 或其他 AI 编程工具前，请阅读 [`AGENTS.md`](../../AGENTS.md)。

AI 生成的功能和行为变更与其他贡献一样，需要配套测试。提交前请运行受影响的测试、类型检查、lint 和构建。

不要提交密钥、个人数据、内部需求文档或生成产物。

---

## 使用 Docker 从源码构建

```bash
docker compose --env-file .env.example build \
  migrate api runner runner-worker-image web
```

多平台构建：

```bash
docker buildx build --platform linux/amd64,linux/arm64 --target runtime \
  -f Dockerfile.api -t <registry>/linksense-api:<tag> --push .
```

| 文件 | 构建目标 | 产物 |
| --- | --- | --- |
| `Dockerfile.api` | `runtime` / `migration` | API / 数据库迁移 |
| `Dockerfile.web` | `runtime` | Web + 帮助中心 |
| `Dockerfile.runner` | `controller` / `worker` | Runner 控制器 / 任务 Worker |

接近生产环境的本地运行方案：

```bash
pnpm dev:prod
pnpm dev:prod:stop
```

生产环境优先使用经过验证、以不可变摘要固定的发行镜像，而不是直接在生产主机上构建源码。
