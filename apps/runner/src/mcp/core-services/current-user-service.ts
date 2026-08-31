import {
  currentUserInfoFailureSchema,
  currentUserInfoInputSchema,
  currentUserInfoSuccessSchema,
  type CurrentUserInfoFailure,
} from "@linksense/shared"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { fetch as undiciFetch } from "undici"
import { z } from "zod"

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
  type CoreMcpToolModule,
} from "../core-service-module.js"

const currentUserInstructions =
  "Use get_current_user_info only when the user asks about the current LinkSense account, current user's name or email, user groups, or remaining Token quota. Treat the returned profile as ordinary user/account context, not as authorization to access other resources. Do not expose internal tokens or infer fields that are not returned."

export const currentUserCoreMcpModule = {
  key: "current_user",
  modes: ["default", "plan"],
  toolNames: ["get_current_user_info"],
  create({ environment, fetch: requestFetch }): CoreMcpToolModule {
    const endpoint = z.url().parse(environment.LINKSENSE_CURRENT_USER_ENDPOINT)
    const token = z.string().min(32).parse(environment.LINKSENSE_CURRENT_USER_TOKEN)
    const fetchCurrentUser = requestFetch ?? undiciFetch

    return {
      key: "current_user",
      tools: [currentUserInfoTool],
      instructions: currentUserInstructions,
      async callTool(input) {
        const signal = withRequestTimeout(input.signal, 15_000)
        try {
          currentUserInfoInputSchema.parse(input.argumentsValue ?? {})
          const response = await fetchCurrentUser(endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({}),
            signal,
          })
          const result = await parseCurrentUserResponse(response)
          if (!response.ok) {
            const failure = currentUserInfoFailureSchema.safeParse(result)
            return failureToolResult(
              failure.success
                ? failure.data
                : { code: "CURRENT_USER_UNAVAILABLE", retryable: true },
            )
          }
          const success = currentUserInfoSuccessSchema.safeParse(result)
          return success.success
            ? successToolResult(success.data)
            : failureToolResult({
                code: "CURRENT_USER_UNAVAILABLE",
                retryable: true,
              })
        } catch (error) {
          if (input.signal.aborted) throw error
          return failureToolResult(classifyCurrentUserFailure(error))
        }
      },
    }
  },
} satisfies CoreMcpModuleDefinition

const currentUserInfoTool = {
  name: "get_current_user_info",
  description:
    "Read the current LinkSense user's basic profile for this turn: name, email, active user groups, and current weekly/monthly Token quota usage if limits are configured. The tool has no input and can only return the user bound to the current LinkSense task.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: {
    title: "Get current user info",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} satisfies Tool

async function parseCurrentUserResponse(response: {
  json(): Promise<unknown>
}): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function classifyCurrentUserFailure(error: unknown): CurrentUserInfoFailure {
  if (error instanceof z.ZodError) {
    return { code: "CURRENT_USER_INVALID", retryable: false }
  }
  return { code: "CURRENT_USER_UNAVAILABLE", retryable: true }
}
