# json-render 对 request_user_form 的适用性

调研日期：2026-11-13。依据官方文档及当前本地工作树；当前分支为 `feat`，表单相关文件已有未提交修改，因此本文不代表线上版本现状。本轮只增加调研记录，不安装依赖、不修改实现。

本文件仅评估表单。关于用户后续提出的整个 AI 输出体验，见 [AI 富内容输出适用性调研](json-render-rich-ai-output-feasibility-2026-11-13.md)。

## 结论

有帮助，但当前普通问答、选择、确认和参数收集不足以证明替换现有实现的收益。现有系统已经完成“AI 输出受约束字段，平台组件渲染，用户提交结构化答案”。

json-render 更值得用于下一阶段：条件显隐、字段联动、跨字段校验，以及由 AI 组合分组、提示和结果摘要的交互卡片。建议先保留当前实现；当这些需求成为实际范围时，再以局部渲染层验证接入，不迁移表单等待和响应机制。这是基于现有功能重合程度的工程判断，未通过集成实验测量工时、体积、生成成功率或 token 成本。

## 本地实现已经提供什么

| 边界 | 当前实现与证据 |
| --- | --- |
| 模型输入 | `apps/runner/src/mcp/core-services/interactive-form-service.ts:25` 起定义严格 Zod 字段；支持 text、textarea、radio、single_select、multi_select、boolean、number、date、date_time。最多 20 字段、每组最多 50 选项；字段 ID、选项值、上下界和审批映射均有检查。 |
| 数据契约 | `packages/shared/src/conversation-forms.ts:114` 起定义受限 JSON Schema 字段和 `ui_hints`；响应是字符串、数值、布尔值或字符串数组组成的扁平映射。它不是通用 JSON Schema 引擎，不支持嵌套对象行、任意布局树或显隐表达式。 |
| Web 渲染 | `apps/web/src/features/conversations/conversation-structured-user-input-form.tsx:53` 起管理值、触碰状态和提交；第 132 行为固定响应式网格，第 302 行起复用项目自身控件，包含本地日期/日期时间组件。 |
| 持久化 | `apps/api/src/modules/events/service.ts:3719` 起校验并保存 requestedSchema、uiHints、responseSemantics 和 waitingPolicy。`apps/api/src/modules/conversations/service.ts:10450` 起通过共享 schema 解析历史记录并返回页面契约。 |
| 等待与投递 | `apps/runner/src/process-pool.ts:2647` 起登记当前回合等待并发出表单事件；`apps/api/src/modules/conversations/form-user-input.ts:16` 起检查归属、回合状态、答案及投递竞争。渲染库不能替代这些职责。 |
| 推荐和审批 | `packages/shared/src/conversation-forms.ts:221` 起区分 required 与 optional；后者要求完整有效推荐。`apps/runner/src/interactive-form-instructions.ts:6` 起明确提交、默认值、超时不能自动构成授权。等待和升级规则另见 `docs/development/interactive-form-waiting.md`。 |

现有相关测试包括 `packages/shared/tests/conversation-forms.test.ts`、`apps/web/src/features/conversations/conversation-user-input-request-card.test.tsx` 和 `apps/runner/test/core-service-registry.test.ts`。本轮阅读测试与实现，未执行测试。

## json-render 能增加什么

json-render 用 catalog 定义允许的组件和动作，以 registry 将类型映射至实际组件，渲染 JSON spec。标准 React spec 为 `root`、`elements` 等组成的 UI 树，并非现有 `requested_schema` 的直接替代格式。[S1][S4]

| 场景 | 对当前 request_user_form 的增益 | 限制 |
| --- | --- | --- |
| 普通文本、单选、多选、日期和数字 | 增益有限，已有对应控件和数据校验 | 仍需复用本地控件、格式转换、六语言错误和只读历史状态。 |
| “选择企业用户后显示公司名称” | 可用状态条件控制显隐 | 隐藏字段是否必填、是否清除旧值、是否允许提交仍需服务端协议决定。[S2] |
| “结束时间晚于开始时间” | 有跨字段比较、条件必填等校验机制 | 现有服务端约束也必须同步扩展，不能只让前端接受或拒绝。[S3] |
| 分组、布局与说明组合 | 可让 AI 在受控 catalog 内组合组件，复用已有 React 组件 | 若只转换现有扁平字段，得到的仍是同样的固定表单；要发挥生成布局能力需扩展工具和持久化契约。[S1][S4] |
| 重复内容与更复杂卡片 | 数据绑定支持 state、双向绑定及数组 repeat | repeat 渲染能力不等于完整可增删明细表单；嵌套答案仍超出现有响应 schema。[S5] |
| 流式 UI | 支持逐步渲染 spec | 当前 MCP 参数在调用时已形成完整对象；单加前端 Renderer 不会使工具参数成为流式表单。需要单独评估传输与可提交时机。[S1][S6] |

## 接入范围与建议

若只是增加 radio、更好的日期组件、间距或现有表单排版，继续使用当前组件最直接。json-render 可以复用自有组件，但不会自动提供与本项目完全一致的表单体验。[S4]

`@json-render/shadcn` 是可选的预制组件包，使用 Radix UI 与 Tailwind。项目当前使用 Base UI/Rhea，不能仅因两者都叫 shadcn 就认为可直接替换；自定义 registry 更适合保留当前组件实现。[S7]

官方校验文档还明确指出，顺序执行 `validateForm` 与提交动作不会自动阻止无效提交，提交 handler 必须检查校验结果。因此现有提交前检查和服务端答案校验不能因引入该库而删除。[S3]

若后续确有复杂表单需求，建议按以下范围验证：

1. 保留 `request_user_form` 入口、request ID、等待、取消、推荐答案、审批语义和原响应接口；只评估其内部渲染层。
2. 用 `@json-render/core` 和 `@json-render/react` 定义一个只含所需字段、分组与说明的 catalog，registry 映射现有 Rhea/Base UI 控件。动作限制在现有提交与取消回调，不让任意 UI 动作直接获得外部执行权限。[S1][S4]
3. 对条件显隐和跨字段校验先定义服务端一致的规则。尤其要覆盖隐藏的必填字段、变更前保存的答案、推荐答案有效性以及审批决策字段不可隐藏或自动选择。
4. 旧记录继续接受现有 `requested_schema` 与 `ui_hints`。如果新布局需要独立 spec，应采用明确版本和可选呈现字段，验证旧表单仍能显示、提交和恢复持久化结果。具体存储方案需在实际需求确定后设计。

单纯增加前端转换可以保留旧数据协议，但不会增加 AI 可表达的表单能力。让模型直接输出新 spec 会同时影响 MCP 工具、shared schema、Runner 事件、API 校验与存储、Web 渲染和历史记录读取，不能作为“换一个组件库”处理。

## 来源与验证边界

- [S1：官方 Introduction](https://json-render.dev/docs)：catalog、spec、registry、生成式布局及集成概念。
- [S2：官方 Visibility](https://json-render.dev/docs/visibility)：状态条件、比较运算、AND/OR 显隐。
- [S3：官方 Validation](https://json-render.dev/docs/validation)：内置与自定义校验、跨字段比较、requiredIf。
- [S4：官方 Registry](https://json-render.dev/docs/registry)：映射自有组件、动作实现与事件接口。
- [S5：官方 Data Binding](https://json-render.dev/docs/data-binding)：state、JSON Pointer、双向绑定、repeat。
- [S6：官方 Streaming](https://json-render.dev/docs/streaming)：spec 的渐进传输与渲染。
- [S7：官方 shadcn API](https://json-render.dev/docs/api/shadcn)：可选预制组件包及其 Radix UI、Tailwind 技术基础。

本轮未接入库、未运行浏览器或真实模型交互、未测包体积和性能、未验证线上部署或真实历史数据。库的客户端校验与受控 catalog 不应替代当前服务端 Zod、授权和答案约束。结论是选型建议，不是集成验收。
