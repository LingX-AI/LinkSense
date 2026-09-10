---
title: 开发交互式应用
description: 了解交互式应用 Manifest 各字段的含义、作用、限制和推荐实践，并通过 SDK 提交任务、接收业务事件。
---

# 开发交互式应用

交互式应用把你的业务表单、可视化和流程界面放入 LinkSense。应用在隔离的 iframe 中运行，右侧由 LinkSense 以独立分栏显示完整原生聊天区，因此用户既能操作你的界面，也能查看任务进度、填写 LinkSense 表单、处理审批、上传附件和查看产物。用户可以拖动分隔线调整两个区域的宽度，聊天区不会覆盖应用内容。

## 应用包结构

把静态文件打包为 ZIP。ZIP 根目录必须直接包含 `manifest.json` 和 `index.html`，不要再套一层目录。

```text
manifest.json
index.html
app.js
styles.css
assets/
  logo.png
```

应用包最大 10 MiB，解压后最大 30 MiB，单个文件最大 5 MiB，最多 200 个文件。不要包含依赖目录、源码缓存、符号链接、服务端代码或凭据；隐藏文件和隐藏目录（例如 `.DS_Store`、`.git`）会导致导入失败，文件路径也不能仅大小写不同。

支持的文件扩展名为 `.html`、`.css`、`.js`、`.mjs`、`.json`、`.map`、`.txt`、`.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.svg`、`.ico`、`.woff`、`.woff2`。使用构建工具时，只打包构建后的静态文件，并把资源引用配置为 `./app.js`、`./assets/logo.png` 等相对路径。字体、脚本、样式和图片应随包提供，避免依赖外部 CDN。

## Manifest

`manifest.json` 同时描述应用身份、任务执行说明、SDK 权限以及业务事件契约。LinkSense 在导入时校验它，在创建任务时固定对应的包版本，并在运行时使用其中的权限和事件定义。

### 最小配置

如果第一版只需要收集输入并启动任务，可以从以下配置开始。这里显式保留 `tasks:write`，其余可选字段使用默认值：

```json title="manifest.json"
{
  "schema_version": 1,
  "id": "research-workbench",
  "name": "研究工作台",
  "version": "1.0.0",
  "sdk_version": 1,
  "permissions": ["tasks:write"]
}
```

这份配置仍需与 `index.html` 一起打包。它允许页面提交和中断任务，但没有声明业务事件，因此结果在 LinkSense 原生聊天区中查看。

### 顶层字段参考

下表中的长度限制针对字符串去除首尾空白后的值。Manifest 顶层和 `custom_events` 的事件定义不接受未知字段；不要自行添加 `author`、`homepage`、`model` 或 `mcp_server_ids` 等字段。

| 字段 | 类型与限制 | 必填 / 默认值 | 含义与作用 | 推荐实践 |
| --- | --- | --- | --- | --- |
| `schema_version` | 整数，当前只支持 `1` | 必填 | Manifest 文件格式的版本，决定平台如何解析清单。 | 保持 `1`；发布应用新版本时修改 `version`，不要递增此字段。 |
| `id` | 字符串，1–120 字符；匹配 `^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$` | 必填 | 包内的应用标识，例如 `research-workbench`；不是平台为应用分配的 UUID。 | 使用稳定的小写英文名称，单词用 `-` 分隔，更新时保持不变；不要包含版本号。相同 `id` 不代表导入时自动覆盖已有应用，更新需从目标应用菜单操作。 |
| `name` | 字符串，1–160 字符 | 必填 | 用户在应用列表等位置看到的名称；导入和更新应用包时写入应用名称。 | 使用简短、可辨认的业务名称，如“研究工作台”，不堆叠版本号或技术名词。 |
| `version` | 字符串，1–80 字符；匹配 `^[0-9A-Za-z][0-9A-Za-z._+-]*$` | 必填 | 区分同一个应用的不同发布包；同一应用不能重复使用已经导入过的版本。 | 建议使用 `1.0.0`、`1.1.0` 等语义化版本。平台只校验格式和版本唯一性，不要求必须是 SemVer，也不按版本大小自动升级。 |
| `description` | 字符串或 `null`；最多 4,000 字符 | 可选，默认 `null` | 面向用户的应用简介；导入和更新时写入应用描述，不是任务执行指令。 | 说明适用场景、需要的输入和能得到的结果。它只接受一个字符串，不接受多语言对象。 |
| `instructions` | 字符串或 `null`；最多 20,000 字符 | 可选，默认 `null` | 应用级任务指令，指导任务如何工作；运行时还会附加已声明的事件名称、描述和 payload Schema。 | 写稳定的业务目标、输出要求和事件触发规则。本次表单输入放入 `tasks.run().prompt`。省略或设为 `null` 时使用平台基础指令；空字符串不会触发这个默认行为。 |
| `icon` | 字符串或 `null`；路径 1–500 字符 | 可选，默认 `null` | 指向包内图片，用作应用图标；不是外部图片 URL。 | 使用 `assets/logo.png` 等相对路径；支持 PNG、JPEG、WebP，最大 512 KiB，宽高各不超过 8,192 像素。建议压缩为清晰的方形图标。路径不能以 `/` 开头或包含 `..`。更新时省略或设为 `null` 会保留原图标，不表示删除。 |
| `entry` | 字符串，当前只支持 `"index.html"` | 可选，默认 `"index.html"` | iframe 打开的入口文件；文件必须位于 ZIP 根目录。 | 保持默认值。不要填完整 URL、子目录入口或前端路由。 |
| `sdk_version` | 整数，当前只支持 `1` | 必填 | 声明页面使用的 LinkSense SDK 协议版本。 | 使用本页的 `/sdk/v1.js` 加载地址；不要填写 SDK 的字符串版本 `"1.0.0"`。 |
| `permissions` | 权限字符串数组，最多 5 项，不可重复 | 可选，默认包含下表全部五项 | 控制页面能调用哪些 SDK 能力；不扩大当前用户对资源的访问权限。 | 显式声明所需权限。只启动任务就写 `["tasks:write"]`；`[]` 表示不申请这五项能力，省略字段则是全部五项。 |
| `custom_events` | 事件定义数组，最多 50 项，名称不可重复 | 可选，默认 `[]` | 声明任务可向应用投递的结构化业务数据，供界面展示和重建。 | 从少量有明确业务含义的事件开始，例如“章节已完成”，不要按聊天增量或工具日志设计事件。 |

### 权限的作用与选择

权限只开放对应 SDK 方法，不会自动选择资源、安装插件或授予资源使用权。读取资源列表后，应用仍需让用户选择，并在提交时传入相应 ID。没有声明所需权限时，SDK 调用会以 `LINKSENSE_SDK_PERMISSION_DENIED` 失败。

| 权限 | 对应 SDK 方法 | 返回内容或作用 | 何时申请 |
| --- | --- | --- | --- |
| `user.profile:read` | `context.getCurrentUser()` | 当前用户的 `id`、`name`、`avatar_url`、`language`。 | 需要显示用户信息或根据用户语言切换界面时；不需要时不申请。 |
| `capabilities:read` | `resources.listCapabilities()` | 技能和插件摘要：`id`、`name`、`type`、`description`、`status`、`can_select`、`logo_url`。 | 需要技能或插件选择器时；只允许用户选取可用项，将 ID 放入 `capability_ids`。 |
| `knowledge_bases:read` | `resources.listKnowledgeBases()` | 知识库摘要：`id`、`name`、`description`、`lifecycle_status`、`availability_status`。 | 需要知识库选择器时；根据可用状态展示选项，将 ID 放入 `knowledge_base_ids`。 |
| `mcp_servers:read` | `resources.listMcpServers()` | MCP 服务摘要：`id`、`name`、`status`、`transport`；不返回地址和凭据。 | 需要展示连接信息时；此权限不提供直接调用 MCP 的接口，`tasks.run()` 也不接受 `mcp_server_ids`。 |
| `tasks:write` | `tasks.run(input)`、`tasks.interrupt(turnId)` | 在当前应用任务中提交请求或请求中断指定轮次。 | 页面有生成、提交或停止操作时；需要处理受理失败和运行中的冲突。 |

`ready()`、`events.on(...)` 和 `chat.show()/hide()/toggle()` 不需要额外的权限项。不要把方法名当成新的权限字符串加入 Manifest。资源列表方法返回 `{ items: [...] }`；资料读取接口只返回摘要，不返回密码、Token、MCP 凭据、能力正文或知识库正文。

### 如何编写 instructions

`description` 帮用户决定是否使用应用；`instructions` 指导任务完成工作；`tasks.run().prompt` 描述本次要做什么。把这三类信息分开，更新应用说明或更换表单输入时更容易维护。

建议按以下顺序组织 `instructions`：

1. **业务目标**：任务要解决什么问题，以及哪些范围不包含在内。
2. **交付要求**：最终答复、章节或结论应包含什么，以及信息不足时如何向用户澄清。
3. **事件触发规则**：什么时机发送哪个事件，每次事件代表一条记录还是完整快照。
4. **与聊天区的分工**：在原生聊天区沟通、处理表单和审批；只将适合界面展示的业务数据发送给应用。

下面的完整示例使用“每个研究章节完成后发送一次事件”。不要只写“按需发事件”，也不要把密钥、固定用户身份或本次提交的全部表单值放入长期指令。

### 自定义事件字段参考

每个 `custom_events` 元素包含以下字段。事件名必须匹配 `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`，且不能以 `linksense.`、`conversation.`、`turn.`、`item.` 开头。

| 字段 | 类型与限制 | 必填 / 默认值 | 含义与作用 | 推荐实践 |
| --- | --- | --- | --- | --- |
| `custom_events[].name` | 字符串，1–120 字符，遵循上述命名规则；同一包中唯一 | 必填 | 连接事件声明、任务发送和 `events.on(name, handler)` 监听的精确名称。 | 使用业务域加已发生的动作，如 `research.section_ready`；三处拼写必须一致，避免 `update` 这类含义模糊的名字。 |
| `custom_events[].description` | 字符串，1–2,000 字符，去除首尾空白后不能为空 | 必填 | 说明何时发送、数据代表什么；会连同契约一起提供给执行任务的模型。 | 写清触发条件、发送粒度和更新方式，例如“每完成一章发送完整章节摘要，相同章节 ID 表示替换”。 |
| `custom_events[].schema_version` | 整数，1–1,000 | 可选，默认 `1` | 此事件的数据契约版本，随事件一起投递；与 Manifest 格式版本和应用包版本无关。 | 字段类型、含义或必填规则变化时递增，并同步修改处理函数和包 `version`；它不会自动转换旧数据。 |
| `custom_events[].payload_schema` | JSON Schema 对象，顶层 `type` 必须显式为 `"object"` | 必填 | 定义事件允许携带的数据结构；导入时编译校验 Schema，发送时校验 payload，不符合契约的数据不会投递。 | 使用 JSON Schema 2020-12，明确字段类型、必填项、字符串和数组上限；建议设置 `additionalProperties: false`，避免夹带未定义数据。 |

### payload_schema 怎么写

LinkSense 使用现有的 Ajv 2020 校验器解析事件契约。常用关键字如下；对象字段的可选性和额外字段行为可参阅 [JSON Schema 对象说明](https://json-schema.org/understanding-json-schema/reference/object)，方言支持见 [Ajv JSON Schema 文档](https://ajv.js.org/json-schema.html)。

| 关键字 | 含义与作用 | 推荐实践 |
| --- | --- | --- |
| `$schema` | 声明 JSON Schema 方言，可省略；使用时填 `https://json-schema.org/draft/2020-12/schema`。 | 显式声明 2020-12，使编辑器和平台按一致的规则理解契约。 |
| `type` | 限定数据类型；事件顶层必须是 `object`，字段可使用 `string`、`number`、`integer`、`boolean`、`array`、`object` 等类型。 | 为每个字段指定类型；嵌套对象也应定义完整结构。 |
| `properties` | 描述对象的字段及各自约束，单独声明不会使字段成为必填。 | 只保留界面实际需要的业务字段，名称保持稳定。 |
| `required` | 必须存在的字段名数组；省略它时，`properties` 中的字段默认可选。 | 把缺失就无法展示或计算的字段列入其中；允许缺失的字段应有明确的界面空态。 |
| `additionalProperties` | 控制是否允许未在契约中定义的额外字段；默认允许。 | 通常设为 `false`，嵌套对象也分别设置。 |
| `description` | 解释 payload 中业务字段的含义。 | 写清单位、来源或标识稳定性，帮助任务构造正确数据；它不是校验规则。 |
| `minLength` / `maxLength` | 限制字符串长度。 | 对标题、摘要设置与界面容量相符的上限，必填文本通常设置 `minLength: 1`。 |
| `enum` | 将取值限制为给定集合。 | 状态、优先级使用稳定代码，例如 `high`、`medium`、`low`，展示时再翻译。 |
| `items` / `maxItems` | 定义数组元素结构及数量上限。 | 表格行和列表应限制数量；大量结果分成有业务含义的小事件。 |

每次发送的是符合 Schema 的 JSON 对象，不是 Schema 本身，也不是 `JSON.stringify(payload)` 后的字符串。单个 payload 还受 `JSON.stringify(payload).length <= 65,536` 的限制；不要按这个上限填满事件，文件和长篇报告应通过 LinkSense 产物交付。

### 完整配置示例

这个版本只需要启动研究任务、接收章节事件，因此仍只申请 `tasks:write`。它不读取用户或资源列表；如果以后加入选择器，再增加对应权限。

```json title="manifest.json"
{
  "schema_version": 1,
  "id": "research-workbench",
  "name": "研究工作台",
  "version": "1.0.0",
  "description": "收集研究条件并展示结构化进展。",
  "instructions": "根据用户本次提交的主题完成研究，信息不足时先在原生聊天区向用户澄清。每完成一个可独立展示的章节，使用 emit_application_event 发送 research.section_ready，包含稳定的 section_id、标题和摘要；同一章节更新时沿用 section_id 并发送完整摘要。最终在原生聊天区给出完整研究结论。不要将聊天增量、推理或工具进度作为业务事件。",
  "icon": null,
  "entry": "index.html",
  "sdk_version": 1,
  "permissions": ["tasks:write"],
  "custom_events": [
    {
      "name": "research.section_ready",
      "description": "每完成一个可独立展示的研究章节时发送完整章节摘要；相同 section_id 的新事件替换该章节的展示内容。",
      "schema_version": 1,
      "payload_schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "required": ["section_id", "title", "summary"],
        "properties": {
          "section_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "description": "同一轮研究内稳定的章节标识，更新章节时保持不变。"
          },
          "title": { "type": "string", "minLength": 1, "maxLength": 160 },
          "summary": { "type": "string", "minLength": 1, "maxLength": 2000 }
        }
      }
    }
  ]
}
```

与此契约匹配的事件 payload 示例：

```json title="research.section_ready.payload.json"
{
  "section_id": "market-overview",
  "title": "市场概况",
  "summary": "本章节概述目标市场的主要参与者、需求变化与研究范围。"
}
```

这里的 `section_id` 是应用自己的业务标识，不是平台生成的事件 `id`。任务通过 LinkSense 的 `emit_application_event` 工具发送 `{ name, payload }`；页面通过 `events.on(...)` 接收，SDK 没有供 iframe 自行发送业务事件的 `events.emit()` 方法。

### 四种版本信息的区别

| 信息 | 标记什么 | 什么时候修改 |
| --- | --- | --- |
| 顶层 `schema_version` | Manifest 格式 | 当前固定 `1`，由平台支持的格式决定。 |
| `sdk_version` | SDK 协议 | 当前固定 `1`，与引入的 SDK v1 对应。 |
| `version` | 整个应用发布包 | HTML、JS、样式、指令、权限或事件契约更新后，导入新包时使用从未发布过的版本。 |
| `custom_events[].schema_version` | 单个业务事件契约 | 该事件的数据结构或语义改变时递增，并随新的包版本发布。 |

既有任务继续使用创建时固定的包、指令和事件契约，新任务使用当前包。更新包不会把旧任务切换到新界面，也不会用新事件 Schema 改写历史数据。发布前分别检查“创建新任务”和“重新进入旧任务”两条路径。

## 引入 SDK

在 `index.html` 中引入 LinkSense 托管的 SDK：

```html
<script src="/api/v1/interactive-app-runtime/sdk/v1.js"></script>
<script type="module" src="./app.js"></script>
```

SDK 挂载到 `window.LinkSense`。在 `app.js` 中尽早注册业务事件监听，再等待就绪并启用交互：

```js
const sections = new Map()
const unsubscribe = LinkSense.events.on("research.section_ready", (event) => {
  const key = `${event.turn_id}:${event.payload.section_id}`
  sections.set(key, event.payload)
  renderSections([...sections.values()])
})

await LinkSense.ready()
```

`renderSections` 是应用自行实现的渲染函数；使用 `textContent` 或框架的文本插值展示内容，避免把任务输出直接赋给 `innerHTML`。这里用轮次 ID 加章节 ID 更新记录，同一章节的新摘要会替换旧内容，不同轮次不会相互覆盖。组件卸载时调用 `unsubscribe()` 移除监听。

需要读取上下文或资源时，先在 Manifest 中加入权限，再在 `ready()` 之后调用对应方法。例如添加 `knowledge_bases:read` 后，使用 `const { items } = await LinkSense.resources.listKnowledgeBases()` 获取选项。

不要把业务 JavaScript 写成内联 `<script>` 或 `onclick` 属性；运行环境只允许加载同源脚本。SDK 使用上面的平台地址，应用脚本使用相对路径。脱离 LinkSense 单独打开 HTML 时没有宿主握手，`ready()` 不会完成；本地可以开发纯 UI，SDK 联调需要导入应用后进行。

## 启动任务

```js
const receipt = await LinkSense.tasks.run({
  prompt: "根据表单条件完成竞争分析，并在每个章节完成时发送 research.section_ready。",
})
```

| 参数 | 含义与限制 | 推荐实践 |
| --- | --- | --- |
| `prompt` | 必填；去除首尾空白后 1–200,000 字符，是本次任务请求。 | 从已校验的表单值构造，明确主题、约束和交付要求；不要只提交没有上下文的字段值。 |
| `capability_ids` | 可选，默认 `[]`；最多 50 个技能或插件 ID。 | 来自用户本次选择；读取列表不等于已经选中，服务端仍会检查资源权限和状态。 |
| `knowledge_base_ids` | 可选，默认 `[]`；最多 20 个知识库 UUID。 | 只提交需要用于本次任务的知识库。 |
| `idempotency_key` | 可选；去除首尾空白后 1–120 字符。 | 通常由宿主管理即可；若自行设置，应标识同一次逻辑提交，不要让不同请求共用固定值。 |

提交后，LinkSense 会立即打开右侧聊天区并显示正在发送的消息；服务端受理后，待发送消息与正式消息合并。`tasks.run()` 返回服务端的受理回执，不等待聊天历史刷新或研究结果生成。同一次提交尚未完成时的重复调用会合并；应用仍应在提交期间禁用生成按钮，并处理调用失败。

通过应用提交的消息超过当前聊天宽度下的 5 行时，默认折叠并在底部渐隐，用户可使用箭头图标展开或收起。完整提示词仍会发送、保存并用于复制；手动输入的聊天消息不受此规则影响。

消息增量、推理和工具进度不会重复发送给 iframe。应用只接收自己声明的业务事件，回调对象字段如下：

| 回调字段 | 含义与用法 |
| --- | --- |
| `id` | 平台生成的稳定事件 ID，用于事件去重；不是业务记录 ID。 |
| `name` | Manifest 中声明的事件名称。 |
| `schema_version` | 对应事件定义中的 Schema 版本。 |
| `payload` | 已通过该事件 Schema 校验的业务对象。 |
| `turn_id` | 产生该事件的任务轮次 ID，可用于区分多次提交的结果。 |
| `sequence` | 所在任务事件流中的序号，用于排序；业务事件之间不保证连续。 |
| `created_at` | 事件时间，用于展示发生时间。 |

网络恢复时同一事件可能再次到达，SDK 会按事件 `id` 去重，应用更新界面时也应保持幂等。受理回执只表示请求已被接受，不代表任务已完成；需要停止时可调用 `await LinkSense.tasks.interrupt(receipt.turn_id)`，不能用隐藏聊天区代替中断。

### 页面重进与事件恢复

用户切换到其他任务后，可以从左侧任务列表或搜索结果重新进入交互式应用。LinkSense 会加载该任务创建时固定的应用包版本，并按 `sequence` 从头回放已经持久化的自定义事件，然后继续发送实时事件。页面恢复不会重新运行任务，也不会要求模型再次生成数据。

SDK 会缓存应用注册监听器前到达的事件，并按稳定事件 id 去重。因此建议先调用 `LinkSense.events.on(...)` 建立所有业务事件监听，再读取其他上下文；事件处理函数仍应保持幂等，并从回调数据重建需要恢复的界面。尚未提交且没有通过自定义事件保存的应用内表单草稿不会由 LinkSense 自动持久化。

## 聊天区控制

用户始终可以显示或隐藏 LinkSense 聊天区，并可在桌面端拖动分隔线调整宽度。应用也可以请求切换：

```js
await LinkSense.chat.show()
await LinkSense.chat.hide()
await LinkSense.chat.toggle()
```

隐藏聊天区不会停止任务。需要处理 LinkSense 表单、审批或错误时，应引导用户重新打开聊天区。

## 安全限制

- 应用 iframe 不能直接调用 LinkSense API，也不能读取登录 Cookie 或 Token。
- 应用默认不能访问外网、提交 HTML 表单、打开 object 或修改 base URL。
- 所有 SDK 请求都受 Manifest 权限和服务端资源授权约束。
- 自定义事件 payload 必须符合 Manifest JSON Schema；无效事件不会投递。
- 自定义事件不要用于传输聊天消息、推理过程、工具日志、凭据或大文件。文件应通过 LinkSense 产物能力交付。

## 导入和更新

进入“插件中心 → 应用 → 创建应用 → 导入交互式应用”上传 ZIP。导入成功后可以像普通应用一样启用、停用并共享给指定用户或用户组。应用菜单中的“更新应用包”用于导入新版本。

推荐按以下顺序完成首个版本：

1. 用最小 Manifest、一个表单和 `tasks.run()` 跑通输入到聊天结果的流程。
2. 定义一个有实际展示用途的业务事件，完成 Schema、发送规则和页面监听。
3. 验证切换任务后能通过事件回放重建结果，再逐步增加资源选择器和可视化。
4. 发布前检查加载、空结果、提交中、失败、权限不足和重复提交等状态；布局要适应聊天区宽度变化。
5. 更新时一并调整包 `version`、事件契约和处理函数，并在新任务和旧任务中分别检查结果。

仓库中的 `examples/interactive-research-brief/` 提供了包含 Manifest、表单、资源选择和事件展示的完整静态示例，可作为扩展参考。

## 常见问题排查

| 现象 | 优先检查 | 处理方式 |
| --- | --- | --- |
| 导入提示应用包无效 | ZIP 根目录、未知字段、版本类型、重复权限或事件、文件与图标限制。 | 从最小配置开始比对；确认数字 `1` 没写成字符串 `"1"`，`index.html` 与 `manifest.json` 没被套进目录。 |
| 事件 Schema 导致导入失败 | `payload_schema.type`、Schema 方言、引用是否可解析。 | 使用 2020-12 和顶层对象；让 Schema 自包含，不依赖运行时下载外部 `$ref`。 |
| 更新提示版本冲突 | 新包的 `version` 是否已经在此应用中导入过。 | 使用从未发布过的版本，修改文件内容不会绕过版本唯一性检查。 |
| 图标无法导入 | 是否把 SVG、GIF 或外部 URL 用作 `icon`。 | 换成包内合规的 PNG、JPEG 或 WebP；普通页面资源允许 SVG，不代表应用图标也支持 SVG。 |
| 页面脚本、请求或资源不工作 | 是否使用内联脚本、CDN、绝对资源路径或直接 `fetch`。 | 使用外置脚本和包内相对资源路径；通过 SDK 获取平台数据，普通网络连接被禁止。 |
| SDK 报未就绪或权限不足 | 是否完成 `ready()`，Manifest 是否包含对应权限。 | 等待初始化后启用按钮；按实际调用添加所需权限，重新发布并在新任务中验证。 |
| 任务有聊天结果但应用没有业务数据 | 声明、指令和监听器的事件名是否一致，任务是否调用发送工具，payload 是否满足 Schema。 | 明确事件触发条件；检查必填字段、类型、长度和未声明字段，尽早注册监听。 |
| 重进页面后出现重复数据或草稿丢失 | 是否把每个事件都追加为新记录，是否把未提交草稿当成已保存结果。 | 按事件 ID 去重、按业务 ID 更新记录；从持久化事件重建界面，不依赖页面内存恢复草稿。 |
