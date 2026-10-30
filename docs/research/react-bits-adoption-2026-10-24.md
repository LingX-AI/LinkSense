# React Bits 采用调研

- 调研日期：2026-10-24，Asia/Shanghai。
- 按用户选择提供完整建议清单，尚未选定全站视觉风格；优先级表达适用程度，不代表已决定实施。
- 本地依据为 `dce0189` 及当前未提交工作区，现有分支为 `feat`；本次仅新增本文，没有切换分支。
- 上游源码固定到 [`e12c22192ac7b4b452c5e2feb9b586d74765d696`](https://github.com/DavidHDev/react-bits/commit/e12c22192ac7b4b452c5e2feb9b586d74765d696)，提交时间为 2026-10-19；核对 18 个主要候选的源码和在线 registry 元数据，并补查三个 Micro 组件源码。
- 本次仅调研、记录文档；没有安装依赖、修改应用代码或运行浏览器性能测试。Context7 因月度额度耗尽不可用，改读官方文档和固定版本源码。

## 1. 采用方式与技术适配

**可以给 React 前端挑选局部效果，适合增强展示区域；不应把它当作整个项目的基础组件库替换。** 官方交付的是可修改的组件源码，有 JS/TS × CSS/Tailwind 四种变体；每次只引入所选组件及其实际依赖。[安装说明](https://reactbits.dev/get-started/installation)、[registry 生成方式](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/jsrepo.config.ts#L107-L185)

采用时选 `TS-TW`。已配置 `@react-bits` registry 后，官网命令可按本项目包管理器改写为以下形式；本次没有执行：

```sh
pnpm --filter @linksense/web exec shadcn add @react-bits/SpotlightCard-TS-TW
```

上例复用 Web 包已安装的 shadcn CLI。registry 地址为 `https://reactbits.dev/r/{name}.json`；也支持手动复制代码并安装组件自身的依赖。[官方 README](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/README.md#installation)

本地依赖声明为 React `^19.2.6`、Vite `^8.1.6`、Tailwind `^4`、`base-rhea` 和 `framer-motion ^12.40.0`，未直接依赖 `motion`、GSAP、OGL 或 Three；`registries` 当前为空，实施时需选择配置 registry 或手动复制，而不是假设已经接好。[web 依赖](../../apps/web/package.json)、[组件配置](../../apps/web/components.json)

上游开发项目使用 React 19、Tailwind 4、Motion 12，方向上适合当前 React/Tailwind 前端；这不是对 LinkSense 的 TypeScript 6、Vite 8、所有浏览器的已验证兼容承诺。其根 `package.json` 是官网开发环境，不能把里面所有库都装入业务项目。[上游 package.json](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/package.json#L37-L101)

`TS-TW` 也不等于无需适配：源码包含自有配色、圆角、间距、内联动态样式和 CSS 变量。例如 SpotlightCard 默认深色、`rounded-3xl p-8`。应保留本项目的基础卡片、按钮、主题与语义，只吸收所需装饰层。[SpotlightCard 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/SpotlightCard/SpotlightCard.tsx)

## 2. 许可证边界

当前许可证是 **MIT + Commons Clause**，不能按纯 MIT 处理。按其文字，允许将代码嵌入个人或商业应用、网站和产品，并要求保留版权和许可声明；禁止销售、再许可或再分发组件本身，包括组件集合和移植版本。[固定版本许可证](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/LICENSE.md)

工具和声音另有明确限制：不能把工具本身或实质相似副本作为托管服务提供；工具导出的代码、图片、视频、音频可以用于产品，但不能把导出物本身作为素材包、背景包或模板包销售或再分发。**装饰 LinkSense 自身界面，与把这些组件打包成可发布/下载的组件、能力或站点模板，是不同采用范围**；后者不能从“可商用”推导出已获得许可。[同一许可证的工具和导出物条款](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/LICENSE.md#commons-clause-restriction)

## 3. 候选效果与优先级

下表的成本是源码结构和依赖推断，**不是实际 bundle、帧率或耗电实测**。无额外包也可能有 Canvas、着色器或持续逐帧工作。

| 候选 | 当前 TS-TW 实际实现/依赖 | 适用范围与取舍 |
| --- | --- | --- |
| **SpotlightCard：优先试点** | React + DOM 渐变 + RAF；无额外依赖；默认 `ambient=false`，稳定后停止 RAF；处理键盘后代焦点和 reduced motion | 少量重点展示卡片的柔和聚光；保留原有链接、菜单和卡片信息。每张卡有全局 pointer/scroll 监听，密集列表需限制数量。[源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/SpotlightCard/SpotlightCard.tsx) |
| **GlareHover：展示区域次选** | React + DOM 光带 + RAF；无额外依赖；支持 hover/follow/click/loop、可见性与 reduced motion | 展示区域的一次轻微扫光；优先 hover，关闭 intro/loop，避免所有卡片不断闪动。[源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Animations/GlareHover/GlareHover.tsx) |
| **GradientText：少量可用** | React + 每帧更新 CSS 渐变；无额外依赖；有视口暂停和 reduced motion | 一个品牌词或短问候语；不用于正文和全部标题。它并非纯 CSS 动画，默认会持续运行。[源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/TextAnimations/GradientText/GradientText.tsx) |
| **TiltedCard：次选** | React 自管弹簧/3D transform/RAF；无 Motion 包依赖；含触屏、焦点、翻转、陀螺仪等逻辑 | 少量图片展示卡；不要让表单、文字密集卡片跟随倾斜。关闭不需要的 floating、gyroscope、intro；不能按旧教程当成简单 Motion 卡片。[源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/TiltedCard/TiltedCard.tsx) |
| **CountUp：有真实指标时采用** | `motion/react`；支持视口触发与 reduced motion；roll 模式有屏幕阅读文本 | 首次展示的少量统计值；不做消息未读数、额度或进度的延迟展示。默认数字分组/小数/compact 单位是自有实现，K/M/B/T 等需改为项目六语言数字格式策略。[源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/TextAnimations/CountUp/CountUp.tsx) |
| **BlurText / SplitText：低优先级** | BlurText 用 `motion/react`；SplitText 用 `gsap`、`ScrollTrigger`、`SplitText`、`@gsap/react` | 单次短文案揭示，不能用于流式聊天正文。中文/日文分词、换行、字体加载和语言切换需验证；BlurText 的 click 模式是 `<p onClick>`，若采用需补交互语义。[BlurText 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/TextAnimations/BlurText/BlurText.tsx)、[SplitText 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/TextAnimations/SplitText/SplitText.tsx) |
| **AnimatedContent / FadeContent：优先复用现有 Motion** | 两者当前都依赖 `gsap` + `ScrollTrigger`；FadeContent 还可生成 SVG 噪声滤镜 | 页面块一次性入场可以借鉴，但为普通 fade/slide 引入新动画引擎收益小；两者初始 `invisible`，不要直接包住关键交互或首屏内容。[AnimatedContent 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Animations/AnimatedContent/AnimatedContent.tsx)、[FadeContent 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Animations/FadeContent/FadeContent.tsx) |
| **ChromaGrid：限定视觉画廊** | React + DOM mask/双图层 + pointer RAF；无额外依赖，稳定后停止 | 图片型作品/站点展示有价值；默认灰度遮罩会改变真实截图和品牌色，信息型资源卡不适合直接照搬。其链接默认另开窗口，需保留项目路由规则。[源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/ChromaGrid/ChromaGrid.tsx) |
| **MagicBento / AnimatedList / Dock：不作全局替换** | MagicBento、AnimatedList 引入两项 Hugeicons 包；Dock 主要是 React/ReactDOM，自管菜单、拖动、键盘与 RAF | 是完整交互组件，复制会同时引入布局/选择/导航语义和主题。保留现有 Rhea、Lucide、路由和列表能力；仅展示页有明确需求时再拆取效果。[MagicBento 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/MagicBento/MagicBento.tsx)、[AnimatedList 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/AnimatedList/AnimatedList.tsx)、[Dock 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/Dock/Dock.tsx) |
| **ShinyText / StarBorder / PixelCard：少量特殊强调** | 都无额外依赖；ShinyText 是 RAF，StarBorder、PixelCard 是 Canvas 2D + RAF，不是简单 CSS 类 | 不应给所有按钮/边框加常驻光效；优先已有加载和运行状态表现。PixelCard 默认可聚焦，包装已有可点击卡片时需避免多余 Tab 停靠点。[ShinyText 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/TextAnimations/ShinyText/ShinyText.tsx)、[StarBorder 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Animations/StarBorder/StarBorder.tsx)、[PixelCard 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/PixelCard/PixelCard.tsx) |
| **Orb / Aurora：仅候选，非默认方案** | 当前是原生 WebGL2 + RAF，**没有 OGL/Three 依赖**；有离屏/后台暂停、DPR 上限和卸载清理 | 用于单个装饰区域也要有静态替代。WebGL2 不可用时源码直接退出；reduced motion 冻结时间但仍调度 RAF，需另外考虑停止渲染。本项目现有欢迎球和账号页有明确设计约束，不能据组件相似就替换。[Orb 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Backgrounds/Orb/Orb.tsx)、[Aurora 源码](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Backgrounds/Aurora/Aurora.tsx) |

候选依赖已同时核对在线 registry，例如 [SpotlightCard](https://reactbits.dev/r/SpotlightCard-TS-TW.json)、[CountUp](https://reactbits.dev/r/CountUp-TS-TW.json)、[SplitText](https://reactbits.dev/r/SplitText-TS-TW.json)、[MagicBento](https://reactbits.dev/r/MagicBento-TS-TW.json)。CountUp/BlurText 的 registry 会声明 `motion`，不能仅因为项目已装 `framer-motion` 就认为原样复制必然可构建；实施时优先验证并复用已有引擎，避免无必要的重复依赖。

OGL、Three 确实出现在上游根依赖中，但不是 React Bits 的统一必需依赖。本次 18 个候选都没有直接导入它们；另查 [Hyperspeed](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Backgrounds/Hyperspeed/Hyperspeed.tsx#L3-L4) 与 [Lanyard](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Components/Lanyard/Lanyard.tsx#L3-L5) 则仍导入 Three。因此必须以所选版本、变体和 registry 为准，不能照旧教程统一安装 GSAP/OGL/Three。

官网现在还有 Micro 分类，其中 [StatusMark](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Micro/StatusMark/StatusMark.tsx) 可以作为异步状态图标过渡的次级候选：使用 `motion/react`，自带英文状态/读屏文本，需本地化并绑定真实状态。[ThoughtLine](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Micro/ThoughtLine/ThoughtLine.tsx) 含定时自动 settled 的展示逻辑，不能代替原生 turn 终态；[VoicePill](https://github.com/DavidHDev/react-bits/blob/e12c22192ac7b4b452c5e2feb9b586d74765d696/src/ts-tailwind/Micro/VoicePill/VoicePill.tsx) 默认可模拟波形，也可自行申请麦克风/创建 AudioContext，不能直接替换现有真实录音链路。

## 4. 当前项目中可用的位置

映射以当前工作区为准；工作区已有多项未提交 UI 变更，本次未覆盖或修改它们。**建议首批只做首页提示卡、自动化模板卡和应用卡的轻量悬停反馈。** 不需要为试点新增 GSAP、OGL、Three 或整套卡片布局。

| 优先级 / 位置 | 可采用效果 | 必须保留的现有行为 |
| --- | --- | --- |
| **P1：首页四张提示卡** | 借鉴 SpotlightCard 的柔和聚光装饰，不必复制其整张卡片 | 仍使用原生 Button、六语言、容器响应式布局；点击只填草稿，不自动发消息。[NewTaskWelcome](../../apps/web/src/features/conversations/new-task-welcome.tsx#L94) |
| **P1：自动化三个模板卡** | 同一个轻量聚光/边缘高亮效果 | 点击仍打开现有编辑侧栏，不能直接创建或启用计划。[AutomationSuggestions](../../apps/web/src/pages/automation-pages.tsx#L761) |
| **P1：应用展示卡** | 小幅边框聚光或一次 GlareHover，可共享适配边界 | 保留 ApplicationCard 的标题详情按钮、状态、操作菜单与 footer；不把整张卡改成抢占点击的交互层。[ApplicationCard](../../apps/web/src/features/applications/application-card.tsx#L76) |
| **P2：首页短文案** | GradientText 只强调短品牌词，可先静态渐变 | 保留真实问候、产品名插值、标题层级和长译文换行，不播放整段打字动画。[欢迎标题](../../apps/web/src/features/conversations/new-task-welcome.tsx#L78) |
| **P2：只读分享页顶部** | 小范围渐变强调或已有 Motion 的轻微过渡 | 分享页仍是固定快照和只读内容，保留生成时间和后续消息不包含的提示；任意长的用户标题优先可读，不强制使用动态渐变。[分享页](../../apps/web/src/pages/shared-conversation-page.tsx#L95) |
| **P2：个人资料小整数统计** | CountUp 对任务数、连续天数首次展示一次 | 保留六语言整数/复数格式；Token 总量和费用继续使用字符串、BigInt 和 Dinero 精度，禁止为动画转成 Number；余额、额度不做延迟读数。[统计](../../apps/web/src/features/profile/profile-overview.tsx#L94)、[精确格式化](../../apps/web/src/lib/usage-number.ts#L16) |
| **P2：管理用量页的任务数、轮次数** | CountUp 对安全整数首次展示一次，保留原始格式化值作为最终值 | 同一组卡片里的 Token 总量、金额和所有表格数据保持现有精确显示；刷新、切换筛选条件时不反复从零计数。[四项汇总卡](../../apps/web/src/pages/admin-usage-page.tsx#L472) |
| **P2：发布成功、安装等异步反馈** | StatusMark 的图形过渡可作为局部参考 | 只映射已有 pending/running/终态，不制造百分比、完成时间或额外状态；读屏和可见文案覆盖六语言，优先复用现有 Spinner/状态组件。[发布成功弹窗](../../apps/web/src/features/applications/application-development-publish-dialog.tsx#L19)、[现有 LoadingState](../../apps/web/src/components/feedback/page-state.tsx#L17) |
| **P2：资料库中的站点卡片** | 可选轻微边框聚光，采用与应用卡片一致的反馈 | 当前卡片展示文字、状态、链接和资源信息，没有截图缩略图；保留复制链接、来源任务及菜单；不倾斜整张信息卡，密集列表不常驻逐帧动画。[SiteCard](../../apps/web/src/features/web-sites/site-card.tsx#L21) |
| **P3：插件/技能市场、知识库信息行** | 只借鉴聚光或选中高亮，必要时复用现有 Motion 做局部过渡 | 不替换行布局；大量结果、搜索筛选与权限状态优先。不直接引入 AnimatedList，也不增加每行的常驻 RAF。[能力行](../../apps/web/src/components/capabilities/capability-library-item.tsx#L37)、[知识库行](../../apps/web/src/pages/knowledge-base-pages.tsx#L527) |
| **未来已有真实图片画廊时** | ChromaGrid、TiltedCard 可重新评估 | 当前 SiteCard 是文字、状态、链接和资源信息，没有截图缩略图；不能把现有站点列表描述成已经存在的截图画廊。[SiteCard](../../apps/web/src/features/web-sites/site-card.tsx#L21) |

需要排除或降级的区域：

- **欢迎球和账号页已有明确基线。** 欢迎球必须保留原 SVG 的形状、点阵、配色，已有 Motion、悬停、暂停与 reduced motion；不能换成 React Bits Orb。账号页明确静态呈现，当前不推荐 Aurora 背景或标题/表单入场；只有日后用户主动改变该设计方向，才重新评估。[设计规范](../development/ui-design-system.md#L43-L67)
- **能力市场和资料库以信息行为为主。** MarketplaceCard 实际复用 `CapabilityLibraryItem` 的 article 行布局；KnowledgeBaseCard 实际是 NavLink 包住信息行。保留搜索、筛选、权限、菜单和路由，不整体改为 MagicBento/ChromaGrid。[能力行](../../apps/web/src/components/capabilities/capability-library-item.tsx#L37)、[知识库行](../../apps/web/src/pages/knowledge-base-pages.tsx#L527)
- **已有状态动画不重复造。** 开发区有绑定真实执行态的 glow；加载页已有 shimmer，聊天已有 waiting snake，录音已有真实 waveform history 与 stopping/transcribing 状态。StarBorder/ShinyText/VoicePill 不能增加第二套状态或麦克风采集。[开发光效](../../apps/web/src/features/applications/application-development-glow.tsx#L9)、[页面加载](../../apps/web/src/components/feedback/page-state.tsx#L17)、[录音控件](../../apps/web/src/features/conversations/conversation-composer.tsx#L299)
- **不全局替换工作界面。** 侧栏、Base UI tabs/dialogs、表格、编辑器、composer、流式 Markdown、Office/浏览器/iframe 预览继续保持现有键盘、滚动和可访问性。用户发布的应用/iframe 内容不在外壳主题改写范围。[设计边界](../development/ui-design-system.md#L49-L63)
- **新手引导、通知、设置与后台表单保持现有组件。** 当前 FirstUseGuide 只有配置模型这一主要后续操作，不为套用 Stepper 扩成新向导；Sonner 已承担通知。Dock、GooeyNav、SwipeToast、模拟输入控件不作为替换目标。滑动选中指示器若需增强，应在共享 Base UI Tabs 上保留键盘与容器内坐标，而不是替换页面导航。[首次引导](../../apps/web/src/features/onboarding/first-use-guide.tsx)、[通知](../../apps/web/src/components/feedback/notification-toast.tsx)、[共享 Tabs](../../apps/web/src/components/ui/tabs.tsx)

仓库的 `apps/docs` 是独立 Docusaurus 文档构建，文档挂在 `/` 且 `pages:false`；没有当前营销首页可直接套用 Aurora/MagicBento，也没有与 `apps/web` 相同的 Tailwind/Motion 环境。未来新增产品官网可以单独评估，不能列作本次已存在的落地点。[docs 配置](../../apps/docs/docusaurus.config.ts#L33)、[docs 依赖](../../apps/docs/package.json)

API、runner、数据库和发布资源协议无需为这些视觉效果变更。效果只装饰主应用自身的界面；不将 React Bits 源码默认加入可导出的应用、插件、站点模板或用户 iframe。[Web 路由范围](../../apps/web/src/App.tsx)、[界面边界](../development/ui-design-system.md)

## 5. 实施前的必要验收

1. **保留业务语义。** 特效层不代替链接、按钮、加载状态、错误状态、焦点和读屏名称；真实状态变化即时可读。全局导航、长列表、编辑器和聊天正文优先稳定与可操作性。
2. **限制常驻工作。** 首批只试少量展示卡与一个短标题，使用事件触发；对照现有页面测路由加载、输入/滚动、卡片密集场景和低性能设备。原生 WebGL 并不代表 GPU 成本为零。
3. **验证静态降级。** 覆盖 reduced motion、触屏、键盘、深浅色、六种语言、长标题、路由返回，以及 Canvas/WebGL 不可用。部分源码只在 effect 挂载时读取媒体查询，还需检查运行中偏好切换。
4. **锁定采用来源。** 记录复制时的上游 commit、许可证和实际依赖；只改目标页面/共享效果边界。没有数据库、API 或旧资源格式变更的必要，不把效果偷偷注入用户发布内容和外部 iframe。

已完成源码/registry/许可证和本地组件映射核对，并在 Codex 浏览器查看 SpotlightCard 官方演示的静态呈现；未安装组件或运行应用测试。

文档检查使用 `uv run --no-project python` 内联校验：30 处本地文件引用及对应行号范围、尾随空白和文件末尾换行全部通过。没有运行应用测试，因为没有修改运行代码。

未测量实际 bundle、帧率、耗电和跨设备表现，也未验证演示的 pointer 交互；上述成本排序是源码级判断。尚未证明可发布组件/模板再分发满足许可，当前建议只覆盖 LinkSense 自身界面。
