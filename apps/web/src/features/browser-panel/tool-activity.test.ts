// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { NativeCodexItem } from "@/api/contracts"
import { isManagedBrowserCommandItem } from "./tool-activity"

function commandItem(
  command: string | undefined,
  actions: { command?: string }[] = []
): NativeCodexItem {
  return {
    type: "commandExecution",
    id: "command-1",
    status: "inProgress",
    commandActions: actions.map((action) => ({
      type: "unknown" as const,
      ...(action.command ? { command: action.command } : {}),
    })),
    ...(command ? { command } : {}),
  }
}

describe("managed browser command activity", () => {
  it.each([
    "linksense-browser open https://example.test/",
    "cd /tmp && linksense-browser goto https://example.test/",
  ])("recognizes the managed browser command %s", (command) => {
    expect(isManagedBrowserCommandItem(commandItem(command))).toBe(true)
  })

  it("recognizes the command inside a parsed command action", () => {
    expect(
      isManagedBrowserCommandItem(
        commandItem(undefined, [
          { command: "ls" },
          { command: "linksense-browser snapshot" },
        ])
      )
    ).toBe(true)
  })

  it.each([
    "command -v linksense-browser",
    "linksense-browser --help",
    "linksense-browser-helper open",
    "npm run build",
  ])("ignores %s", (command) => {
    expect(isManagedBrowserCommandItem(commandItem(command))).toBe(false)
  })

  it("ignores non-command items", () => {
    expect(
      isManagedBrowserCommandItem({
        type: "mcpToolCall",
        id: "tool-1",
        server: "linksense_core",
        tool: "browser_use",
        status: "inProgress",
      })
    ).toBe(false)
  })
})
