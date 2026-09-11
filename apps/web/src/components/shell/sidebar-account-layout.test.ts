// @vitest-environment node

import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

describe("sidebar account bar layout", () => {
  it("keeps new task above one shared scroll area and the account bar below it", () => {
    expect(appShellSource).toContain(
      'className="sidebar-primary-navigation mt-2 shrink-0 space-y-0.5"'
    )
    expect(appShellSource).toContain(".slice(0, 1)")
    expect(appShellSource).toContain(
      'className="sidebar-conversation-scroll min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-3.5"'
    )
    expect(appShellSource).toContain(".slice(1)")

    const primaryNavigationIndex = appShellSource.indexOf(
      "sidebar-primary-navigation"
    )
    const scrollAreaIndex = appShellSource.indexOf(
      "sidebar-conversation-scroll"
    )
    const accountBarIndex = appShellSource.indexOf("sidebar-account-bar")

    expect(primaryNavigationIndex).toBeGreaterThan(-1)
    expect(scrollAreaIndex).toBeGreaterThan(primaryNavigationIndex)
    expect(accountBarIndex).toBeGreaterThan(scrollAreaIndex)
  })

  it("uses a compact footer while preserving a 40px account target", () => {
    expect(appShellSource).toContain(
      'className="flex h-full min-h-0 flex-col overflow-hidden px-3 pt-3 pb-2"'
    )
    expect(appShellSource).toContain(
      'className="sidebar-account-bar mt-1 flex shrink-0 items-center gap-1"'
    )
    expect(appShellSource).toContain(
      "sidebar-user-button h-auto min-w-0 flex-1 justify-start gap-2 border-0 px-2 py-1.5 text-left shadow-none"
    )
    expect(
      appShellSource.match(
        /<Avatar className="sidebar-account-avatar size-6 border-0">/gu
      )
    ).toHaveLength(2)
    expect(appShellSource).toContain(
      '<DropdownMenuLabel className="account-menu-quota px-2 py-1.5'
    )
  })
})
