// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"

import { apiRequest } from "@/api/client"
import type { Conversation } from "@/api/contracts"
import { moveTaskToProject } from "@/features/projects/project-api"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))

const movedConversation = { id: "conversation-1" } as Conversation

describe("moveTaskToProject", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset()
    vi.mocked(apiRequest).mockResolvedValue(movedConversation)
  })

  it("moves an unpinned task directly", async () => {
    await expect(
      moveTaskToProject(
        { id: movedConversation.id, pinned_at: null },
        "project-1"
      )
    ).resolves.toBe(movedConversation)

    expect(apiRequest).toHaveBeenCalledOnce()
    expect(apiRequest).toHaveBeenCalledWith(
      `/conversations/${movedConversation.id}`,
      expect.objectContaining({ body: { project_id: "project-1" } })
    )
  })

  it("unpins and moves a pinned task in a single atomic request", async () => {
    await moveTaskToProject(
      { id: movedConversation.id, pinned_at: "2026-09-22T00:00:00.000Z" },
      "project-1"
    )

    expect(apiRequest).toHaveBeenCalledOnce()
    expect(apiRequest).toHaveBeenCalledWith(
      `/conversations/${movedConversation.id}`,
      expect.objectContaining({
        body: { project_id: "project-1", pinned: false },
      })
    )
  })

  it.each([
    "AUTOMATION_TASK_IN_USE",
    "PROJECT_NOT_FOUND",
    "PROJECT_TASK_ACTIVE",
  ])(
    "does not send a separate unpin request when moving fails with %s",
    async (code) => {
      const error = new Error(code)
      vi.mocked(apiRequest).mockRejectedValueOnce(error)

      await expect(
        moveTaskToProject(
          { id: movedConversation.id, pinned_at: "2026-09-22T00:00:00.000Z" },
          "project-1"
        )
      ).rejects.toBe(error)

      expect(apiRequest).toHaveBeenCalledOnce()
      expect(apiRequest).toHaveBeenCalledWith(
        `/conversations/${movedConversation.id}`,
        expect.objectContaining({
          body: { project_id: "project-1", pinned: false },
        })
      )
    }
  )
})
