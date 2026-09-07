// @vitest-environment node

import { describe, expect, it } from "vitest"

import type {
  ConversationEvent,
  ConversationFile,
  NativeCodexItem,
} from "@/api/contracts"
import { buildConversationTaskOverview } from "@/features/conversations/conversation-task-overview"

const agentKeyA = `agent_${"a".repeat(24)}`
const agentKeyB = `agent_${"b".repeat(24)}`

function nativeEvent({
  id,
  sequence,
  item,
}: {
  id: string
  sequence: number
  item: NativeCodexItem
}): ConversationEvent {
  return {
    id,
    type: "item/completed",
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: "2026-07-20T08:00:00.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item,
      },
    },
  }
}

function artifact(
  id: string,
  name: string,
  options: Partial<ConversationFile> = {}
): ConversationFile {
  return {
    id,
    name,
    kind: "artifact",
    mime_type: "application/pdf",
    size: 1024,
    download_available: true,
    ...options,
  }
}

describe("conversation task overview", () => {
  it("counts unique native Codex subagents and keeps only generated artifacts", () => {
    const deck = artifact("artifact-deck", "ai-overview.pdf")
    const overview = buildConversationTaskOverview({
      events: [
        nativeEvent({
          id: "spawn-subagents",
          sequence: 1,
          item: {
            id: "spawn-subagents",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "completed",
            agents: [
              { agentKey: agentKeyA, status: "completed" },
              { agentKey: agentKeyB, status: "completed" },
            ],
          },
        }),
        nativeEvent({
          id: "subagent-update",
          sequence: 2,
          item: {
            id: "subagent-update",
            type: "subAgentActivity",
            kind: "interacted",
            agentKey: agentKeyA,
          },
        }),
      ],
      files: [
        deck,
        artifact("attachment", "brief.docx", { kind: "attachment" }),
        deck,
      ],
    })

    expect(overview.subAgents.map((agent) => agent.ordinal)).toEqual([1, 2])
    expect(overview.subAgentCount).toBe(2)
    expect(overview.subAgentCompletedCount).toBe(2)
    expect(overview.outputFiles).toEqual([deck])
  })

  it("does not infer subagents from unrelated Codex lifecycle items", () => {
    const overview = buildConversationTaskOverview({
      events: [
        nativeEvent({
          id: "command",
          sequence: 1,
          item: {
            id: "command",
            type: "commandExecution",
            status: "completed",
            commandActions: [],
          },
        }),
      ],
      files: [],
    })

    expect(overview).toEqual({
      subAgents: [],
      subAgentCount: 0,
      subAgentCompletedCount: 0,
      outputFiles: [],
    })
  })

  it("uses one current summary per child for the sidebar aggregate", () => {
    const overview = buildConversationTaskOverview({
      events: [
        nativeEvent({
          id: "spawn-subagents",
          sequence: 1,
          item: {
            id: "spawn-subagents",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "completed",
            agents: [
              { agentKey: agentKeyA, status: "running" },
              { agentKey: agentKeyB, status: "running" },
            ],
          },
        }),
        nativeEvent({
          id: "agent-a-update",
          sequence: 2,
          item: {
            id: "agent-a-update",
            type: "subAgentActivity",
            kind: "interacted",
            agentKey: agentKeyA,
            agentLabel: "纽约概览",
          },
        }),
      ],
      files: [],
      summaries: [
        {
          agentKey: agentKeyA,
          agentLabel: "纽约概览",
          status: "completed",
        },
        {
          agentKey: agentKeyB,
          agentLabel: "纽约历史",
          status: "running",
        },
      ],
    })

    expect(overview.subAgents).toMatchObject([
      { id: agentKeyA, label: "纽约概览", status: "completed" },
      { id: agentKeyB, label: "纽约历史", status: "running" },
    ])
    expect(overview.subAgentCount).toBe(2)
    expect(overview.subAgentCompletedCount).toBe(1)
  })
})
