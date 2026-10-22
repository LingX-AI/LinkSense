export const applicationSetupZhCN = {
  title: "应用配置指南",
  description: "为 {{name}} 配置所需能力，完成后即可开始使用。",
  progress: "已就绪 {{completed}} / {{total}} 项",
  required: "必需",
  unnamed: "{{type}} {{number}}",
  selected: "当前使用：{{name}}",
  choose: "选择你自己的资源",
  chooseNamed: "为 {{name}} 选择你自己的资源",
  search: "搜索可用资源",
  manage: "创建或管理资源",
  credentials: "配置个人凭据",
  modelDefault: "使用我的模型偏好",
  modelHelp:
    "为应用选择可用的模型，也可以沿用你的模型偏好。如果没有可用模型，请联系管理员。",
  check: "重新检查",
  later: "稍后继续",
  complete: "保存并完成配置",
  use: "开始使用",
  completed: "应用配置已完成。",
  ready: "所需能力已就绪，可以开始使用。",
  pending: "请完成下面的必需项。每次选择都会保存，稍后可以继续。",
  activate: "所需能力已就绪。完成配置后，这些设置将用于此应用。",
  note: "检查结果反映当前的资源和授权配置。外部服务的实际访问还取决于服务状态和账户权限。",
  newTab:
    "配置页面会在新标签页打开。完成后返回这里，状态会自动刷新，也可以点击“重新检查”。",
  types: {
    plugin: "插件",
    skill: "Skill",
    knowledge_base: "知识库",
    mcp_server: "MCP 连接",
    model: "模型",
  },
  statuses: {
    configured: "已就绪",
    unconfigured: "待配置",
    unavailable: "当前不可用",
    credentials_required: "待配置凭据",
  },
  purposes: {
    plugin: "此插件为应用提供操作能力。请使用你自己的账户凭据完成所需授权。",
    skill: "此 Skill 为应用提供完成任务的方法和操作说明。",
    knowledge_base:
      "为应用提供回答问题时需要查阅的资料。请选择包含相应资料的个人知识库。",
    mcp_server:
      "让应用访问所需的外部服务或工具。请选择你已经配置好的对应连接。",
  },
} as const
