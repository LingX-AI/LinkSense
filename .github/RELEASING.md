# LinkSense 发布指南

本文描述 LinkSense 在私有和公开 GitHub 仓库中的发布流程。发布工作流不会修改仓库可见性，仅通过维护者手动触发；推送代码、修改仓库可见性或创建标签都不会自动发布新版本。

## 当前发布边界

- 目标仓库：`LingX-AI/linksense`
- 源码仓库：支持 Private 和 Public，由仓库设置控制
- GitHub Release：访问权限随仓库可见性变化；私有仓库需认证，公开仓库允许匿名下载已发布资产
- 工作流：`Publish release`，只能由 `LINKSENSE_RELEASE_ACTOR` 指定的用户在 `main` 上手动触发
- 新 Release 标题：`LinkSense vMAJOR.MINOR.PATCH`，不再将仓库可见性写入标题
- LinkSense GHCR 镜像：公开，允许匿名拉取
- 许可证：CPAL-1.0
- 版本：由待发布提交的 `package.json` 确定，标签使用 `vMAJOR.MINOR.PATCH`
- 镜像架构：`linux/amd64` 和 `linux/arm64`，使用 GitHub 托管原生架构 Runner
- 默认对外端口：`18081`，安装时可自定义
- Issues 和 Discussions：启用
- Git 历史：使用干净快照，不复制 GitLab 历史
- `requirements/`、`training/`、`design-qa.md`、`output/`、`outputs/` 和 `tmp/` 不进入发布快照；`AGENTS.md` 必须保留

发布清单中的 LinkSense 镜像和第三方服务镜像全部固定到不可变的 `sha256` 摘要。修复脚本只修复当前已安装版本，不会隐式升级，也不会自动重建丢失的数据卷。

MinIO 使用 Coolify 团队在 GitHub GHCR 发布的第三方构建 `ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z`，不再依赖官方已失效的镜像地址，也不由 LinkSense 自托管。该镜像包含服务端和 `mc` 客户端，Core / Full 的安装与升级均从发布清单读取锁定摘要；存储桶初始化复用镜像内的 `mc`，健康检查使用 `mc ready local`。详见 [构建源码](https://github.com/coollabsio/minio) 和 [Coolify 使用配置](https://github.com/coollabsio/coolify/blob/main/templates/compose/minio-community-edition.yaml)。

升级会保留原 MinIO 数据卷、存储桶和凭据。操作前应按现有升级流程备份；不能通过删除数据卷解决镜像拉取问题。旧 Release 的清单不会被篡改，修复旧版本仍使用该版本原有镜像；需要新镜像源时应升级到包含此变更的新 Release。

## GitHub Free 的实现边界

私有组织仓库在 GitHub Free 下不使用以下能力：

- GitHub Environments 的私有仓库保护规则
- GitHub 原生私有仓库 artifact attestations
- 私有仓库 CodeQL 和 Dependency Review

发布流程仍生成 BuildKit SBOM 和最小 provenance，并要求待发布提交已通过 CI 和 Security。CI 执行生产依赖审计和部署测试，Security 执行 Gitleaks 历史扫描。仓库公开时，`public` 事件自动触发 Security 并运行 CodeQL；公开仓库的 PR 还会运行 Dependency Review。Security 也支持在 Actions 页面手动运行。

公开仓库发版时，会进一步确认选中的 Security 运行中 `codeql` job 已成功。私有阶段跳过 CodeQL 的成功记录不能用于公开发版；须等待公开后的 Security 通过，或在 `main` 上手动运行 Security。CI 必须来自同一提交的成功 `push` 运行；Security 可以来自同一提交、`main` 分支的 `push`、`public`、`workflow_dispatch` 或 `schedule` 运行，不接受 PR 检查替代。

## 一次性 GitHub 配置

1. 在 `LingX-AI/linksense` 仓库启用 Issues 和 Discussions。仓库公开与否由维护者单独设置，发布工作流不执行此操作。
2. 创建仓库变量 `LINKSENSE_RELEASE_ACTOR`，值为唯一允许手动发版的 GitHub 用户名。发布工作流只接受该用户从 `main` 分支发起的 `workflow_dispatch`。
3. 在 Actions 设置中允许仓库工作流运行，并允许 `GITHUB_TOKEN` 创建 Release 和写入 Packages。无需保存长期 Personal Access Token 到仓库 Secrets。
4. 将 Actions artifact 保留期设为 3 天。建议为 Actions 设置预算和告警，并禁止意外超额计费。
5. 使用 `ubuntu-24.04` 和 `ubuntu-24.04-arm` GitHub 托管 Runner，无需配置自托管 Runner。
6. Core / Full 的完整安装、修复和升级验收由维护者在独立测试主机上手动完成，不在发布工作流中启动整套 Full 服务。安装主机要求见 README，不等同于构建 Runner 要求。
7. 通过 PR 审核合入 `main`。发布准备任务强制检查同一提交的 CI 和 Security 结果；如仓库套餐支持，再配置相应分支保护或规则集。

GHCR 首次创建包时默认为私有。首次工作流生成候选镜像后，组织所有者需要把下列五个包改为公开：

- `linksense-api`
- `linksense-web`
- `linksense-migrate`
- `linksense-runner`
- `linksense-worker`

公开镜像意味着任何人都可以下载并保留副本，因此该步骤需要明确确认。最终发布任务会先退出 GHCR，再匿名检查五个候选镜像；未全部公开时任务会安全失败。完成可见性调整后，只需重新运行失败的 `release` job。

## 首次导入时准备干净快照

先在当前项目上完成安全审计和发布验证，再在项目目录之外创建独立快照：

```bash
scripts/create-public-snapshot.sh /absolute/path/to/linksense-github
```

首次导入时，无论仓库是否私有，都使用同一套公开快照规则，避免需求文档或历史敏感内容进入 GitHub。初始化新仓库前至少检查：

```bash
test -f /absolute/path/to/linksense-github/AGENTS.md
test -f /absolute/path/to/linksense-github/LICENSE
test ! -e /absolute/path/to/linksense-github/requirements
test ! -e /absolute/path/to/linksense-github/training
test ! -e /absolute/path/to/linksense-github/design-qa.md
```

在快照上再次运行 `scripts/run-gitleaks.sh` 和完整验证，人工检查文件清单。不要复制原项目的 `.git` 目录或 GitLab 历史。此步骤用于首次导入；已有 GitHub 仓库切换为 Public 不需要重新初始化、复制快照或改写历史。

## 发布一个版本

1. 确认 `package.json` 的 `version` 为不带 `v` 的目标版本，并确认 `license` 为 `CPAL-1.0`。
2. 确认待发布代码已经推送到 GitHub 仓库的 `main`。
3. 等待该 `main` 提交的 `CI` 和 `Security` 全部成功；公开仓库还须确认 Security 中的 CodeQL 成功。发布工作流会复用这些结果，不再重复安装依赖、运行测试、扫描密钥、执行类型检查、Lint 和源码构建。
4. 从 GitHub Actions 手动运行 `Publish release`。工作流会核对目标提交的检查结果，并拒绝非 `main`、非 Private/Public 仓库、未授权发版人、已存在版本或非 CPAL-1.0 的输入。检查尚未结束或失败时，发布会在准备阶段快速停止，不会创建标签、镜像正式版本或 Release。
5. `prepare` 在镜像构建前验证第三方镜像同时包含两个目标架构，下载固定提交的 tokenizer，生成并检查安装入口脚本。上游镜像摘要、资源内容、版本、源码提交和生成时间保存为带校验和的 `release-inputs` artifact；失败时不会启动后续镜像构建。
6. GitHub 托管 Runner 分别构建 `api`、`web`、`migrate`、`runner`、`worker` 的两种架构。所有镜像先发布为本次运行唯一的候选标签，生成 SBOM 和最小 provenance，并验证镜像内基础命令或 Nginx 配置可以运行。此检查不是完整业务或安装验收。
7. `image-indexes` 合并已验证架构镜像；`assets` 使用保存的发布输入和镜像摘要生成清单、许可证和资产校验和，不再重新解析上游标签或下载 tokenizer。
8. 首次发布时，按上一节将五个 GHCR 包设为公开；如果最终 job 已失败，只重新运行失败 job。
9. 最终 job 匿名验证镜像后，按已验证摘要创建正式 `vMAJOR.MINOR.PATCH` 镜像标签。已存在的正式标签若指向不同摘要，流程会拒绝覆盖。
10. 创建 GitHub Release 草稿并上传资产，下载全部资产逐字节核对后才发布 Release。仓库可见性保持不变：Private 仓库仅授权用户可访问；Public 仓库发布后允许匿名下载。维护者应完成 Core / Full 安装、修复、升级及业务验收，再对外宣布该版本可用于生产。

不要删除或替换已发布标签，也不要复用版本号。错误版本应通过新版本修正。

## 节约 Runner 用量与失败恢复

- CI 和 Security 在目标 `main` 提交上通过一次即可，发布不重复执行完整测试、检查和源码构建。
- 镜像矩阵不因单个任务失败而取消其他架构或镜像任务，已经成功的构建结果留给续跑复用。
- 镜像缓存使用 GitHub Actions `mode=min` 缓存，不向公开 GHCR 推送中间构建层。仓库公开后不要将缓存视为私有存储，也不要向其中放入凭据。API 额外读取同架构 migration 的共享依赖缓存。缓存导出最多等待 2 分钟；导出失败不使已成功构建的镜像失败。编译、测试、安全扫描、镜像推送和资产校验仍是必须通过的步骤。
- 只对上游镜像查询和 tokenizer 下载设置有界重试，不重试或忽略测试失败。
- 发布输入和中间 artifact 保留 3 天。期间发生网络或上传中断，在原工作流选择 **Re-run failed jobs**；不要重新 dispatch，也不要选择 Re-run all jobs，否则会重复构建。

也可使用已登录的 GitHub CLI，替换实际运行编号后执行：

```bash
gh run rerun RUN_ID --failed --repo LingX-AI/linksense
```

续跑复用成功任务保存的输入、镜像摘要和资产。草稿上传中断时先核对已有资产，再补传缺失资产，不覆盖已上传内容。已发布 Release 只校验、不修改。若标签指向错误提交、资产不一致，或 artifact 已过期，流程会停止；先人工排查，不能靠覆盖旧版本绕过校验。

用所有 job 的计费时长之和评估额度消耗，不能只看整个工作流经过了多久。后续发布需比较缓存命中、实际 job 耗时和失败次数，再决定是否继续合并构建任务；当前保留独立构建以控制内存峰值和失败重跑范围。

## 私有仓库的内部部署测试

私有 GitHub Release 无法供匿名一行脚本直接读取。内部测试时，用已登录的 GitHub CLI 下载完整 Release 资产目录：

```bash
gh release download v0.1.0 --repo LingX-AI/linksense --dir /srv/linksense-v0.1.0
```

然后把该目录原样放到受信任的内部 HTTPS 静态服务器，不要只复制四个入口脚本。安装器需要清单、清单校验文件、Compose 配置、许可证和其他受校验资产。内部执行时显式指定镜像源，例如：

```bash
curl -fsSL https://downloads.example.internal/linksense/v0.1.0/install-core.sh | \
  sudo LINKSENSE_RELEASE_BASE_URL=https://downloads.example.internal/linksense/v0.1.0 sh
```

`LINKSENSE_RELEASE_BASE_URL` 的显式值优先于清单中记录的私有 GitHub Release 地址，因此同一组经过校验的资产可通过内部 HTTPS 镜像测试，无需改写清单。

## 提前准备并切换为公开仓库

可以在仓库仍为 Private 时提前执行完整发布：运行 `Publish release`，完成镜像构建、安装资产校验并正式发布 Release。此时 Release 及安装资产仍需仓库访问权限，五个公开 GHCR 包中的新版本镜像则可匿名拉取。之后将仓库改为 Public，已有 Release 和资产随之开放，不需要再点击 Publish 或重新构建。

1. 先把本次发布流程改动合并、推送到 `main`，等待 CI 和 Security 通过。发布仍只有 `workflow_dispatch` 入口，此步骤不会构建发布镜像或创建 Release。
2. 公开前完成 Git 历史、远程分支、PR、Actions 日志与资产的敏感信息检查，确认贡献授权和许可证。选择没有发布任务运行的时间切换可见性。
3. 在约定时间将仓库改为 Public。已有 Release 和其资产随仓库一起公开，无需重建镜像、重打标签或重新发布；历史标题中的 `(private source)` 如需移除，可单独编辑标题，不修改资产或标签。
4. 等待 `public` 事件触发的 Security 完成并确认 CodeQL 成功。若未自动触发，在 Actions → Security → Run workflow 中选择 `main` 手动运行；之后检查分支保护、Dependabot、secret scanning 和 push protection 的实际启用状态。
5. 验证匿名访问 README 安装入口、最新 Release 资产和五个 GHCR 镜像，再进行独立环境的安装验收。当前最新 Release 与 `main` 可以是不同版本；改为公开不会把 `main` 自动变成最新 Release。
6. 后续需要新版本时，按上面的“发布一个版本”执行 `Publish release`。公开本身不要求发布新版本。

GitHub 官方说明：[仓库公开事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#public)、[修改可见性的影响](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。
