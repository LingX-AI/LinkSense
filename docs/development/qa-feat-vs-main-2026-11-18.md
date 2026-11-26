# feat 分支提测说明

> 基线：`origin/main` (`227ad976`) → `origin/feat` (`bbe64302`)，136 个提交、589 个文件。
> 最新两笔提交：`f88bd997` 站点访问统计；`bbe64302` 侧栏任务操作与紧凑视图。
> **不含 desktop app**。当前工作区剩余的未提交改动也均为 desktop 相关，不在本次范围。

## 一、P0 冒烟清单（建议先跑这 11 条）

1. 应用与工具 → 应用 → 我的站点可打开；旧书签 `/knowledge-bases?tab=sites` 自动跳转。
2. 发布一个静态站点，稳定链接 `/app/s/{id}` 可访问。
3. 修改自定义 slug，新旧链接都能打开同一应用。
4. 设置访问密码，访客需解锁；修改密码后旧解锁立即失效。
5. 站点详情弹窗、更新发布、取消/重新发布、删除均正常。
6. 在普通对话描述目标 → 助手创建并发布 → 对话内站点卡片可打开，刷新后恢复。
7. 富内容回答（图表、表格、Tabs、清单）正常渲染、键盘可操作、复制内容可读。
8. 设置 → 隐私脱敏：保存设置、“试一试”按草稿脱敏。
9. 会话侧栏、上下文分项、压缩会话入口正常。
10. 管理员模型表单：上下文长度自动探测、推理强度自动匹配保存成功。
11. 站点访问统计开关（需配置 tinytraffic）：开启后详情出现仪表盘链接。

## 二、功能模块与测试点

优先级：P0 = 阻塞提测；P1 = 核心功能；P2 = 边界/体验。

### A. 应用与工具 / 我的站点（SITE）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| SITE-01 | 打开侧边栏 | “插件中心”已改名“应用与工具”；应用 → 我的站点可进入 | P0 |
| SITE-02 | 访问旧书签 `/knowledge-bases?tab=sites` | 跳转 `/capabilities?section=application&app_scope=sites`，保留 `site_search`/`site_status` | P1 |
| SITE-03 | 只打开非站点页签 | 不请求站点列表；只有一个应用范围时不显示范围切换器 | P2 |
| SITE-04 | 站点列表 | 搜索、发布状态筛选、加载更多、空态、无结果态正常 | P1 |
| SITE-05 | 站点行信息 | 显示自定义链接路径、复制完整地址、访问、发布状态、资源数量/大小、数据服务状态 | P1 |
| SITE-06 | 点击整行或站点名称 | 打开详情；操作菜单含编辑、更新发布、取消/重新发布、下载、删除 | P0 |
| SITE-07 | 未发布站点/来源任务已删除 | 详情明确提示链接暂不可访问；保留站点仍显示来源信息 | P1 |
| SITE-08 | 详情内编辑并保存 | 列表与当前详情同步更新；关闭后焦点回到触发按钮 | P1 |
| SITE-09 | 六语言与窄屏 | 文案、插值、按钮不溢出；loading/禁用态正常 | P2 |

### B. 发布、更新与生命周期（PUB）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| PUB-01 | 打开发布弹窗 | 默认“新建站点”；选择“更新已有站点”但未选目标时不能提交 | P0 |
| PUB-02 | 更新目标选择器 | 支持搜索/分页；先列当前任务站点，再列其他任务；只含本人未删除站点 | P1 |
| PUB-03 | 首次发布 | 立即可公开访问；未发布站点更新内容不会自动重新发布 | P0 |
| PUB-04 | 跨任务更新 | 来源任务切换到新任务；删除旧任务不停用站点；删除新来源任务按规则停用 | P1 |
| PUB-05 | 发布失败 | 资源校验失败、后端冲突、租约竞争时回滚，原页面/ID/别名/状态保持可用 | P1 |
| PUB-06 | 同一 HTML 产物重复创建 | 返回已有站点，不产生重复站点 | P2 |
| PUB-07 | 删除站点 | 永久删除站点、发布版本与地址占用；原任务和文件保留；地址可被他人重新使用 | P0 |
| PUB-08 | 取消发布/重新发布 | 取消后不可访问但保留地址；重新发布恢复访问 | P1 |
| PUB-09 | 下载网页包 | ZIP 含目录结构、转换后的引用与资源清单，可离线打开 | P1 |

### C. 地址、密码与公开访问（ADDR）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| ADDR-01 | 访问稳定入口 `/app/s/{site-id}` | 静态站与沙箱动态应用均可访问；改名、换版本、加后端不变 | P0 |
| ADDR-02 | 修改 slug | 新 `/web/{slug}` 生效；旧 `/web/{slug}` 仍跳转到同一应用 | P0 |
| ADDR-03 | 沙箱后端别名 `/app/{address}` | 3–30 位小写标签；改别名后旧别名跳转稳定入口并保留查询参数 | P1 |
| ADDR-04 | 历史独立域名应用 | 保持原 origin 与运行方式，不被迁移 | P1 |
| ADDR-05 | 地址占用 | 占用期间不能被其他应用接管；删除站点后释放 | P1 |
| ADDR-06 | 访问未知/失效 slug | 品牌化 404，本地化文案，`noindex` | P1 |
| ADDR-07 | 设置/保留/移除密码 | 4–128 字符；留空保持公开；“保留/取消密码”切换可用 | P0 |
| ADDR-08 | 访客解锁 | 未解锁显示密码页（401、`no-store`、`noindex`）；错误密码提示；正确后 303 跳回原地址，`next` 不允许外站 | P0 |
| ADDR-09 | 资源访问 | 未解锁时 HTML/JS/CSS/图片同样被拦截；解锁后正常 | P1 |
| ADDR-10 | 修改密码 | 旧解锁立即失效；密码哈希不出现在 API、页面、日志 | P1 |
| ADDR-11 | 同域隔离 | 页面在 sandbox iframe（无 `allow-same-origin`）中运行；不能读平台 Cookie/localStorage；公开路由可被嵌入，管理路由安全头不变 | P1 |
| ADDR-12 | 网页包边界 | 500 文件、单文件 20 MiB、合计 50 MiB、深度 20；拒绝符号链接、隐藏文件、node_modules | P2 |

### D. 动态应用（自部署 Appwrite）（DYN）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| DYN-01 | 未配置 Appwrite | 动态能力禁用，静态发布与站点管理照常；部分配置或非法 URL 启动即拒绝 | P0 |
| DYN-02 | 对话中准备/配置/检查后端 | 同任务同名重试复用原后端，不重复开通 | P1 |
| DYN-03 | 发布带 `backend_id` 的站点 | 稳定入口打开应用；SDK `LinkSenseApp.ready()` 后 `account`/`tables`/`storage`/`functions` 可用 | P0 |
| DYN-04 | 访客登录/退出 | 会话正常；Cookie 属性符合 HTTPS 规则；Redis 会话丢失后需重新登录，数据保留 | P1 |
| DYN-05 | 上传/下载/函数 | 上传 ≤20 MiB；下载以 Blob 返回；函数同步执行 ≤30 秒，异步执行被拒绝 | P1 |
| DYN-06 | 跨应用隔离 | A 应用的能力/会话不能调用 B 应用；伪造 Origin、其他访客或其他应用能力均拒绝 | P0 |
| DYN-07 | 站点停用/取消发布/任务删除/所有者停用 | 入口与网关立即关闭，含在途请求返回前复查 | P0 |
| DYN-08 | 恢复/重新发布 | 保留后端、访客账号、数据与地址；不允许替换已有后端或旧 origin 原地增强 | P1 |
| DYN-09 | 子目录入口 | 根地址跳转入口并保留查询参数；目录尾斜杠读取 `index.html` | P2 |
| DYN-10 | 容量限制 | 每用户最多 50 个后端；单次发布最多检查 100 个表和函数 | P2 |

### E. 对话内创建与发布（CHAT）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| CHAT-01 | 普通对话直接描述目标 | 无需预选 Skill；助手复用已给信息，只问影响结果的关键需求 | P0 |
| CHAT-02 | “用对话创建应用”入口 | 只填目标即可开始；不默认公开、不默认启用计划 | P1 |
| CHAT-03 | “创建 Web 应用”入口 | 站点名称 + 可选目标 + “发布后在本机浏览器打开”；提交后进入对话 | P1 |
| CHAT-04 | 助手登记与发布 | 生成 `artifacts/<site>/` → `register_artifact`（含 `web_root_relative_path`）→ `publish_web_site`，返回 `url`/`slug` | P0 |
| CHAT-05 | 工具权限 | 仅 `default` 协作模式、当前用户、运行中的轮次可用；内部路由需 runner secret + owner header | P1 |
| CHAT-06 | 只要求预览 | 保持未发布，不产生公开链接 | P0 |
| CHAT-07 | 对话内站点卡片 | 显示状态，支持打开/复制/管理；刷新对话后按发布记录恢复，不重复生成 | P1 |
| CHAT-08 | 后续任务继续修改 | `list_web_sites` 可查找；`update_web_site` 改名称/简介/slug/状态/密码；带 `site_id` 发布新版本 | P1 |
| CHAT-09 | 修改动态应用 | 先查 `backend_id` 并复用，不重建账号与数据 | P1 |
| CHAT-10 | 扩展打开站点窗口 | 已配对且允许打开新页面时，在独立窗口打开；新窗口不交给助手控制 | P2 |

### F. 富内容（RICH）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| RICH-01 | 17 类组件渲染 | Panel/Grid/Tabs/Details/Text/KeyValue/Timeline/Steps/Checklist/MediaGallery/ResourceList/Callout/Evidence/Comparison/Metric/DataTable/Chart 正常 | P1 |
| RICH-02 | 非法/超限块 | 无效块不影响正文；超限（65,536 字符、40 元素、深度 6）被拒绝或降级 | P2 |
| RICH-03 | Tabs | 2–5 个、顺序与 ID 一致；方向键移动、Enter/空格切换；默认第一项 | P1 |
| RICH-04 | Details / Checklist | Details 默认收起且互不影响；Checklist 挂载期间保留勾选，刷新重置 | P2 |
| RICH-05 | MediaGallery / ResourceList | 只接受已登记 `file_id`；未知/已删除/不可下载文件显示说明与不可用提示；预览/下载鉴权正常 | P1 |
| RICH-06 | Evidence 引用 | 编号可解析时显示来源并可打开既有引用预览；无法匹配不生成链接；公开分享不追加私有引用信息 | P1 |
| RICH-07 | DataTable | 列类型 text/number/date、单位、筛选匹配数/总数、排序缺失值两向最后、日期不做时区换算 | P1 |
| RICH-08 | Chart | 旧单序列兼容；多序列 2–6 个、≤100 点、共用单位；`stacked` 仅柱图；图例/提示/表格替代完整 | P1 |
| RICH-09 | 阅读位置 | 切换视图、展开、筛选时暂停自动跟随，不被卡片高度变化拉到底部 | P1 |
| RICH-10 | 键盘与响应式 | 键盘可达、焦点可见；桌面与窄屏单列网格；六语言 | P2 |
| RICH-11 | 复制/分享/公开快照 | 保留所有标签页、折叠内容与数据明细；快照移除块内文件绑定；外部渠道收到摘要 | P1 |
| RICH-12 | 会话分叉 | 有效富内容中的 fileId 重映射到复制后的文件；正文与裸 ID 不变 | P2 |
| RICH-13 | 自动产物卡 | 组件成功挂载后隐藏同轮自动产物卡；卸载或失败时恢复 | P2 |

### G. 会话界面与上下文（CONV）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| CONV-01 | 会话侧栏 | 显示来源、子智能体、产出文件、上下文、变更、后台任务 | P1 |
| CONV-02 | 上下文区 | 可折叠；输入/缓存输入/输出/推理/剩余空间分项正确；显示距自动压缩与阈值提示 | P1 |
| CONV-03 | 压缩会话 | 压缩轮次在对话中以命令展示；完成事件显示节省 Token；未完成有独立状态 | P1 |
| CONV-04 | 输入框上下文卡片 | 与侧栏使用同一套分项数据 | P1 |
| CONV-05 | 模型菜单 | 显示各模型上下文窗口（十进制，如 128K）；不可用模型/强度不可选 | P1 |
| CONV-06 | 任务行操作（最新提交） | 悬停行显示“置顶”“归档”两个按钮；已置顶显示实心图钉；无 hover 设备常显；不再出现“更多”菜单 | P0 |
| CONV-07 | 移动任务到项目 | 行菜单入口已移除；确认拖拽仍可移动，失败提示正常 | P1 |
| CONV-08 | “最近”分组 | 标题旁新增“新任务”（+）按钮，点击进入新任务 | P1 |
| CONV-09 | 项目内新建任务 | 项目侧栏“在项目 X 中新建任务”可用；默认项目在渲染前同步 | P1 |
| CONV-10 | 品牌 Logo | 点击进入新任务 | P2 |
| CONV-11 | 紧凑视图（最新提交） | 任务概览非上下文区域字号变小；新任务欢迎 banner 变紧凑，窄屏/宽屏不溢出 | P2 |
| CONV-12 | 完成提醒 | 打开中的任务完成时被标记为已读 | P2 |
| CONV-13 | 计划保留 | 轮次中的计划在事件缓存淘汰后仍显示当前计划 | P2 |
| CONV-14 | 输入与滚动 | 任务引用 caret 恢复正确；富内容交互不改变滚动位置 | P2 |
| CONV-15 | 表单与键盘 | 内联 radio（含描述）可用；输入框操作键盘可达；侧栏不与内容重叠 | P2 |

### H. 隐私脱敏（MASK）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| MASK-01 | 打开 `/settings/mask` | 显示启用开关、密钥与凭据、自定义词、匹配选项、允许列表、试一试 | P0 |
| MASK-02 | 保存设置 | 单次带 revision 保存成功；冲突时重新读取后可保存 | P0 |
| MASK-03 | 试一试 | 使用未保存草稿脱敏；高亮占位符并列出命中类型；关闭状态也可预览 | P1 |
| MASK-04 | 脱敏动态卡 | 7/30 天切换、替换处数、受影响请求数、最近请求、加载更多；不显示原值/占位符 | P1 |
| MASK-05 | 实际请求 | 密钥/Token/私钥/密码/URL 密码/Authorization/Cookie/赋值语句/中英日韩密码短语/自定义词被替换；模型 ID、工具名与 schema、图片 data URL 不变 | P0 |
| MASK-06 | 流式还原 | 整包响应、SSE（原生/工具兼容/Chat Completions）、跨 delta 占位符、工具参数 JSON 转义均正确 | P1 |
| MASK-07 | 失败路径 | 引擎异常 503 `privacy_masking_unavailable`；命中 block 422 `privacy_masking_blocked`；设置无法解密 `PRIVACY_MASKING_SETTINGS_UNAVAILABLE` | P1 |
| MASK-08 | WebSocket | 开启脱敏后 Responses WS 升级返回 426，自动回落 SSE | P2 |
| MASK-09 | 共享会话 | 使用会话所有者的脱敏设置 | P2 |
| MASK-10 | 设置变更 | revision 变化后下一回合使用新设置；同一主密钥下占位符稳定 | P2 |

### I. 管理员与模型渠道（MODEL）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| MODEL-01 | 协议探测 | Responses 优先；原生探测使用 `apply_patch`；失败可重试且不影响已保存配置 | P1 |
| MODEL-02 | 上下文长度 | 留空自动探测；探测不到用内置目录补齐；可手动填写或用快捷值；非法值提示 | P1 |
| MODEL-03 | 推理强度 | 默认按模型能力自动匹配；可手动调整；只显示支持档位 | P1 |
| MODEL-04 | 模型选择校验 | 被关闭、未发现或协议不匹配的模型不可用于对话/记忆提取/标题；保存冲突返回 409 | P0 |
| MODEL-05 | 模型菜单上下文窗口 | 显示正确、十进制单位 | P2 |
| MODEL-06 | 窄屏与六语言 | 管理员模型表单不溢出，文案完整 | P2 |

### J. 浏览器扩展（EXT）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| EXT-01 | 扩展版本 | 升级到 0.4.6 | P1 |
| EXT-02 | 打开站点窗口 | 已授权时在独立窗口打开当前用户已发布站点 | P1 |
| EXT-03 | 未授权 | 返回 `BROWSER_USE_ACCESS_DENIED`，不打开窗口 | P1 |
| EXT-04 | 跳转后打开 | 站点跳转稳定入口后仍能打开动态应用；新窗口不交给助手控制 | P1 |
| EXT-05 | 滚动升级 | 旧 API 副本与新扩展混跑期间邮箱/命令不互相污染 | P2 |

### K. 站点访问统计（ANALYTICS，最新提交 f88bd997）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| ANALYTICS-01 | 未配置统计服务 | 开启返回 `WEB_SITE_ANALYTICS_NOT_CONFIGURED`，其他站点功能不受影响 | P1 |
| ANALYTICS-02 | 未发布站点开启 | 返回 `WEB_SITE_ANALYTICS_UNPUBLISHED`；已发布站点可开启 | P1 |
| ANALYTICS-03 | 编辑弹窗开关 | 只有编辑弹窗显示；未发布且未开启时锁定并提示原因 | P1 |
| ANALYTICS-04 | 对话 `update_web_site` | `analytics: true/false` 生效；返回 `analytics_url` | P1 |
| ANALYTICS-05 | HTML 注入 | 发布的 HTML 文档响应注入跟踪脚本；JS/CSS/图片不注入；含标记的 HTML 不重复注入 | P1 |
| ANALYTICS-06 | CSP | 发布资源 CSP 放行统计服务 origin；HTTP 开发环境也可用 | P1 |
| ANALYTICS-07 | 详情展示 | 显示统计状态与仪表盘链接；客户端不自行拼接 URL | P2 |
| ANALYTICS-08 | 关闭统计 | 只停止采集，保留历史数据与远端站点 | P2 |
| ANALYTICS-09 | 统计服务异常 | 返回 `WEB_SITE_ANALYTICS_UNAVAILABLE`，不回滚站点其他设置 | P2 |
| ANALYTICS-10 | 部署配置 | `LINKSENSE_TINYTRAFFIC_URL` 与 `LINKSENSE_TINYTRAFFIC_API_KEY` 同时设置才生效 | P1 |

### L. 日志与部署（OPS）

| 编号 | 测试场景 | 预期 | 级别 |
| --- | --- | --- | --- |
| OPS-01 | 请求日志 | 含 request id、路径、耗时、状态；敏感头/字段被脱敏 | P1 |
| OPS-02 | SSE 断连 | 重放泵在响应断开后停止，不空转 | P2 |
| OPS-03 | 网关 | `/app/` 与 `/web/` 均转发到 API（Nginx/UAT/dev proxy） | P0 |
| OPS-04 | UAT 升级 | 更新保留 Appwrite 凭据；统计配置正确传递 | P1 |
| OPS-05 | 开发环境 | SSH 隧道、独立 Appwrite 配置可用；帮助中心仅在显式请求时启动 | P2 |

## 三、兼容与升级

- 迁移顺序（均为新增表/可空字段）：
  1. `20261115000000_add_web_site_backends`
  2. `20261116090000_add_user_privacy_masking_settings`
  3. `20261117120000_add_web_site_backend_host_label`
  4. `20261117160000_reserve_web_site_backend_addresses`
  5. `20261117163000_resolve_existing_web_site_backend_hosts`
  6. `20261117180000_add_web_site_backend_runtime_mode`
  7. `20261117190000_add_user_privacy_masking_records`
  8. `20261117200000_add_desktop_devices`（桌面端使用，本次不测）
  9. `20261118100000_add_web_site_passcode`
  10. `20261118110000_add_web_site_analytics`
- 站点功能：先更新 API，再更新 Web/Runner；旧客户端省略 `backend_id` 仍有效；旧静态站点与历史 origin 应用无需重建。
- 动态应用：先停旧 Skill 的在途生成/发布，再应用迁移并升级全部 API/网关与 Runner/Web；回退期间旧二进制不能执行新 SDK 应用。
- 脱敏：先应用迁移再开放设置页；主密钥轮换会改变占位符并使缓存前缀失效。
- 兼容回归：升级前的站点、任务、会话、消息、富内容块可正常读取和管理；六语言缺键回退正常。

## 四、环境准备

- 依赖：PostgreSQL、Redis；本地开发 `nr dev:host`（Web 5273 / API 4000）。
- 迁移：`pnpm db:migrate:deploy`（开发/测试库）。
- 可选配置：
  - Appwrite：`LINKSENSE_APPWRITE_ENDPOINT`、`LINKSENSE_APPWRITE_ADMIN_EMAIL`、`LINKSENSE_APPWRITE_ADMIN_PASSWORD`（历史 origin 应用另配 `LINKSENSE_DYNAMIC_APPS_BASE_URL`；多组织配 `LINKSENSE_APPWRITE_ORGANIZATION_ID`）。
  - 访问统计：`LINKSENSE_TINYTRAFFIC_URL`、`LINKSENSE_TINYTRAFFIC_API_KEY`。
  - 脱敏与凭据：`LINKSENSE_CREDENTIAL_MASTER_KEY`。
- 隔离集成脚本（自动清理，不触碰现有数据）：
  - `apps/api/test/integration/web-sites-postgres.ts`
  - `apps/api/test/integration/web-site-deliveries-postgres.ts`
  - `apps/api/test/integration/web-site-backend-addresses-postgres.ts`
  - `apps/api/test/integration/web-site-visitor-sessions-redis.ts`
  - `apps/api/test/integration/web-site-backends-appwrite.ts`（需测试用 Appwrite 凭据文件）
- 六语言：zh-CN、en-US、es-ES、pt-BR、fr-FR、ja-JP；重点检查新增键、插值、复数、缺键回退。

## 五、已知限制（不建议作为阻断项）

- 真实模型选择富内容组件的质量、真实 Appwrite 2.7.2、真实 tinytraffic 未在代码层验证。
- 站点沙箱不提供 localStorage/IndexedDB/Service Worker/原生 OAuth，这是设计边界。
- 本地/自部署模型渠道同样被脱敏（Phase 1 无按渠道开关）。
- 脱敏是“线上脱敏”，任务历史与事件仍按原文保存（产品既定边界）。

## 附录：模块与主要提交

| 模块 | 主要提交 |
| --- | --- |
| 站点与 Web 应用 | `2494b9ed` `73a1ac9c` `cd7de489` `d2dd407f` `0a4a98c6` `c6fa0cce` `b2bb649d` `fbf26d98` `f15a37f7` `c934610f` `f66c6de0` `13539b56` `3e9cb15c` `5f046a27` |
| 访问统计 | `f88bd997` |
| 对话内创建/发布 | `2494b9ed` `d2dd407f` `864cf3f8` `25517005` `66b48403` `5eaeb726` `6cd85da2` `f43e7d56` `038070b9` |
| 动态应用 | `7a31a531` `5eaeb726` `6cd85da2` `8d15dc57` `bbc1894f` `f93d0601` `0cc90b6a` `5ea29e70` |
| 富内容 | `a4c22a87` `04953f5b` `bea07aa0` `df6cec6f` `30126f89` `3f849438` `6a4c6b7f` |
| 会话界面 | `2c6a6e2b` `8e70ff66` `89c4f3f5` `a3fcd0ef` `becfbaa2` `2b63bdba` `77504f6d` `da59182a` `bbe64302` |
| 隐私脱敏 | `fcc2d1c0` `d458febe` `c2e5a27c` `941984d0` `445fe6c9` `15bdcc88` `18c4af90` |
| 管理员/模型渠道 | `42b01bb1` `d99be4a2` `ff4d0f25` `e2f119d5` `6f1be041` `9f0652c0` |
| 浏览器扩展 | `2494b9ed` `038070b9` `5eaeb726` |
| 日志与部署 | `39827012` `dd294c40` `56e076bc` `e856c6b7` `45596c42` `bd69d16f` `5ea29e70` `aa764e74` `13019544` `ed7c857c` |
