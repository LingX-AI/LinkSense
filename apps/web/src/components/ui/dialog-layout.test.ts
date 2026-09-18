// @vitest-environment node

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { dialogBodyStyles } from "./dialog-layout"
import { cn } from "@/lib/utils"
import dialogSource from "./dialog.tsx?raw"

const dialogBodies = [
  "features/applications/interactive-declaration-dialog.tsx",
  "features/applications/application-catalog-panel.tsx",
  "features/applications/application-publication-picker.tsx",
  "features/admin/model-settings-editor.tsx",
  "features/capabilities/skill-update-dialog.tsx",
  "features/usage/billing-statements-panel.tsx",
  "features/conversations/conversation-thread.tsx",
  "pages/mcp-pages.tsx",
  "pages/admin-pages.tsx",
  "pages/knowledge-base-pages.tsx",
  "pages/capability-pages.tsx",
]
function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

describe("shared dialog body scrolling", () => {
  it.each(dialogBodies)("uses edge-aligned body scrolling in %s", (path) => {
    expect(source(path).includes("dialogBodyStyles(")).toBe(true)
  })

  it("does not clip the expanded body at the nested admin form boundary", () => {
    expect(
      source("pages/admin-pages.tsx").includes(
        'className="flex min-h-0 flex-col gap-4 overflow-hidden"'
      )
    ).toBe(false)
  })

  it("offsets the popup padding while retaining space between content and scrollbar", () => {
    expect(dialogSource.includes(" p-6 ")).toBe(true)
    expect(dialogBodyStyles().split(" ")).toEqual(
      expect.arrayContaining([
        "-mr-6",
        "pr-6",
        "w-auto",
        "min-h-0",
        "overflow-y-auto",
        "overscroll-contain",
      ])
    )
  })

  it("lets field groups and tables stretch to the edge without losing their layout or horizontal scrolling", () => {
    const classes = cn(
      "relative flex w-full overflow-x-auto",
      dialogBodyStyles("flex-1 gap-6")
    ).split(" ")
    expect(classes).toEqual(
      expect.arrayContaining([
        "relative",
        "flex",
        "w-auto",
        "overflow-x-auto",
        "flex-1",
        "gap-6",
        "-mr-6",
        "pr-6",
      ])
    )
    expect(classes).not.toContain("w-full")
  })
})
