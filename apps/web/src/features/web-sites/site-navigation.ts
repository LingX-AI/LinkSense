export function webSiteManagementPath(filters?: URLSearchParams): string {
  const params = new URLSearchParams({
    section: "application",
    app_scope: "sites",
  })
  for (const key of ["site_search", "site_status"]) {
    const value = filters?.get(key)
    if (value) params.set(key, value)
  }
  return `/capabilities?${params}`
}
