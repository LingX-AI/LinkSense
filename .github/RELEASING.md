# LinkSense 私有源码发布指南

本文描述 LinkSense 首发阶段的 GitHub 发布边界和实际操作。它本身不构成发布授权；创建 GitHub 仓库、推送源码、公开 GHCR 包、发布版本或公开源码仍需发布负责人明确执行。

## 首发边界

- 目标仓库：`LingX-AI/linksense`
- 源码仓库：私有
- GitHub Release：私有，仅用于内部获取安装资产
- LinkSense GHCR 镜像：公开，允许匿名拉取
- 许可证：CPAL-1.0
- 首发版本：`v0.1.0`
- 首发架构：`linux/amd64`
- 对外端口：`10080`
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
5. 注册一台可随时重建、仅用于发版的 `linux/amd64` self-hosted runner，并添加 `linksense-full-release` 标签。它需要：
   - passwordless `sudo`
   - Docker API v1.45 或更高
   - Docker Compose v2.24.4 或更高
   - 至少 16 GiB 内存
   - Docker 数据目录至少 80 GiB 可用空间
   - 至少 200,000 个可用 inode
6. 这台 runner 不得是生产主机或多人共享的长期主机。Full 冒烟测试会创建并精确清理固定名称的测试卷、网络和 `/opt/linksense-release-smoke`。
7. 配置 `main` 分支保护，要求 CI 通过，并禁止 force push 和删除。

GHCR 首次创建包时默认为私有。首次工作流生成候选镜像后，组织所有者需要把下列五个包改为公开：

- `linksense-api`
- `linksense-web`
- `linksense-migrate`
- `linksense-runner`
- `linksense-worker`

GHCR 包从公开改回私有通常不可逆，因此该步骤需要明确确认。最终发布任务会先退出 GHCR，再匿名检查五个候选镜像；未全部公开时任务会安全失败。完成可见性调整后，只需重新运行失败的 `release` job。

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
3. 从 GitHub Actions 手动运行 `Publish private-source release`。工作流会拒绝非 `main`、非私有仓库、未授权发版人、已存在版本或非 CPAL-1.0 的输入。
4. GitHub-hosted runner 验证代码并构建 `api`、`web`、`migrate`、`runner`；self-hosted runner 构建较大的 `worker`。所有镜像先发布为本次运行唯一的候选标签。
5. 工作流记录候选镜像不可变摘要，生成安装资产、CPAL-1.0 许可证、资产校验和、SBOM 和 provenance。
6. 专用 runner 从临时 HTTPS 源执行 Core 安装/修复和 Full 安装/修复，验证 Core 不包含 Full 服务、仅暴露 `10080`，并完成 Full 探针。
7. 首次发布时，按上一节将五个 GHCR 包设为公开；如果最终 job 已失败，重新运行失败 job。
8. 最终 job 匿名验证镜像后，按已测试摘要创建正式 `vMAJOR.MINOR.PATCH` 镜像标签，并创建仍保持私有的 GitHub Release。已存在的正式标签若指向不同摘要，流程会拒绝覆盖。

不要删除或替换已发布标签，也不要复用版本号。错误版本应通过新版本修正。

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
