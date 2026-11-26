import {
  webSiteToolFailureSchema,
  webSiteToolInputs,
  webSiteToolRequestSchema,
  webSiteToolResultSchema,
} from "@linksense/shared"
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
  failureToolResult,
  requestBlockingCoreMcpBroker,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
} from "../core-service-module.js"

const toolNames = webSiteToolRequestSchema.options.map(schema => schema.shape.tool.value)
const nameSchema = z.enum(toolNames)
const siteLinkInstructions = "When the result contains a site, include its complete site.url in your final reply. For a published site, copy the Markdown link from the result. Use the exact URL as both the link text and target."
const descriptions: Record<keyof typeof webSiteToolInputs, string> = {
  list_sites: "List the current user's LinkSense sites across all tasks. Search by name or address slug, optionally filter by published or disabled, and use next_cursor to continue a paginated result. Use the returned site ID when calling a management tool.",
  publish_site: `Publish a registered HTML task artifact as a new public LinkSense site on the user's request. ${siteLinkInstructions} With no arguments, list existing HTML artifacts in the current task for source selection. Pass site with its file_id, name, optional description and optional slug to publish. Use a known artifact ID, or register new HTML with register_artifact first. Ask the user to choose if the source is ambiguous. Once the details are ready, use this call to show the required confirmation card and publish after approval. An existing result describes the site already linked to that artifact, and a cancelled result means publication was cancelled.`,
  update_site: `Update an owned site explicitly identified by the user. ${siteLinkInstructions} Resolve its unique site_id using list_sites or a verified earlier result. Pass changes containing name, description or slug to edit site information, or pass changes containing only a registered HTML file_id to create a new content version. A new version of a public site requires the built-in confirmation card. A disabled site keeps its unpublished status when saving a new version. With an address change, the former link stops working. If the site changes while awaiting confirmation, retrieve its current details before proposing the update again.`,
  unpublish_site: "Stop public access to an owned site explicitly identified by the user. Use a verified site_id from list_sites or an earlier result. Resolve ambiguous names with the user first. The site moves to disabled status and retains its address and saved versions.",
  delete_site: "Request permanent deletion of one owned site that the user explicitly asks to remove. Resolve a unique site_id using list_sites or an earlier result. Use request_user_form to disambiguate multiple matches. For the selected site, this call opens the required request_user_form approval card with its name, address and the impact of deletion. It deletes the site, its versions and reserved addresses only after the user approves that card. A cancelled result means the site was kept. If the outcome is uncertain, check the current list before trying again.",
}

const tools = toolNames.map(name => ({
  name,
  description: descriptions[name],
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteToolInputs[name], { io: "input" })),
  annotations: {
    readOnlyHint: name === "list_sites",
    destructiveHint: name === "delete_site" || name === "unpublish_site" || name === "update_site",
    idempotentHint: name === "list_sites",
    openWorldHint: name === "publish_site" || name === "update_site",
  },
}))

export const webSiteCoreMcpModule = {
  key: "web_sites",
  modes: ["default"],
  toolNames,
  create({ environment, fetch: fetcher = globalThis.fetch }) {
    return {
      key: "web_sites",
      tools,
      async callTool(input) {
        const name = nameSchema.safeParse(input.toolName)
        if (!name.success) return failureToolResult({ code: "VALIDATION_ERROR", retryable: false })
        const args = webSiteToolInputs[name.data].safeParse(input.argumentsValue ?? {})
        if (!args.success) return failureToolResult({ code: "VALIDATION_ERROR", retryable: false })
        const request = webSiteToolRequestSchema.parse({ ...args.data, tool: name.data })
        try {
          const endpoint = z.url().parse(environment.LINKSENSE_WEB_SITE_ENDPOINT)
          const token = z.string().min(32).parse(environment.LINKSENSE_WEB_SITE_TOKEN)
          const waitsForApproval = request.tool === "delete_site" ||
            (request.tool === "publish_site" && request.site !== undefined) ||
            (request.tool === "update_site" && "file_id" in request.changes)
          const options = {
            method: "POST",
            headers: { authorization: "Bearer " + token, "content-type": "application/json" },
            body: JSON.stringify(request),
            signal: waitsForApproval ? input.signal : withRequestTimeout(input.signal, 65_000),
          } as const
          const response = waitsForApproval && fetcher === globalThis.fetch
            ? await requestBlockingCoreMcpBroker(endpoint, options)
            : await fetcher(endpoint, options)
          const body: unknown = await response.json()
          if (!response.ok) {
            const failure = webSiteToolFailureSchema.safeParse(body)
            if (failure.success) return failureToolResult(failure.data)
            return failureToolResult({ code: "INTERNAL_ERROR", retryable: request.tool === "list_sites" })
          }
          const result = webSiteToolResultSchema.safeParse(body)
          if (result.success && result.data.tool === request.tool) {
            const data = result.data
            const output = successToolResult(data)
            if ((data.tool === "publish_site" || data.tool === "update_site") &&
                "site" in data && data.site.status === "published") {
              output.content.push({ type: "text", text: `<${data.site.url}>` })
            }
            return output
          }
        } catch (error) {
          if (input.signal.aborted) throw error
        }
        return failureToolResult({ code: "INTERNAL_ERROR", retryable: false })
      },
    }
  },
} satisfies CoreMcpModuleDefinition
