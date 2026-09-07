// @vitest-environment node

import { describe, expect, it } from "vitest"

import { interactiveCustomEvent } from "@/features/applications/interactive-application-event"

describe("interactive application event projection", () => {
  it("forwards only application custom events to the iframe", () => {
    expect(
      interactiveCustomEvent({
        id: "conversation:event:1",
        type: "item/agentMessage/delta",
        turn_id: "20000000-0000-4000-8000-000000000001",
        payload: { delta: "not forwarded" },
        created_at: "2026-08-25T00:00:00.000Z",
        sequence_no: 1,
      })
    ).toBeNull()

    expect(
      interactiveCustomEvent({
        id: "conversation:event:2",
        type: "linksense/application/custom-event",
        turn_id: "20000000-0000-4000-8000-000000000001",
        payload: {
          schema_version: 1,
          source: "linksense_runner",
          method: "linksense/application/custom-event",
          params: {
            eventId: "30000000-0000-4000-8000-000000000001",
            name: "research.section_ready",
            eventSchemaVersion: 1,
            payload: { title: "Market overview" },
          },
        },
        created_at: "2026-08-25T00:00:01.000Z",
        sequence_no: 2,
      })
    ).toMatchObject({
      name: "research.section_ready",
      payload: { title: "Market overview" },
      sequence: 2,
    })
  })
})
