import {
  webSiteListToolSchema,
  webSitePublishToolSchema,
  webSiteToolPageSchema,
  webSiteToolRequestSchema,
  webSiteUpdateToolSchema,
  webSiteWithUrlSchema,
  webSiteBackendPrepareSchema,
  webSiteBackendConfigureSchema,
  webSiteBackendInspectSchema,
  webSiteBackendSchema,
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
  toolNames: ["publish_web_site", "list_web_sites", "update_web_site", "prepare_web_site_backend", "configure_web_site_backend", "inspect_web_site_backend"],
  create({ environment, fetch: fetcher = globalThis.fetch }) {
    return {
      key: "web_site",
      tools: [publishTool, listTool, updateTool, prepareBackendTool, configureBackendTool, inspectBackendTool],
      async callTool(input) {
        try {
          const request = input.toolName === "publish_web_site"
            ? { operation: "publish" as const, ...webSitePublishToolSchema.parse(input.argumentsValue) }
            : input.toolName === "update_web_site"
              ? { operation: "update" as const, ...webSiteUpdateToolSchema.parse(input.argumentsValue) }
              : input.toolName === "prepare_web_site_backend"
                ? { operation: "prepare_backend" as const, ...webSiteBackendPrepareSchema.parse(input.argumentsValue) }
              : input.toolName === "configure_web_site_backend"
                ? { operation: "configure_backend" as const, ...webSiteBackendConfigureSchema.parse(input.argumentsValue) }
              : input.toolName === "inspect_web_site_backend"
                ? { operation: "inspect_backend" as const, ...webSiteBackendInspectSchema.parse(input.argumentsValue) }
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
          if (request.operation === "prepare_backend" || request.operation === "inspect_backend") return successToolResult(webSiteBackendSchema.parse(result));
          if (request.operation === "configure_backend") return successToolResult(z.record(z.string(), z.unknown()).parse(result));
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
    "Publish a complete Web application from an HTML artifact registered in this ordinary conversation by register_artifact. Requires the user's request to publish or deliver a public link; choosing a delivery shape alone is insufficient. Prepare a self-hosted backend only for requested data capabilities. Pass its ready backend_id for a new dynamic app or to add a backend to an existing static site_id, together with the new file_id. Existing backends cannot be replaced. Returns the stable public URL, preserving site identity, aliases and publication status on updates. New sites require name and optionally description and slug. LinkSense AI, tasks, knowledge, plugins or organization sharing use the interactive application builder.",
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
    "Update an owned Web application's name, description, slug, or published status without changing its content. The stable application URL and retired aliases remain usable after renaming. Unpublishing closes the stable entry, aliases, resources and backend gateway.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteUpdateToolSchema)),
};

const prepareBackendTool: Tool = {
  name: "prepare_web_site_backend",
  description: "Prepare a self-hosted Appwrite backend for requested data capabilities in the current conversation without publishing it. New backends return runtime_mode sandbox, an optional main-domain /app/ alias and sdk_url; use the sandbox SDK. The publishing result supplies the stable application URL. Reuse an existing backend_id; do not create a replacement. Repeating a name in the same task reuses the backend. Existing backends retain their runtime. No credentials are returned.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteBackendPrepareSchema)),
};
const configureBackendTool: Tool = {
  name: "configure_web_site_backend",
  description: "Configure an owned backend: create a table with row security and indexes, add optional columns, create a file bucket, create a Node.js 24 HTTP function, stage its registered .tar.gz artifact, explicitly activate a ready deployment, or inspect resource/build status. Tables and buckets default to private user-owned records; specify public reads only when requested. No credentials are returned. No destructive schema operations are supported. Builds are asynchronous and never activate automatically. Activate a ready deployment only as part of an authorized rollout; retain the previous deployment ID for recovery.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteBackendConfigureSchema)),
};
const inspectBackendTool: Tool = {
  name: "inspect_web_site_backend",
  description: "Read an owned dynamic application's stable public backend configuration without credentials. Use configure_web_site_backend with inspect to check tables, functions or native deployment status.",
  inputSchema: ToolSchema.shape.inputSchema.parse(z.toJSONSchema(webSiteBackendInspectSchema)),
};
