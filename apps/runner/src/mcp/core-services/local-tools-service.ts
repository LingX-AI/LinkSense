import {
  desktopCloudToolDataSchemaFor,
  desktopCloudToolErrorCodeSchema,
  desktopCloudToolInputSchemaFor,
  localFilesCreateOperation,
  localFilesDeleteOperation,
  localFilesListOperation,
  localFilesReadOperation,
  localFilesRootsOperation,
  localFilesSearchOperation,
  localFilesToolNames,
  localComputerActOperation,
  localComputerExtendedOperation,
  localComputerObserveOperation,
  localComputerPauseOperation,
  localComputerResumeOperation,
  localComputerSelectOperation,
  localComputerStatusOperation,
  localComputerStopOperation,
  localComputerToolNames,
  localComputerWaitOperation,
  localFilesWriteOperation,
  localToolsPingOperation,
  localToolsPingToolName,
  type DesktopCloudToolOperation,
} from "@linksense/shared";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
} from "../core-service-module.js";

const rootId = { type: "string", format: "uuid" } as const;
const relativePath = { type: "string", minLength: 1, maxLength: 4096 } as const;
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" } as const;

const localToolSpecs = [
  {
    name: localToolsPingToolName,
    operation: localToolsPingOperation,
    tool: {
      name: localToolsPingToolName,
      description:
        "Check the local tool lane on the signed-in Mac. Returns the Mac platform and app version and echoes a short message. The Mac must be online and the task must have local tools enabled; otherwise the call fails closed. This read-only check changes nothing on the Mac.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string", minLength: 1, maxLength: 200 } },
        required: ["message"],
        additionalProperties: false,
      },
      annotations: {
        title: "Check local tools",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.roots,
    operation: localFilesRootsOperation,
    tool: {
      name: localFilesToolNames.roots,
      description:
        "List the local folders this task may use on the Mac. Each root has an id, alias, and mode (read or write). Call this before other local_files tools; absolute folder paths are never exposed.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        title: "List shared folders",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.list,
    operation: localFilesListOperation,
    tool: {
      name: localFilesToolNames.list,
      description:
        "List entries under a granted local folder on the Mac. root_id comes from the task's local folder grants; path is relative to that root. Omit path to list the root. Directories are listed without following symlinks.",
      inputSchema: {
        type: "object",
        properties: {
          root_id: rootId,
          path: relativePath,
          limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
        },
        required: ["root_id"],
        additionalProperties: false,
      },
      annotations: {
        title: "List local folder",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.read,
    operation: localFilesReadOperation,
    tool: {
      name: localFilesToolNames.read,
      description:
        "Read a text file under a granted local folder on the Mac. Binary files return metadata only. Reads are bounded by max_bytes; a larger file returns its first max_bytes with truncated=true and no digest. An untruncated text read returns a SHA-256 digest for later conflict-checked writes.",
      inputSchema: {
        type: "object",
        properties: {
          root_id: rootId,
          path: relativePath,
          max_bytes: { type: "integer", minimum: 1, maximum: 1048576, default: 262144 },
        },
        required: ["root_id", "path"],
        additionalProperties: false,
      },
      annotations: {
        title: "Read local file",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.search,
    operation: localFilesSearchOperation,
    tool: {
      name: localFilesToolNames.search,
      description:
        "Search text files under a granted local folder on the Mac. Results are bounded and large dependency directories such as .git and node_modules are skipped. Returns relative paths, line and column.",
      inputSchema: {
        type: "object",
        properties: {
          root_id: rootId,
          path: relativePath,
          query: { type: "string", minLength: 1, maxLength: 200 },
          max_results: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
        required: ["root_id", "query"],
        additionalProperties: false,
      },
      annotations: {
        title: "Search local folder",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.write,
    operation: localFilesWriteOperation,
    tool: {
      name: localFilesToolNames.write,
      description:
        "Write a text file under a write-granted local folder on the Mac. An existing file must be read first: pass its digest as expected_digest or the write is rejected with DESKTOP_FILE_CONFLICT. A changed file also returns that conflict and is never overwritten. Set create_parents only when the parent folder should be created.",
      inputSchema: {
        type: "object",
        properties: {
          root_id: rootId,
          path: relativePath,
          content: { type: "string", maxLength: 1048576 },
          expected_digest: { anyOf: [digest, { type: "null" }] },
          create_parents: { type: "boolean", default: false },
        },
        required: ["root_id", "path", "content"],
        additionalProperties: false,
      },
      annotations: {
        title: "Write local file",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.create,
    operation: localFilesCreateOperation,
    tool: {
      name: localFilesToolNames.create,
      description:
        "Create a file or directory under a write-granted local folder on the Mac. Fails when the target already exists. For files the optional content is written once.",
      inputSchema: {
        type: "object",
        properties: {
          root_id: rootId,
          path: relativePath,
          kind: { type: "string", enum: ["file", "directory"] },
          content: { type: "string", maxLength: 1048576 },
        },
        required: ["root_id", "path", "kind"],
        additionalProperties: false,
      },
      annotations: {
        title: "Create local entry",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  },
  {
    name: localFilesToolNames.delete,
    operation: localFilesDeleteOperation,
    tool: {
      name: localFilesToolNames.delete,
      description:
        "Move a file or folder under a write-granted local folder to the macOS Trash. Pass expected_digest from an earlier read to avoid deleting an externally changed file. The root itself cannot be deleted.",
      inputSchema: {
        type: "object",
        properties: {
          root_id: rootId,
          path: relativePath,
          expected_digest: { anyOf: [digest, { type: "null" }] },
        },
        required: ["root_id", "path"],
        additionalProperties: false,
      },
      annotations: {
        title: "Trash local entry",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
  },
  {
    name: localComputerToolNames.status,
    operation: localComputerStatusOperation,
    tool: {
      name: localComputerToolNames.status,
      description:
        "Report macOS Accessibility permission, the agent-desktop version, and the current five-minute window selection on the Mac. Call this before selecting a window.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Desktop status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.select,
    operation: localComputerSelectOperation,
    tool: {
      name: localComputerToolNames.select,
      description:
        "Ask the Mac user to choose one window with the native picker. Only the returned selection_id crosses the lane; the window title, app and bundle stay on the Mac. The selection expires after five minutes and can be paused, resumed or stopped.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { title: "Select a Mac window", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.observe,
    operation: localComputerObserveOperation,
    tool: {
      name: localComputerToolNames.observe,
      description:
        "Read the accessibility tree of the selected Mac window. Returns an observation_id and refs for the current controls; values and descriptions stay on the Mac.",
      inputSchema: {
        type: "object",
        properties: { selection_id: rootId },
        required: ["selection_id"],
        additionalProperties: false,
      },
      annotations: { title: "Observe the Mac window", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.act,
    operation: localComputerActOperation,
    tool: {
      name: localComputerToolNames.act,
      description:
        "Click or type into a ref from the latest observation of the selected Mac window. The ref must belong to that observation; one act is admitted at a time and the result reports whether the UI changed.",
      inputSchema: {
        type: "object",
        properties: {
          selection_id: rootId,
          action: { type: "string", enum: ["click", "type"] },
          observation_id: { type: "string" },
          ref: { type: "string" },
          text: { type: "string", maxLength: 8000 },
          timeout_ms: { type: "integer", minimum: 100, maximum: 20000, default: 8000 },
        },
        required: ["selection_id", "action", "observation_id", "ref"],
        additionalProperties: false,
      },
      annotations: { title: "Act on the Mac window", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.wait,
    operation: localComputerWaitOperation,
    tool: {
      name: localComputerToolNames.wait,
      description:
        "Wait until a ref from the latest observation becomes actionable, up to the bounded timeout. This is a read-only wait on the selected Mac window.",
      inputSchema: {
        type: "object",
        properties: {
          selection_id: rootId,
          observation_id: { type: "string" },
          ref: { type: "string" },
          timeout_ms: { type: "integer", minimum: 100, maximum: 20000, default: 8000 },
        },
        required: ["selection_id", "observation_id", "ref"],
        additionalProperties: false,
      },
      annotations: { title: "Wait for the Mac window", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.pause,
    operation: localComputerPauseOperation,
    tool: {
      name: localComputerToolNames.pause,
      description: "Pause input to the selected Mac window. Observation and input are closed until resume.",
      inputSchema: { type: "object", properties: { selection_id: rootId }, required: ["selection_id"], additionalProperties: false },
      annotations: { title: "Pause desktop control", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.resume,
    operation: localComputerResumeOperation,
    tool: {
      name: localComputerToolNames.resume,
      description: "Resume the paused selection and extend its five-minute window. A fresh observation is required before the next act.",
      inputSchema: { type: "object", properties: { selection_id: rootId }, required: ["selection_id"], additionalProperties: false },
      annotations: { title: "Resume desktop control", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.stop,
    operation: localComputerStopOperation,
    tool: {
      name: localComputerToolNames.stop,
      description: "Stop desktop control and close the selected Mac window. A new selection needs another native picker.",
      inputSchema: { type: "object", properties: { selection_id: rootId }, required: ["selection_id"], additionalProperties: false },
      annotations: { title: "Stop desktop control", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
  },
  {
    name: localComputerToolNames.extended,
    operation: localComputerExtendedOperation,
    tool: {
      name: localComputerToolNames.extended,
      description:
        "Internal-build desktop actions beyond click/type: scroll, press, drag, launch, window focus/resize/move/minimize/maximize/restore, clipboard get/set/clear, and screenshots. Release builds reject this tool. Ref-based actions require the latest observation_id and qualified refs.",
      inputSchema: {
        type: "object",
        properties: {
          selection_id: rootId,
          action: {
            type: "string",
            enum: ["scroll", "press", "drag", "launch", "window", "clipboard_get", "clipboard_set", "clipboard_clear", "screenshot"],
          },
          observation_id: { type: "string" },
          ref: { type: "string" },
          to_ref: { type: "string" },
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "integer", minimum: 1, maximum: 20 },
          combo: { type: "string" },
          app: { type: "string" },
          window_action: { type: "string", enum: ["focus", "resize", "move", "minimize", "maximize", "restore"] },
          width: { type: "integer" },
          height: { type: "integer" },
          x: { type: "integer" },
          y: { type: "integer" },
          text: { type: "string" },
          timeout_ms: { type: "integer", minimum: 100, maximum: 30000 },
        },
        required: ["selection_id", "action"],
        additionalProperties: false,
      },
      annotations: { title: "Extended desktop action", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
  },
] as const satisfies ReadonlyArray<{
  name: string;
  operation: DesktopCloudToolOperation;
  tool: Tool;
}>;

/**
 * Registers the cloud local-tool lane only for a worker whose task explicitly
 * enabled it. The API supplies the endpoint/token environment at start.
 */
export function localToolsCoreMcpModules(input: {
  environment: Readonly<NodeJS.ProcessEnv>;
}): readonly CoreMcpModuleDefinition[] {
  if (!input.environment.LINKSENSE_LOCAL_TOOLS_ENDPOINT ||
      !input.environment.LINKSENSE_LOCAL_TOOLS_TOKEN) {
    return [];
  }
  return [{
    key: "local_tools",
    modes: ["default"],
    toolNames: localToolSpecs.map(spec => spec.name),
    create({ environment, fetch: requestFetch = globalThis.fetch }) {
      const endpoint = z.url().parse(environment.LINKSENSE_LOCAL_TOOLS_ENDPOINT);
      const token = z.string().min(32).parse(environment.LINKSENSE_LOCAL_TOOLS_TOKEN);
      return {
        key: "local_tools",
        tools: localToolSpecs.map(spec => spec.tool),
        async callTool(call) {
          const spec = localToolSpecs.find(candidate => candidate.name === call.toolName);
          if (!spec) {
            return failureToolResult({ code: "DESKTOP_TOOL_UNAVAILABLE", retryable: false });
          }
          try {
            call.signal.throwIfAborted();
            const input = desktopCloudToolInputSchemaFor[spec.operation].parse(call.argumentsValue);
            const response = await requestFetch(endpoint, {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ operation: spec.operation, input }),
              signal: withRequestTimeout(call.signal, spec.operation === localComputerSelectOperation ? 125_000 : 35_000),
            });
            const result: unknown = await response.json();
            if (!response.ok) {
              const remoteCode = result !== null && typeof result === "object" &&
                  "error_code" in result && typeof result.error_code === "string" &&
                  desktopCloudToolErrorCodeSchema.safeParse(result.error_code).success &&
                  result.error_code.startsWith("DESKTOP_FILE_")
                ? result.error_code
                : null;
              return failureToolResult({
                code: response.status === 403
                  ? "DESKTOP_TOOL_ACCESS_DENIED"
                  : remoteCode ?? "DESKTOP_TOOL_UNAVAILABLE",
                retryable: response.status >= 500,
              });
            }
            const parsed = desktopCloudToolDataSchemaFor[spec.operation].safeParse(result);
            return parsed.success
              ? successToolResult(parsed.data)
              : failureToolResult({
                  code: "DESKTOP_TOOL_RESPONSE_INVALID",
                  retryable: false,
                });
          } catch (error) {
            if (call.signal.aborted) throw error;
            return failureToolResult({
              code: error instanceof z.ZodError
                ? "DESKTOP_TOOL_INVALID"
                : "DESKTOP_TOOL_UNAVAILABLE",
              retryable: !(error instanceof z.ZodError),
            });
          }
        },
      };
    },
  }];
}
