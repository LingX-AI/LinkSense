# macOS 安装与任务执行问题反馈（整理稿）

- 来源：用户提供的《LinkSense_macOS_安装问题总结与改进建议》（docx）+ 2 张任务执行失败截图（2026-10-13）。
- 用途：问题证据、修复记录和验收清单。每项区分现象、用户处置、已确认原因与待验证假设。
- 「现状核对」基于 `feat/october-changes-testing` 分支（2026-10-13）。代码与模拟测试不代表反馈机器已部署或完成实机复测；修改需随新发布版安装器和应用镜像交付。

## 用户环境

- macOS Apple M4（ARM64），16 GiB RAM
- Docker Desktop（首次安装；反馈记录版本为 29.8.2，尚未确认是 Desktop 应用版本还是 Docker Engine 版本）
- 国内网络：GitHub / Docker Hub 不稳定
- 代理：v2rayN / xray，仅开启 SOCKS5 端口 10808（未开 HTTP 10809）
- 结果：Core 版最终安装成功

## A. 安装过程问题（按时间顺序）

### A1. Docker CLI 不在 PATH（Stage 1 失败）

- 现象：安装脚本 Stage 1 报 Docker CLI is not installed。
- 用户处置：手动把 `/Applications/Docker.app/Contents/Resources/bin` 加入 `~/.zshrc` 的 PATH。
- 已确认现象：当前安装进程的 PATH 无法定位 Docker CLI。Docker Desktop 的 CLI 链接或 shell 配置是否安装成功，需在反馈机器核实。
- 修复方向：脚本主动探测 Docker Desktop 常见 bin 路径并临时加入 PATH；文档给出手动配置方法。
- 修复：共享主机工具在 macOS 追加 `~/.docker/bin`、系统或用户 Applications 下的 Docker.app bin 目录和 `/usr/local/bin`，保留 PATH 中原有 Docker CLI 的优先级；安装、修复、升级和管理 CLI 共用该行为。

### A2. Docker Desktop CLI 集成安装失败

- 现象：Docker Desktop 内点 “Install” 安装 CLI completions 报 `An unexpected error occurred while installing CLI completions`。
- 用户处置：放弃自动集成，改用手动编辑 `~/.zshrc`。
- 根因：Docker Desktop 自动集成失败，原因不明。
- 修复方向：文档提供手动 PATH 配置说明，不依赖 Docker Desktop 自动集成（同 C6）。

### A3. curl HTTP/2 framing 错误

- 现象：`curl: (16) Error in the HTTP2 framing layer`；初始脚本下载与安装脚本内部的 curl 调用都会触发。
- 用户处置：创建 `~/.curlrc` 写入 `http1.1`，全局降级到 HTTP/1.1。
- 修复方向：脚本内 curl 自动 `--http1.1` 回退；文档说明该兼容性问题。
- 现状核对：`host_download` 对 curl 退出码 16/92 自动切换 `--http1.1` 并重试最多 3 次；根 `install-core.sh` 对脚本自身下载也做同样回退。当前代码已覆盖大部分场景，待实机复测。

### A4. docker-credential-desktop 找不到

- 现象：Stage 4 拉取镜像报 `exec: "docker-credential-desktop": executable file not found in $PATH`。
- 用户处置：当前终端手动 `export PATH=...` 后重新运行。
- 核对：`curl | sh` 会继承已导出的 PATH，但 `sh` 不会重新读取 `.zshrc`。不能将问题归因于管道必然丢失 PATH。
- 修复方向：脚本开头探测并加入常见 Docker 路径；预检 `docker-credential-desktop` 可用性；文档建议两步安装（先 `curl -o` 再 `sh`）。
- 修复：macOS 预检检查当前 Docker 配置的 `credsStore` 所指向的 helper；有非空 `credHelpers` 覆盖时交由实际拉取选择，不误拦截未被使用的全局 helper，也不要求未配置的 `desktop` helper。拉取时遇到找不到 helper 的错误，立即给出 PATH 修复指引，不删除登录配置或重试永久错误。

### A5. GitHub 连接超时

- 现象：`curl: (28) Failed to connect to github.com port 443 after 15004 ms`。
- 用户处置：设置 Mac 不自动熄屏，重试后恢复。
- 分析：GitHub 连接超时已确认；网络不稳定或系统休眠均可能影响下载，但现有记录不能确认此次超时由休眠导致。熄屏本身不等于系统休眠。
- 修复方向：预检 GitHub / raw.githubusercontent.com 连通性并给出提示（见 C1、C10）。

### A6. Docker Hub 镜像拉取失败（TLS 超时）

- 现象：`TLS handshake timeout`，连接 `auth.docker.io` 超时；ghcr.io 的镜像可拉取，docker.io 的不行。
- 用户处置：Docker Engine 配置 `registry-mirrors` 镜像加速；编辑配置时误覆盖了原始 Docker Engine 配置。
- 修复方向：文档明确国内用户需要配置镜像加速并给出示例；提示编辑时保留原配置。
- 修复：主机适配说明补充 Docker Desktop 代理和可信 `registry-mirrors` 的配置方式，明确保留原始 JSON 配置；不内置或自动切换第三方加速源。

### A7. 镜像下载中途断开

- 现象：`short read: expected 5401 bytes but got 0: unexpected EOF`。
- 用户处置：重跑安装命令（已下载的镜像不重复下载）。
- 现状核对：`pull_image` 对 timeout / EOF 等瞬时错误最多重试 3 次（45 分钟阶段预算内）；已存在镜像直接跳过。已部分覆盖，重跑成本低。

### A8. 安装脚本本身下载失败

- 现象：`curl: (56) Recv failure: Operation timed out`（raw.githubusercontent.com）。
- 用户处置：重试。
- 核对：bootstrap 和 `host_download` 的重试仅在对应脚本已下载并开始执行后生效。最外层 raw.githubusercontent.com 下载不受其保护；安装文档改用带超时、重试和 `--http1.1` 的两步命令。bootstrap 的 HTTP/1.1 回退也保留重试。

### A9. 终端已有代理，但下载/拉取依然很慢

- 根因：终端代理和 Docker 代理是两条完全独立的通道；终端里的 `http_proxy/https_proxy` 只对 curl 等命令行工具有效，Docker 拉取镜像由 Docker 引擎在自己的虚拟机里完成，不走终端代理。
- 用户处置：为 Docker Desktop 单独配置代理（见 A12）。
- 修复方向：文档新增「网络与代理配置」专章（见 C9）。
- 修复：`deploy/release/HOST-ADAPTATION.md` 新增 Network and proxies 章节，分别说明终端代理与 Desktop/daemon 代理，并给出逐项诊断命令。

### A10. 代理端口识别错误

- 现象：误将代理软件 DNS 设置页显示值当作代理端口；`curl -x http://127.0.0.1:10809` 报 `Couldn't connect to server`。
- 根因：DNS 设置 ≠ 代理端口；该环境仅开启 SOCKS5 10808（`lsof -i -P | grep LISTEN` 确认），未开 HTTP 10809。
- 修复方向：文档给出 `lsof` 排查方法与 scheme 区分说明（见 C11）。

### A11. Docker 代理配置后 `docker info` 看起来没变

- 现象：Docker Desktop 配置 `socks5://127.0.0.1:10808` 后，`docker info | grep -i proxy` 仍显示 `http.docker.internal:3128`。
- 根因：`http.docker.internal:3128` 是 Docker Desktop 内部的代理转发服务，属正常现象；应以 `docker pull` 实测结果为准。
- 修复方向：FAQ 说明（见 C12）。

### A12. Docker 代理生效，但终端 curl 仍超时

- 现象：`docker pull hello-world` 成功，但终端 `curl https://raw.githubusercontent.com/...` 仍报 `Recv failure: Operation timed out`。
- 根因：Docker 引擎已走代理，终端本身没有走代理。
- 用户处置：终端执行以下三行后，安装脚本顺利跑完。

```sh
export http_proxy=socks5://127.0.0.1:10808
export https_proxy=socks5://127.0.0.1:10808
export ALL_PROXY=socks5://127.0.0.1:10808
```

- 修复方向：预检分别测试两条通道并给出对应修复（见 C10）。

## B. 任务执行失败（截图反馈）

### B1. 带工具执行的任务中途失败：model_provider_error

- 现象：普通对话正常；带工具调用的任务执行 6–8 秒后失败，界面直接显示原始 JSON：

```json
{"error":{"type":"model_gateway_error","code":"model_provider_error","message":"The model provider request failed."}}
```

- 截图证据（2026-10-13）：
  - 任务「帮我整理一下我遇到的问题…」：8 秒失败；失败前已运行 `cat $ABSOLUTE/SKILL.md`、`linksense-browser --help` 等命令。
  - 任务「制作 2026 年 AI 技术发展 PPT」：6 秒失败；失败前运行 `fc-list`、`python3`、`libreoffice` 等环境检测命令。
  - 两个任务均使用 DeepSeek-V4.1-Flash。
- 修复前代码路径：`apps/runner/src/model-gateway/model-gateway.ts` 中 `handleUnsuccessfulUpstream` 在向模型渠道的上游请求返回非 2xx 时抛出 `GatewayHttpError(上游状态码, "model_provider_error")`，对外固定文案为 "The model provider request failed."；同时以 warn 级别记录 `model provider request failed`，字段含 `upstreamStatus`、`upstreamRequestId`、`providerRevision`、`protocolMode`。本次改为保留状态码并分类错误，不能据此反推原截图的上游状态。
- 修复前需要补充的信息：
  1. 失败时刻 runner 日志中的 `model provider request failed` 条目（`upstreamStatus`、`upstreamRequestId`）；可用 `linksense logs runner` 或安装目录内 `docker compose logs runner` 获取。
  2. 该模型渠道的协议模式与渠道配置（DeepSeek 默认 `chat_completions_bridge`）。
  3. 切换其他模型/渠道是否复现；普通对话与带工具任务的差异。
- 已修复 UX：已知网关错误按认证、限流/用量、请求兼容性、服务不可用及超时分类，提供六语言操作提示。历史任务中的原始 JSON 在展示时转换，无需改写数据库；未知或损坏的 JSON 使用通用提示，避免泄露外部错误体。
- 诊断改进：runner 日志保留请求/轮次关联和上游状态，增加 `model` 与安全的 `failureCode`；不记录渠道密钥、用户内容或完整上游响应。未新增整轮任务自动重试。
- 仍待确认：反馈中 DeepSeek 渠道的真实执行故障根因。错误展示和分类修复不等于该渠道已经恢复。

## C. 用户体验改进建议（用户 13 条，按主题归组）

### 预检与诊断

- C1 完整预检清单：Docker CLI 常见路径（`~/.docker/bin`、`/Applications/Docker.app/Contents/Resources/bin` 等）、`docker-credential-desktop` 可用性、github.com / raw.githubusercontent.com / ghcr.io / docker.io 连通性、curl HTTP2 兼容性；预检不通过时给出具体修复指引。
- C10 预检分别测试两条通道：`curl -I https://raw.githubusercontent.com`（终端网络）与 `docker pull hello-world`（Docker 引擎网络），分别给出结果与对应修复指引。
- C13 一键自检：`linksense doctor --network` 或独立诊断脚本，输出终端/Docker 连通性、PATH 中工具、代理配置与逐项修复建议。修复：`linksense doctor --network` 单独检查终端下载与 Docker 引擎拉取，逐项报告，任何项目失败时退出码非零。尚未安装可用新版安装器 `--check-network`；诊断会拉取镜像，但不启动服务或创建安装状态。

### 下载与安装韧性

- C2 curl 容错：保留有界重试和 HTTP/1.1 回退；下载失败增加终端代理检查和文档链接。最外层 curl 示例的普通 `--retry` 不涵盖所有错误，接收中断仍可能需要重跑，不能声称所有 curl 调用都具备同样的重试策略。
- C3 断点续装：已完成 Stage 打标记（如 `~/.linksense/.install-progress`），重跑时跳过；Stage 4 镜像拉取可单独重试。现状：`install.pending` + 摘要校验缓存 + 已拉取镜像跳过已提供大部分效果，无显式阶段标记。
- C4 内置/文档化 Docker Hub 镜像加速：拉取失败给出独立 Docker 代理、可信 `registry-mirrors` 和认证/限流检查指引；文档提供合并 JSON 的示例。没有硬编码未经验证的公共加速地址。
- C8 离线/半离线安装：`--offline` / `--local` 参数，或镜像 tar 包 + `docker load` 替代 `docker pull`。现状：未实现。

### PATH 与工具链

- C5 PATH 继承：脚本开头探测并加载常见 Docker 路径，或文档建议两步安装替代管道。

```sh
for p in /usr/local/bin /Applications/Docker.app/Contents/Resources/bin "$HOME/.docker/bin" "$HOME/.local/bin"; do
  [ -d "$p" ] && export PATH="$p:$PATH"
done
```

- C6 Docker Desktop CLI 集成失败降级：文档提供手动 PATH 配置说明，不依赖自动集成。

### 错误提示与文档

- C7 错误提示更友好：本次覆盖 Docker CLI/Engine、配置中的 credential helper、终端下载、镜像拉取和模型渠道失败。凭证助手缺失给出 PATH 命令；其他通道给出对应检查与文档指引。没有重写所有既有安装阶段的提示。
- C9 文档新增「网络与代理配置」章节：终端代理（`http_proxy` / `https_proxy` / `ALL_PROXY`）与 Docker 代理（Settings → Resources → Proxies）必须分别配置，只配一个另一个仍会失败。
- C11 区分 HTTP 与 SOCKS5 端口：说明 Docker Desktop 支持 HTTP/HTTPS 代理，SOCKS5 需要 Business 订阅；给出 `lsof -i -P | grep LISTEN` 排查方法；提醒 SOCKS5 端口不能填成 `http://`。
- C12 说明 `http.docker.internal:3128` 为正常现象：配置自定义代理后该字段不会改变，以 `docker pull` 实测为准。

## D. 推荐安装流程与原始成功记录

原反馈使用 SOCKS5 10808、全局 `~/.curlrc` 和第三方镜像加速后安装成功。这是单台机器的观察记录，不是所有 Docker Desktop 用户都适用的配置。[官方说明](https://docs.docker.com/desktop/settings-and-maintenance/settings/#proxies) Desktop 的 SOCKS5 支持需要 Business 订阅；优先启用代理软件的 HTTP 监听端口。

1. 启动 Docker Desktop。新版脚本自动补齐常见工具路径；需要手动使用 Docker 时可执行：

```sh
export PATH="$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

2. 确认代理软件的真实监听端口，DNS 设置值不能代替代理端口：

```sh
lsof -nP -iTCP -sTCP:LISTEN
# 仅在 HTTP 10809 已开启时使用下面的示例；实际端口以代理软件为准。
export http_proxy=http://127.0.0.1:10809
export https_proxy=http://127.0.0.1:10809
# 只有 SOCKS5 时，终端 curl 可使用 socks5h://，由代理解析域名。
# export ALL_PROXY=socks5h://127.0.0.1:10808
```

3. 在 Docker Desktop → Settings → Resources → Proxies 单独配置 HTTP 代理。`http.docker.internal:3128` 是 Desktop 内部转发地址，不能凭它判断外部代理是否生效。Engine 的镜像加速配置应合并到现有 JSON，并使用由自己信任和管理的地址；不覆盖原配置，也不将 daemon.json 的代理设置当成 Desktop 代理配置。

4. 检查 Docker VM 内存分配。16 GiB 主机优先 Core；当前 Core 要求 Docker Engine 实际可用至少 8 GiB，名义分配值应为 VM 开销留余量。不要把 16 GiB 物理内存当成容器可用内存。

5. 分别检查两条通道，再执行安装：

```sh
curl --http1.1 --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 \
  -fsSL -o install-core.sh https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh
# 下载失败时不要执行本地残缺文件；成功后再运行下面命令。
sh install-core.sh --check-network
sh install-core.sh
# 已安装新版管理工具后：
linksense doctor --network
```

`--check-network` 需要包含本次改进的新发布版。新版 bootstrap 会拒绝将诊断参数交给不支持它的旧安装器，避免诊断误触发安装。发布前可使用 `scripts/bundle-release-installers.mjs` 生成本分支的自包含安装器进行测试。

诊断默认测试真实发布清单下载；默认 GitHub 发布源同时测试 raw bootstrap。自定义发布源不强制检查 GitHub/raw。安装前校验清单摘要，验证唯一且固定摘要的 BusyBox/API 引用，再分别拉取，覆盖标准发布的 Docker Hub 和 GHCR；清单不可验证时只继续 `hello-world:latest` 探测，整体仍失败。已安装工具使用当前环境中的镜像引用；旧状态缺失引用时使用对应版本的校验清单。诊断不执行容器，拉取可能增加较大的本地镜像缓存。`upgrade.sh --check-network` 也可在尚未安装时运行，正常升级仍要求已有可信状态。

无需为了安装永久修改全局 `~/.curlrc`。HTTP/1.1 降级作用于示例下载命令，安装器内部遇到 HTTP/2 错误也会回退。

完整操作见 [主机适配说明](../../deploy/release/HOST-ADAPTATION.md#network-and-proxies)。

## E. 建议修复优先级（供参考）

- P0：B1 任务执行失败（阻断核心功能）；C9 / C10 / C11 / C12 代理与网络文档及预检（国内用户几乎必踩）。
- P1：A1 / A4 / C5 / C6 macOS PATH 与 credential helper；C1 / C13 预检与 `doctor --network`；A6 / C4 镜像加速提示。
- P2：C3 显式阶段标记；C8 离线安装；C7 错误提示文案；A3 / A7 / A8 实机复测确认现有重试覆盖。

## F. 本次修复范围与验收边界

- 实施：macOS PATH 自动发现、配置中凭证助手预检、拉取失败指引、安装前及安装后的双通道网络诊断、bootstrap 参数透传及旧版本诊断保护、六语言模型错误提示及安全错误分类。
- 复用：下载/拉取重试、HTTP/1.1 回退、摘要缓存、部分文件续传、`install.pending` 和原有数据保护。没有增加重复的阶段状态文件。
- 延后：完整离线发布包与 `--offline`。预先 `docker load` 的正确摘要镜像已可复用，但发布清单、配置及 Full tokenizer 等仍需可信资源，不能因此声称完全离线安装。
- 必须实机验收：M4 首次安装、真实终端/Engine 代理、下载中断后续装，以及失败渠道的多轮工具任务。模拟测试通过不替代这些检查。

## G. DeerFlow 参考与安装入口

参考 [DeerFlow README](https://github.com/bytedance/deer-flow#one-line-agent-setup) 和 [Install.md](https://github.com/bytedance/deer-flow/blob/main/Install.md) 的组织方式，新增本项目的 [Agent 安装指南](../../Install.md)，并同步中英文 README：

- One-Line Agent Setup：一句话交给编程助手，默认使用已发布 Core；明确请求源码开发时才克隆并准备开发栈。
- Running the Application：区分发行镜像安装和 Docker 源码开发，写明 `pnpm dev:prepare` 会启动服务，不是纯依赖准备。
- Deployment Sizing：用表格区分 Core 评估、Core 共享服务器、Full 新安装和源码开发，包含起步配置、推荐配置和限制；推荐值属于规划建议，不是容量压测结果。
- 补齐初始化、模型配置、服务管理、网络诊断和工具任务验证步骤；补充源码开发实际需要的 mkcert。

新增入口随文档与新版安装器发布后才能在线使用。当前测试分支不代表 GitHub `main/Install.md` 或已发布镜像已经更新。

## H. 本地验证结果（2026-10-13）

| 范围 | 实际检查 | 结果 |
| --- | --- | --- |
| 主机工具、安装器与 README（审查后重跑） | `pnpm exec node --test --test-concurrency=2 scripts/installer-host.test.mjs scripts/release-cli.test.mjs scripts/release-installation.test.mjs scripts/readme.test.mjs` | 119/122 通过；3 项调用真实 Docker Compose 的检查因 `spawnSync docker ENOENT` 失败。新增覆盖 GHCR 被阻断、摘要不符、无效或重复镜像引用、首次主机升级脚本诊断，以及代理变量白名单和 helper 覆盖。 |
| 最终管理 CLI | `pnpm exec node --test scripts/release-cli.test.mjs` | 16/16 通过。补充回归：缺失 registry credential helper 不阻止本地 `status` / `stop`；预检仍用于安装及网络诊断。 |
| 模型网关与协议桥 | `pnpm --filter @linksense/runner test test/model-gateway.test.ts test/chat-completions-bridge.test.ts` | 49/49 通过；覆盖错误分类、超时、脱敏、单次上游请求及原有协议桥行为。 |
| 前端错误、历史任务与六语言 | `pnpm --filter @linksense/web exec vitest run src/lib/public-copy.test.ts src/i18n.test.ts src/api/error-message.test.ts src/features/conversations/conversation-thread.test.tsx --maxWorkers=2` | 302/302 通过。历史任务摘要与旧 activity 的原始 JSON 均转换为安全提示。 |
| 文档 | `pnpm exec node --test scripts/readme.test.mjs`；`pnpm --filter @linksense/docs test` | README 4/4、帮助中心 23/23 通过；中英文实际执行命令一致、文件链接和开发端口正确。 |
| 静态检查 | `pnpm typecheck`；`pnpm lint`；`git diff --check` | 均通过。lint 保留未修改文件 `conversation-message-list.tsx` 中已有的 `useVirtualizer` / React Compiler 兼容性警告，0 个错误。 |
| 构建 | 对 `@linksense/shared`、`@linksense/runner`、`@linksense/web`、`@linksense/docs` 分别运行 `pnpm --filter <package> build` | 均通过；帮助中心中英文构建成功。Web 仍有大 chunk 提示，此次没有改动预览组件拆包。 |

兼容性检查覆盖旧任务 JSON、缺失或 null 的 `credsStore`、缺失镜像引用的旧安装状态，以及已有配置/卷保留用例。本次没有数据库迁移或依赖变更，不需要改写历史任务或重建组织资源。

未运行整个仓库测试及真实 Docker 安装。当前主机缺少 Docker CLI，3 项 Compose 检查需在有 Docker 的环境重跑上述安装测试；实机 Core 安装、下载中断续装、终端与 Docker 代理、原 DeepSeek 渠道多轮工具任务仍需按 F 节验收。B1 的真实上游根因仍缺失败时 runner 日志，不能标记为已解决。

本次改动在 `feat/october-changes-testing` 独立测试分支维护；本记录不代表已合并至主分支或已发布版本。

## I. Code review 后修复

- Standards（P2）：全局 `credsStore` 预检误拦截有合法 `credHelpers` 覆盖的配置。现按 Docker 的覆盖优先级处理，实际 pull 保留缺失 helper 的诊断。
- Spec（P2）：新安装网络检查漏测 GHCR。现从摘要校验通过的清单拉取实际 BusyBox/API 镜像；不可信或损坏的引用不会传给 Docker。
- Spec（P2）：Linux `sudo` 清理代理变量，使用户账号诊断通过而提权安装失败。安装示例、CLI 和生成的 launcher 仅保留八个代理变量，不使用全环境 `-E`，不将代理凭据写入命令参数或配置；旧 launcher 首次升级需显式使用文档中的 `sudo --preserve-env=…`。
- 入口检查（P2）：`upgrade.sh --check-network` 在诊断前要求已有安装状态。现仅诊断跳过该身份读取，正常升级的可信状态要求保持不变。

每项先由回归检查复现失败，再修复。审查本轮只改动安装脚本、相应测试和文档，未再次运行 Web/Runner 的上一轮测试、类型检查与构建；真实 sudo 策略、Docker 网络和原 DeepSeek 渠道仍需实机验收。
