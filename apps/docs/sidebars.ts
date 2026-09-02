import type { SidebarsConfig } from "@docusaurus/plugin-content-docs"

const sidebars: SidebarsConfig = {
  helpSidebar: [
    "introduction",
    {
      type: "category",
      label: "用户指南",
      link: {
        type: "doc",
        id: "user-guide/overview",
      },
      items: [
        {
          type: "category",
          label: "开始使用",
          items: [
            "user-guide/getting-started/sign-in",
            "user-guide/getting-started/registration",
            "user-guide/getting-started/password-and-sso",
            "user-guide/getting-started/first-task",
          ],
        },
        {
          type: "category",
          label: "任务",
          items: [
            "user-guide/tasks/create-and-run",
            "user-guide/tasks/plan-mode",
            "user-guide/tasks/goal-tasks",
            "user-guide/tasks/files-and-results",
            "user-guide/tasks/file-annotations",
            "user-guide/tasks/voice-input",
            "user-guide/tasks/running-requests",
            "user-guide/tasks/manage-history",
            "user-guide/tasks/branch-and-organize",
          ],
        },
        "user-guide/automations/create-and-manage",
        {
          type: "category",
          label: "消息渠道",
          items: [
            "user-guide/message-channels/weixin",
            "user-guide/message-channels/feishu",
          ],
        },
        {
          type: "category",
          label: "插件中心",
          items: [
            "user-guide/plugin-center/discover-and-install",
            "user-guide/plugin-center/clawhub",
            "user-guide/plugin-center/personal-content",
            "user-guide/plugin-center/create-applications",
            "user-guide/plugin-center/organization-apps",
            "user-guide/plugin-center/application-access",
            "user-guide/plugin-center/application-usage",
            "user-guide/plugin-center/credentials",
          ],
        },
        "user-guide/mcp/connect-and-manage",
        {
          type: "category",
          label: "知识库",
          items: [
            "user-guide/knowledge-bases/create-and-manage",
            "user-guide/knowledge-bases/documents",
            "user-guide/knowledge-bases/sharing",
            "user-guide/knowledge-bases/use-and-citations",
          ],
        },
        {
          type: "category",
          label: "个人设置",
          items: [
            "user-guide/settings/general",
            "user-guide/settings/profile",
            "user-guide/settings/personalization",
            "user-guide/settings/appearance",
            "user-guide/settings/security",
            "user-guide/settings/archived-tasks",
          ],
        },
        "user-guide/feedback",
        "user-guide/troubleshooting/common-problems",
      ],
    },
    {
      type: "category",
      label: "开发者指南",
      items: [
        "developer-guide/interactive-application",
        "developer-guide/embed-application",
      ],
    },
    {
      type: "category",
      label: "管理员指南",
      link: {
        type: "doc",
        id: "admin-guide/overview",
      },
      items: [
        {
          type: "category",
          label: "用户与权限",
          items: [
            "admin-guide/users",
            "admin-guide/groups",
            "admin-guide/roles",
          ],
        },
        "admin-guide/plugin-governance",
        {
          type: "category",
          label: "知识库治理",
          items: [
            "admin-guide/knowledge-governance",
            "admin-guide/knowledge-sources",
          ],
        },
        "admin-guide/model-settings",
        "admin-guide/system-settings",
        "admin-guide/authentication-settings",
        "admin-guide/health",
        "admin-guide/feedback",
        "admin-guide/audit",
        "admin-guide/usage",
        "admin-guide/system-update",
      ],
    },
  ],
}

export default sidebars
