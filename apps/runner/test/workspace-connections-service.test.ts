import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspaceModule } from "../src/mcp/connection-services/workspace.js";

const environment = {
  LINKSENSE_CONNECTION_ENDPOINT: "http://127.0.0.1:4000/execute",
  LINKSENSE_CONNECTION_TOKEN: "test-only-token-more-than-32-characters",
};
const signal = new AbortController().signal;
function value(
  result: Awaited<
    ReturnType<ReturnType<typeof createWorkspaceModule>["callTool"]>
  >,
) {
  const first = result.content[0];
  if (first?.type !== "text") throw new Error("missing text");
  return JSON.parse(first.text);
}
describe("official workspace connection tools", () => {
  it.each(["google_docs", "gmail", "outlook"])(
    "exposes only %s operations without credentials or base64 arguments",
    (provider) => {
      const module = createWorkspaceModule(provider, {
        workspaceRoot: "/tmp",
        environment,
      });
      expect(module.tools.map((t) => t.name)).toEqual(["read", "write"]);
      const serialized = JSON.stringify(module.tools);
      expect(serialized).not.toContain(environment.LINKSENSE_CONNECTION_TOKEN);
      expect(serialized).not.toContain("content_base64");
      expect(serialized).not.toContain("list_connections");
    },
  );
  it("denies cross-provider requests and writes hidden in the read tool", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const module = createWorkspaceModule("gmail", {
      workspaceRoot: "/tmp",
      environment,
      fetch,
    });
    expect(
      value(
        await module.callTool({
          toolName: "read",
          argumentsValue: {
            request: {
              provider: "outlook",
              operation: "read_mail",
              message_id: "id",
            },
          },
          signal,
        }),
      ).code,
    ).toBe("CONNECTION_ACCESS_DENIED");
    expect(
      value(
        await module.callTool({
          toolName: "read",
          argumentsValue: {
            request: {
              provider: "gmail",
              operation: "send_draft",
              draft_id: "id",
            },
          },
          signal,
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks mutations and workspace downloads in Plan", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const module = createWorkspaceModule("google_docs", {
      workspaceRoot: "/tmp",
      environment: { ...environment, LINKSENSE_COLLABORATION_MODE: "plan" },
      fetch,
    });
    expect(module.tools.map((t) => t.name)).toEqual(["read"]);
    for (const call of [
      {
        toolName: "write",
        request: {
          provider: "google_docs",
          operation: "create_document",
          title: "test",
        },
      },
      {
        toolName: "read",
        request: {
          provider: "google_docs",
          operation: "export_document",
          document_id: "doc",
          format: "pdf",
        },
      },
    ]) {
      expect(
        value(
          await module.callTool({
            toolName: call.toolName,
            argumentsValue: { request: call.request },
            signal,
          }),
        ).code,
      ).toBe("CONNECTION_ACCESS_DENIED");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not retry sends even when a provider reports a retryable failure", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { code: "CONNECTION_UNAVAILABLE", retryable: true },
          { status: 503 },
        ),
      );
    const module = createWorkspaceModule("gmail", {
      workspaceRoot: "/tmp",
      environment,
      fetch,
    });
    expect(
      value(
        await module.callTool({
          toolName: "write",
          argumentsValue: {
            request: {
              provider: "gmail",
              operation: "send_draft",
              draft_id: "draft",
            },
          },
          signal,
        }),
      ),
    ).toMatchObject({ code: "CONNECTION_UNAVAILABLE", retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("pages long email content with a revision hash and rejects changed content", async () => {
    let content = "你好".repeat(50000);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () =>
        Response.json({
          kind: "workspace_data",
          data: { text: content },
          next_cursor: null,
        }),
      );
    const module = createWorkspaceModule("gmail", {
      workspaceRoot: "/tmp",
      environment,
      fetch,
    });
    const call = (extra: Record<string, unknown> = {}) =>
      module.callTool({
        toolName: "read",
        argumentsValue: {
          request: {
            provider: "gmail",
            operation: "read_mail",
            message_id: "mail",
          },
          ...extra,
        },
        signal,
      });
    const first = value(await call());
    expect(first.complete).toBe(false);
    expect(Buffer.byteLength(first.data)).toBeLessThanOrEqual(65536);
    expect(
      value(
        await call({
          byte_offset: first.next_byte_offset,
          expected_sha256: first.sha256,
        }),
      ).code,
    ).toBeUndefined();
    content = "changed";
    expect(
      value(
        await call({
          byte_offset: first.next_byte_offset,
          expected_sha256: first.sha256,
        }),
      ).code,
    ).toBe("DOCUMENT_CHANGED");
  });
  it("loads safe workspace attachments and downloads binary files without putting bytes in context", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-workspace-connection-"),
    );
    try {
      await writeFile(path.join(root, "test.txt"), "hello");
      await symlink(path.join(root, "test.txt"), path.join(root, "linked.txt"));
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(async () =>
          Response.json({
            kind: "workspace_data",
            data: { id: "draft" },
            next_cursor: null,
          }),
        );
      const module = createWorkspaceModule("gmail", {
        workspaceRoot: root,
        environment,
        fetch,
      });
      const request = {
        provider: "gmail",
        operation: "create_draft",
        to: ["to@example.test"],
        subject: "hello",
        text: "test",
      };
      const call = (workspace_relative_path: string) =>
        module.callTool({
          toolName: "write",
          argumentsValue: {
            request,
            attachments: [
              {
                workspace_relative_path,
                name: "test.txt",
                content_type: "text/plain",
              },
            ],
          },
          signal,
        });
      expect((await call("test.txt")).isError).toBe(false);
      expect(
        JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).attachments[0]
          .content_base64,
      ).toBe(Buffer.from("hello").toString("base64"));
      for (const file of ["../outside.txt", "/etc/passwd", "linked.txt"])
        expect((await call(file)).isError).toBe(true);
      expect(fetch).toHaveBeenCalledOnce();
      fetch.mockResolvedValue(
        Response.json({
          kind: "workspace_file",
          name: "../../report.pdf",
          content_type: "application/pdf",
          content_base64: Buffer.from("pdf").toString("base64"),
        }),
      );
      const result = value(
        await module.callTool({
          toolName: "read",
          argumentsValue: {
            request: {
              provider: "gmail",
              operation: "download_attachment",
              message_id: "message",
              attachment_id: "part",
            },
          },
          signal,
        }),
      );
      expect(result.workspace_relative_path).toMatch(/^downloads\//u);
      expect(result).not.toHaveProperty("content_base64");
      expect(
        await readFile(path.join(root, result.workspace_relative_path), "utf8"),
      ).toBe("pdf");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
