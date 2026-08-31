import { describe, expect, it } from "vitest"

import type { NativeCodexItem } from "@/api/contracts"
import { resolveNativeActivityIconKind } from "@/features/conversations/native-activity-icon-kind"

function dynamicTool(namespace: string, tool: string): NativeCodexItem {
  return {
    id: `${namespace}-${tool}`,
    type: "dynamicToolCall",
    namespace,
    tool,
    status: "completed",
    success: true,
  }
}

function mcpTool(server: string, tool: string): NativeCodexItem {
  return {
    id: `${server}-${tool}`,
    type: "mcpToolCall",
    server,
    tool,
    status: "completed",
  }
}

describe("native activity icon semantics", () => {
  it.each<[NativeCodexItem, string]>([
    [dynamicTool("imagegen", "render_image"), "image-generation"],
    [dynamicTool("functions", "request_user_input"), "user-input"],
    [dynamicTool("functions", "update_plan"), "plan"],
    [dynamicTool("functions", "apply_patch"), "file-edit"],
    [dynamicTool("functions", "exec_command"), "terminal"],
    [dynamicTool("collaboration", "spawn_agent"), "agents"],
    [mcpTool("linksense_core", "search_knowledge_base"), "knowledge"],
    [mcpTool("browser", "navigate"), "browser"],
    [mcpTool("documents-server", "create_document"), "document"],
    [mcpTool("excel-live", "update_sheet"), "spreadsheet"],
    [mcpTool("presentations", "create_slides"), "presentation"],
    [mcpTool("postgres", "run_sql"), "database"],
    [mcpTool("github", "create_pull_request"), "git"],
    [mcpTool("outlook-mail", "send_email"), "mail"],
    [mcpTool("calendar", "create_event"), "calendar"],
    [mcpTool("trading", "portfolio_summary"), "finance"],
    [mcpTool("audio", "transcribe"), "audio"],
    [mcpTool("video", "render"), "video"],
    [mcpTool("unknown-server", "custom_action"), "tool"],
  ])("maps %s to the %s icon family", (item, expected) => {
    expect(resolveNativeActivityIconKind(item)).toBe(expected)
  })

  it.each<[Extract<NativeCodexItem, { type: "commandExecution" }>, string]>([
    [
      {
        id: "read-skill",
        type: "commandExecution",
        status: "completed",
        commandActions: [{ type: "read", path: "/skills/design/SKILL.md" }],
      },
      "skill",
    ],
    [
      {
        id: "read-file",
        type: "commandExecution",
        status: "completed",
        commandActions: [{ type: "read", path: "/workspace/app.tsx" }],
      },
      "file-read",
    ],
    [
      {
        id: "list-files",
        type: "commandExecution",
        status: "completed",
        commandActions: [{ type: "listFiles", path: "/workspace" }],
      },
      "folder",
    ],
    [
      {
        id: "search-files",
        type: "commandExecution",
        status: "completed",
        commandActions: [{ type: "search", command: "rg TODO apps/web" }],
      },
      "file-search",
    ],
    [
      {
        id: "run-tests",
        type: "commandExecution",
        status: "completed",
        commandActions: [],
        command: "pnpm test",
      },
      "test",
    ],
    [
      {
        id: "inspect-git",
        type: "commandExecution",
        status: "completed",
        commandActions: [],
        command: "git diff --stat",
      },
      "git",
    ],
  ])("classifies command activity %s as %s", (item, expected) => {
    expect(resolveNativeActivityIconKind(item)).toBe(expected)
  })

  it("uses the leading semantic category for a mixed activity group", () => {
    const command = {
      id: "mixed-command",
      type: "commandExecution" as const,
      status: "completed" as const,
      commandActions: [
        { type: "read" as const, path: "/skills/design/SKILL.md" },
        { type: "unknown" as const, command: "pnpm test" },
      ],
    }
    const fileChange = {
      id: "mixed-change",
      type: "fileChange" as const,
      status: "completed" as const,
      changes: [],
    }

    expect(resolveNativeActivityIconKind(command, [command, fileChange])).toBe(
      "skill"
    )
  })
})
