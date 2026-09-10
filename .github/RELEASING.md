# LinkSense 私有源码发布指南

本文描述 LinkSense 私有源码阶段的 GitHub 发布边界和实际操作。本文不构成发布授权；创建 GitHub 仓库、推送源码、公开 GHCR 包、发布版本或公开源码仍需发布负责人明确执行。

## 当前发布边界

- 目标仓库：`LingX-AI/linksense`
- 源码仓库：私有
- GitHub Release：私有，仅用于内部获取安装资产
- LinkSense GHCR 镜像：公开，允许匿名拉取
- 许可证：CPAL-1.0
- 版本：由待发布提交的 `package.json` 确定，标签使用 `vMAJOR.MINOR.PATCH`
- 镜像架构：`linux/amd64` 和 `linux/arm64`，使用 GitHub 托管原生架构 Runner
- 默认对外端口：`18081`，安装时可自定义
- Issues 和 Discussions：启用
- Git 历史：使用干净快照，不复制 GitLab 历史
- `requirements/`、`training/`、`design-qa.md`、`output/`、`outputs/` 和 `tmp/` 不进入发布快照；`AGENTS.md` 必须保留

发布清单中的 LinkSense 镜像和第三方服务镜像全部固定到不可变的 `sha256` 摘要。修复脚本只修复当前已安装版本，不会隐式升级，也不会自动重建丢失的数据卷。

## GitHub Free 的实现边界

私有组织仓库在 GitHub Free 下不使用以下能力：

- GitHub Environments 的私有仓库保护规则
- GitHub 原生私有仓库 artifact attestations
- 私有仓库 CodeQL 和 Dependency Review

发布流程仍生成 BuildKit SBOM 和最小 provenance，并始终执行 Gitleaks 历史扫描、生产依赖审计、CI 和部署测试。仓库公开后，安全工作流会自动启用 CodeQL 和 Dependency Review。

## 一次性 GitHub 配置

1. 经明确授权后，在 `LingX-AI` 下创建私有仓库 `linksense`，启用 Issues 和 Discussions。
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

## 准备私有干净快照

先在当前项目上完成安全审计和发布验证，再在项目目录之外创建独立快照：

```bash
scripts/create-public-snapshot.sh /absolute/path/to/linksense-github
```

虽然首发仓库是私有的，仍使用同一套公开快照规则，避免需求文档或历史敏感内容进入 GitHub。初始化新仓库前至少检查：

```bash
test -f /absolute/path/to/linksense-github/AGENTS.md
test -f /absolute/path/to/linksense-github/LICENSE
test ! -e /absolute/path/to/linksense-github/requirements
test ! -e /absolute/path/to/linksense-github/training
test ! -e /absolute/path/to/linksense-github/design-qa.md
```

在快照上再次运行 `scripts/run-gitleaks.sh` 和完整验证，人工检查文件清单。不要复制原项目的 `.git` 目录或 GitLab 历史。

## 发布一个私有源码版本

1. 确认 `package.json` 的 `version` 为不带 `v` 的目标版本，并确认 `license` 为 `CPAL-1.0`。
2. 确认准备发布的干净快照已经推送到私有 GitHub 仓库的 `main`。
3. 等待该 `main` 提交触发的 `CI` 和 `Security` 工作流全部成功。发布工作流会复用这两个结果，不再重复安装依赖、运行测试、扫描密钥、执行类型检查、Lint 和源码构建。
4. 从 GitHub Actions 手动运行 `Publish private-source release`。工作流会核对目标提交是否已有成功的 `CI` 和 `Security` 推送检查，并拒绝非 `main`、非私有仓库、未授权发版人、已存在版本或非 CPAL-1.0 的输入。检查尚未结束或失败时，发布会在准备阶段快速停止，不会创建标签、镜像正式版本或 Release。
5. `prepare` 在镜像构建前验证第三方镜像同时包含两个目标架构，下载固定提交的 tokenizer，生成并检查安装入口脚本。上游镜像摘要、资源内容、版本、源码提交和生成时间保存为带校验和的 `release-inputs` artifact；失败时不会启动后续镜像构建。
6. GitHub 托管 Runner 分别构建 `api`、`web`、`migrate`、`runner`、`worker` 的两种架构。所有镜像先发布为本次运行唯一的候选标签，生成 SBOM 和最小 provenance，并验证镜像内基础命令或 Nginx 配置可以运行。此检查不是完整业务或安装验收。
7. `image-indexes` 合并已验证架构镜像；`assets` 使用保存的发布输入和镜像摘要生成清单、许可证和资产校验和，不再重新解析上游标签或下载 tokenizer。
8. 首次发布时，按上一节将五个 GHCR 包设为公开；如果最终 job 已失败，只重新运行失败 job。
9. 最终 job 匿名验证镜像后，按已验证摘要创建正式 `vMAJOR.MINOR.PATCH` 镜像标签。已存在的正式标签若指向不同摘要，流程会拒绝覆盖。
10. 创建 GitHub Release 草稿并上传资产，下载全部资产逐字节核对后才发布 Release。源码仓库和 GitHub Release 均保持私有。维护者随后完成 Core / Full 安装、修复、升级及业务验收，再对外分发安装资产。

不要删除或替换已发布标签，也不要复用版本号。错误版本应通过新版本修正。

## 节约 Runner 用量与失败恢复

- CI 和 Security 在目标 `main` 提交上通过一次即可，发布不重复执行完整测试、检查和源码构建。
- 镜像矩阵不因单个任务失败而取消其他架构或镜像任务，已经成功的构建结果留给续跑复用。
- 镜像缓存继续使用私有 GitHub Actions `mode=min` 缓存，不向公开 GHCR 暴露中间构建层。API 额外读取同架构 migration 的共享依赖缓存。缓存导出最多等待 2 分钟；导出失败不使已成功构建的镜像失败。编译、测试、安全扫描、镜像推送和资产校验仍是必须通过的步骤。
- 只对上游镜像查询和 tokenizer 下载设置有界重试，不重试或忽略测试失败。
- 发布输入和中间 artifact 保留 3 天。期间发生网络或上传中断，在原工作流选择 **Re-run failed jobs**；不要重新 dispatch，也不要选择 Re-run all jobs，否则会重复构建。

也可使用已登录的 GitHub CLI，替换实际运行编号后执行：

```bash
gh run rerun RUN_ID --failed --repo LingX-AI/linksense
```

续跑复用成功任务保存的输入、镜像摘要和资产。草稿上传中断时先核对已有资产，再补传缺失资产，不覆盖已上传内容。已发布 Release 只校验、不修改。若标签指向错误提交、资产不一致，或 artifact 已过期，流程会停止；先人工排查，不能靠覆盖旧版本绕过校验。

用所有 job 的计费时长之和评估额度消耗，不能只看整个工作流经过了多久。后续发布需比较缓存命中、实际 job 耗时和失败次数，再决定是否继续合并构建任务；当前保留独立构建以控制内存峰值和失败重跑范围。

## 内部一键部署测试

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

## 后续公开边界

公开源码和提供公网一行安装地址是两个独立动作，都需要再次确认：

- 公开源码前，对即将公开的干净快照再次进行密钥、许可证、隐私和文件清单审计。
- 公网一键安装可在源码公开后直接使用公开 GitHub Release，也可以继续使用独立 HTTPS 下载域名。
- 源码公开后确认 CodeQL、Dependency Review、Dependabot、secret scanning 和 push protection 的实际启用状态。
