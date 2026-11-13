import { describe, expect, it } from "vitest"
import { parseRichOutput } from "@linksense/shared"
import { richOutputCoreMcpModule } from "../src/mcp/core-services/rich-output-service.js"

describe("rich output catalog", () => {
  const module = richOutputCoreMcpModule.create()
  it("supplies a valid example and component schemas without reading user resources", async () => {
    const result = await module.callTool({
      toolName: "get_rich_output_catalog",
      argumentsValue: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    const content = result.content[0]
    if (content?.type !== "text") throw new Error("Expected text catalog")
    const catalog = JSON.parse(content.text)
    expect(parseRichOutput(JSON.stringify(catalog.example))).not.toBeNull()
    expect(Object.keys(catalog.components)).toEqual([
      "Panel", "Grid", "Text", "Callout", "Evidence", "Comparison", "Metric", "DataTable", "Chart",
    ])
    expect(catalog.instructions.join(" ")).toContain("request_user_form")
    expect(module.tools[0]?.annotations?.readOnlyHint).toBe(true)
  })

  it("rejects arbitrary arguments and never enables the tool in Plan mode", async () => {
    const result = await module.callTool({
      toolName: "get_rich_output_catalog",
      argumentsValue: { action: "delete" },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(richOutputCoreMcpModule.modes).toEqual(["default"])
  })
})
