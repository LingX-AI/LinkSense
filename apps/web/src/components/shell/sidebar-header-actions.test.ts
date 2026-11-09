// @vitest-environment node

import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

describe("sidebar header actions", () => {
  it("keeps compact notification, search and collapse controls beside the logo", () => {
    const actionsStart = appShellSource.indexOf("sidebar-header-actions")
    const actionsEnd = appShellSource.indexOf("</div>", actionsStart)
    const actionsSource = appShellSource.slice(actionsStart, actionsEnd)

    const collapseIndex = actionsSource.indexOf('t("nav.collapseSidebar")')
    const searchIndex = actionsSource.indexOf('t("common.search")')

    const notificationIndex = actionsSource.indexOf("<ShellSidebarActions")
    expect(notificationIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeGreaterThan(notificationIndex)
    expect(collapseIndex).toBeGreaterThan(searchIndex)
    expect(actionsSource).toContain("[&_button]:size-7")
    expect(actionsSource).toContain("[&_svg[data-design-icon]]:size-4")
  })
})
