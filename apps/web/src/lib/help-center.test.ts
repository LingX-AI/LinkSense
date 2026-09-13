import { describe, expect, it } from "vitest"

import { buildHelpCenterHref, resolveHelpDocumentPath } from "@/lib/help-center"

describe("help center routing", () => {
  it.each([
    ["/conversations/new", "user-guide/tasks/create-and-run"],
    ["/conversations/task-1", "user-guide/tasks/create-and-run"],
    ["/automations", "user-guide/automations/create-and-manage"],
    ["/capabilities", "user-guide/plugin-center/discover-and-install"],
    [
      "/capabilities/applications/app-1/external-access",
      "user-guide/plugin-center/application-access",
    ],
    [
      "/capabilities/applications/app-1/usage",
      "user-guide/plugin-center/application-usage",
    ],
    ["/knowledge-bases/kb-1", "user-guide/knowledge-bases/create-and-manage"],
    [
      "/applications/app-1/run/conversation-1",
      "user-guide/plugin-center/organization-apps",
    ],
    [
      "/knowledge-bases/kb-1/documents/doc-1/preview",
      "user-guide/knowledge-bases/documents",
    ],
    [
      "/knowledge-citations/citation-1",
      "user-guide/knowledge-bases/use-and-citations",
    ],
    ["/settings/general", "user-guide/settings/general"],
    ["/settings/profile", "user-guide/settings/profile"],
    ["/settings/personalization", "user-guide/settings/personalization"],
    ["/settings/appearance", "user-guide/settings/appearance"],
    ["/settings/security", "user-guide/settings/security"],
    ["/settings/credentials", "user-guide/plugin-center/credentials"],
    ["/settings/mcp", "user-guide/mcp/connect-and-manage"],
    ["/settings/weixin", "user-guide/message-channels/overview"],
    ["/archived", "user-guide/settings/archived-tasks"],
    ["/admin/users", "admin-guide/users"],
    ["/admin/groups", "admin-guide/groups"],
    ["/admin/roles", "admin-guide/roles"],
    ["/admin/capabilities", "admin-guide/plugin-governance"],
    ["/admin/knowledge-bases", "admin-guide/knowledge-governance"],
    ["/admin/knowledge-sources", "admin-guide/knowledge-sources"],
    ["/admin/models", "admin-guide/model-settings"],
    ["/admin/quotas", "admin-guide/quota-settings"],
    ["/admin/settings", "admin-guide/system-settings"],
    ["/admin/health", "admin-guide/health"],
    ["/settings/feedback", "user-guide/feedback"],
    ["/admin/feedback", "admin-guide/feedback"],
    ["/admin/audit", "admin-guide/audit"],
    ["/admin/usage", "admin-guide/usage"],
    ["/admin/system-update", "admin-guide/system-update"],
  ])("maps %s to %s", (pathname, documentPath) => {
    expect(resolveHelpDocumentPath(pathname)).toBe(documentPath)
  })

  it("falls back to the help center home page", () => {
    expect(resolveHelpDocumentPath("/unknown")).toBe("")
    expect(buildHelpCenterHref("/unknown", "zh-CN")).toBe("/help/")
    expect(buildHelpCenterHref("/unknown", "en-US")).toBe("/help/en-US/")
  })

  it("uses the active application language and keeps trailing slashes", () => {
    expect(buildHelpCenterHref("/settings/security", "zh-CN")).toBe(
      "/help/user-guide/settings/security/"
    )
    expect(buildHelpCenterHref("/admin/usage", "en-US")).toBe(
      "/help/en-US/admin-guide/usage/"
    )
  })
})
