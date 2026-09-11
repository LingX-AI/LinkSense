import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { parseRunnerConfig } from "../src/config.js"
import { buildControllerServer } from "../src/controller/server.js"
import { ownerWorkerSecret } from "../src/controller/storage-key.js"
import {
  WorkerContractVersionMismatchError,
  type WorkerManager,
} from "../src/controller/worker-manager.js"

const ownerId = "01900000-0000-7000-8000-000000000002"
const otherOwnerId = "01900000-0000-7000-8000-000000000003"
const secret = "runner-555555555555555555555555555555"
const runnerInstanceId = "55555555-5555-4555-8555-555555555555"
const expectedRuntimeGeneration = "01900000-0000-7000-8000-000000000010"
const capabilityGeneration = "a".repeat(64)
const capabilityRevision = "2026-07-19T00:00:00.000Z"
const modelRuntimeInput = {
  model: "test-model",
  reasoningEffort: "medium" as const,
  modelProvider: {
    revision: 1,
    baseUrl: "https://models.example.test/v1",
    protocolMode: "native_responses" as const,
    apiKey: "test-provider-key",
  },
}
const roots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("controller authentication and routing", () => {
  it("exposes worker cleanup only behind the authenticated development boundary", async () => {
    const disabled = await createServer()
    const unavailable = await disabled.server.inject({
      method: "POST",
      url: "/development/workers/stop-all",
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(unavailable.statusCode).toBe(404)
    expect(disabled.stopAllWorkers).not.toHaveBeenCalled()
    await disabled.server.close()

    const enabled = await createServer({ developmentEndpoints: true })
    const unauthorized = await enabled.server.inject({
      method: "POST",
      url: "/development/workers/stop-all",
    })
    expect(unauthorized.statusCode).toBe(401)
    expect(enabled.stopAllWorkers).not.toHaveBeenCalled()

    const stopped = await enabled.server.inject({
      method: "POST",
      url: "/development/workers/stop-all",
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(stopped.statusCode).toBe(204)
    expect(enabled.stopAllWorkers).toHaveBeenCalledOnce()
    await enabled.server.close()
  })

  it("echoes the current controller instance in authenticated readiness", async () => {
    const { server, health } = await createServer()

    const response = await server.inject({
      method: "GET",
      url: "/health/ready",
      headers: { authorization: `Bearer ${secret}` },
    })

    expect(response.statusCode).toBe(200)
    expect(health).toHaveBeenCalledWith({ includeResourceUsage: false })
    expect(response.json()).toMatchObject({
      status: "available",
      runner_instance_id: runnerInstanceId,
    })
    await server.close()
  })

  it("collects resource diagnostics only when explicitly requested and authenticated", async () => {
    const { server, health } = await createServer()
    const url = "/health/ready?include_resource_usage=true"
    expect((await server.inject({ url })).statusCode).toBe(401)
    expect(health).not.toHaveBeenCalled()
    expect((await server.inject({ url, headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(200)
    expect(health).toHaveBeenCalledWith({ includeResourceUsage: true })
    expect((await server.inject({ url: "/health/ready?include_resource_usage=invalid", headers: { authorization: `Bearer ${secret}` } })).statusCode).toBe(400)
    expect(health).toHaveBeenCalledTimes(1)
    await server.close()
  })

  it("serves the model catalog captured by the startup app-server probe", async () => {
    const catalog = {
      models: [
        {
          id: "gpt-test",
          supported_reasoning_efforts: ["low", "high"],
          default_reasoning_effort: "high",
        },
      ],
    } satisfies NonNullable<ReturnType<WorkerManager["getModelCatalog"]>>
    const { server } = await createServer({ modelCatalog: catalog })

    const response = await server.inject({
      method: "GET",
      url: "/model-catalog",
      headers: { authorization: `Bearer ${secret}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(catalog)
    await server.close()
  })

  it("prewarms an owner worker only across the authenticated owner boundary", async () => {
    const { server, prewarm } = await createServer()

    const unauthorized = await server.inject({
      method: "POST",
      url: "/workers/prewarm",
      headers: { "x-linksense-owner-id": ownerId },
    })
    expect(unauthorized.statusCode).toBe(401)

    const missingOwner = await server.inject({
      method: "POST",
      url: "/workers/prewarm",
      headers: { authorization: `Bearer ${secret}` },
    })
    expect(missingOwner.statusCode).toBe(403)
    expect(missingOwner.json()).toEqual({
      error_code: "RUNNER_OWNER_REQUIRED",
    })

    const accepted = await server.inject({
      method: "POST",
      url: "/workers/prewarm",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
    })
    expect(accepted.statusCode).toBe(204)
    expect(prewarm).toHaveBeenCalledWith(ownerId)
    await server.close()
  })

  it("proxies every personalization operation to the authenticated owner worker", async () => {
    const { server, request } = await createServer()
    const headers = {
      authorization: `Bearer ${secret}`,
      "x-linksense-owner-id": ownerId,
    }

    expect(
      (
        await server.inject({
          method: "GET",
          url: "/personalization",
          headers,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await server.inject({
          method: "PATCH",
          url: "/personalization",
          headers,
          payload: { memories_enabled: false },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/personalization/memories/reset",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200)

    expect(
      request.mock.calls.map(
        ([forwardedOwnerId, requestPath, method, body, timeoutMs]) => ({
          forwardedOwnerId,
          requestPath,
          method,
          body: body ? JSON.parse(body.toString("utf8")) : undefined,
          timeoutMs,
        }),
      ),
    ).toEqual([
      {
        forwardedOwnerId: ownerId,
        requestPath: "/personalization",
        method: "GET",
        body: undefined,
        timeoutMs: undefined,
      },
      {
        forwardedOwnerId: ownerId,
        requestPath: "/personalization",
        method: "PATCH",
        body: { memories_enabled: false },
        timeoutMs: undefined,
      },
      {
        forwardedOwnerId: ownerId,
        requestPath: "/personalization/memories/reset",
        method: "POST",
        body: {},
        timeoutMs: 30_000,
      },
    ])
    await server.close()
  })

  it("routes an authenticated STDIO MCP probe only to the claimed owner worker", async () => {
    const { server, request } = await createServer()
    const payload = {
      ownerId,
      command: "npx",
      args: ["-y", "mcp-server-weread"],
      environment: { CC_ID: "reader-id" },
      timeoutMs: 5_000,
    }

    const mismatched = await server.inject({
      method: "POST",
      url: "/mcp/stdio/probe",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": otherOwnerId,
      },
      payload,
    })
    expect(mismatched.statusCode).toBe(400)
    expect(request).not.toHaveBeenCalled()

    const accepted = await server.inject({
      method: "POST",
      url: "/mcp/stdio/probe",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })
    expect(accepted.statusCode).toBe(200)
    expect(request).toHaveBeenCalledWith(
      ownerId,
      "/mcp/stdio/probe",
      "POST",
      Buffer.from(JSON.stringify(payload)),
      15_000,
    )
    await server.close()
  })

  it("routes runtime cleanup through the controller cleanup coordinator", async () => {
    const { server, cleanupConversation, request } = await createServer()
    const conversationId = "01900000-0000-7000-8000-000000000001"

    const response = await server.inject({
      method: "DELETE",
      url: `/conversations/${conversationId}/runtime`,
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ success: true })
    expect(cleanupConversation).toHaveBeenCalledWith(ownerId, conversationId)
    expect(request).not.toHaveBeenCalled()
    await server.close()
  })

  it.each(["/internal/runner/events", "/internal/runner/heartbeat"])("authenticates and relays the scoped callback %s", async (route) => {
    const { server } = await createServer()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const forged = await server.inject({
      method: "POST",
      url: route,
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(otherOwnerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: { conversationId: "01900000-0000-7000-8000-000000000001" },
    })
    expect(forged.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()

    const accepted = await server.inject({
      method: "POST",
      url: route,
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: { conversationId: "01900000-0000-7000-8000-000000000001" },
    })
    expect(accepted.statusCode).toBe(200)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${secret}`,
    )
    expect(new Headers(init?.headers).get("x-linksense-owner-id")).toBe(ownerId)
    await server.close()
  })

  it("relays interactive application events across the owner-scoped callback boundary", async () => {
    const { server } = await createServer()
    const apiResponse = {
      success: true,
      data: {
        accepted: true,
        event_id: "01900000-0000-7000-8000-000000000005",
        sequence: 42,
      },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const payload = {
      conversationId: "01900000-0000-7000-8000-000000000001",
      codexTurnId: "turn-native-1",
      name: "brief.insight_ready",
      payload: {
        title: "Insight",
        finding: "Finding",
        evidence: "Evidence",
      },
    }

    const forged = await server.inject({
      method: "POST",
      url: "/internal/application-events/emit",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(otherOwnerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })
    expect(forged.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()

    const accepted = await server.inject({
      method: "POST",
      url: "/internal/application-events/emit",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual(apiResponse)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://api:4000/internal/application-events/emit"
    )
    const init = fetchMock.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${secret}`
    )
    expect(new Headers(init?.headers).get("x-linksense-owner-id")).toBe(ownerId)
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    await server.close()
  })

  it("relays knowledge search only across the scoped internal callback boundary", async () => {
    const { server } = await createServer({ knowledgeSearchTimeoutMs: 181_234 })
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const apiResponse = {
      success: true,
      results: [
        {
          source_ref: "source-ref-000000000000000000000001",
          citation_marker:
            "[[kb-source:source-ref-000000000000000000000001]]",
          document_ref: "document-ref-00000000000000000000001",
          knowledge_base_name: "Operations",
          document_name: "Runbook.md",
          location: "parsed content",
          content: "Recovery procedure",
        },
      ],
      unavailable_knowledge_base_count: 0,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const payload = {
      conversationId: "01900000-0000-7000-8000-000000000001",
      turnId: "01900000-0000-7000-8000-000000000004",
      query: "recovery procedure",
      finalTopK: 5,
      candidateMultiplier: 3,
      numCandidates: 40,
      minScore: 0.2,
    }

    const forged = await server.inject({
      method: "POST",
      url: "/internal/knowledge/search",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(otherOwnerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })
    expect(forged.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()

    const accepted = await server.inject({
      method: "POST",
      url: "/internal/knowledge/search",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })

    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual(apiResponse)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("http://api:4000/internal/knowledge/search")
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${secret}`,
    )
    expect(new Headers(init?.headers).get("x-linksense-owner-id")).toBe(ownerId)
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(timeoutSpy).toHaveBeenCalledWith(181_234)
    await server.close()
  })

  it("relays current user info through the scoped internal callback boundary", async () => {
    const { server } = await createServer()
    const apiResponse = {
      success: true,
      user: {
        name: "Ada",
        email: "ada@example.com",
        user_groups: [
          {
            id: "01900000-0000-7000-8000-000000000010",
            name: "Research",
          },
        ],
      },
      credit_quota: { total: null, weekly: null, monthly: null },
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const payload = {
      conversationId: "01900000-0000-7000-8000-000000000001",
      turnId: "01900000-0000-7000-8000-000000000004",
    }

    const accepted = await server.inject({
      method: "POST",
      url: "/internal/current-user/info",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })

    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toEqual(apiResponse)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("http://api:4000/internal/current-user/info")
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${secret}`,
    )
    expect(new Headers(init?.headers).get("x-linksense-owner-id")).toBe(ownerId)
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    await server.close()
  })

  it("relays image generation to the API with the full inference timeout", async () => {
    const { server } = await createServer()
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    const apiResponse = {
      success: true,
      provider: "alibaba_bailian",
      model: "qwen-image-3.0",
      image_count: 1,
      unit_price: "0.12",
      total_cost: "0.12",
      currency: "CNY",
      images: [],
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(apiResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const payload = {
      conversationId: "01900000-0000-7000-8000-000000000001",
      turnId: "01900000-0000-7000-8000-000000000004",
      request: {
        prompt: "A white dog watching television",
        count: 1,
        size: "1024x1536",
      },
    }

    const response = await server.inject({
      method: "POST",
      url: "/internal/image-generation/generate",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(apiResponse)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(
      "http://api:4000/internal/image-generation/generate",
    )
    expect(init?.method).toBe("POST")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${secret}`,
    )
    expect(new Headers(init?.headers).get("x-linksense-owner-id")).toBe(ownerId)
    expect(JSON.parse(String(init?.body))).toEqual(payload)
    expect(timeoutSpy).toHaveBeenCalledWith(180_000)
    await server.close()
  })

  it("maps an unavailable API relay to a stable 503 without exposing the transport error", async () => {
    const { server } = await createServer()
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("dial api with secret")),
    )

    const response = await server.inject({
      method: "POST",
      url: "/internal/runner/process-exit",
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        conversationId: "01900000-0000-7000-8000-000000000001",
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        capabilityGeneration,
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error_code: "RUNNER_UNAVAILABLE" })
    expect(response.body).not.toContain("dial api")
    expect(response.body).not.toContain("secret")
    expect(timeoutSpy).toHaveBeenCalledWith(130_000)
    await server.close()
  })

  it("requires a global token for API routes and validates owner/body equality", async () => {
    const { server, request } = await createServer()
    const url = "/conversations/01900000-0000-7000-8000-000000000001/turns/start"
    const startBody = {
      ownerId,
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      appServerProcessLimit: 20,
      expectedRuntimeGeneration,
      capabilityGeneration,
      ...modelRuntimeInput,
      context: {
        userInput: "test",
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: [],
      environment: {},
    }

    const scopedOnApiRoute = await server.inject({
      method: "POST",
      url,
      headers: {
        authorization: `Bearer ${ownerWorkerSecret(ownerId, secret)}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: startBody,
    })
    expect(scopedOnApiRoute.statusCode).toBe(401)

    const crossOwner = await server.inject({
      method: "POST",
      url,
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": otherOwnerId,
      },
      payload: startBody,
    })
    expect(crossOwner.statusCode).toBe(403)
    expect(request).not.toHaveBeenCalled()
    await server.close()
  })

  it("returns a stable 400 without forwarding an invalid turn-start body", async () => {
    const { server, request } = await createServer()

    const response = await server.inject({
      method: "POST",
      url: "/conversations/01900000-0000-7000-8000-000000000001/turns/start",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        appServerProcessLimit: 20,
        expectedRuntimeGeneration,
        capabilityGeneration,
        ...modelRuntimeInput,
        context: {
          userInput: "use this skill",
          attachments: [],
          priorityPlugins: [],
          prioritySkills: [],
        },
        capabilities: [
          {
            id: "01900000-0000-7000-8000-000000000005",
            name: "Presentations",
            type: "skill",
            sourcePath: "/public-capabilities/presentations",
            revision: capabilityRevision,
          },
        ],
        environment: {},
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error_code: "RUNNER_TURN_START_INVALID",
    })
    expect(request).not.toHaveBeenCalled()
    await server.close()
  })

  it("rejects a legacy priority capability without its protocol id", async () => {
    const { server, request } = await createServer()

    const response = await server.inject({
      method: "POST",
      url: "/conversations/01900000-0000-7000-8000-000000000001/turns/start",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        appServerProcessLimit: 20,
        expectedRuntimeGeneration,
        capabilityGeneration,
        ...modelRuntimeInput,
        context: {
          userInput: "use pdf",
          attachments: [],
          priorityPlugins: [{ name: "pdf" }],
          prioritySkills: [],
        },
        capabilities: [],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error_code: "RUNNER_TURN_START_INVALID",
    })
    expect(request).not.toHaveBeenCalled()
    await server.close()
  })

  it("rejects unknown nested turn-start fields instead of stripping them", async () => {
    const { server, request } = await createServer()

    const response = await server.inject({
      method: "POST",
      url: "/conversations/01900000-0000-7000-8000-000000000001/turns/start",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        expectedRuntimeGeneration,
        capabilityGeneration,
        context: {
          userInput: "test",
          attachments: [],
          priorityPlugins: [],
          prioritySkills: [],
          legacyPriorityCapabilities: [],
        },
        capabilities: [],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error_code: "RUNNER_TURN_START_INVALID",
    })
    expect(request).not.toHaveBeenCalled()
    await server.close()
  })

  it("forwards capability metadata without controller-side staging", async () => {
    const { server, request } = await createServer()
    const url =
      "/conversations/01900000-0000-7000-8000-000000000001/turns/start"

    const response = await server.inject({
      method: "POST",
      url,
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        appServerProcessLimit: 20,
        expectedRuntimeGeneration,
        capabilityGeneration,
        ...modelRuntimeInput,
        context: {
          userInput: "use pdf",
          attachments: [],
          priorityPlugins: [
            {
              id: "01900000-0000-7000-8000-000000000005",
              name: "pdf",
            },
          ],
          prioritySkills: [],
        },
        capabilities: [
          {
            id: "01900000-0000-7000-8000-000000000005",
            name: "pdf",
            type: "plugin",
            revision: capabilityRevision,
          },
        ],
        environment: {},
      },
    })

    expect(response.statusCode).toBe(200)
    expect(request).toHaveBeenCalledOnce()
    const forwarded = JSON.parse(
      (request.mock.calls[0]?.[3] as Buffer).toString("utf8"),
    ) as Record<string, unknown>
    expect(forwarded).toMatchObject({
      ownerId,
      capabilityGeneration,
      capabilities: [
        {
          id: "01900000-0000-7000-8000-000000000005",
          name: "pdf",
          type: "plugin",
          revision: capabilityRevision,
        },
      ],
    })
    expect(JSON.stringify(forwarded)).not.toContain("sourcePath")
    await server.close()
  })

  it("gives worker reconciliation a request-specific 110 second budget", async () => {
    const { server, request } = await createServer()
    const response = await server.inject({
      method: "POST",
      url: "/conversations/01900000-0000-7000-8000-000000000001/reconcile",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        expectedRuntimeGeneration,
        capabilityGeneration,
        ...modelRuntimeInput,
        codexThreadId: "thread-native-1",
        codexTurnId: "turn-native-1",
        taskKind: "turn",
        collaborationMode: "default",
        capabilities: [],
        environment: {},
      },
    })

    expect(response.statusCode).toBe(200)
    expect(request.mock.calls[0]?.[4]).toBe(110_000)
    expect(
      JSON.parse((request.mock.calls[0]?.[3] as Buffer).toString("utf8")),
    ).toMatchObject({ taskKind: "turn", collaborationMode: "default" })
    await server.close()
  })

  it("maps a worker turn-start contract mismatch to its dedicated 503 error", async () => {
    const { server, request } = await createServer({
      requestError: new WorkerContractVersionMismatchError(),
    })

    const response = await server.inject({
      method: "POST",
      url: "/conversations/01900000-0000-7000-8000-000000000001/turns/start",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        appServerProcessLimit: 20,
        expectedRuntimeGeneration,
        capabilityGeneration,
        ...modelRuntimeInput,
        context: {
          userInput: "use pdf",
          attachments: [],
          priorityPlugins: [],
          prioritySkills: [],
        },
        capabilities: [],
      },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({
      error_code: "RUNNER_CONTRACT_MISMATCH",
    })
    expect(request).toHaveBeenCalledOnce()
    await server.close()
  })
})

async function createServer(
  options: {
    developmentEndpoints?: boolean
    requestError?: Error
    knowledgeSearchTimeoutMs?: number
    modelCatalog?: ReturnType<WorkerManager["getModelCatalog"]>
  } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-controller-server-"))
  roots.push(root)
  const config = parseRunnerConfig({
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_USER_DATA_ROOT: path.join(root, "users"),
    LINKSENSE_RUNNER_SHARED_SECRET: secret,
    LINKSENSE_RUNNER_INSTANCE_ID: runnerInstanceId,
    LINKSENSE_API_INTERNAL_URL: "http://api:4000",
    ...(options.knowledgeSearchTimeoutMs === undefined
      ? {}
      : {
          LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: String(
            options.knowledgeSearchTimeoutMs,
          ),
        }),
    LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: options.developmentEndpoints
      ? "true"
      : "false",
  })
  const request = vi.fn<WorkerManager["request"]>(
    async () => {
      if (options.requestError) throw options.requestError
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ status: "available" })),
      }
    },
  )
  const cleanupConversation = vi.fn<WorkerManager["cleanupConversation"]>(
    async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ success: true })),
    }),
  )
  const workers = {
    health: vi.fn(async () => ({ statusCode: 200, body: { status: "available" } })),
    stopAllWorkers: vi.fn(async () => undefined),
    prewarm: vi.fn(async () => undefined),
    getModelCatalog: vi.fn(() => options.modelCatalog),
    request,
    cleanupConversation,
  } as unknown as WorkerManager
  return {
    server: buildControllerServer(config, workers),
    health: workers.health,
    request,
    prewarm: workers.prewarm,
    stopAllWorkers: workers.stopAllWorkers,
    cleanupConversation,
  }
}
