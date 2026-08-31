import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const CONVERSATION_ID = "01900000-0000-7000-8000-000000000001";
const children: ChildProcessWithoutNullStreams[] = [];
const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("LinkSense Core MCP image generation module", () => {
  it("generates images, saves them under artifacts, and registers them", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-image-mcp-"));
    roots.push(workspace);
    const requests: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];
    const pngBytes = Buffer.from("generated png");
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        requests.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
          body,
        });
        response.writeHead(200, { "content-type": "application/json" });
        if (request.url === "/generate") {
          response.end(
            JSON.stringify({
              success: true,
              provider: "alibaba_bailian",
              model: "qwen-image-3.0",
              image_count: 1,
              unit_price: "0.12",
              total_cost: "0.12",
              currency: "CNY",
              transparency: {
                requested: true,
                strategy: "chroma_key",
                chroma_key: "magenta",
              },
              images: [
                {
                  data_base64: pngBytes.toString("base64"),
                  mime_type: "image/png",
                  display_name: "qwen-image-3.0-1.png",
                  has_transparency: true,
                },
              ],
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            success: true,
            artifact_id: "01900000-0000-7000-8000-000000000010",
            file_id: "01900000-0000-7000-8000-000000000011",
            display_name: "qwen-image-3.0-1.png",
            download_card_event_id: "01900000-0000-7000-8000-000000000012",
          }),
        );
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const imageToken = "image-token-000000000000000000000000000000";
    const fileToken = "file-token-0000000000000000000000000000000";
    const child = startMcpServer({
      workspace,
      imageEndpoint: `http://127.0.0.1:${address.port}/generate`,
      imageToken,
      fileEndpoint: `http://127.0.0.1:${address.port}/register-artifact`,
      fileToken,
    });
    const rpc = rpcClient(child);

    await expect(
      rpc.call(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ).resolves.toMatchObject({
      serverInfo: { name: "linksense_core" },
    });
    await expect(rpc.call(2, "tools/list", {})).resolves.toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "generate_image" }),
      ]),
    });
    const result = await rpc.call(3, "tools/call", {
      name: "generate_image",
      arguments: {
        prompt: "A clean product mockup",
        count: 1,
        size: "1024x1024",
        background: "transparent",
        transparency_mode: "chroma_key",
        chroma_key: "magenta",
      },
    });

    expect(result).toMatchObject({ isError: false });
    const text = (result as { content: Array<{ text: string }> }).content[0]!
      .text;
    expect(JSON.parse(text)).toMatchObject({
      success: true,
      provider: "alibaba_bailian",
      model: "qwen-image-3.0",
      artifacts: [
        {
          artifact_id: "01900000-0000-7000-8000-000000000010",
          file_id: "01900000-0000-7000-8000-000000000011",
          display_name: "qwen-image-3.0-1.png",
          download_card_event_id: "01900000-0000-7000-8000-000000000012",
          mime_type: "image/png",
          has_transparency: true,
        },
      ],
    });
    const registerRequest = requests.find(
      (request) => request.url === "/register-artifact",
    );
    expect(registerRequest).toMatchObject({
      authorization: `Bearer ${fileToken}`,
      body: expect.objectContaining({
        displayName: "qwen-image-3.0-1.png",
        mimeType: "image/png",
        artifactKind: "generated_image",
      }),
    });
    const workspaceRelativePath = (
      registerRequest?.body as { workspaceRelativePath: string }
    ).workspaceRelativePath;
    expect(workspaceRelativePath).toMatch(/^artifacts\//u);
    await expect(readFile(join(workspace, workspaceRelativePath))).resolves.toEqual(
      pngBytes,
    );
    expect(
      (await lstat(join(workspace, workspaceRelativePath))).mode & 0o777,
    ).toBe(0o640);
    expect(
      (await lstat(join(workspace, "artifacts"))).mode & 0o7777,
    ).toBe(0o2770);
    expect(requests[0]).toMatchObject({
      url: "/generate",
      authorization: `Bearer ${imageToken}`,
      body: {
        prompt: "A clean product mockup",
        count: 1,
        size: "1024x1024",
        background: "transparent",
        transparency_mode: "chroma_key",
        chroma_key: "magenta",
      },
    });
  });

  it("does not retry a generated image when artifact registration fails and removes the orphan", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-image-mcp-"));
    roots.push(workspace);
    const pngBytes = Buffer.from("generated png");
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url === "/generate") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              success: true,
              provider: "openai",
              model: "gpt-image-2",
              image_count: 1,
              unit_price: "0.12",
              total_cost: "0.12",
              currency: "CNY",
              transparency: {
                requested: false,
                strategy: "none",
                chroma_key: null,
              },
              images: [
                {
                  data_base64: pngBytes.toString("base64"),
                  mime_type: "image/png",
                  display_name: "generated.png",
                  has_transparency: false,
                },
              ],
            }),
          );
          return;
        }
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: false,
            error_code: "ARTIFACT_REGISTRATION_INVALID",
          }),
        );
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const child = startMcpServer({
      workspace,
      imageEndpoint: `http://127.0.0.1:${address.port}/generate`,
      imageToken: "image-token-000000000000000000000000000000",
      fileEndpoint: `http://127.0.0.1:${address.port}/register-artifact`,
      fileToken: "file-token-0000000000000000000000000000000",
    });
    const rpc = rpcClient(child);

    const result = await rpc.call(1, "tools/call", {
      name: "generate_image",
      arguments: { prompt: "A clean product mockup", count: 1 },
    });

    expect(result).toMatchObject({ isError: true });
    const text = (result as { content: Array<{ text: string }> }).content[0]!
      .text;
    expect(JSON.parse(text)).toEqual({
      code: "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
      retryable: false,
    });
    await expect(readdir(join(workspace, "artifacts"))).resolves.toEqual([]);
  });

  it("returns provider rejection details as a structured tool error", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-image-mcp-"));
    roots.push(workspace);
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(422, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            code: "IMAGE_GENERATION_PROVIDER_REJECTED",
            retryable: false,
            provider_code: "InvalidApiKey",
            provider_message: "Invalid API-key provided.",
            provider_request_id: "31f808fd-8eef-9004",
          }),
        );
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const child = startMcpServer({
      workspace,
      imageEndpoint: `http://127.0.0.1:${address.port}/generate`,
      imageToken: "image-token-000000000000000000000000000000",
      fileEndpoint: `http://127.0.0.1:${address.port}/register-artifact`,
      fileToken: "file-token-0000000000000000000000000000000",
    });
    const rpc = rpcClient(child);

    const result = await rpc.call(1, "tools/call", {
      name: "generate_image",
      arguments: {
        prompt: "A clean product mockup",
        count: 1,
      },
    });

    expect(result).toMatchObject({ isError: true });
    const text = (result as { content: Array<{ text: string }> }).content[0]!
      .text;
    expect(JSON.parse(text)).toEqual({
      code: "IMAGE_GENERATION_PROVIDER_REJECTED",
      retryable: false,
      provider_code: "InvalidApiKey",
      provider_message: "Invalid API-key provided.",
      provider_request_id: "31f808fd-8eef-9004",
    });
  });
});

function startMcpServer(input: {
  workspace: string;
  imageEndpoint: string;
  imageToken: string;
  fileEndpoint: string;
  fileToken: string;
}): ChildProcessWithoutNullStreams {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const script = fileURLToPath(
    new URL("../src/mcp/core-service-server.ts", import.meta.url),
  );
  const child = spawn(process.execPath, [tsxCli, script], {
    cwd: input.workspace,
    env: {
      PATH: process.env.PATH,
      LINKSENSE_IMAGE_GENERATION_ENDPOINT: input.imageEndpoint,
      LINKSENSE_IMAGE_GENERATION_TOKEN: input.imageToken,
      LINKSENSE_FILE_SERVICE_ENDPOINT: input.fileEndpoint,
      LINKSENSE_FILE_SERVICE_TOKEN: input.fileToken,
      LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:1/form",
      LINKSENSE_FORM_SERVICE_TOKEN:
        "unused-form-token-00000000000000000000000000000000",
      LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:1/search",
      LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
      LINKSENSE_KNOWLEDGE_SERVICE_TOKEN:
        "unused-knowledge-token-0000000000000000000000000000",
      LINKSENSE_SKILL_CREATOR_ENDPOINT: "http://127.0.0.1:1/skill",
      LINKSENSE_SKILL_CREATOR_TOKEN:
        "unused-skill-token-00000000000000000000000000000000",
      LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:1/current-user",
      LINKSENSE_CURRENT_USER_TOKEN:
        "unused-current-user-token-0000000000000000000000",
      LINKSENSE_CONVERSATION_ID: CONVERSATION_ID,
      LINKSENSE_COLLABORATION_MODE: "default",
    },
    stdio: "pipe",
  });
  children.push(child);
  return child;
}

function rpcClient(child: ChildProcessWithoutNullStreams) {
  const pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: Error) => void }
  >();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (typeof message.id !== "number") return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message ?? "MCP request failed"));
    } else {
      waiter.resolve(message.result);
    }
  });
  child.once("exit", (code) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`MCP subprocess exited with ${String(code)}`));
    }
    pending.clear();
  });
  return {
    call(id: number, method: string, params: unknown): Promise<unknown> {
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      return result;
    },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}
