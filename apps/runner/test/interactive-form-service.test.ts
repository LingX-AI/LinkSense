import { afterEach, describe, expect, it, vi } from "vitest"

import { interactiveFormCoreMcpModule } from "../src/mcp/core-services/interactive-form-service.js"

const { requestHttp } = vi.hoisted(() => ({ requestHttp: vi.fn() }))
vi.mock("undici", () => ({ request: requestHttp }))

const endpoint = "http://127.0.0.1:8081/mcp-interactive-form/task/request"
const token = "test-form-service-token-000000000000000000000000"
const input = {
  toolName: "request_user_form",
  argumentsValue: {
    message: "Choose a scope",
    fields: [{ id: "scope", label: "Scope", control: "text", required: true }],
  },
}

function createModule() {
  return interactiveFormCoreMcpModule.create({
    environment: {
      LINKSENSE_FORM_SERVICE_ENDPOINT: endpoint,
      LINKSENSE_FORM_SERVICE_TOKEN: token,
    },
    workspaceRoot: "/tmp/linksense-form-service-test",
  })
}

afterEach(() => vi.resetAllMocks())

describe("interactive form broker transport", () => {
  it("keeps the existing HTTP broker open without header or body deadlines while awaiting human input", async () => {
    const body = { json: vi.fn(async () => ({ action: "accept", content: { scope: "full" } })) }
    requestHttp.mockResolvedValueOnce({ statusCode: 200, body })
    const signal = new AbortController().signal
    const result = await createModule().callTool({ ...input, signal })
    expect(requestHttp).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({
      method: "POST", headersTimeout: 0, bodyTimeout: 0, signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    }))
    expect(result).toMatchObject({ isError: false, content: [{ type: "text", text: JSON.stringify({ action: "accept", content: { scope: "full" } }) }] })
  })

  it("propagates task cancellation instead of restarting the form", async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new Error("Task stopped")
    requestHttp.mockRejectedValueOnce(error)
    await expect(createModule().callTool({ ...input, signal: controller.signal })).rejects.toBe(error)
    expect(requestHttp).toHaveBeenCalledOnce()
  })

  it("releases an unsuccessful broker response and reports an unavailable form", async () => {
    const body = { dump: vi.fn(async () => undefined), json: vi.fn() }
    requestHttp.mockResolvedValueOnce({ statusCode: 503, body })
    const result = await createModule().callTool({ ...input, signal: new AbortController().signal })
    expect(body.dump).toHaveBeenCalledOnce()
    expect(body.json).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true })
  })
})
