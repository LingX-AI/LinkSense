import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const runtimeRoot = path.resolve(process.argv[2] ?? "");
const taskUid = 1001;
const sharedGid = 1000;
const conversationId = "019f45dd-a318-7d02-b03b-eaece8887865";
const token = "linksense-runtime-smoke-token-0000000000000000";

if (process.getuid?.() !== taskUid || process.getgid?.() !== sharedGid) {
  throw new Error("runner runtime smoke must execute as the task identity");
}

await assertTaskReadableAndImmutable(runtimeRoot);
await runNode(["--input-type=module", "--eval", 'await import("@linksense/shared")']);
await runNode([
  "--input-type=module",
  "--eval",
  'const { toMarkdownBytes } = await import("@firecrawl/anydoc"); const markdown = await toMarkdownBytes(Buffer.from("name,score\\nAda,10\\n"), "csv"); if (!markdown.includes("Ada")) throw new Error("anydoc conversion failed");',
]);

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
  LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:1/current-user",
  LINKSENSE_CURRENT_USER_TOKEN: token,
  LINKSENSE_CONVERSATION_ID: conversationId,
};

const services = [
  {
    label: "Core MCP in Default mode",
    entrypoint: "dist/mcp/core-service-server.js",
    environment: {
      ...coreServiceEnvironment,
      LINKSENSE_COLLABORATION_MODE: "default",
    },
    tools: [
      "register_artifact",
      "convert_document_to_markdown",
      "get_current_user_info",
      "generate_image",
      "search_knowledge_base",
      "list_knowledge_documents",
      "get_knowledge_document_markdown",
      "request_user_form",
      "emit_application_event",
      "preview_skill_zip",
      "install_skill",
    ],
  },
  {
    label: "Core MCP in Plan mode",
    entrypoint: "dist/mcp/core-service-server.js",
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
    tools: [
      "convert_document_to_markdown",
      "get_current_user_info",
      "search_knowledge_base",
      "list_knowledge_documents",
      "get_knowledge_document_markdown",
      "request_user_form",
      "emit_application_event",
    ],
  },
];

for (const service of services) {
  await assertMcpTools(service);
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

async function runNode(arguments_, environment = {}) {
  const result = await runChild(process.execPath, arguments_, environment);
  if (result.code !== 0) {
    throw new Error(`task runtime import failed: ${result.stderr}`);
  }
}

async function assertMcpTools(service) {
  const result = await runChild(
    process.execPath,
    [path.join(runtimeRoot, service.entrypoint)],
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
  const toolNames = toolsResponse?.result?.tools?.map((tool) => tool.name);
  const expectedToolNames = [...service.tools].sort();
  const actualToolNames = Array.isArray(toolNames) ? [...toolNames].sort() : [];
  if (
    !Array.isArray(toolNames) ||
    actualToolNames.length !== expectedToolNames.length ||
    actualToolNames.some(
      (toolName, index) => toolName !== expectedToolNames[index],
    )
  ) {
    throw new Error(`${service.label} exposed an unexpected tool registry`);
  }
}

function runChild(command, arguments_, environment, requests = []) {
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
