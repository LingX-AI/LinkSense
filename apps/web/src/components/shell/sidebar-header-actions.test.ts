// @vitest-environment node

import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

describe("sidebar header actions", () => {
  it("keeps only the collapse control beside the logo", () => {
    const actionsStart = appShellSource.indexOf("sidebar-header-actions")
    const actionsEnd = appShellSource.indexOf("</div>", actionsStart)
    const actionsSource = appShellSource.slice(actionsStart, actionsEnd)

    const collapseIndex = actionsSource.indexOf('t("nav.collapseSidebar")')

    expect(actionsSource).not.toContain('"nav.automationNotifications"')
    expect(collapseIndex).toBeGreaterThan(-1)
  })
})
