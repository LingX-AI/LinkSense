import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const taskUid = 1001;
const sharedGid = 1000;
const conversationId = "019f45dd-a318-7d02-b03b-eaece8887865";
const token = "linksense-runtime-smoke-token-0000000000000000";

const coreServiceEnvironment = {
  LINKSENSE_FILE_SERVICE_ENDPOINT: "http://127.0.0.1:1/register-artifact",
  LINKSENSE_FILE_SERVICE_TOKEN: token,
  LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:1/request-user-form",
  LINKSENSE_FORM_SERVICE_TOKEN: token,
  LINKSENSE_IMAGE_GENERATION_ENDPOINT: "http://127.0.0.1:1/generate-image",
  LINKSENSE_IMAGE_GENERATION_TOKEN: token,
  LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:1/search",
  LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
  LINKSENSE_SKILL_CREATOR_ENDPOINT: "http://127.0.0.1:1/skills",
  LINKSENSE_SKILL_CREATOR_TOKEN: token,
  LINKSENSE_APPLICATION_BUILDER_ENDPOINT: "http://127.0.0.1:1/application-builder",
  LINKSENSE_APPLICATION_BUILDER_TOKEN: token,
  LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:1/current-user",
  LINKSENSE_CURRENT_USER_TOKEN: token,
  LINKSENSE_CONVERSATION_ID: conversationId,
};

const services = [
  {
    label: "Core MCP in Default mode",
    environment: {
      ...coreServiceEnvironment,
      LINKSENSE_COLLABORATION_MODE: "default",
    },
  },
  {
    label: "Core MCP in Plan mode",
    environment: {
      LINKSENSE_COLLABORATION_MODE: "plan",
      LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT:
        coreServiceEnvironment.LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT,
      LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
      LINKSENSE_FORM_SERVICE_ENDPOINT:
        coreServiceEnvironment.LINKSENSE_FORM_SERVICE_ENDPOINT,
      LINKSENSE_FORM_SERVICE_TOKEN: token,
      LINKSENSE_CURRENT_USER_ENDPOINT:
        coreServiceEnvironment.LINKSENSE_CURRENT_USER_ENDPOINT,
      LINKSENSE_CURRENT_USER_TOKEN: token,
    },
  },
];

export async function assertCoreMcpRuntime(runtimeRoot, {
  registryPath = "dist/mcp/core-service-registry.js",
  serverPath = "dist/mcp/core-service-server.js",
  nodeArguments = [],
} = {}) {
  // The module declarations are the single source of tool names. Check their
  // real stdio exposure in the deployed package, not a second handwritten list.
  const { coreMcpToolNamesFor } = await import(pathToFileURL(path.join(runtimeRoot, registryPath)).href);
  for (const service of services) {
    await assertMcpTools(runtimeRoot, {
      ...service,
      entrypoint: serverPath,
      tools: coreMcpToolNamesFor(service.environment.LINKSENSE_COLLABORATION_MODE),
    }, nodeArguments);
  }
}

async function assertTaskReadableAndImmutable(root) {
  const packagePath = path.join(
    root,
    "node_modules",
    "@linksense",
    "shared",
    "package.json",
  );
  await access(packagePath, constants.R_OK);
  const [rootStats, packageStats] = await Promise.all([
    stat(root),
    stat(packagePath),
  ]);
  if (rootStats.uid !== 0 || packageStats.uid !== 0) {
    throw new Error("runner runtime must remain root-owned");
  }
  if ((rootStats.mode & 0o022) !== 0 || (packageStats.mode & 0o022) !== 0) {
    throw new Error("runner runtime must not be writable by the task identity");
  }
}

async function runNode(runtimeRoot, arguments_, environment = {}) {
  const result = await runChild(runtimeRoot, process.execPath, arguments_, environment);
  if (result.code !== 0) {
    throw new Error(`task runtime import failed: ${result.stderr}`);
  }
}

async function assertMcpTools(runtimeRoot, service, nodeArguments) {
  const result = await runChild(
    runtimeRoot,
    process.execPath,
    [...nodeArguments, path.join(runtimeRoot, service.entrypoint)],
    service.environment,
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ],
  );
  if (result.code !== 0) {
    throw new Error(`${service.label} failed: ${result.stderr}`);
  }
  const toolsResponse = result.messages.find((message) => message?.id === 2);
  const tools = toolsResponse?.result?.tools;
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool?.name !== "string")) {
    throw new Error(`${service.label} returned an invalid tools/list response`);
  }
  const toolNames = tools.map((tool) => tool.name);
  const expectedToolNames = [...service.tools].sort();
  const actualToolNames = [...toolNames].sort();
  if (
    actualToolNames.length !== expectedToolNames.length ||
    actualToolNames.some(
      (toolName, index) => toolName !== expectedToolNames[index],
    )
  ) {
    throw new Error(`${service.label} exposed an unexpected tool registry; expected=${JSON.stringify(expectedToolNames)}; actual=${JSON.stringify(actualToolNames)}`);
  }
}

function runChild(runtimeRoot, command, arguments_, environment, requests = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: runtimeRoot,
      env: {
        PATH: process.env.PATH,
        HOME: "/tmp",
        LANG: "C.UTF-8",
        NODE_ENV: "production",
        NODE_OPTIONS: "",
        ...environment,
      },
      stdio: "pipe",
    });
    const messages = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`runtime smoke timed out: ${arguments_[0] ?? command}`));
    }, 5_000);
    timer.unref();

    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // The built-in MCP protocol must use stdout only for JSON-RPC.
        messages.push({ invalidJson: line });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, messages, stderr: stderr.trim().slice(-2_000) });
    });
    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const runtimeRoot = path.resolve(process.argv[2] ?? "");
  if (process.getuid?.() !== taskUid || process.getgid?.() !== sharedGid) {
    throw new Error("runner runtime smoke must execute as the task identity");
  }
  await assertTaskReadableAndImmutable(runtimeRoot);
  await runNode(runtimeRoot, ["--input-type=module", "--eval", 'await import("@linksense/shared")']);
  await runNode(runtimeRoot, [
    "--input-type=module",
    "--eval",
    'const { toMarkdownBytes } = await import("@firecrawl/anydoc"); const markdown = await toMarkdownBytes(Buffer.from("name,score\\nAda,10\\n"), "csv"); if (!markdown.includes("Ada")) throw new Error("anydoc conversion failed");',
  ]);
  await assertCoreMcpRuntime(runtimeRoot);
}
