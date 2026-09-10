// @vitest-environment node

import { describe, expect, it } from "vitest"
import type { NativeCodexItem } from "@/api/contracts"
import {
  buildNativeActivityViewModel,
  getNativeActivityPreview,
} from "@/features/conversations/native-activity-view-model"

describe("native activity preview", () => {
  it.each([
    {
      item: {
        id: "cmd",
        type: "commandExecution",
        status: "inProgress",
        command: "pnpm test\n  --run",
        commandActions: [],
      },
      expected: "pnpm test --run",
    },
    {
      item: {
        id: "files",
        type: "fileChange",
        status: "inProgress",
        changes: [{ path: "apps/web/src/app.tsx", kind: { type: "update" } }],
      },
      expected: "apps/web/src/app.tsx",
    },
    {
      item: {
        id: "search",
        type: "webSearch",
        action: {
          type: "search",
          queries: ["URL parsing", "URL parsing", "URL validation"],
        },
      },
      expected: "URL parsing · URL validation",
    },
    {
      item: {
        id: "open",
        type: "webSearch",
        action: { type: "openPage", url: "https://example.com/docs" },
      },
      expected: "https://example.com/docs",
    },
    {
      item: {
        id: "tool",
        type: "mcpToolCall",
        status: "inProgress",
        server: "documents",
        tool: "read",
        pluginId: "documents-plugin",
      },
      expected: "documents · read",
    },
    {
      item: {
        id: "empty",
        type: "commandExecution",
        status: "inProgress",
        commandActions: [],
      },
      expected: null,
    },
  ] satisfies Array<{ item: NativeCodexItem; expected: string | null }>)(
    "provides a compact preview for $item.type",
    ({ item, expected }) => {
      expect(
        getNativeActivityPreview(
          buildNativeActivityViewModel(item, "item/started"),
          "Activity"
        )
      ).toBe(expected)
    }
  )

  it("does not duplicate content already present in the activity label", () => {
    const model = buildNativeActivityViewModel(
      {
        id: "search",
        type: "webSearch",
        query: "URL parsing",
        action: { type: "search", query: "URL parsing" },
      },
      "item/started"
    )
    expect(getNativeActivityPreview(model, "URL parsing")).toBeNull()
  })
})
