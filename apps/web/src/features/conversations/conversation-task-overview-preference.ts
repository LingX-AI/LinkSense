export const taskOverviewOpenStorageKey = "linksense.taskOverviewOpen"

export function readTaskOverviewOpenPreference() {
  try {
    return window.localStorage.getItem(taskOverviewOpenStorageKey) !== "false"
  } catch {
    return true
  }
}

export function writeTaskOverviewOpenPreference(open: boolean) {
  try {
    window.localStorage.setItem(taskOverviewOpenStorageKey, String(open))
  } catch {
    // Storage can be unavailable in restricted browser contexts. The local
    // component state still preserves the interaction for the current view.
  }
}
