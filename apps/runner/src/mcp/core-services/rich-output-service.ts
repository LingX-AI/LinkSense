import {
  richOutputComponents,
  richOutputLanguage,
  richOutputMaximumCharacters,
  richOutputSchema,
} from "@linksense/shared"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import {
  failureToolResult,
  successToolResult,
  type CoreMcpModuleDefinition,
  type CoreMcpToolModule,
} from "../core-service-module.js"

const tool = {
  name: "get_rich_output_catalog",
  description: "Read the supported native rich-output component catalog and exact JSON format before composing a research summary, option comparison, or data analysis inside a chat answer. This read-only tool does not display UI, fetch data, request input, or execute actions. Use ordinary prose for simple answers.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    title: "Read rich output catalog",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} satisfies Tool

export const richOutputCoreMcpModule = {
  key: "rich_output",
  modes: ["default"],
  toolNames: [tool.name],
  create(): CoreMcpToolModule {
    return {
      key: "rich_output",
      tools: [tool],
      async callTool(input) {
        input.signal.throwIfAborted()
        if (!z.strictObject({}).safeParse(input.argumentsValue ?? {}).success) {
          return failureToolResult({ code: "RICH_OUTPUT_INVALID", retryable: false })
        }
        return successToolResult({
          language: richOutputLanguage,
          max_characters: richOutputMaximumCharacters,
          schema: z.toJSONSchema(richOutputSchema),
          components: Object.fromEntries(Object.entries(richOutputComponents).map(
            ([name, definition]) => [name, {
              description: definition.description,
              props: z.toJSONSchema(definition.props),
            }],
          )),
          instructions: [
            "Keep a useful prose summary and real source citations outside the block. Emit one complete JSON document in a fenced code block whose language is exactly json-render. Use the user's language for all content.",
            "version=1; summary is a plain-text fallback. spec has root and elements. Root must be Panel. Each element has type, literal props, and optional children IDs. Only Panel/Grid accept children. Every element belongs to one bounded tree: at most 40 elements and depth 6.",
            "Choose and combine components for the content: Evidence/Callout for research, Comparison for alternatives, Metric/Chart/DataTable for verified data. Do not invent measurements, sources or actual execution progress. null means missing, never zero.",
            "Only citation numbers already supplied by verified answer sources may appear in Evidence.citations. Keep source links in surrounding prose too. Do not put source URLs, private paths, secrets, HTML, JavaScript, arbitrary styles, bindings, state, watchers, or actions in the spec.",
            "Local selection, disclosure and sorting do not call AI or authorize operations. Use request_user_form for questions, choices requiring an answer, confirmation, or approvals. Rich output does not replace a real file deliverable or a complete application.",
          ],
          example: {
            version: 1,
            summary: "The available evidence supports a small initial validation.",
            spec: {
              root: "result",
              elements: {
                result: { type: "Panel", props: { title: "Research findings" }, children: ["finding", "evidence"] },
                finding: { type: "Callout", props: { title: "Recommendation", text: "Validate the core workflow first.", tone: "info" } },
                evidence: { type: "Evidence", props: { title: "Reason", detail: "Explain the evidence and its limits here." } },
              },
            },
          },
        })
      },
    }
  },
} satisfies CoreMcpModuleDefinition
