# README 开发者致谢工具调研

调研日期：2026-11-11。范围：在中英文 README 底部展示开发者头像和可见昵称，并根据仓库贡献记录更新。仅调研，未修改 README、脚本或工作流。

后续实施：已复用现有脚本，在两份 README 底部显示头像及可见 GitHub 用户名，保留每周生成更新 PR 的流程；下文保留调研时的仓库状态和选型依据。

## 结论

存在直接支持“头像 + 可见姓名/用户名”的开源工具：`akhilmhdh/contributors-readme-action` 和 All Contributors。前者自动读取仓库贡献者，后者维护人工认可的贡献名单，适合同时感谢代码、文档、设计、测试等贡献。[S1][S2][S3][S4]

对 LinkSense，建议复用已经存在的生成脚本与 PR 工作流，补齐 README 标记并将可见用户名加入模板；这比替换整套机制更小，也能继续一次更新两种语言。当前脚本尚未满足可见昵称要求，而且两份 README 均缺少标记，因此工作流目前不会生成贡献者名单。下述为建议，尚未实施。

## 三种现成方案

| 方案 | 头像和可见昵称 | 名单与更新方式 | 对本需求的适配 |
| --- | --- | --- | --- |
| [contributors-readme-action](https://github.com/akhilmhdh/contributors-readme-action) | 支持。头像下方生成 `<sub><b>名称</b></sub>`；默认用个人资料 `name`，为空时回退到 `login`；`use_username: true` 固定用 GitHub 用户名。[S1] | 调用 GitHub `listContributors`，在 Actions 触发后重写指定 README；可由调用方安排定时运行。默认非保护分支直接提交，保护分支走 PR。[S2][S5] | 三者中最接近“按仓库自动生成头像 + 昵称”。`readme_path` 单次指定一个文件，中英文需分别处理；替换现有方案还需适配双语更新与始终走 PR 的要求。[S2][S6] |
| [All Contributors Bot / CLI](https://github.com/all-contributors/cli) | 支持头像、可见姓名、贡献类型图标；默认模板用 `name`，为空时回退到 `login`。[S3] | Bot 接收 Issue/PR 中的 `@allcontributors please add @username for code` 等提名，创建 PR。CLI 的 `add` 维护 `.all-contributorsrc`，`generate` 从配置生成表格；`check` 仅检查与提交者的差异。[S4][S7] | 适合认可更广的贡献。并非自动扫描后收录所有新提交者；配置 `files` 可同时更新两份 README。[S7][S8] |
| [contrib.rocks / contributors-img](https://github.com/lacolaco/contributors-img) | 当前标准渲染只有头像和 SVG `<title>`，没有可见文字昵称。[S9] | README 嵌入服务生成的图片；名单变化无需提交 README，但取决于服务和缓存。当前响应设置 `Cache-Control: public, max-age=259200`，即 3 天。[S10] | 接入最少，适合只要头像墙的场景；不能直接满足“头像旁或下方可见昵称”，也不能承诺即时更新。[S9][S10] |

`login` 是 GitHub 用户名，`name` 是可为空的公开资料姓名。若本需求中的“昵称”指账号名，直接显示 `login` 即可；若指资料姓名，则还需查询用户资料，并处理缺失值及后续改名。上述 action 会复用上一次 README 中的姓名，不能把每次执行视为重新刷新全部资料姓名。[S1][S11]

## LinkSense 当前实现

以下结论来自本地代码和 README 的实际内容：

- [`scripts/update-contributors.mjs:5–7`](../../scripts/update-contributors.mjs#L5) 已定义起止标记和两份 README；[`76–91`](../../scripts/update-contributors.mjs#L76) 在两份文档都没有标记时直接返回 `[]`，不会请求 GitHub。当前 [`README.md`](../../README.md#L103) 和 [`README.zh-CN.md`](../../README.zh-CN.md#L98) 底部已有社区致谢，但没有这些标记。
- [`26–49`](../../scripts/update-contributors.mjs#L26) 排除机器人和匿名作者，按提交数降序、用户名排序、账号 ID 去重；[`52–58`](../../scripts/update-contributors.mjs#L52) 只生成链接和 64px 头像，`alt` / `title` 使用 `login`，没有直接显示的文字昵称。
- [`.github/workflows/contributors.yml:3–6`](../../.github/workflows/contributors.yml#L3) 每周一 03:23 UTC（北京时间 11:23）或手动触发；[`65–83`](../../.github/workflows/contributors.yml#L65) 只提出中英文 README 的更新 PR，由维护者合并。它不是每次访问 README 时即时更新。
- [`.github/CONTRIBUTING.md:84–96`](../../.github/CONTRIBUTING.md#L84) 仍描述两份 README 已有头像区，与当前 README 内容不一致。若后续实施，应同步实际展示和这段说明，并更新已有回归测试。

## “当前贡献者”的边界

GitHub `GET /repos/{owner}/{repo}/contributors` 按提交数降序返回贡献者，并根据提交作者邮箱关联账号；它不是所有 Issue、评审、设计或社区帮助者的名单。官方说明接口有缓存，数据可能延迟数小时；出于性能考虑，只对前 500 个作者邮箱地址关联账号，其他作者可能作为匿名贡献者返回。[S11]

因此，定时生成表格的实际时效为“GitHub 数据缓存 + 工作流间隔 + PR 合并等待”；动态图还受到图片服务和 GitHub Camo 缓存影响。头像墙和定时脚本都不宜宣称实时；想认可未进入提交记录的贡献者，应采用 All Contributors 的提名名单。[S4][S10][S11][S12]

## 许可证与维护信号

- All Contributors CLI 与 Bot 仓库均有 MIT 许可证。GitHub API 在本次查询时显示未归档，仓库最近推送日期分别为 2026-11-11、2026-11-09；仅作为活动信号，不代表已审计每次变更。[S13][S14][S15][S16]
- contributors-readme-action 有 MIT 许可证；本次查询时未归档，最近推送为 2025-07-27。其 `action.yml` 仍声明 `node20`；若选择接入，需在当前 Actions 环境验证执行和权限，不能只依赖 README 示例。[S2][S6][S17]
- contrib.rocks 的代码公开，但本次仓库 API 返回 `license: null`，文件树未找到许可证文件；不能据此确认可复制或自托管的开源授权。仓库未归档，最近推送为 2026-10-31。[S18][S19]

## 验证与限制

已核对官方文档、实际生成模板、API 调用、缓存响应源码，以及本地脚本、工作流和两份 README。未安装工具，未运行外部 Action、安装 Bot、创建 PR 或修改远端；未验证 contrib.rocks 生产服务与仓库源码是否完全一致，也未进行 GitHub README 的浏览器视觉验证。本次仅新增本研究笔记，无需运行应用测试或构建。

## 一手来源

- [S1] [contributors-readme-action：表格模板及姓名选择](https://github.com/akhilmhdh/contributors-readme-action/blob/master/src/utils/templateBuilder.js)
- [S2] [contributors-readme-action：官方 README、触发示例与提交/PR 行为](https://github.com/akhilmhdh/contributors-readme-action/blob/master/README.md)
- [S3] [All Contributors CLI：贡献者渲染源码](https://github.com/all-contributors/cli/blob/main/src/generate/format-contributor.js)
- [S4] [All Contributors：Bot 使用方法](https://allcontributors.org/en/bot/usage/)
- [S5] [contributors-readme-action：API 调用及更新入口](https://github.com/akhilmhdh/contributors-readme-action/blob/master/src/index.js)
- [S6] [contributors-readme-action：Action 参数及 Node 版本](https://github.com/akhilmhdh/contributors-readme-action/blob/master/action.yml)
- [S7] [All Contributors：CLI add / check / generate](https://allcontributors.org/en/cli/usage/)
- [S8] [All Contributors：CLI files 配置](https://allcontributors.org/en/cli/configuration/)
- [S9] [contributors-img：SVG 渲染源码](https://github.com/lacolaco/contributors-img/blob/main/apps/api/go/renderer/renderer.go)
- [S10] [contributors-img：图片 HTTP 缓存](https://github.com/lacolaco/contributors-img/blob/main/apps/api/internal/api/image/api.go)
- [S11] [GitHub REST：List repository contributors](https://docs.github.com/en/rest/repos/repos#list-repository-contributors)
- [S12] [GitHub：Camo 图片匿名代理与缓存排查](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)
- [S13] [All Contributors CLI：MIT 许可证](https://github.com/all-contributors/cli/blob/main/LICENSE.md)
- [S14] [All Contributors Bot：MIT 许可证](https://github.com/all-contributors/app/blob/main/LICENSE)
- [S15] [GitHub API：All Contributors CLI 仓库元数据](https://api.github.com/repos/all-contributors/cli)
- [S16] [GitHub API：All Contributors Bot 仓库元数据](https://api.github.com/repos/all-contributors/app)
- [S17] [GitHub API：contributors-readme-action 仓库元数据](https://api.github.com/repos/akhilmhdh/contributors-readme-action)
- [S18] [GitHub API：contributors-img 仓库元数据](https://api.github.com/repos/lacolaco/contributors-img)
- [S19] [GitHub API：contributors-img 文件树](https://api.github.com/repos/lacolaco/contributors-img/git/trees/main?recursive=1)
