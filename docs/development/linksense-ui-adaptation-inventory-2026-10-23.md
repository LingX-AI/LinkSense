# Linksense UI 适配盘点

首次盘点：2026-10-23。实施更新：2026-10-24（Asia/Shanghai）。本次按用户“继续直到全部完成”的要求，将适配从登录和首页扩展到现有 Web 页面家族。视觉规范、复用方式和实际边界以 [UI 设计基线](ui-design-system.md) 及代码为准。

## 当前实现覆盖

| 页面家族 | 已完成的适配范围 |
| --- | --- |
| 账号访问 | 登录、注册、激活、找回、重设密码、首次初始化及 OIDC / SAML / 社交回调统一外壳；保留等比品牌图，按最新要求移除登录入场动效。 |
| 任务与会话 | 主框架、首页、聊天阅读与输入区、项目选择、任务/项目操作、搜索、分享与公开快照；执行、审批、表单、计划、产物、引用和各预览沿用现有能力与语义。 |
| 自动化 | 页面外壳、标题、筛选、列表和模板卡片，以及现有计划编辑与操作使用的共享控件。 |
| 插件中心 | 应用、插件、技能、连接器、MCP、发布/审核及应用外部访问、用量等页面继承统一外壳、表单、列表、表格与弹窗；主模块导航调整到标题之后。 |
| 资料库 | 知识库、文档、文档预览、引用、任务产物及站点复用统一导航、列表、表格、表单与弹窗样式。 |
| 设置与管理 | 全部现有个人设置、归档及管理入口接入规范；常规/个性化/安全使用共享分区，资料页改为横向身份卡，外观页提供主题预览卡。 |

覆盖通过页面家族和实际组件继承完成，不代表逐一重写每个文件或逐像素验收全部状态画板。应用运行页的宿主界面保留规范；用户创建的应用/iframe 内容不强行改写。

## 本轮代表稿件

此前已读取登录、密码找回和首页。本轮补读了下列代表页面，以及相关任务、项目、搜索、概览与分享分区的元数据。大画板仅返回稀疏结构时，补读可见子节点。

| 代表界面 | 个人副本节点 |
| --- | --- |
| 聊天详情及结构化请求 | [聊天](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-151957)、[表单](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-153760) |
| 自动化 | [列表与模板](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=984-74401) |
| 插件中心 | [应用](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-272955) |
| 资料库 | [知识库](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-290427) |
| 个人与设置 | [常规](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-306101)、[个人资料](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-303573)、[外观](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-306738) |
| 项目、搜索与分享 | [创建项目](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-163511)、[搜索](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-182899)、[分享弹窗](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-189863)、[公开快照](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=985-190925) |

## 实际适配与边界

1. 公开分享仍是“持链接可访问”的固定快照，保留预览与脱敏；不采用稿件中与现有 API 不符的访问权限提示，也不虚构分享作者。
2. 保留真实项目分组、通知位置、自动化编辑侧栏、模型未配置提示、既有用户偏好和完整统计。自动命名沿用实际的个性化入口；团队/奖励等只有稿件、尚无产品页面及明确业务契约的内容，未作为新业务功能实现。
3. 移动、暗色和跨平台字体按语义规范适配；浅色操作、辅助与危险文字略调深以保证对比度。账号页均静态显示，登录页原有入场动效已按最新要求移除。
4. 本次不改数据库、认证/会话契约和 Codex 执行策略。没有部署 UAT/生产或写回 Figma，也未修改两个个人 skill 的默认内容；仓库 AGENTS 已指向设计基线，以便后续常规工作减少 Figma 依赖。

## 本轮验证

2026-10-24 最终检查完成：

| 检查 | 实际结果 |
| --- | --- |
| `pnpm --filter @linksense/web test:unit` | 440 个测试文件通过：应用 325 项，组件与 Node 4,888 项，共 5,213 项，无失败。 |
| `pnpm --filter @linksense/web test:e2e --workers=2` | 92 项 Chromium 浏览器测试全部通过。包含 28 个入口的桌面浅色、窄屏浅色、桌面暗色布局巡检，以及公开快照的只读与 Axe 检查。 |
| 面板与图片稳定性复查 | 四个相关浏览器用例连续运行三轮，12 / 12 通过。 |
| `pnpm --filter @linksense/web typecheck` | 通过。 |
| `pnpm --filter @linksense/web lint` | 零错误；保留 `conversation-message-list.tsx` 中 TanStack Virtual 与 React Compiler 的一条既有兼容性警告。 |
| `pnpm --filter @linksense/web build` | TypeScript 与 Vite 构建通过；Office/表格等现有渲染器仍有大分块提示，未添加依赖或放宽构建阈值。 |
| `git diff --check` | 通过。 |

验证使用隔离模拟 API，并查看了实际生成的运行截图。未运行后端/Runner 测试，未部署或验证真实 SSO、邮件投递、第三方连接、AI 执行与生产数据权限；Safari、Firefox 和真实移动设备未验收。真实环境复核应聚焦认证回跳、找回邮件及外部连接的实际可用性。

本轮发现并修复了项目弹窗提交冒泡导致误发任务，以及字段文字层级变化后凭据移除按钮的纵向偏移；连接提示也随共享顶栏高度定位。旧视觉断言随确认的规范更新，业务、安全、脱敏和失败路径断言继续保留；图片预览浏览器夹具改用有效资源 UUID 并核验现有图片呈现、打开和下载流程。

图片预览回归还复现了原生懒加载尚未选择图片源时 `decode()` 提前拒绝的情况：PNG 校验及 HTTP 响应正常，但 `currentSrc` 为空、`complete` 为 false。实现保留挂载图片和占位，等待本次 load 后再解码一次；真实失败、鉴权、缓存版本和卸载清理继续保留。新增单元测试先复现失败，再验证修复；实现参考 [MDN 的 decode 与图片请求说明](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)。面板边界检查改为同一帧测量并等待动画布局稳定，保持原有像素边界断言。

## 个人工作副本

- [LinkSense (Copy)](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3)，位于用户个人团队的 Drafts；原文件保持原状。
- 使用 Figma 原生 “Duplicate to your drafts” 复制完整文件，没有用截图或手工重建替代设计结构。
- 副本通过 `get_metadata` 验证保留 25 个 Page；只读 `use_figma` 验证设计页包含 17 个流程分区、本地 8 个变量集合／334 个变量、52 个文本样式和 12 个效果样式。
- 抽查登录页的嵌套实例，主组件引用和实际变量绑定仍可读取；副本的 `get_variable_defs` 成功。未逐一检查所有组件、交互和外部库关系，也未测试全部写入能力。
- 浏览器副本出现完整 Design 编辑工具和 Variables 入口，MCP 不再返回原文件的 View 席位限额错误；这不代表套餐额度或所有功能限制均已取消。
- 完整复制生成独立副本，原文件后续设计更新不会自动同步。后续适配使用此工作副本，同时保留原稿来源以便核对设计师变更。

## 当前执行与验收口径

以下为用户补充的本次任务要求，优先于两个 skill 默认的严格还原要求：

1. **有设计稿：参考设计稿实现。** 尽可能匹配布局、视觉风格、组件和明确状态，同时以项目真实业务、接口、权限和运行能力为准。设计与实际功能冲突时保留已确认的可用行为，并说明差异。
2. **无设计稿：按规范直接实现。** 复用已确认的设计规范、主题变量、共享组件与页面模式；不以先补齐 Figma 画板为实现前提，也不因缺稿遗漏实际已有功能。
3. **设计无法落地：完成可行部分并告知。** 对真实技术或业务约束，说明受影响的页面／功能块、已确认原因，以及采用的替代方式或未实现范围；继续推进独立部分。普通实现工作量不作为跳过的理由。

验收以业务可用、设计体系一致和必要验证为准，不强求所有页面与设计稿完全相同。可确定且可修复的偏差继续修正；有意适配或无法实现的差异如实列出，不宣称完成未验证的 1:1 还原。安全、可访问性、数据完整性及已明确要求的业务行为仍须保留。

## 后续减少 Figma 依赖的方式

用户希望在本次适配过程中保留设计规范与风格，后续常规 UI 开发可以不依赖 Figma。可采用仓库内的设计基线：把已确认的设计变量落实为主题 token、组件及其变体／状态，辅以简短的组件用法、页面模式、响应式和动效约定，记录来源与确认时间。

以代码和实际示例保存规范，避免仅依赖聊天记忆或另维护一套重复数值。基线建立后，常规新页面和局部调整优先复用代码体系；需要新稿精确还原或同步设计师变更时再读取 Figma。

当前已通过仓库内的主题 token、共享组件、设计基线和 AGENTS 入口落实上述方式。两个个人 skill 的内容未改写；本项目遵循用户确认的执行口径。

## 初次连接盘点记录（2026-10-23，历史）

以下保留初次盘点的证据与执行建议。此后的实施和验证以本文开头的当前状态为准。

Figma OAuth 和当前聊天的 MCP 工具已连通，已实际读取文件目录、基础规范文字、变量集合、部分页面截图、组件来源及绑定关系。可以确定首批候选范围，但尚未完成全体系代表页及目标组件全部状态的细读，不能将本次盘点视为开发或 1:1 验证完成。

建议先适配登录与密码找回两页，再处理主框架、首页与聊天。首批采用 `linksense-design-to-code` 的设计读取和实现流程，并遵循用户上述验收口径；缺稿界面依规范与已有组件直接补齐，需要新界面组合时参考 `linksense-ui-design` 的项目规则。

本次视觉来源为上述个人工作副本，[原 Figma 主文件](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH) 用于溯源。本文记录读取范围、代码对应和执行条件，不维护另一套视觉参数；读取与实现方式遵循当前验收口径及后续减少 Figma 依赖的约定。

## 已验证能力和缺项

| 项目 | 本次结果 |
| --- | --- |
| 连接 | `codex mcp login figma` 成功；`codex mcp list --json` 显示 `o_auth`；重启后当前聊天已能调用官方工具 |
| 目录 | `get_metadata` 读取到 25 个顶层 Page；只读 `use_figma` 读取设计分区与画板索引 |
| 规范 | 读取基础规范全部去重文字、本地文本及效果样式目录；发现 8 个变量集合、334 个变量条目，未逐项核验全部变量及引用链 |
| 设计上下文 | 登录、密码找回、聊天详情及首页任务入口区成功取得 `get_design_context`；首页整页过大，仅返回稀疏结构，随后补读入口区，未完成其余依赖细读 |
| 组件关系 | 登录表单与共享外壳已追溯主组件、嵌套输入控件及部分实际变量绑定；登录页 `get_variable_defs` 成功 |
| 图像 | 已查看首页、登录、密码找回、聊天详情和首页任务入口区的设计图；首页基准 PNG 下载成功 |
| 线上界面 | Codex 浏览器访问网站后进入 `/login`，可见现有居中表单；登录后业务流程未验证 |
| 写回 | 官方工具提供 `use_figma`；本次保持只读，尚未验证目标文件编辑权限和原生实例写回 |
| 预览 | 仓库有 UAT 部署流程；未部署，未确认团队共享地址、本期路由隔离或设计师访问条件 |

后续读取受到 Figma 配额限制。目标文件的错误返回为 “View seat on the Professional plan”，但 `whoami` 返回当前账号个人团队为教育版 Full 席位。尚未确认该文件的归属计划及账号在所属团队中的席位，不能据此认定账号整体需要升级，也不能承诺等待一分钟即可恢复。

应先核对目标文件所属团队及实际访问席位，再验证读取是否恢复。未自动购买套餐、修改权限或绕过限额。额度规则以 [Figma 官方说明](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) 为准。

## 设计覆盖索引

以下为“05 设计图”下 17 个流程分区，共 297 个页面／状态画板。统计对象为分区或子分区直接包含的桌面 Frame，不是独立业务页面或路由数量；未计入组件示例、流程索引、演示页及历史页面。

| 流程分区 | 画板数 | Figma 定位 |
| --- | ---: | --- |
| 开始任务 | 2 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73324) |
| 输入与资料选择 | 20 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73325) |
| 聊天执行与表单 | 12 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73326) |
| 消息操作 | 6 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73327) |
| 任务管理 | 10 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73328) |
| 项目管理 | 8 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73329) |
| 搜索与打开 | 5 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73330) |
| 任务概览、产物与来源 | 4 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73331) |
| 分享聊天 | 4 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73332) |
| 账户操作 | 4 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73333) |
| 异常与更新 | 2 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73334) |
| 宽屏适配 | 2 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73335) |
| 自动化 | 15 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73336) |
| 插件中心 | 74 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73337) |
| 资料库 | 49 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73338) |
| 个人与设置 | 78 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73339) |
| 登录与账号访问 | 2 | [设计分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=1312-80811) |

已发现部分流程标注“待核实”，涉及工具操作确认触发、消息分支、移除项目后的任务去向和分享失效规则。视觉稿不能代替这些业务决策，也不能据此覆盖项目已有 Codex 生命周期或授权行为。

## 推荐执行顺序

1. **首批：登录与密码找回。** [登录设计](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=1316-117634)、[密码找回设计](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=1316-117690)。两页共享品牌面板、页面外壳、语言选择及输入控件；现有代码和测试均可定位，且不涉及当前对话和自动化的未提交实现。
2. **第二批：主框架与首页。** 覆盖侧栏、顶栏、新任务空态和已有记录态，再核对宽屏。入口为 [首页](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=985-75095) 和 [宽屏分区](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=983-73335)。需要继续读取共享侧栏源组件及导航状态。
3. **第三批：聊天输入与执行呈现。** 从 [聊天详情](https://www.figma.com/design/9tWtvFkWvcRT8bdtQYyjYH?node-id=985-151957) 延伸到生成、停止、失败和表单状态；保留真实执行及审批语义，兼容正在开发的浏览器面板。

插件中心、资料库、个人设置的画板较多；本次已盘点分组，但因限额未取得这些类别的代表图，不能声称已完成其视觉理解或差异审查。注册、激活、重设密码等其他认证路由也未完成设计覆盖核对，不判定为设计缺失。

## 首批代码范围与约束

| 范围 | 代码及已有验证入口 |
| --- | --- |
| 两页布局与现有交互 | `apps/web/src/pages/auth-pages.tsx` 中的 `PublicPanel`、`LoginPage`、`ForgotPasswordPage` |
| 共享呈现 | `apps/web/src/components/forms/`、`components/brand/`、`features/onboarding/language-switcher.tsx`，及适用的源拥有 UI 组件 |
| 主题与文案 | `apps/web/src/index.css`、`apps/web/src/i18n/`；保留六语言和既有主题能力 |
| 测试 | `pages/auth-pages.test.tsx`、`pages/auth-layout.test.ts`、`e2e/public-actions.spec.ts`，以及受影响的语言与共享组件测试 |

当前实现采用居中表单，Figma 为品牌面板与表单左右分区。现有代码字体以 Inter 为首选，设计使用 SF Pro；跨平台字体策略尚未核对，不能先宣称文字尺寸已精确还原。线上截图为深色、不同视口，本次只确认结构差异，未作像素级比较。

`PublicPanel` 还被其他认证流程使用，不能为两页改造顺带改变全部认证路由。现有按钮回归要求操作区高 44px，设计默认按钮视觉高度为 36px；后续实现需处理视觉尺寸与点击区域的关系，并保留可访问性验证，不能直接删除现有断言。

保留现有登录、Teams、OIDC、SAML、社交登录、密码找回及按配置显示入口的行为。纯 UI 适配不迁移认证方案、不修改数据库或接口契约，不把稿件示例提供商改成固定启用项。

## 开始编码前与验收条件

1. 从个人副本按需补读 [账号访问组件规范](https://www.figma.com/design/UeHSfgORGySQ6c6JbAcrR3?node-id=1314-1544)、相关主组件的变体、主题和实际绑定；建立可复用的代码设计基线。
2. 确定首批仅两页的实施范围，按项目已有接口和可访问性原语完成视觉适配及必要状态。未定义的移动端、深色或其他状态须区分正式设计、项目惯例与未验证部分。
3. 使用 Figma 基准、相同视口／主题／语言／数据，通过 Codex 浏览器及现有 Playwright 做设计对照和相关交互回归；按实际影响运行必要检查，保留错误和会话恢复路径。
4. 复用团队已授权预览流程，验证首批路由隔离、深链接和访问条件。UAT 的操作入口见 [UAT 文档](../../deploy/uat/README.md)，存在部署脚本不代表共享预览已可用。
5. 交付可运行实现、设计基线及验证结果，列明按稿实现、按规范补齐和因实际约束调整的部分。已有稿件不重复写回设计源；进入新设计分支时按已确认范围处理待审写回，不以先补稿为代码实现前提，各类交付与审核状态分别报告。

本次未运行测试、类型检查、构建、部署、真实登录或密码提交，因为未修改产品实现；未验证生产登录后的流程、全部响应式状态、Figma 写回及共享预览。已有未提交修改保持原状。
