// @vitest-environment node
import { describe, expect, it } from "vitest"
import { automationToolNames } from "@linksense/shared"

import {
  isAutomationMutationItem,
  isAutomationToolItem,
} from "./automation-tool-activity"

describe("automation tool activities", () => {
  it.each(automationToolNames)(
    "recognizes %s and refreshes only mutating operations",
    (tool) => {
      const item = {
        id: "tool-1",
        type: "mcpToolCall" as const,
        server: "linksense_core",
        tool,
        status: "completed" as const,
      }
      expect(isAutomationToolItem(item)).toBe(true)
      expect(isAutomationMutationItem(item)).toBe(
        !["list_automations", "get_automation"].includes(tool)
      )
      expect(isAutomationToolItem({ ...item, server: "external" })).toBe(false)
    }
  )

  it("does not treat unrelated tools as automation mutations", () => {
    expect(
      isAutomationMutationItem({
        id: "tool-2",
        type: "mcpToolCall",
        server: "linksense_core",
        tool: "generate_image",
        status: "completed",
      })
    ).toBe(false)
  })
})
