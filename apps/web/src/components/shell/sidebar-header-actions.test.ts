// @vitest-environment node

import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

describe("sidebar header actions", () => {
  it("places the collapse control to the right of notifications", () => {
    const actionsStart = appShellSource.indexOf("sidebar-header-actions")
    const actionsEnd = appShellSource.indexOf("</div>", actionsStart)
    const actionsSource = appShellSource.slice(actionsStart, actionsEnd)

    const searchIndex = actionsSource.indexOf('t("common.search")')
    const notificationsIndex = actionsSource.indexOf(
      '"nav.automationNotifications"'
    )
    const collapseIndex = actionsSource.indexOf('t("nav.collapseSidebar")')

    expect(searchIndex).toBeGreaterThan(-1)
    expect(notificationsIndex).toBeGreaterThan(searchIndex)
    expect(collapseIndex).toBeGreaterThan(notificationsIndex)
  })
})
