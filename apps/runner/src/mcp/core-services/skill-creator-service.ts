import {
  skillCreatorInstallResultSchema,
  skillCreatorPreviewResultSchema,
} from "@linksense/shared"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
  type CoreMcpToolModule,
} from "../core-service-module.js"

const previewArgumentsSchema = z.strictObject({
  conversation_id: z.uuid().optional(),
  workspace_relative_path: z.string().min(1).max(2_000),
})
const installArgumentsSchema = z.strictObject({
  conversation_id: z.uuid().optional(),
  install_token: z.string().min(64).max(2_048),
})
const skillCreatorFailureSchema = z.object({
  code: z.enum([
    "SKILL_PACKAGE_INVALID",
    "SKILL_NAME_CONFLICT",
    "SKILL_INSTALL_PREVIEW_INVALID",
    "SKILL_INSTALL_CONFIRMATION_REQUIRED",
    "SKILL_INSTALL_SYNC_FAILED",
    "SKILL_CREATOR_FORBIDDEN",
    "SKILL_CREATOR_TURN_INACTIVE",
    "SKILL_CREATOR_UNAVAILABLE",
  ]),
  retryable: z.boolean(),
})

type SkillCreatorFailure = z.infer<typeof skillCreatorFailureSchema>

class SkillCreatorMcpError extends Error {
  constructor(readonly failure: SkillCreatorFailure) {
    super(failure.code)
    this.name = "SkillCreatorMcpError"
  }
}

export const skillCreatorCoreMcpModule = {
  key: "skill_creator",
  modes: ["default"],
  toolNames: ["preview_skill_zip", "install_skill"],
  create({ environment }): CoreMcpToolModule {
    const endpoint = z
      .url()
      .parse(environment.LINKSENSE_SKILL_CREATOR_ENDPOINT)
    const token = z
      .string()
      .min(32)
      .parse(environment.LINKSENSE_SKILL_CREATOR_TOKEN)
    const conversationId = z
      .uuid()
      .parse(environment.LINKSENSE_CONVERSATION_ID)

    return {
      key: "skill_creator",
      tools: [previewTool, installTool],
      async callTool(input) {
        try {
          if (input.toolName === "preview_skill_zip") {
            const arguments_ = previewArgumentsSchema.parse(
              input.argumentsValue,
            )
            assertConversation(arguments_.conversation_id, conversationId)
            const result = await postJson({
              endpoint,
              token,
              operation: "preview",
              body: {
                workspaceRelativePath: arguments_.workspace_relative_path,
              },
              signal: input.signal,
            })
            return successToolResult(
              skillCreatorPreviewResultSchema.parse(result),
            )
          }
          const arguments_ = installArgumentsSchema.parse(input.argumentsValue)
          assertConversation(arguments_.conversation_id, conversationId)
          const result = await postJson({
            endpoint,
            token,
            operation: "confirm",
            body: { installToken: arguments_.install_token },
            signal: input.signal,
          })
          return successToolResult(skillCreatorInstallResultSchema.parse(result))
        } catch (error) {
          if (input.signal.aborted) throw error
          return failureToolResult(classifyFailure(error))
        }
      },
    }
  },
} satisfies CoreMcpModuleDefinition

function assertConversation(
  requested: string | undefined,
  conversationId: string,
): void {
  if (requested && requested !== conversationId) {
    throw new SkillCreatorMcpError({
      code: "SKILL_CREATOR_FORBIDDEN",
      retryable: false,
    })
  }
}

async function postJson(input: {
  endpoint: string
  token: string
  operation: "preview" | "confirm"
  body: unknown
  signal: AbortSignal
}): Promise<unknown> {
  const response = await fetch(`${input.endpoint}/${input.operation}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: withRequestTimeout(input.signal, 30_000),
  })
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw unavailable()
  }
  if (!response.ok) {
    const failure = skillCreatorFailureSchema.safeParse(result)
    if (!failure.success) throw unavailable()
    throw new SkillCreatorMcpError(failure.data)
  }
  return result
}

function classifyFailure(error: unknown): SkillCreatorFailure {
  if (error instanceof SkillCreatorMcpError) return error.failure
  if (error instanceof z.ZodError) {
    return { code: "SKILL_PACKAGE_INVALID", retryable: false }
  }
  return unavailable().failure
}

function unavailable(): SkillCreatorMcpError {
  return new SkillCreatorMcpError({
    code: "SKILL_CREATOR_UNAVAILABLE",
    retryable: true,
  })
}

const previewTool = {
  name: "preview_skill_zip",
  description:
    "Validate and risk-scan one Skill ZIP from artifacts/. This creates an expiring preview and never installs the Skill.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", format: "uuid" },
      workspace_relative_path: { type: "string" },
    },
    required: ["workspace_relative_path"],
    additionalProperties: false,
  },
} satisfies Tool

const installTool = {
  name: "install_skill",
  description:
    "Install the exact Skill preview represented by an opaque install token. A preview with no risks may be installed immediately when the user requested installation. A risky preview requires explicit user approval, including an approved request_user_form response in the same turn.",
  inputSchema: {
    type: "object",
    properties: {
      conversation_id: { type: "string", format: "uuid" },
      install_token: { type: "string" },
    },
    required: ["install_token"],
    additionalProperties: false,
  },
} satisfies Tool
