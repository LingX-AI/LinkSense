import { describe, expect, it, vi } from "vitest"

import {
  coreMcpModuleRegistry,
  coreMcpToolNamesFor,
  createCoreMcpRegistry,
} from "../src/mcp/core-service-registry.js"

const conversationId = "01900000-0000-7000-8000-000000000001"
const token = "turn-token-00000000000000000000000000000000"

describe("Core MCP module registry", () => {
  it.each(["default", "plan"] as const)("makes knowledge tools available without input-box selection in %s mode", (mode) => {
    const registry = createCoreMcpRegistry({ mode, environment: defaultEnvironment() })
    for (const name of ["search_knowledge_base", "list_knowledge_documents"]) {
      const description = registry.tools.find((tool) => tool.name === name)?.description
      expect(description).toContain("including unselected bases")
      expect(description).toContain("Input-box selection expresses focus, not access permission")
    }
    const read = registry.tools.find((tool) => tool.name === "get_knowledge_document_markdown")
    expect(read?.description).toContain("whether or not its knowledge base was selected")
    expect(read?.description).toContain("Authorization is checked on every call")
  })

  it("registers all ordinary built-in services in Default mode", () => {
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: defaultEnvironment(),
      workspaceRoot: "/tmp/linksense-core-registry-test",
    })

    expect(coreMcpModuleRegistry.map((module) => module.key)).toEqual([
      "file_service",
      "document_conversion",
      "current_user",
      "image_generation",
      "knowledge",
      "interactive_form",
      "skill_creator",
    ])
    expect(registry.modules.map((module) => module.key)).toEqual([
      "file_service",
      "document_conversion",
      "current_user",
      "image_generation",
      "knowledge",
      "interactive_form",
      "skill_creator",
    ])
    expect(registry.tools.map((tool) => tool.name)).toEqual(
      coreMcpToolNamesFor("default"),
    )
    expect(
      registry.tools.find((tool) => tool.name === "emit_application_event")
        ?.inputSchema,
    ).toMatchObject({
      properties: { payload: { type: "object" } },
    })
  })

  it("loads only read-only modules in Plan mode", () => {
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: {
        LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT:
          "http://127.0.0.1:4000/search",
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
        LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
        LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
        LINKSENSE_FORM_SERVICE_TOKEN: token,
        LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
        LINKSENSE_CURRENT_USER_TOKEN: token,
      },
    })

    expect(registry.modules.map((module) => module.key)).toEqual([
      "document_conversion",
      "current_user",
      "knowledge",
      "interactive_form",
    ])
    expect(registry.tools.map((tool) => tool.name)).toEqual([
      "convert_document_to_markdown",
      "get_current_user_info",
      "search_knowledge_base",
      "list_knowledge_documents",
      "get_knowledge_document_markdown",
      "request_user_form",
      "emit_application_event",
    ])
    expect(registry.tools.map((tool) => tool.name)).toEqual(
      coreMcpToolNamesFor("plan"),
    )
    expect(
      registry.tools.find((tool) => tool.name === "request_user_form")
        ?.annotations,
    ).toEqual({
      title: "Request user form input",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
  })

  it.each(["default", "plan"] as const)(
    "directs confirmation and feedback to forms without an explicit form request in %s mode",
    (mode) => {
      const registry = createCoreMcpRegistry({
        mode,
        environment: defaultEnvironment(),
      })
      const tool = registry.tools.find(
        (candidate) => candidate.name === "request_user_form",
      )

      for (const instructions of [registry.instructions, tool?.description]) {
        expect(instructions).toContain(
          "user confirmation, clarification, a choice, missing information, or feedback",
        )
        expect(instructions).toContain(
          "even for a single question or a yes/no decision",
        )
        expect(instructions).toContain(
          "the user does not need to ask for a form",
        )
      }
      expect(registry.instructions).toContain(
        "Use single_select for mutually exclusive choices and textarea for open-ended feedback",
      )
      expect(registry.instructions).toContain(
        "Write the message, labels, descriptions, and options in the user's language",
      )
      expect(registry.instructions).toContain(
        "Do not substitute Markdown, numbered questions, plain-text questions, or html-preview",
      )
    },
  )

  it("blocks on the LinkSense form broker and returns the response to the model", async () => {
    const request = formBrokerFetch({
      action: "accept",
      content: {
        title: "季度复盘",
        publish_at: "2026-08-15T09:30:00.000Z",
        channels: ["email", "teams"],
        expected_attendees: 12,
      },
    })
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: {
        LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT:
          "http://127.0.0.1:4000/search",
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
        LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
        LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
        LINKSENSE_FORM_SERVICE_TOKEN: token,
        LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
        LINKSENSE_CURRENT_USER_TOKEN: token,
      },
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "request_user_form",
      argumentsValue: {
        message: "请确认发布信息",
        fields: [
          {
            id: "title",
            label: "标题",
            control: "textarea",
            required: true,
            max_length: 500,
          },
          {
            id: "publish_at",
            label: "发布时间",
            control: "date_time",
            required: true,
          },
          {
            id: "channels",
            label: "渠道",
            control: "multi_select",
            required: true,
            options: [
              { value: "email", label: "邮件" },
              { value: "teams", label: "Teams" },
            ],
          },
          {
            id: "expected_attendees",
            label: "预计人数",
            control: "number",
            integer: true,
            minimum: 1,
            maximum: 100,
            placeholder: "1～100",
          },
        ],
      },
      signal: new AbortController().signal,
    })

    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/form",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(formBrokerBody(request)).toEqual(
      expect.objectContaining({
        message: "请确认发布信息",
        requestedSchema: expect.objectContaining({
          type: "object",
          required: ["title", "publish_at", "channels"],
        }),
        uiHints: {
          title: { control: "textarea" },
          expected_attendees: {
            control: "number",
            placeholder: "1～100",
          },
        },
        responseSemantics: { kind: "input" },
      }),
    )
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            action: "accept",
            content: {
              title: "季度复盘",
              publish_at: "2026-08-15T09:30:00.000Z",
              channels: ["email", "teams"],
              expected_attendees: 12,
            },
          }),
        },
      ],
      isError: false,
    })
  })

  it("emits only explicit interactive application business events", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ accepted: true, event_id: conversationId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: {
        ...defaultEnvironment(),
        LINKSENSE_FORM_SERVICE_ENDPOINT:
          "http://127.0.0.1:4000/form/request",
      },
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "emit_application_event",
      argumentsValue: {
        name: "research.section_ready",
        payload: { title: "Market overview" },
      },
      signal: new AbortController().signal,
    })

    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/form/event",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "research.section_ready",
          payload: { title: "Market overview" },
        }),
      }),
    )
    expect(result.isError).toBe(false)
  })

  it("normalizes a model-generated JSON object string before emitting an application event", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ accepted: true, event_id: conversationId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: {
        ...defaultEnvironment(),
        LINKSENSE_FORM_SERVICE_ENDPOINT:
          "http://127.0.0.1:4000/form/request",
      },
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "emit_application_event",
      argumentsValue: {
        name: "research.section_ready",
        payload: JSON.stringify({ title: "Market overview" }),
      },
      signal: new AbortController().signal,
    })

    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/form/event",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "research.section_ready",
          payload: { title: "Market overview" },
        }),
      }),
    )
    expect(result.isError).toBe(false)
  })

  it("allows an explicit external-side-effect approval decision", async () => {
    const request = formBrokerFetch({
      action: "accept",
      content: { approval_decision: "approve" },
    })
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: defaultEnvironment(),
      fetch: request,
    })
    const tool = registry.tools.find(
      (candidate) => candidate.name === "request_user_form"
    )

    expect(registry.instructions).toContain("Set purpose=approval")
    expect(registry.instructions).toContain(
      "whenever the user explicitly asks for an interactive form"
    )
    expect(registry.instructions).toContain(
      "The explicit request alone is sufficient, including for a one-field form"
    )
    expect(registry.instructions).toContain(
      "Do not substitute Markdown, numbered questions, plain-text questions"
    )
    expect(registry.instructions).toContain(
      "Never claim that an interactive form was displayed unless request_user_form was actually called successfully"
    )
    expect(registry.instructions).toContain(
      "Form submission by itself, cancellation, rejection, or missing input is not approval"
    )
    expect(tool?.description).toContain(
      "purpose=approval with an exact required two-option decision mapping"
    )
    expect(tool?.description).toContain(
      "that explicit request is sufficient even for one field"
    )
    expect(tool?.description).toContain(
      "never claim that a form was displayed unless this tool call succeeded"
    )

    const result = await registry.callTool({
      toolName: "request_user_form",
      argumentsValue: {
        message:
          "创建一个 ManageBac 作业草稿，不发布作业，也不发送学生或家长通知。",
        purpose: "approval",
        approval: {
          decision_field_id: "approval_decision",
          approve_value: "approve",
          reject_value: "reject",
        },
        fields: [
          {
            id: "approval_decision",
            label: "是否批准创建草稿",
            control: "single_select",
            required: true,
            options: [
              { value: "approve", label: "批准创建草稿" },
              { value: "reject", label: "拒绝" },
            ],
          },
        ],
      },
      signal: new AbortController().signal,
    })

    expect(formBrokerBody(request)).toEqual(
      expect.objectContaining({
        requestedSchema: expect.objectContaining({
          required: ["approval_decision"],
          properties: {
            approval_decision: expect.objectContaining({
              oneOf: [
                { const: "approve", title: "批准创建草稿" },
                { const: "reject", title: "拒绝" },
              ],
            }),
          },
        }),
        responseSemantics: {
          kind: "approval",
          decision_field_id: "approval_decision",
          approve_value: "approve",
          reject_value: "reject",
        },
      }),
    )
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            action: "accept",
            content: { approval_decision: "approve" },
          }),
        },
      ],
      isError: false,
    })
  })

  it("rejects an approval form without an explicit decision mapping", async () => {
    const request = formBrokerFetch({ action: "cancel" })
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: defaultEnvironment(),
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "request_user_form",
      argumentsValue: {
        message: "请确认是否创建草稿。",
        purpose: "approval",
        fields: [
          {
            id: "approval_decision",
            label: "审批决定",
            control: "single_select",
            required: true,
            options: [
              { value: "approve", label: "同意" },
              { value: "reject", label: "拒绝" },
            ],
          },
        ],
      },
      signal: new AbortController().signal,
    })

    expect(request).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true })
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          code: "INTERACTIVE_FORM_INVALID",
          retryable: true,
          details: [
            {
              path: "approval",
              reason: "approval_semantics_required",
            },
          ],
        }),
      },
    ])
  })

  it("drops an invalid optional default instead of rejecting the whole form", async () => {
    const request = formBrokerFetch({ action: "cancel" })
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: {
        LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT:
          "http://127.0.0.1:4000/search",
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
        LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
        LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
        LINKSENSE_FORM_SERVICE_TOKEN: token,
        LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
        LINKSENSE_CURRENT_USER_TOKEN: token,
      },
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "request_user_form",
      argumentsValue: {
        message: "请选择渠道",
        fields: [
          {
            id: "channels",
            label: "渠道",
            control: "multi_select",
            options: [
              { value: "email", label: "邮件" },
              { value: "teams", label: "Teams" },
            ],
            default: ["sms"],
          },
        ],
      },
      signal: new AbortController().signal,
    })

    expect(formBrokerBody(request)).toEqual(
      expect.objectContaining({
        requestedSchema: expect.objectContaining({
          properties: {
            channels: expect.not.objectContaining({ default: expect.anything() }),
          },
        }),
      }),
    )
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({ action: "cancel", content: null }),
        },
      ],
      isError: false,
    })
  })

  it("returns retryable field-level details for a structural validation error", async () => {
    const request = formBrokerFetch({ action: "cancel" })
    const registry = createCoreMcpRegistry({
      mode: "plan",
      environment: {
        LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT:
          "http://127.0.0.1:4000/search",
        LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
        LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
        LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
        LINKSENSE_FORM_SERVICE_TOKEN: token,
        LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
        LINKSENSE_CURRENT_USER_TOKEN: token,
      },
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "request_user_form",
      argumentsValue: {
        message: "请输入预计人数",
        fields: [
          {
            id: "expected_attendees",
            label: "预计人数",
            control: "number",
            minimum: 100,
            maximum: 1,
          },
        ],
      },
      signal: new AbortController().signal,
    })

    expect(request).not.toHaveBeenCalled()
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          code: "INTERACTIVE_FORM_INVALID",
          retryable: true,
          details: [
            {
              path: "fields.0",
              reason: "minimum_exceeds_maximum",
            },
          ],
        }),
      },
    ])
  })

  it("rejects credential collection before opening a user form", async () => {
    const request = formBrokerFetch({ action: "cancel" })
    const registry = createCoreMcpRegistry({
      mode: "default",
      environment: defaultEnvironment(),
      fetch: request,
    })

    const result = await registry.callTool({
      toolName: "request_user_form",
      argumentsValue: {
        message: "请输入 API Key 以继续",
        fields: [{ id: "api_key", label: "API Key", control: "text" }],
      },
      signal: new AbortController().signal,
    })

    expect(request).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true })
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          code: "INTERACTIVE_FORM_INVALID",
          retryable: false,
          details: [
            {
              path: "fields",
              reason: "sensitive_field_forbidden",
            },
          ],
        }),
      },
    ])
  })
})

function defaultEnvironment(): NodeJS.ProcessEnv {
  return {
    LINKSENSE_COLLABORATION_MODE: "default",
    LINKSENSE_CONVERSATION_ID: conversationId,
    LINKSENSE_FILE_SERVICE_ENDPOINT:
      "http://127.0.0.1:4000/register-artifact",
    LINKSENSE_FILE_SERVICE_TOKEN: token,
    LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:4000/form",
    LINKSENSE_FORM_SERVICE_TOKEN: token,
    LINKSENSE_IMAGE_GENERATION_ENDPOINT:
      "http://127.0.0.1:4000/generate",
    LINKSENSE_IMAGE_GENERATION_TOKEN: token,
    LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT:
      "http://127.0.0.1:4000/search",
    LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
    LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
    LINKSENSE_SKILL_CREATOR_ENDPOINT: "http://127.0.0.1:4000/skill",
    LINKSENSE_SKILL_CREATOR_TOKEN: token,
    LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:4000/current-user",
    LINKSENSE_CURRENT_USER_TOKEN: token,
  }
}

function formBrokerFetch(
  response:
    | { action: "accept"; content: Record<string, unknown> }
    | { action: "decline" | "cancel" },
) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  )
}

function formBrokerBody(request: ReturnType<typeof formBrokerFetch>) {
  const body = request.mock.calls[0]?.[1]?.body
  if (typeof body !== "string") throw new Error("form broker body is missing")
  return JSON.parse(body) as unknown
}
