export const applicationSetupEnUS = {
  title: "Application setup guide",
  description:
    "Set up the capabilities required by {{name}} to start using it.",
  progress: "{{completed}} / {{total}} ready",
  required: "Required",
  unnamed: "{{type}} {{number}}",
  selected: "Currently using: {{name}}",
  choose: "Choose your own resource",
  chooseNamed: "Choose your own resource for {{name}}",
  search: "Search available resources",
  manage: "Create or manage resources",
  credentials: "Configure personal credentials",
  modelDefault: "Use my model preference",
  modelHelp:
    "Choose an available model for the application, or use your model preference. Contact your administrator if no models are available.",
  check: "Check again",
  later: "Continue later",
  complete: "Save and finish setup",
  use: "Start using",
  completed: "Application setup is complete.",
  ready:
    "The required capabilities are ready. You can start using the application.",
  pending:
    "Complete the required items below. Each selection is saved so you can continue later.",
  activate:
    "The required capabilities are ready. Finish setup to apply these settings to the application.",
  note: "These checks reflect your current resource and authorization settings. Actual access to external services also depends on service availability and account permissions.",
  newTab:
    "Setup pages open in a new tab. Return here when finished to refresh the status automatically, or select “Check again”.",
  types: {
    plugin: "Plugin",
    skill: "Skill",
    knowledge_base: "Knowledge base",
    mcp_server: "MCP connection",
    model: "Model",
  },
  statuses: {
    configured: "Ready",
    unconfigured: "Setup needed",
    unavailable: "Currently unavailable",
    credentials_required: "Credentials needed",
  },
  purposes: {
    plugin:
      "This plugin provides actions for the application. Complete any required authorization with your own account credentials.",
    skill:
      "This Skill provides instructions and methods for completing the application's tasks.",
    knowledge_base:
      "Provide the reference materials the application needs to answer questions. Choose a personal knowledge base with the relevant content.",
    mcp_server:
      "Give the application access to the external service or tools it needs. Choose the corresponding connection you have configured.",
  },
} as const
