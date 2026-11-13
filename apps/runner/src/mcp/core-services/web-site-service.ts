import {
  webSiteListToolSchema,
  webSitePublishToolSchema,
  webSiteToolPageSchema,
  webSiteToolRequestSchema,
  webSiteUpdateToolSchema,
  webSiteWithUrlSchema,
} from "@linksense/shared";
import { ToolSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { webSiteFailureSchema } from "../../web-site-error.js";
import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
} from "../core-service-module.js";

export const webSiteCoreMcpModule: CoreMcpModuleDefinition = {
  key: "web_site",
  modes: ["default"],
  toolNames: ["publish_web_site", "list_web_sites", "update_web_site"],
  create({ environment, fetch: fetcher = globalThis.fetch }) {
    return {
      key: "web_site",
      tools: [publishTool, listTool, updateTool],
      async callTool(input) {
        try {
          const request = input.toolName === "publish_web_site"
            ? { operation: "publish" as const, ...webSitePublishToolSchema.parse(input.argumentsValue) }
            : input.toolName === "update_web_site"
              ? { operation: "update" as const, ...webSiteUpdateToolSchema.parse(input.argumentsValue) }
              : { operation: "list" as const, ...webSiteListToolSchema.parse(input.argumentsValue) };
          const endpoint = z.url().parse(environment.LINKSENSE_WEB_SITE_ENDPOINT);
          const token = z.string().min(32).parse(environment.LINKSENSE_WEB_SITE_TOKEN);
          const response = await fetcher(endpoint, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(webSiteToolRequestSchema.parse(request)),
            signal: withRequestTimeout(input.signal, 60_000),
          });
          const result: unknown = await response.json();
          if (!response.ok) {
            const failure = webSiteFailureSchema.safeParse(result);
            return failureToolResult(failure.success ? failure.data : { code: "WEB_SITE_UNAVAILABLE", retryable: response.status >= 500 });
          }
          return successToolResult(request.operation === "list"
            ? webSiteToolPageSchema.parse(result)
            : webSiteWithUrlSchema.parse(result));
        } catch (error) {
          if (input.signal.aborted) throw error;
          return failureToolResult({
            code: error instanceof z.ZodError ? "WEB_SITE_INVALID" : "WEB_SITE_UNAVAILABLE",
            retryable: !(error instanceof z.ZodError),
          });
        }
      },
    };
  },
};

const publishTool: Tool = {
  name: "publish_web_site",
  description:
    "Publish a complete static website from an artifact registered by register_artifact. This creates or updates a public site at /web/<slug> that anyone can open without LinkSense login; it takes effect immediately. Pass the file_id returned by register_artifact. For a new site, also pass a name and optionally description and slug. To publish a new release of an existing site, pass site_id and file_id; the slug stays the same. Returns the public URL. Do not use for applications that need LinkSense tasks, AI, knowledge, files, plugins, or organization sharing.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSitePublishToolSchema)),
};

const listTool: Tool = {
  name: "list_web_sites",
  description:
    "List the current user's public sites, optionally filtered by search text or status. Use this to find a site before publishing an update from a later task.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteListToolSchema)),
};

const updateTool: Tool = {
  name: "update_web_site",
  description:
    "Update an existing public site's name, description, slug, or published status without changing its content. Changing the slug immediately invalidates the old link.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteUpdateToolSchema)),
};
