# 安装兼容性测试调研：DeerFlow 与 LinkSense

调研日期：2026-10-20。DeerFlow 上游固定为 [`d288935865a7a0f2f33d8138aedaaa29997e0e7c`](https://github.com/bytedance/deer-flow/commit/d288935865a7a0f2f33d8138aedaaa29997e0e7c)，提交时间为 2026-10-20 06:30:57 UTC；LinkSense 对照版本固定为远端 main 的 [`43da026a53f2a37fa40c9bb65b6580f409eb516b`](https://github.com/LingX-AI/LinkSense/commit/43da026a53f2a37fa40c9bb65b6580f409eb516b)。DeerFlow 结论来自该版本的安装文档、Makefile、脚本、相关测试，以及全部 19 个 GitHub Actions workflow 的任务入口与运行环境；对相关安装、测试和发布任务进一步读取了实现。只读核对源码，没有执行上游安装器、安装依赖、启动服务或运行其测试。LinkSense 部分另行核对了已有 Actions 运行结果；本轮只新增此研究记录，未修改或触发工作流。

## 结论与建议范围

**可行：让 GitHub Actions 覆盖更多真实宿主与脚本运行环境，可以减少对维护者手边机器的依赖。LinkSense 已有完整的 Ubuntu 发布安装门禁，适合复用现有验收；DeerFlow 可供参考的是测试分层、阶段诊断与制品留证。**

建议先增加托管 Ubuntu/macOS 的脚本回归及 Debian、CentOS Stream 的容器兼容检查；保留现有 Ubuntu 真实安装门禁。其他发行版的完整宿主安装先做单个 VM 试点，macOS Docker Desktop 全链验收需要能实际运行该虚拟化后端的 Mac 环境。各层报告应写清“脚本通过”“容器内检查通过”或“真实宿主完整安装通过”，不能把它们合并成一个支持结论。

## DeerFlow：实际安装路径

**DeerFlow 值得借鉴的是安装入口、诊断与测试分层；它当前公开的 CI 不能证明已经在 macOS、CentOS 或多种 Linux 宿主机上完成安装验收。** 其 workflow 的运行环境主要为 `ubuntu-latest`，另有一个专门的 `windows-latest` 离线策略测试；没有找到 macOS 或按 Linux 发行版划分的安装矩阵。这里描述的是 workflow 配置，不代表本次核验了所有历史运行结果。[工作流目录](https://github.com/bytedance/deer-flow/tree/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows)、[Windows 专项测试](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/backend-windows-live-policy.yml#L25-L59)

| 入口 | 实际完成的工作 | 不能据此认定的工作 |
| --- | --- | --- |
| 面向 coding agent 的 `Install.md` | 检查已有配置；Docker 可用时优先 `make docker-init`；否则 `make check` 后运行 `make install`；提供下一条启动命令。 | 文档明确把 Docker 路径的完成状态定义为“先决条件准备完成”，没有要求服务已启动、Compose 校验通过或镜像已构建。[Install.md](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/Install.md) |
| `make check` / `make install` | 检查 Node、pnpm、uv、nginx；安装 Python/前端项目依赖及 pre-commit hooks。 | 不是在干净系统上自动安装 Docker、系统包和服务。缺少依赖时 checker 主要给出安装提示并失败返回；macOS/Ubuntu 的提示不等于已经在对应宿主机验收。[Makefile](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/Makefile)、[check.py](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/check.py#L89-L193) |
| `make docker-init` / `make docker-start` | 前者按 sandbox 模式准备或预拉镜像；后者检查 Compose 版本、配置与挂载路径，再启动开发栈。 | `docker-init` 在 local sandbox 模式下即使 Docker 不可用也可返回成功，预拉镜像失败也可仅给提示。因此不能把它的退出码当作整个应用安装成功。[docker.sh](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/docker.sh#L197-L272) |
| `make up` → `scripts/deploy.sh` | 生产路径检查数据目录权限、准备配置和持久化凭据，调用 `compose up --wait --wait-timeout 180`；失败输出容器状态和 Gateway 日志。 | 等待服务就绪仍需另行验证登录、业务 API、持久数据等实际行为。[部署脚本](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/deploy.sh#L484-L515)、[Gateway readiness healthcheck](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/docker/docker-compose.yaml#L200-L215) |

配置保护是明确的：`configure.py` 遇到已有主配置直接中止，复制其他模板时保留已有文件；生产部署脚本还检查旧开发栈创建的 root 所有权数据目录，给出修复提示。这些属于安装重复执行与既有环境处理机制，并不能替代完整的历史版本升级测试。[配置生成](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/configure.py#L11-L51)、[数据目录权限预检](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/deploy.sh#L115-L140)

## DeerFlow：CI 究竟验证了什么

| 自动化路径 | 核验到的实际覆盖 | 与多系统安装验收的差距 |
| --- | --- | --- |
| 后端/前端单测与 lint | Ubuntu 上安装项目依赖并运行检查；后端矩阵 `[1,2,3,4]` 是测试分片，并启动 PostgreSQL、Redis 服务。 | 没有 OS 矩阵；CI 预装环境和项目依赖安装不能证明从干净目标系统完成宿主依赖安装。[后端](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/backend-unit-tests.yml)、[前端](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/frontend-unit-tests.yml)、[lint/build](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/lint-check.yml) |
| 安装与启动脚本回归 | `test_make_install.py` 执行真实 make，但把 uv、pnpm 替换为记录命令的假工具；Docker 脚本测试也使用假 Docker/Compose 检查参数、版本门槛、配置保留、路径与 socket 分支。 | 能有效防止脚本逻辑回归，但没有实际安装依赖或验证真实 daemon/宿主差异。[make install 回归](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/backend/tests/test_make_install.py#L17-L32)、[Docker 脚本回归](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/backend/tests/test_docker_sandbox_mode_detection.py) |
| E2E 与 Replay E2E | Ubuntu 上运行 Chromium；普通 E2E 主要为前端 mock 路径并包含专项 Python fixture；Replay E2E 启动真实前端和真实 Gateway，以确定性模型回放验证 SSE 与浏览器渲染。 | 测试代码直接启动组件，没有走用户的完整安装器，更没有在多个宿主 OS 上部署完整 Compose 栈。[E2E workflow](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/e2e-tests.yml)、[Replay workflow](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/replay-e2e.yml)、[真实后端启动配置](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/frontend/playwright.real-backend.config.ts#L9-L69) |
| Sandbox Image Smoke | Ubuntu 上拉取真实 AIO sandbox 镜像，分别覆盖默认/配置镜像及 `1.11.0` 回归镜像；先解析成不可变 digest，再运行 `-m live` 测试。 | 这是一个真实容器组件的运行测试，不是完整产品跨发行版安装测试。[真实镜像 smoke](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/sandbox-image-smoke.yml) |
| 发布镜像、Helm 与 nightly | Ubuntu 上构建/推送产品镜像；Helm 做 lint、模板渲染及配置契约检查。部分独立组件使用 QEMU/Buildx 构建 `linux/amd64,linux/arm64`。 | 产品主镜像 release/nightly 路径没有多宿主矩阵；组件多架构构建不等于完整产品多架构运行，更不等于 CentOS/macOS 安装。Helm 渲染成功也不等于集群安装成功。[产品镜像](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/container.yaml)、[nightly](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/nightly.yaml)、[Helm](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/chart.yaml)、[多架构 proxy 组件](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/sandbox-network-proxy-image.yaml) |
| Windows Live Test Policy | `windows-latest` 安装后端依赖，执行 5 个离线测试，检查子进程环境隔离、显式 opt-in 与 CI 中禁止收集 live tests 的策略。 | 名称包含 Live，但该工作流本身不执行真实模型调用，也没有覆盖完整 Windows 安装。[Windows workflow](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/backend-windows-live-policy.yml#L25-L59) |

仓库另附 `.agent/skills/smoke-test/`，包含环境检查、部署、HTTP 健康检查、登录后的前端路由检查与报告模板。这是一套供 Agent 执行的运维流程；上述 19 个 workflow 没有直接引用这套目录或其部署脚本，不能把技能文档中的完成清单当作 CI 已通过的证据。[smoke-test 文档](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.agent/skills/smoke-test/SKILL.md)、[workflow 目录](https://github.com/bytedance/deer-flow/tree/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows)

这套辅助 smoke 也有需要加强的地方：`health_check.sh` 使用固定等待，Gateway 检查主要判断 curl 成功且响应非空；前端脚本用 curl 验证 HTTP 状态、认证与最终重定向，没有浏览器 DOM 断言。适合参考其覆盖顺序，不宜直接当作严格安装门禁。生产路径现有的 readiness healthcheck 与 Compose 有界等待更值得复用。[健康检查脚本](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.agent/skills/smoke-test/scripts/health_check.sh#L87-L107)、[路由检查脚本](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.agent/skills/smoke-test/scripts/frontend_check.sh#L107-L157)

## 可以借鉴的四项做法

以下是基于源码的工程建议，不是 DeerFlow 已经完成 LinkSense 所需平台覆盖的结论。

1. **复用用户真实入口，明确每一阶段的完成条件。** 文档、Agent 与自动化都调用同一 Makefile/脚本；区分“配置已准备”“依赖已安装”“服务已就绪”“业务可用”。特别避免把镜像预拉取或 Compose 配置解析成功写成安装成功。[统一入口](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/Makefile)、[setup 边界](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/Install.md)
2. **先做预检并保护已有配置，失败给可执行诊断。** 在修改文件/启动容器前检查工具版本、数据目录与挂载；保留已有配置；等待超时后输出容器状态和有限日志。`make doctor` 将问题分成系统、配置、模型、Web 能力、沙箱并给出修复提示，便于把用户环境问题转成结构化诊断。[配置保护](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/configure.py)、[doctor 汇总](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/doctor.py#L904-L974)、[启动失败诊断](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/scripts/deploy.sh#L486-L515)
3. **把快速脚本回归、真实环境 smoke、业务契约测试分开。** 假工具覆盖旧 Compose、路径和配置保留等失败分支；真实镜像 smoke 补运行时；回放模型使前后端集成不依赖付费 API Key。分层能降低成本，但每层都应标明证明范围，完整安装仍需调用真实安装入口。[脚本回归](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/backend/tests/test_docker_sandbox_mode_detection.py)、[真实镜像](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/sandbox-image-smoke.yml)、[无 Key 回放](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/replay-e2e.yml)
4. **固定被测制品并留下证据。** 真实镜像测试把 tag 解析为 digest，记录到 job summary；回放浏览器测试保留报告及结果；发布前检查各处版本一致性。安装报告也应记录宿主 OS、架构、安装版本、镜像 digest 和各阶段结果，使失败可复现。[镜像 digest](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/sandbox-image-smoke.yml#L41-L61)、[测试产物](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/replay-e2e.yml#L103-L114)、[版本门禁](https://github.com/bytedance/deer-flow/blob/d288935865a7a0f2f33d8138aedaaa29997e0e7c/.github/workflows/verify-versions.yml)

DeerFlow 当前公开代码提供了这些可复用机制；**不能由此推导 CentOS/macOS 宿主安装、不同 Linux init/包管理器/安全策略、完整产品 ARM 运行或跨版本数据升级已经验收通过**。本次没有执行其任何安装与运行测试，以上是源码范围判断。

## LinkSense：已有能力与缺口

普通 CI 的 `verify` 运行于 `ubuntu-24.04`，其中执行 `pnpm test:deployment`，已有脚本回归覆盖部分 macOS 路径、Docker 凭证与 CentOS 7 提示。这些通过模拟命令覆盖分支，不能证明已经在对应真实系统上安装。[普通 CI](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/.github/workflows/ci.yml)、[宿主脚本测试](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/scripts/installer-host.test.mjs)

发布流程已经有 `edition: [core, full]` × `cpu-mode: [strict, compatible]` × `amd64/arm64` 共 8 个真实安装任务。默认宿主分别是 `ubuntu-24.04`、`ubuntu-24.04-arm`，可通过两个仓库变量替换。2026-10-20 查询 [发布运行 39379129204](https://github.com/LingX-AI/LinkSense/actions/runs/39379129204) 时，8 个 `installation-smoke` 任务均为 `success`；这证明该次候选制品在这两种 Ubuntu 架构环境通过了既有验收，不代表其他 OS 已通过。[安装矩阵与发布依赖](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/.github/workflows/release.yml#L565-L642)

现有验收调用用户使用的 `install-core.sh` / `install-full.sh`，检查安装、重复执行、修复、同版本升级、CPU 模式切换、持久数据与冻结上一版制品的升级，保留密钥和卷、校验备份，并输出脱敏报告。已有部分旧版 Full 环境通过专项 fixture 构造，不能据此声称旧安装器本身成功。本次只读取既有运行结论和测试实现，没有重新运行这些阶段。[完整验收实现](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/scripts/release-installation-smoke.mjs)

需要处理的具体差距：

1. **完整测试入口限定 Linux/root。** `runInstallationSmoke` 显式断言 `process.platform === "linux"` 和 UID 0，而真实 macOS 安装器要求当前用户无 sudo 运行。增加 macOS `runs-on` 前，需让验收以 macOS 正确用户上下文执行，并适配 launcher、路径及清理逻辑。[测试限制](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/scripts/release-installation-smoke.mjs#L122-L125)、[安装器权限约束](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/deploy/release/linksense-installer.sh#L77-L84)
2. **测试 CA bundle 路径固定为 Debian/Ubuntu。** 验收器读取 `/etc/ssl/certs/ca-certificates.crt`，其他发行版需要发现系统 CA 路径或显式传入。这里是已确认的可移植性假设，尚未在 CentOS 实跑确认其失败表现；不能因此关闭 TLS 验证。[证书构造](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/scripts/release-installation-smoke.mjs#L275-L285)
3. **增加宿主环境留证。** 当前 JSON 主要记录 edition、architecture、version 和阶段结果；新增平台应记录 `/etc/os-release` 或 macOS 版本、内核、实际 Runner image、Docker/Compose 版本、源 SHA 和镜像 digest。已有报告上传和脱敏机制可继续使用。
4. **资源说明需要对齐。** 当前运行预检和 release workflow 使用 Core 8 GiB、Full 10 GiB Docker 可用内存下限，Full 仍有容量告警与真实运行验证；`Install.md` 还写着新 Full 24 GiB。实现时应区分可启动下限、推荐容量和实际工作负载，核对文档，不能为了让矩阵变绿随意放宽运行检查。[安装器内存校验](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/deploy/release/linksense-installer.sh#L562-L575)、[资源预算](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/deploy/release/linksense-installer.sh#L1033-L1084)、[现有安装文档](https://github.com/LingX-AI/LinkSense/blob/43da026a53f2a37fa40c9bb65b6580f409eb516b/Install.md#L31-L40)

仓库 API 在本次查询时显示公开仓库、仓库级自托管 Runner 列表为空，未设置 `LINKSENSE_INSTALLATION_RUNNER_AMD64` / `LINKSENSE_INSTALLATION_RUNNER_ARM64` 仓库变量。这不是对未来可用机器或组织级 Runner 的承诺。查询使用 `gh api repos/LingX-AI/LinkSense`、`gh api repos/LingX-AI/LinkSense/actions/runners`、`gh variable list --repo LingX-AI/LinkSense`；未读取密钥值。

## GitHub Actions 能覆盖的平台边界

| 目标环境 | 推荐的第一步 | 完整宿主安装还需验证的内容 |
| --- | --- | --- |
| Ubuntu 22.04 / 24.04 | 使用 GitHub 原生托管 VM；保留现有 24.04 amd64/arm64 完整门禁，增加 22.04 覆盖。 | 每种实际承诺支持的组合需运行相同候选制品与升级验收；不只构建镜像。 |
| Debian 12 / 13 | 在 Ubuntu job 中用固定发行版镜像执行脚本与工具检查。 | 容器共用宿主内核；真实 Docker 安装、systemd、cgroup、磁盘与网络需要 Debian VM。 |
| CentOS Stream 9 / 10 及所选 Rocky/Alma 版本 | 容器覆盖 RPM 系列 shell、依赖与 CA 路径；优先选一个发行版进行 VM 试点。 | 真实内核、SELinux、systemd、Docker 服务及 bind mount 权限；给容器挂 Ubuntu Docker socket 仍然使用 Ubuntu daemon。 |
| macOS Intel / Apple Silicon | 原生托管 Mac 执行真实 Darwin/BSD 工具与路径回归，Docker 控制分支可使用测试替身。 | Docker Desktop、用户凭证助手、VM 内存、真实 socket 与卷行为需另行全链验收。 |
| CentOS 7 / 8 等老系统 | 测试依赖不足时准确失败、给迁移提示、保留已有状态。 | 不承诺将不受维护的旧系统变成受支持平台；现有安装在满足其他条件时的可用性不能仅由提示分支推断。 |

GitHub 标准托管 OS 是 Ubuntu、Windows、macOS，没有原生 `centos-*` / `debian-*` 托管标签。公开仓库的标准 Ubuntu Runner 提供 16 GB RAM；macOS ARM 为 7 GB，Intel 为 14 GB。标准托管 Runner 可用于公开仓库的免费测试，另外购买 larger runner 或云资源要另行评估。选择具体标签应固定版本，避免 `latest` 升级改变验证范围。[Runner 规格与标签](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

在 Ubuntu Runner 中用 QEMU/KVM 启动发行版 VM 是可以探索的路径，无需先承诺购买机器；但 GitHub 明确将嵌套 VM 列为实验用途，不保证性能、稳定性或兼容性。建议先验证一个 CentOS Stream VM 的资源、启动和 Docker 完整验收，确认运行稳定后再扩大矩阵；如果不稳定，再使用临时云 VM 或隔离的自托管 Runner。[GitHub 嵌套虚拟化说明](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners#preinstalled-software-for-github-owned-images)

GitHub 明确不支持 ARM macOS Runner 的嵌套虚拟化，标准 ARM Mac 的 7 GB 总内存也低于当前 Core 的 Docker 内存门槛。因此不能承诺把现有任务改为 `macos-15` 就能跑完整 Compose 安装。Intel 托管 Mac 的具体 Docker Desktop 可行性本次未实测；若要确认 macOS 正式支持，应安排能运行 Docker Desktop 且资源充足的物理/云 Mac Runner。远程 Linux Docker Engine 不能证明 Desktop 本地 VM、凭证或挂载语义，且当前一键安装器仅接受本地 Unix socket。[macOS Runner 限制](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#limitations-for-arm64-macos-runners)、[Docker Desktop macOS 安装与用户路径](https://docs.docker.com/desktop/setup/install/mac-install/)

Docker 官方当前列出的 CentOS 安装目标是维护中的 Stream 9、10。对 CentOS 7/8 的测试应明确为旧环境诊断，不应自动执行最新版 Docker 一键安装或强行迁移已有数据。[Docker CentOS 支持范围](https://docs.docker.com/engine/install/centos/#os-requirements)

## 建议实施顺序与验收条件

以下为拟议范围，尚未创建工作流或新增系统支持承诺。

1. **先增加快速平台回归。** 安装器、共享宿主 helper、打包脚本、对应测试及 workflow 变更时，在 PR/main 运行 Ubuntu 与 Intel/ARM macOS 的相关脚本测试，以及 Debian/CentOS Stream 容器中的兼容检查。复用现有 helper 与测试约定；离线 fixture 验证下载失败、参数处理、缺依赖、版本门槛、权限及旧配置保护。报告明确标注有无真实 Docker，不使用私密模型 Key。
2. **复用现有真实安装门禁。** 继续使用候选 release assets、不可变镜像和冻结的上一版资产，验收 Core/Full；增加 Ubuntu 22.04，再选一个 CentOS Stream VM 试点。首次先手动运行并定位失败，补回归用例、修复共用脚本后重跑；稳定的组合再成为发布必需门禁。安装器路径变更的 PR 如需完整测试，应使用本次提交生成的测试制品，不能只测试旧 `latest` 后断言 PR 正确。
3. **补齐确有需求的真实宿主。** 对需要正式承诺的 Debian/RPM 系列版本和 macOS Desktop 安排充足资源的隔离环境；由同一 Actions 流程调度。完整测试要求空白、可销毁的 Docker daemon，不能指向维护者日常或生产 Docker。公开 PR 的不可信代码不直接接入有凭证或持久数据的自托管主机；可信发布任务与临时环境分开执行。[公开仓库 Runner 注意事项](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)

最低验收标准：

- **真实安装成功：** 从干净目标宿主通过用户的真实入口完成安装，Compose 就绪、业务探针与管理 CLI 通过；仅预拉镜像、配置解析或容器启动不足以通过。
- **已有安装可继续使用：** 重复执行、修复、同版本升级及上一支持版本升级保留凭据、业务数据、自定义资源设置和持久卷，备份可读取；不能只测全新数据或要求用户重装。
- **失败可定位：** 工具、资源、网络或系统能力不足时在安全阶段退出，保留已有文件/数据；脱敏报告记录环境、被测制品和失败阶段。不得以跳过断言、放松安全检查或吞掉退出码让测试通过。
- **覆盖声明准确：** 分别报告脚本、容器兼容与真实宿主完整安装结论。需要付费提供商的真实模型/工具调用另行设为可选专项测试，不影响无 Key 的安装验收。

本轮交付为源码与已存在 CI 结果调研；没有执行 DeerFlow 安装，也没有在新增的 Linux 发行版或 macOS 上运行 LinkSense 安装测试。尚不能确定 VM 试点时长、费用或 Intel 托管 Mac 的完整 Docker 可行性。
