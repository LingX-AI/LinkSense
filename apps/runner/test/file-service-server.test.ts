import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

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

describe("LinkSense Core MCP subprocess", () => {
  it("accepts MCP request metadata and forwards register_artifact over HTTP", async () => {
    let receivedBody: unknown;
    let receivedAuthorization: string | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedAuthorization = request.headers.authorization;
        receivedBody = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as unknown;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            artifact_id: "01900000-0000-7000-8000-000000000010",
            file_id: "01900000-0000-7000-8000-000000000010",
            display_name: "report.txt",
            download_card_event_id: "01900000-0000-7000-8000-000000000011",
          }),
        );
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const token = "turn-token-00000000000000000000000000000000";
    const child = startMcpServer(
      `http://127.0.0.1:${address.port}/register-artifact`,
      token,
    );
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
    await expect(rpc.call(10, "tools/list", {})).resolves.toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "register_artifact" }),
        expect.objectContaining({ name: "convert_document_to_markdown" }),
        expect.objectContaining({ name: "generate_image" }),
        expect.objectContaining({ name: "get_current_user_info" }),
        expect.objectContaining({ name: "search_knowledge_base" }),
        expect.objectContaining({ name: "list_knowledge_documents" }),
        expect.objectContaining({ name: "get_knowledge_document_markdown" }),
        expect.objectContaining({ name: "preview_skill_zip" }),
        expect.objectContaining({ name: "install_skill" }),
      ]),
    });

    await expect(
      rpc.call(2, "tools/call", {
        _meta: { progressToken: "registration-progress" },
        name: "register_artifact",
        arguments: {
          workspace_relative_path: "artifacts/report.txt",
          display_name: "report.txt",
          mime_type: "text/plain",
          artifact_kind: "text",
        },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            artifact_id: "01900000-0000-7000-8000-000000000010",
            file_id: "01900000-0000-7000-8000-000000000010",
            display_name: "report.txt",
            download_card_event_id: "01900000-0000-7000-8000-000000000011",
          }),
        },
      ],
      isError: false,
    });
    expect(receivedAuthorization).toBe(`Bearer ${token}`);
    expect(receivedBody).toEqual({
      workspaceRelativePath: "artifacts/report.txt",
      displayName: "report.txt",
      mimeType: "text/plain",
      artifactKind: "text",
    });
  });

  it("returns a non-retryable stable code for invalid tool arguments", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(500).end();
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const child = startMcpServer(
      `http://127.0.0.1:${address.port}/register-artifact`,
      "turn-token-00000000000000000000000000000000",
    );
    const rpc = rpcClient(child);

    await expect(
      rpc.call(1, "tools/call", {
        name: "register_artifact",
        arguments: {
          workspace_relative_path: "artifacts/report.txt",
          display_name: "report.txt",
          unexpected: "must not be accepted",
        },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "ARTIFACT_REGISTRATION_INVALID",
            retryable: false,
          }),
        },
      ],
      isError: true,
    });
  });

  it("normalizes task-owned artifact permissions before forwarding registration", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-file-mcp-"));
    roots.push(workspace);
    const artifactDirectory = join(workspace, "generated", "nested");
    const artifact = join(artifactDirectory, "report.txt");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifact, "report", { mode: 0o600 });
    await Promise.all([
      chmod(join(workspace, "generated"), 0o700),
      chmod(artifactDirectory, 0o700),
      chmod(artifact, 0o600),
    ]);

    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          success: true,
          artifact_id: "01900000-0000-7000-8000-000000000010",
          file_id: "01900000-0000-7000-8000-000000000010",
          display_name: "report.txt",
          download_card_event_id: "01900000-0000-7000-8000-000000000011",
        }),
      );
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const child = startMcpServer(
      `http://127.0.0.1:${address.port}/register-artifact`,
      "turn-token-00000000000000000000000000000000",
      workspace,
    );
    const rpc = rpcClient(child);

    await expect(
      rpc.call(1, "tools/call", {
        name: "register_artifact",
        arguments: {
          workspace_relative_path: "generated/nested/report.txt",
          display_name: "report.txt",
        },
      }),
    ).resolves.toMatchObject({ isError: false });
    expect((await lstat(join(workspace, "generated"))).mode & 0o7777).toBe(
      0o2770,
    );
    expect((await lstat(artifactDirectory)).mode & 0o7777).toBe(0o2770);
    expect((await lstat(artifact)).mode & 0o777).toBe(0o640);
  });

  it("rejects artifact symlinks before contacting the registration API", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "linksense-file-mcp-"));
    roots.push(workspace);
    const outside = join(workspace, "outside.txt");
    const artifactDirectory = join(workspace, "artifacts");
    await mkdir(artifactDirectory);
    await writeFile(outside, "private");
    await symlink(outside, join(artifactDirectory, "linked.txt"));
    let requestCount = 0;
    const server = createServer((_request, response) => {
      requestCount += 1;
      response.writeHead(500).end();
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const child = startMcpServer(
      `http://127.0.0.1:${address.port}/register-artifact`,
      "turn-token-00000000000000000000000000000000",
      workspace,
    );
    const rpc = rpcClient(child);
    await expect(
      rpc.call(1, "tools/call", {
        name: "register_artifact",
        arguments: {
          workspace_relative_path: "artifacts/linked.txt",
          display_name: "linked.txt",
        },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "ARTIFACT_REGISTRATION_INVALID",
            retryable: false,
          }),
        },
      ],
      isError: true,
    });
    expect(requestCount).toBe(0);
  });

  it("forwards bounded knowledge searches and returns citation markers", async () => {
    let receivedBody: unknown;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        receivedBody = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as unknown;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            success: true,
            results: [
              {
                source_ref: "source-ref-0000000000000001",
                citation_marker: "[[kb-source:source-ref-0000000000000001]]",
                document_ref: "document-ref-0000000000000001",
                knowledge_base_name: "产品制度",
                document_name: "报销制度.pdf",
                document_version_id: "01900000-0000-7000-8000-000000000012",
                title_path: ["报销标准"],
                page_numbers: [2],
                location: "第 2 页 · 报销标准",
                content: "完整父段内容",
              },
            ],
            unavailable_knowledge_base_count: 0,
          }),
        );
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const endpoint = `http://127.0.0.1:${address.port}/search-knowledge`;
    const child = startKnowledgeMcpServer(
      endpoint,
      "turn-token-00000000000000000000000000000000",
    );
    const rpc = rpcClient(child);

    await expect(
      rpc.call(0, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    ).resolves.toMatchObject({
      serverInfo: { name: "linksense_core" },
      instructions: expect.stringMatching(
        /search_knowledge_base for focused factual[\s\S]*list_knowledge_documents for document inventory[\s\S]*get_knowledge_document_markdown only when the user needs a complete named document/u,
      ),
    });
    const toolList = await rpc.call(3, "tools/list", {});
    expect(toolList).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({
          name: "search_knowledge_base",
          description: expect.stringContaining(
            "Copy the complete Markdown image reference exactly as returned",
          ),
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              num_candidates: expect.objectContaining({
                description: expect.stringContaining("automatically raised"),
              }),
            }),
          }),
        }),
        expect.objectContaining({ name: "list_knowledge_documents" }),
        expect.objectContaining({
          name: "get_knowledge_document_markdown",
        }),
      ]),
    });
    expect(
      (toolList as { tools: Array<{ name: string }> }).tools
        .map((tool) => tool.name)
        .sort(),
    ).toEqual([
      "convert_document_to_markdown",
      "emit_application_event",
      "get_current_user_info",
      "get_knowledge_document_markdown",
      "list_knowledge_documents",
      "request_user_form",
      "search_knowledge_base",
    ]);
    await expect(
      rpc.call(1, "tools/call", {
        name: "search_knowledge_base",
        arguments: {
          query: "报销标准",
          final_top_k: 5,
          candidate_multiplier: 3,
          num_candidates: 50,
          min_score: 0.2,
        },
      }),
    ).resolves.toMatchObject({ isError: false });
    expect(receivedBody).toEqual({
      query: "报销标准",
      final_top_k: 5,
      candidate_multiplier: 3,
      num_candidates: 50,
      min_score: 0.2,
    });
  });

  it("forwards document inventory and complete-Markdown pagination to sibling endpoints", async () => {
    const requests: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];
    const documentRef = "document-ref-0000000000000001";
    const listCursor = "list-cursor-000000000000000001";
    const markdownCursor = "markdown-cursor-00000000000001";
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as unknown;
        requests.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
          body,
        });
        response.writeHead(200, { "content-type": "application/json" });
        if (request.url === "/documents") {
          response.end(
            JSON.stringify({
              success: true,
              documents: [
                {
                  document_ref: documentRef,
                  knowledge_base_name: "产品制度",
                  document_name: "报销制度.pdf",
                  file_type: "pdf",
                },
              ],
              next_cursor: listCursor,
              unavailable_knowledge_base_count: 0,
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            success: true,
            document_ref: documentRef,
            knowledge_base_name: "产品制度",
            document_name: "报销制度.pdf",
            file_type: "pdf",
            markdown: "# 报销制度\n",
            chunk_index: 0,
            byte_start: 0,
            byte_end: 17,
            total_bytes: 32,
            next_cursor: markdownCursor,
            complete: false,
          }),
        );
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const token = "turn-token-00000000000000000000000000000000";
    const child = startKnowledgeMcpServer(
      `http://127.0.0.1:${address.port}/search`,
      token,
    );
    const rpc = rpcClient(child);

    await expect(
      rpc.call(10, "tools/call", {
        name: "list_knowledge_documents",
        arguments: { cursor: listCursor },
      }),
    ).resolves.toMatchObject({ isError: false });
    await expect(
      rpc.call(11, "tools/call", {
        name: "get_knowledge_document_markdown",
        arguments: {
          document_ref: documentRef,
          cursor: markdownCursor,
        },
      }),
    ).resolves.toMatchObject({ isError: false });

    expect(requests).toEqual([
      {
        url: "/documents",
        authorization: `Bearer ${token}`,
        body: { cursor: listCursor },
      },
      {
        url: "/document-markdown",
        authorization: `Bearer ${token}`,
        body: {
          document_ref: documentRef,
          cursor: markdownCursor,
        },
      },
    ]);
  });

  it("returns knowledge-specific stable failures for invalid arguments and invalid JSON", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(502, { "content-type": "text/plain" });
      response.end("private upstream response");
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const endpoint = `http://127.0.0.1:${address.port}/search-knowledge`;
    const child = startKnowledgeMcpServer(
      endpoint,
      "turn-token-00000000000000000000000000000000",
    );
    const rpc = rpcClient(child);

    await expect(
      rpc.call(1, "tools/call", {
        name: "search_knowledge_base",
        arguments: { query: "" },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "KNOWLEDGE_SEARCH_INVALID",
            retryable: false,
          }),
        },
      ],
      isError: true,
    });

    await expect(
      rpc.call(2, "tools/call", {
        name: "search_knowledge_base",
        arguments: { query: "有效查询" },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
            retryable: true,
          }),
        },
      ],
      isError: true,
    });

    await expect(
      rpc.call(3, "tools/call", {
        name: "list_knowledge_documents",
        arguments: { cursor: "short" },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "KNOWLEDGE_DOCUMENT_LIST_INVALID",
            retryable: false,
          }),
        },
      ],
      isError: true,
    });

    await expect(
      rpc.call(4, "tools/call", {
        name: "get_knowledge_document_markdown",
        arguments: { document_ref: "short" },
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            code: "KNOWLEDGE_DOCUMENT_MARKDOWN_INVALID",
            retryable: false,
          }),
        },
      ],
      isError: true,
    });
  });

  it("aborts an in-flight knowledge request after MCP cancellation", async () => {
    let requestStarted = false;
    let requestAborted = false;
    const server = createServer((request) => {
      requestStarted = true;
      request.once("aborted", () => {
        requestAborted = true;
      });
    });
    servers.push(server);
    await listen(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("missing test port");

    const child = startKnowledgeMcpServer(
      `http://127.0.0.1:${address.port}/search-knowledge`,
      "turn-token-00000000000000000000000000000000",
    );
    const rpc = rpcClient(child);
    const call = rpc.call(31, "tools/call", {
      name: "search_knowledge_base",
      arguments: { query: "等待取消" },
    });
    await expect.poll(() => requestStarted, { timeout: 5_000 }).toBe(true);

    rpc.notify("notifications/cancelled", { requestId: 31 });

    await expect.poll(() => requestAborted, { timeout: 5_000 }).toBe(true);
    child.kill("SIGTERM");
    await expect(call).rejects.toThrow("MCP subprocess exited");
  });

  it("rejects a non-positive knowledge search timeout at MCP startup", async () => {
    const endpoint = "http://127.0.0.1:1/internal";
    const child = startKnowledgeMcpServer(
      endpoint,
      "turn-token-00000000000000000000000000000000",
      "0",
    );

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", resolve);
    });

    expect(exitCode).not.toBe(0);
  });
});

function startMcpServer(
  endpoint: string,
  token: string,
  cwd?: string,
): ChildProcessWithoutNullStreams {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const script = fileURLToPath(
    new URL("../src/mcp/core-service-server.ts", import.meta.url),
  );
  const child = spawn(process.execPath, [tsxCli, script], {
    ...(cwd ? { cwd } : {}),
    env: {
      PATH: process.env.PATH,
      LINKSENSE_FILE_SERVICE_ENDPOINT: endpoint,
      LINKSENSE_FILE_SERVICE_TOKEN: token,
      LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:1/form",
      LINKSENSE_FORM_SERVICE_TOKEN:
        "unused-form-token-00000000000000000000000000000000",
      LINKSENSE_IMAGE_GENERATION_ENDPOINT: "http://127.0.0.1:1/generate",
      LINKSENSE_IMAGE_GENERATION_TOKEN:
        "unused-image-token-00000000000000000000000000000000",
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
      LINKSENSE_CONVERSATION_ID: "01900000-0000-7000-8000-000000000001",
      LINKSENSE_COLLABORATION_MODE: "default",
    },
    stdio: "pipe",
  });
  children.push(child);
  return child;
}

function startKnowledgeMcpServer(
  endpoint: string,
  token: string,
  knowledgeSearchTimeoutMs = "200000",
): ChildProcessWithoutNullStreams {
  const tsxCli = fileURLToPath(import.meta.resolve("tsx/cli"));
  const script = fileURLToPath(
    new URL("../src/mcp/core-service-server.ts", import.meta.url),
  );
  const child = spawn(process.execPath, [tsxCli, script], {
    env: {
      PATH: process.env.PATH,
      LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: endpoint,
      LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: knowledgeSearchTimeoutMs,
      LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
      LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:1/form",
      LINKSENSE_FORM_SERVICE_TOKEN:
        "unused-form-token-00000000000000000000000000000000",
      LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:1/current-user",
      LINKSENSE_CURRENT_USER_TOKEN:
        "unused-current-user-token-0000000000000000000000",
      LINKSENSE_COLLABORATION_MODE: "plan",
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
    notify(method: string, params: unknown): void {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
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
