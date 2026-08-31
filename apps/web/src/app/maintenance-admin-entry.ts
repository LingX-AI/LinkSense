const maintenanceAdminEntryKey = "linksense:maintenance-admin-entry"

export function enableMaintenanceAdminEntry() {
  try {
    window.sessionStorage.setItem(maintenanceAdminEntryKey, "1")
  } catch {
    // Ignore unavailable storage; the route guard will keep maintenance mode safe.
  }
}

export function hasMaintenanceAdminEntry() {
  try {
    return window.sessionStorage.getItem(maintenanceAdminEntryKey) === "1"
  } catch {
    return false
  }
}

export function clearMaintenanceAdminEntry() {
  try {
    window.sessionStorage.removeItem(maintenanceAdminEntryKey)
  } catch {
    // Ignore unavailable storage.
  }
}
