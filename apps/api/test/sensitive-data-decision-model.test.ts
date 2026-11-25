import { describe, expect, it, vi } from "vitest"

import { maySendToExternalModel } from "../src/modules/sensitive-data/decision-model.js"

const model = {
  endpoint: "http://decision.example.test/v1/systemone",
  modelId: "decision-model",
  apiKey: "test-placeholder",
  organizationPrompt: null,
  personalPrompt: null,
}
const organizationPrompt = "Confidential price lists need local handling."
const personalPrompt = "Include internal project codenames."
const negative = { type: "noul", noul: 0.03 }
const positive = { type: "noul", noul: 0.9 }

describe("KnowLine sensitive data decision", () => {
  it("uses a noul question with task data in state and accepts a confident negative", async () => {
    const service = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ answers: { sensitive: { type: "noul", noul: 0.03 } } }),
    )
    expect(await maySendToExternalModel(model, "fictional task", undefined, service)).toBe(true)
    const [url, request] = service.mock.calls[0] ?? []
    expect(url).toBe(model.endpoint)
    expect(request).toMatchObject({
      method: "POST", redirect: "error",
      headers: { authorization: "Bearer test-placeholder" },
    })
    const body = JSON.parse(String(request?.body))
    expect(body).toMatchObject({
      model: model.modelId,
      state: { task_context: "fictional task" },
      questions: { sensitive: { type: "noul" } },
      chat_template_kwargs: { enable_thinking: false },
    })
    expect(Object.keys(body.questions)).toEqual(["sensitive"])
  })

  it("adds organization criteria to the built-in question without requiring a personal answer", async () => {
    const service = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ answers: { sensitive: negative } }),
    )
    expect(await maySendToExternalModel({ ...model, organizationPrompt }, "task", undefined, service)).toBe(true)
    const { questions } = JSON.parse(String(service.mock.calls[0]?.[1]?.body))
    expect(Object.keys(questions)).toEqual(["sensitive"])
    expect(questions.sensitive.instructions).toContain("credentials")
    expect(questions.sensitive.instructions).toContain(organizationPrompt)
  })

  it("evaluates organization-wide and personal criteria in separate questions of one request", async () => {
    const service = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ answers: { sensitive: negative, personal_sensitive: negative } }),
    )
    expect(await maySendToExternalModel({ ...model, organizationPrompt, personalPrompt }, "task", undefined, service)).toBe(true)
    expect(service).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(service.mock.calls[0]?.[1]?.body))
    expect(body.state).toEqual({ task_context: "task" })
    expect(body.questions).toEqual({
      sensitive: { type: "noul", instructions: expect.stringContaining(organizationPrompt) },
      personal_sensitive: { type: "noul", instructions: expect.stringContaining(personalPrompt) },
    })
    expect(body.questions.sensitive.instructions).not.toContain(personalPrompt)
    expect(body.questions.personal_sensitive.instructions).not.toContain(organizationPrompt)
  })

  it.each([
    ["the organization detects sensitive data despite a personal negative", { sensitive: positive, personal_sensitive: negative }],
    ["the personal criteria detect sensitive data", { sensitive: negative, personal_sensitive: positive }],
    ["the personal result is uncertain", { sensitive: negative, personal_sensitive: { type: "noul", noul: 0.1 } }],
    ["the personal answer is missing", { sensitive: negative }],
    ["the personal answer is invalid", { sensitive: negative, personal_sensitive: { type: "choice", noul: 0 } }],
    ["the built-in answer is missing", { personal_sensitive: negative }],
  ])("requires local handling when %s", async (_reason, answers) => {
    const service = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ answers }))
    expect(await maySendToExternalModel({ ...model, personalPrompt }, "task", undefined, service)).toBe(false)
  })

  it("asks about declared sensitive work before the data arrives", async () => {
    const context = JSON.stringify({ input: [{ role: "user", content: "注意我要处理铭感数据了" }] })
    const service = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ answers: { sensitive: { type: "noul", noul: 0.82 } } }),
    )

    expect(await maySendToExternalModel(model, context, undefined, service)).toBe(false)
    expect(JSON.parse(String(service.mock.calls[0]?.[1]?.body))).toMatchObject({
      state: { task_context: context },
      questions: {
        sensitive: {
          instructions: expect.stringContaining(
            "the user says that this task will handle sensitive or private data, even if those data have not been supplied yet",
          ),
        },
      },
    })
  })

  it.each([
    { answers: { sensitive: { type: "noul", noul: 0.99 } } },
    { answers: { sensitive: { type: "noul", noul: 0.35 } } },
    { answers: { sensitive: { type: "noul", noul: -1 } } },
    { answers: { sensitive: { type: "noul", noul: false } } },
    { answers: {} },
  ])("routes locally for a positive, uncertain or malformed answer", async (payload) => {
    expect(await maySendToExternalModel(model, "task", undefined,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload)))).toBe(false)
  })

  it("routes locally when the server is down or the request is cancelled", async () => {
    const signal = AbortSignal.abort()
    const service = vi.fn<typeof fetch>().mockRejectedValue(new Error("unavailable"))
    expect(await maySendToExternalModel(model, "task", signal, service)).toBe(false)
    expect(service.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it("rejects large and non-success replies", async () => {
    for (const response of [new Response(null, { status: 503 }), new Response(" ".repeat(70_000))]) {
      expect(await maySendToExternalModel(model, "task", undefined,
        vi.fn<typeof fetch>().mockResolvedValue(response))).toBe(false)
    }
  })
})
