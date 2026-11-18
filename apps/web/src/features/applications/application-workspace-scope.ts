import { readUrlEnum } from "@/lib/url-search-params"

export function applicationWorkspaceScope(
  searchParams: URLSearchParams,
  organizationSharingEnabled = true
): "owned" | "sites" | "shared" | "center" {
  return readUrlEnum(
    searchParams,
    "app_scope",
    organizationSharingEnabled
      ? ["owned", "sites", "shared", "center"]
      : ["owned", "sites"],
    "owned"
  )
}
