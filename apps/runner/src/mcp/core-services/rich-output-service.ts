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
  description: "Read the supported native rich-output component catalog and exact JSON format before composing a research summary, option comparison, metadata, timeline, step-by-step guide, image gallery, file list, or data analysis inside a chat answer. This read-only tool does not display UI, fetch data, request input, or execute actions. Use ordinary prose for simple answers.",
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
            "version=1; summary is a plain-text fallback. spec has root and elements. Root must be Panel. Each element has type, literal props, and optional children IDs. Only Panel, Grid, Tabs and Details accept children. Every element belongs to one bounded tree: at most 40 elements and depth 6.",
            "When a reader needs to see a trend and check the exact monthly values, use Chart and DataTable from the same supplied data. Use null for missing numeric values and preserve real zeros. For a decision between a few options, put the recommendation and hard constraints in prose and use Comparison to explore each option's tradeoffs. Evidence can explain why a source supports or limits a claim. Do not invent measurements, sources or execution progress.",
            "Use KeyValue for labelled metadata, Timeline for events with known time precision, and Steps for ordered instructions or a proposed plan. Keep short answers in prose. Timeline/Steps never report native task progress or execute their entries.",
            "Use Tabs for distinct views of one result and Details for optional material. Tabs.tabs IDs must match children IDs in the same order; use Grid when one tab needs several child blocks. Details needs at least one child. Keep conclusions and important risks visible. Use Checklist only for temporary reader checkmarks; never pre-check or require them as an answer.",
            "Use multiple Chart.series with points[].values only for comparable series with the same unit; stacked=true is only for bars. Use Metric.period and comparison with a verified signed change and a named baseline. DataTable column types are optional; date requires YYYY-MM-DD, numbers must be raw numbers, and filterable only filters the supplied snapshot.",
            "When the reader needs to compare images side by side, use MediaGallery instead of putting images in a Markdown table. For example, present two cover variants in MediaGallery and the accompanying brief in ResourceList, under the same Panel. Use only already registered artifacts; images and files need not be regenerated or registered again for presentation.",
            "Use MediaGallery for 1–12 image artifacts and ResourceList for 1–20 file artifacts already registered in this conversation. items[].fileId must be the returned file_id from register_artifact or generate_image, never artifact_id, an attachment ID, a guessed UUID, a path, URL or base64. If you do not know the file_id, keep the original delivery link. Keep the normal final-delivery Markdown links required by those tools. The same files are not repeated as automatic cards while a rich resource component is mounted.",
            "ResourceList.label/detail and MediaGallery.alt/caption are plain-language descriptions, not trusted file metadata. Private filenames, sizes and preview/download access come only from existing authorized conversation records. Copy and text-only shares retain these descriptions without resource IDs, actual filenames, sizes or access links. Describe unavailable resources in prose without inventing replacements.",
            "Keep real knowledge citation markers and source links in the surrounding Markdown. Evidence.citations accepts only numeric references to the answer's actual knowledge citations, not search result ranks or source handles. LinkSense numbers distinct cited passages in order of first use, starting at 1. If you cannot identify the number, omit it and keep the source in the prose. The UI resolves document names and locations from the citation record. Never put source URLs, handles, private paths, secrets, HTML, JavaScript, arbitrary styles, bindings, state, watchers, or actions in the spec.",
            "Local selection, disclosure, checkmarks, filtering and sorting do not call AI or authorize operations. Use request_user_form for questions, choices requiring an answer, confirmation, or approvals. Rich output does not replace a real file deliverable or a complete application.",
          ],
          example: {
            version: 1,
            summary: "The available evidence supports a small initial validation.",
            spec: {
              root: "result",
              elements: {
                result: { type: "Panel", props: { title: "Research findings" }, children: ["finding", "views"] },
                finding: { type: "Callout", props: { title: "Recommendation", text: "Validate the core workflow first.", tone: "info" } },
                views: { type: "Tabs", props: { title: "More about the recommendation", tabs: [
                  { id: "evidence", label: "Evidence" }, { id: "preparation", label: "Preparation" },
                ] }, children: ["evidence", "preparation"] },
                evidence: { type: "Evidence", props: { title: "Reason", detail: "Explain the evidence and its limits here." } },
                preparation: { type: "Details", props: { title: "Before you start" }, children: ["checks"] },
                checks: { type: "Checklist", props: { title: "Preparation checklist", items: [
                  { id: "inspect", label: "Check the source data" },
                  { id: "validate", label: "Choose a representative test case" },
                ] } },
              },
            },
          },
        })
      },
    }
  },
} satisfies CoreMcpModuleDefinition
