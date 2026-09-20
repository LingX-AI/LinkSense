import type { SupportedLanguage } from "@/i18n"

type HelpRoute = {
  matches: (pathname: string) => boolean
  documentPath: string
}

const startsWithSegment = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`)

const helpRoutes: readonly HelpRoute[] = [
  {
    matches: (pathname) =>
      /^\/capabilities\/applications\/[^/]+\/external-access(?:\/|$)/u.test(
        pathname
      ),
    documentPath: "user-guide/plugin-center/application-access",
  },
  {
    matches: (pathname) =>
      /^\/capabilities\/applications\/[^/]+\/usage(?:\/|$)/u.test(pathname),
    documentPath: "user-guide/plugin-center/application-usage",
  },
  {
    matches: (pathname) =>
      /^\/knowledge-bases\/[^/]+\/documents(?:\/|$)/u.test(pathname),
    documentPath: "user-guide/knowledge-bases/documents",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/knowledge-citations"),
    documentPath: "user-guide/knowledge-bases/use-and-citations",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/knowledge-bases"),
    documentPath: "user-guide/knowledge-bases/create-and-manage",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/applications"),
    documentPath: "user-guide/plugin-center/organization-apps",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/conversations"),
    documentPath: "user-guide/tasks/create-and-run",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/automations"),
    documentPath: "user-guide/automations/create-and-manage",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/capabilities"),
    documentPath: "user-guide/plugin-center/discover-and-install",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/general"),
    documentPath: "user-guide/settings/general",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/profile"),
    documentPath: "user-guide/settings/profile",
  },
  {
    matches: (pathname) =>
      startsWithSegment(pathname, "/settings/personalization"),
    documentPath: "user-guide/settings/personalization",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/appearance"),
    documentPath: "user-guide/settings/appearance",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/security"),
    documentPath: "user-guide/settings/security",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/credentials"),
    documentPath: "user-guide/plugin-center/credentials",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/mcp"),
    documentPath: "user-guide/mcp/connect-and-manage",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/weixin"),
    documentPath: "user-guide/message-channels/overview",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/archived"),
    documentPath: "user-guide/settings/archived-tasks",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/users"),
    documentPath: "admin-guide/users",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/groups"),
    documentPath: "admin-guide/groups",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/roles"),
    documentPath: "admin-guide/roles",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/capabilities"),
    documentPath: "admin-guide/plugin-governance",
  },
  {
    matches: (pathname) =>
      startsWithSegment(pathname, "/admin/knowledge-sources"),
    documentPath: "admin-guide/knowledge-sources",
  },
  {
    matches: (pathname) =>
      startsWithSegment(pathname, "/admin/knowledge-bases"),
    documentPath: "admin-guide/knowledge-governance",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/models"),
    documentPath: "admin-guide/model-settings",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/quotas"),
    documentPath: "admin-guide/quota-settings",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/settings"),
    documentPath: "admin-guide/system-settings",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/health"),
    documentPath: "admin-guide/health",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/settings/feedback"),
    documentPath: "user-guide/feedback",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/feedback"),
    documentPath: "admin-guide/feedback",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/audit"),
    documentPath: "admin-guide/audit",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/usage"),
    documentPath: "admin-guide/usage",
  },
  {
    matches: (pathname) => startsWithSegment(pathname, "/admin/system-update"),
    documentPath: "admin-guide/system-update",
  },
]

export function resolveHelpDocumentPath(pathname: string, search = ""): string {
  if (pathname === "/knowledge-bases") {
    const tab = new URLSearchParams(search).get("tab")
    if (tab === "artifacts") return "user-guide/tasks/files-and-results"
    if (tab === "sites") return "user-guide/tasks/publish-websites"
  }
  return helpRoutes.find((route) => route.matches(pathname))?.documentPath ?? ""
}

export function buildHelpCenterHref(
  pathname: string,
  language: SupportedLanguage,
  search = ""
): string {
  const localePrefix = language === "en-US" ? "en-US/" : ""
  const documentPath = resolveHelpDocumentPath(pathname, search)
  return `/help/${localePrefix}${documentPath ? `${documentPath}/` : ""}`
}
