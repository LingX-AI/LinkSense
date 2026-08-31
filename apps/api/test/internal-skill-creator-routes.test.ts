import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"

import type { ConversationSkillCreatorService } from "../src/modules/capabilities/conversation-skill-creator.js"
import { internalSkillCreatorRoutes } from "../src/modules/capabilities/internal-skill-creator-routes.js"

const SHARED_SECRET = "shared-secret-material-that-is-at-least-32-bytes"
const OWNER_ID = "10000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const TURN_ID = "codex-turn-1"

describe("internalSkillCreatorRoutes", () => {
  it("authenticates the runner and forwards preview and confirm inputs", async () => {
    const preview = vi.fn(async () => ({ success: true, operation: "preview" }))
    const confirm = vi.fn(async () => ({ success: true, operation: "confirm" }))
    const app = await createApp(preview, confirm)
    const headers = {
      authorization: `Bearer ${SHARED_SECRET}`,
      "x-linksense-owner-id": OWNER_ID,
    }

    const previewResponse = await app.inject({
      method: "POST",
      url: "/internal/skill-creator/preview",
      headers,
      payload: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workspaceRelativePath: "artifacts/new-skill.zip",
      },
    })
    expect(previewResponse.statusCode).toBe(200)
    expect(preview).toHaveBeenCalledWith(OWNER_ID, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      workspaceRelativePath: "artifacts/new-skill.zip",
    })

    const installToken = "opaque-install-token-" + "x".repeat(80)
    const confirmResponse = await app.inject({
      method: "POST",
      url: "/internal/skill-creator/confirm",
      headers,
      payload: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        installToken,
      },
    })
    expect(confirmResponse.statusCode).toBe(200)
    expect(confirm).toHaveBeenCalledWith(OWNER_ID, {
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      installToken,
    })
    await app.close()
  })

  it("rejects requests without the runner secret before invoking the service", async () => {
    const preview = vi.fn()
    const confirm = vi.fn()
    const app = await createApp(preview, confirm)
    const response = await app.inject({
      method: "POST",
      url: "/internal/skill-creator/preview",
      headers: { "x-linksense-owner-id": OWNER_ID },
      payload: {
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workspaceRelativePath: "artifacts/new-skill.zip",
      },
    })
    expect(response.statusCode).toBe(401)
    expect(preview).not.toHaveBeenCalled()
    await app.close()
  })
})

async function createApp(
  preview: ReturnType<typeof vi.fn>,
  confirm: ReturnType<typeof vi.fn>,
) {
  const app = Fastify()
  await app.register(internalSkillCreatorRoutes, {
    prefix: "/internal/skill-creator",
    service: { preview, confirm } as unknown as ConversationSkillCreatorService,
    sharedSecret: SHARED_SECRET,
  })
  return app
}
