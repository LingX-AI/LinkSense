---
title: 开发交互式应用
description: 使用 HTML、CSS、JavaScript 和 LinkSense SDK 构建可导入的交互式应用。
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

应用包最大 10 MiB，解压后最大 30 MiB，最多 200 个文件。不要包含依赖目录、源码缓存、符号链接、服务端代码或凭据。

## Manifest

```json
{
  "schema_version": 1,
  "id": "research-workbench",
  "name": "研究工作台",
  "version": "1.0.0",
  "description": "收集研究条件并展示结构化进展。",
  "instructions": "完成研究时按应用声明发送业务事件。",
  "icon": "assets/logo.png",
  "entry": "index.html",
  "sdk_version": 1,
  "permissions": [
    "user.profile:read",
    "capabilities:read",
    "knowledge_bases:read",
    "mcp_servers:read",
    "tasks:write"
  ],
  "custom_events": [
    {
      "name": "research.section_ready",
      "description": "每完成一个可独立展示的研究章节时发送。",
      "schema_version": 1,
      "payload_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "summary"],
        "properties": {
          "title": { "type": "string" },
          "summary": { "type": "string" }
        }
      }
    }
  ]
}
```

每个 `payload_schema` 必须描述一个顶层 JSON 对象；事件字段放在该对象的 `properties` 中定义。不要把整个事件数据编码成 JSON 字符串。

更新应用包时必须修改 `version`。既有任务继续使用创建时的包版本，新任务使用当前版本。

## 引入 SDK

在 `index.html` 中引入 LinkSense 托管的 SDK：

```html
<script src="/api/v1/interactive-app-runtime/sdk/v1.js"></script>
<script type="module" src="./app.js"></script>
```

SDK 初始化后挂载到 `window.LinkSense`：

```js
await LinkSense.ready()

const user = await LinkSense.context.getCurrentUser()
const capabilities = await LinkSense.resources.listCapabilities()
const knowledgeBases = await LinkSense.resources.listKnowledgeBases()
const mcpServers = await LinkSense.resources.listMcpServers()
```

接口只返回当前登录用户有权使用的摘要。SDK 不返回密码、Token、MCP 凭据、MCP 地址、能力正文或知识库正文。

## 启动任务

```js
const receipt = await LinkSense.tasks.run({
  prompt: "根据表单条件完成竞争分析，并在每个章节完成时发送 research.section_ready。",
  capability_ids: selectedCapabilityIds,
  knowledge_base_ids: selectedKnowledgeBaseIds,
})
```

提交后，LinkSense 会立即打开右侧聊天区并显示正在发送的消息；服务端受理后，待发送消息与正式消息合并。`tasks.run()` 返回服务端的受理回执，不等待聊天历史刷新或研究结果生成。同一次提交尚未完成时的重复调用会合并；应用仍应在提交期间禁用生成按钮，并处理调用失败。

通过应用提交的消息超过当前聊天宽度下的 5 行时，默认折叠并在底部渐隐，用户可使用箭头图标展开或收起。完整提示词仍会发送、保存并用于复制；手动输入的聊天消息不受此规则影响。

消息增量、推理和工具进度不会重复发送给 iframe。应用只接收自己声明的业务事件：

```js
const unsubscribe = LinkSense.events.on(
  "research.section_ready",
  (event) => {
    renderSection(event.payload)
  },
)
```

每个事件包含稳定 id、Schema 版本、turn、sequence 和时间。网络恢复时同一事件可能再次到达，SDK 会按事件 id 处理，应用更新界面时也应保持幂等。

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
