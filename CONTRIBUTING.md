# Contributing to LinkSense

Thank you for contributing to LinkSense. Before submitting changes, search the existing Issues and Discussions to make sure the topic has not already been covered. For security issues, follow [SECURITY.md](./SECURITY.md) and do not disclose them publicly.

## Development setup

The project uses Node.js, a pnpm workspace, Docker Compose, and PostgreSQL. Use the pnpm version declared in the repository's `package.json`.

```bash
pnpm install
DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build pnpm db:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

To run a command for a single workspace, use:

```bash
pnpm --filter <package-name> <script>
```

Use `uv` consistently for Python commands and dependencies.

### Development image caching / 开发镜像缓存

`pnpm dev` reuses images when their tracked build inputs are unchanged. A changed
manifest, lockfile, or worker source can require an image rebuild. The Dockerfiles
use persistent BuildKit pnpm stores, so rebuilding a dependency layer reuses cached
packages and downloads only missing packages. Stores are separated by target
architecture and build user; installed dependencies remain in the image without
requiring the cache at runtime. The first build with these stores, a new Docker
builder, or a cleared build cache must download packages again. Keep the same
builder between development runs to retain this benefit.

Production-package assembly also keeps pnpm registry metadata and prefers cached
responses. Worker browser downloads use a separate BuildKit cache and are copied
into the final image; an interrupted build retains completed browser downloads.
The `[dev]` stage timings distinguish image preparation from application startup.
Use `pnpm dev:benchmark --runs=3 --mode=restart --budget-ms=10000` to measure warm
restart time after preparation, or `--mode=reattach` to measure an already-running
stack. The command reports preparation separately; a cold build is not a 10-second
restart and should be allowed to complete once.

`pnpm dev` 会在构建输入未变化时复用镜像。依赖清单、锁文件或 Worker 源码变化可能触发重建；
Dockerfile 中的 BuildKit pnpm 缓存会复用已下载的包，只下载缓存缺失的依赖。缓存按目标架构和
构建用户隔离，安装后的依赖保存在镜像内，运行时不需要挂载缓存。首次使用这些缓存、更换 Docker
构建器或清理构建缓存后，需要重新下载。日常开发保持使用同一个构建器即可持续复用缓存。

生产依赖打包还会缓存包仓库元数据并优先复用；Worker 浏览器下载使用独立缓存，再复制到最终
镜像，中断构建也会保留已完成的浏览器下载。`[dev]` 分阶段耗时会区分镜像准备与服务启动。
执行 `pnpm dev:benchmark --runs=3 --mode=restart --budget-ms=10000` 可验证准备完成后的重启耗时；
`--mode=reattach` 则测量连接到已运行服务的耗时。首次构建需要先完整结束，不能与后续热启动
的 10 秒目标混为一谈。

## Pull requests

- Keep changes focused and do not include unrelated refactoring or generated artifacts.
- Every feature and behavior change should include corresponding tests.
- Maintain user-visible text in both `zh-CN` and `en-US`.
- Do not commit `.env` files, tokens, secrets, real personal data, runtime directories, build artifacts, or local absolute paths.
- Use Prisma migrations for database schema changes, and clearly describe data-loss and compatibility risks in the pull request.
- Before submitting, run the affected tests, type checks, linting, and build, and record the results in the pull request.

By contributing, you agree to license your contribution under this repository's [CPAL-1.0](./LICENSE).

## Contributor acknowledgements / 贡献者展示

The English and Chinese READMEs share an avatar section based on GitHub's repository contributor records, ordered by commit count. Bot accounts and anonymous authors are excluded; commit email addresses must be associated with a GitHub account to appear. GitHub caches this list, so newly merged contributions can take several hours to appear. We display public avatars and profile links only, never author emails or tokens. Recognition here covers code contributions; other contributions are welcome too.

The **Update README contributors** workflow checks weekly on Monday at 03:23 UTC and can also be run manually from Actions on the default branch. With changes, the workflow creates or updates one documentation-only PR on `automation/readme-contributors`; without changes, no new commit or PR is created. Maintainers review and merge the PR. Do not edit that automation-managed branch by hand. The workflow uses the repository's built-in `GITHUB_TOKEN`, works with private repositories, and does not publish code, build images, or create releases. It does not run on forks or on every push. Keep `[skip ci]` in the merge commit message to avoid unnecessary CI builds.

Before enabling automation, merge the workflow into the default branch and enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** (the organization policy must also permit this). The workflow only creates PRs; it does not approve or merge them. No personal access token or additional Secret is required. Until this permission is enabled, the checked-in avatars remain visible but automated PR creation cannot succeed. API failures or empty contributor results preserve the existing avatars. Only content between `<!-- contributors:start -->` and `<!-- contributors:end -->` is generated; keep both markers in each README.

中英文 README 共用一份基于 GitHub 仓库贡献记录的头像名单，按提交数量排序，排除机器人与匿名作者。提交邮箱需要关联 GitHub 账号；GitHub 的缓存可能导致新贡献延迟数小时显示。名单仅展示公开头像和个人主页，不包含邮箱、Token 或其他私密信息。这里展示代码贡献，我们也欢迎其他形式的贡献。

**Update README contributors** 工作流每周一北京时间 11:23 检查，也可在默认分支的 Actions 页面手动运行。只有名单或顺序发生变化时，才创建或更新 `automation/readme-contributors` 分支上的文档 PR，由维护者审阅合并；请勿手动修改该自动维护分支。工作流使用仓库自带的 `GITHUB_TOKEN`，支持私有仓库，不公开源码、不构建镜像、不发布版本，也不会在 Fork 或每次推送时运行。合并时请保留 `[skip ci]`，避免触发不必要的 CI 构建。

启用前需将工作流合入默认分支，并在 **Settings → Actions → General → Workflow permissions** 勾选 **Allow GitHub Actions to create and approve pull requests**，同时确保组织策略允许。工作流只创建 PR，不自动审批或合并，无需配置个人 Token 或额外 Secret。未开启权限时，已写入 README 的头像仍然可见，但无法自动创建更新 PR。接口失败或返回空名单不会清空已有头像。两份 README 中的贡献者起止标记必须保留，仅标记之间的内容由脚本生成。
