// @vitest-environment node

import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

describe("sidebar account bar layout", () => {
  it("keeps new task above one shared scroll area and the account bar below it", () => {
    expect(appShellSource).toContain(
      'className="sidebar-primary-navigation mt-3 shrink-0"'
    )
    expect(appShellSource).toContain(".slice(0, 1)")
    expect(appShellSource).toContain("<SidebarTaskScrollArea>")
    expect(appShellSource).toContain(".slice(1)")

    const primaryNavigationIndex = appShellSource.indexOf(
      "sidebar-primary-navigation"
    )
    const scrollAreaIndex = appShellSource.indexOf("<SidebarTaskScrollArea>")
    const accountBarIndex = appShellSource.indexOf("sidebar-account-bar")

    expect(primaryNavigationIndex).toBeGreaterThan(-1)
    expect(scrollAreaIndex).toBeGreaterThan(primaryNavigationIndex)
    expect(accountBarIndex).toBeGreaterThan(scrollAreaIndex)
  })

  it("uses a compact footer while preserving a 40px account target", () => {
    expect(appShellSource).toContain(
      'className="workspace-theme flex h-full min-h-0 flex-col overflow-hidden bg-sidebar px-4 pb-2 font-interface text-foreground"'
    )
    expect(appShellSource).toContain(
      'className="sidebar-account-bar -mx-4 mt-1 flex min-h-15 shrink-0 items-center gap-1 border-t border-border px-4 pt-1"'
    )
    expect(appShellSource).toContain(
      "sidebar-user-button h-auto min-w-0 flex-1 justify-start gap-2 border-0 px-2 py-1.5 text-left shadow-none"
    )
    expect(
      appShellSource.match(
        /<Avatar className="sidebar-account-avatar size-6 border-0">/gu
      )
    ).toHaveLength(1)
    expect(appShellSource).toContain(
      '<DropdownMenuItem\n                  className="account-menu-quota min-h-7 justify-between gap-2'
    )
  })
})
