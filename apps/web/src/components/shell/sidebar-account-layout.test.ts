import appShellSource from "@/components/shell/app-shell.tsx?raw"
import { describe, expect, it } from "vitest"

describe("sidebar account bar layout", () => {
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
