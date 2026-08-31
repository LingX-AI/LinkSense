import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js";
import {
  normalizePersonalStdioCommand,
  personalStdioInvocationEnvironment,
} from "./personal-stdio-launcher.js";

export async function probePersonalStdioMcp(input: {
  command: string;
  args: string[];
  environment: Record<string, string>;
  runtimeEnvironment: Record<string, string>;
  timeoutMs: number;
  processIdentity?: ProcessIdentity;
}): Promise<{
  serverName: string;
  protocolVersion: string;
  toolCount: number;
}> {
  const normalized = normalizePersonalStdioCommand(input.command, input.args);
  const invocation = isolatedChildInvocation(
    normalized.command,
    normalized.args,
    input.processIdentity,
  );
  const environment = personalStdioInvocationEnvironment(
    normalized,
    { ...input.runtimeEnvironment, ...input.environment },
    Object.keys(input.environment),
  );
  const transport = new StdioClientTransport({
    command: invocation.command,
    args: invocation.args,
    env: environment,
    ...(input.runtimeEnvironment.LINKSENSE_USER_NODE_PROJECT ??
    input.runtimeEnvironment.HOME
      ? {
          cwd:
            input.runtimeEnvironment.LINKSENSE_USER_NODE_PROJECT ??
            input.runtimeEnvironment.HOME!,
        }
      : {}),
    stderr: "pipe",
  });
  // Drain stderr so a verbose package manager or server cannot block on its
  // pipe. Its contents may include user secrets and are intentionally dropped.
  transport.stderr?.on("data", () => undefined);
  const client = new Client(
    { name: "linksense-stdio-mcp-connection-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const controller = new AbortController();
  let protocolVersion = "unknown";
  const clientTransport: Transport = {
    start: async () => {
      transport.onclose = () => clientTransport.onclose?.();
      transport.onerror = (error) => clientTransport.onerror?.(error);
      transport.onmessage = (message) => clientTransport.onmessage?.(message);
      await transport.start();
    },
    send: (message) => transport.send(message),
    close: () => transport.close(),
    setProtocolVersion: (version) => {
      protocolVersion = version;
    },
  };
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  timeout.unref();
  try {
    await client.connect(clientTransport, { signal: controller.signal });
    const tools = await client.listTools(undefined, {
      signal: controller.signal,
    });
    return {
      serverName: client.getServerVersion()?.name ?? "stdio-mcp",
      protocolVersion,
      toolCount: tools.tools.length,
    };
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}
