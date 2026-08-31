import { describe, expect, it, vi } from "vitest"

import {
  SUPERSEDED_VERSION_RETENTION_MS,
  restoreUnreferencedVersionCleanupEligibility,
} from "../src/modules/knowledge/retention.js"

const VERSION_ID = "00000000-0000-4000-8000-000000000001"
const RETAINED_VERSION_ID = "00000000-0000-4000-8000-000000000002"
const SUPERSEDED_AT = new Date("2026-06-01T00:00:00.000Z")

describe("knowledge version retention", () => {
  it("restores the original thirty-day deadline only for unreferenced superseded versions", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBaseDocumentVersion: {
        findMany: vi.fn(async () => [
          { id: VERSION_ID, supersededAt: SUPERSEDED_AT },
          { id: RETAINED_VERSION_ID, supersededAt: SUPERSEDED_AT },
        ]),
        updateMany,
      },
      conversationMessageKnowledgeCitation: {
        findMany: vi.fn(async () => [
          { documentVersionId: RETAINED_VERSION_ID },
        ]),
      },
    }

    await restoreUnreferencedVersionCleanupEligibility(
      transaction as never,
      [VERSION_ID, RETAINED_VERSION_ID, VERSION_ID],
    )

    expect(updateMany).toHaveBeenCalledOnce()
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: VERSION_ID,
        versionStatus: "superseded",
        cleanupEligibleAt: null,
      },
      data: {
        cleanupEligibleAt: new Date(
          SUPERSEDED_AT.getTime() + SUPERSEDED_VERSION_RETENTION_MS,
        ),
      },
    })
  })
})
