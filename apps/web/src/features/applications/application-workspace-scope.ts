import { readUrlEnum } from "@/lib/url-search-params"

export function applicationWorkspaceScope(
  searchParams: URLSearchParams,
  organizationSharingEnabled = true
): "owned" | "shared" | "center" {
  return organizationSharingEnabled
    ? readUrlEnum(
        searchParams,
        "app_scope",
        ["owned", "shared", "center"] as const,
        "owned"
      )
    : "owned"
}
