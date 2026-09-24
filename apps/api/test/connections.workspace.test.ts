import { afterEach, describe, expect, it, vi } from "vitest";
import { workspaceInputSchema } from "@linksense/shared";
import { WorkspaceConnections } from "../src/modules/connections/workspace-adapter.js";

function network(responses: Array<{ body: unknown; status?: number }>) {
  const calls: Array<{ url: URL; body: unknown; method: string }> = [];
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const raw = await request.text();
      calls.push({
        url: new URL(request.url),
        body: raw ? JSON.parse(raw) : undefined,
        method: request.method,
      });
      const response = responses.shift();
      if (!response) throw new Error("unexpected call");
      return response.status === 202
        ? new Response(null, { status: 202 })
        : Response.json(response.body, { status: response.status ?? 200 });
    },
  );
  vi.stubGlobal("fetch", fetch);
  return { calls, fetch };
}
afterEach(() => vi.unstubAllGlobals());
const adapter = new WorkspaceConnections();

describe("workspace provider SDK adapters", () => {
  it("escapes Drive searches, restricts to Docs and follows opaque page tokens", async () => {
    const net = network([
      {
        body: {
          files: [{ id: "doc", name: "meeting" }],
          nextPageToken: "opaque",
        },
      },
    ]);
    const result = await adapter.execute(
      "test-token",
      workspaceInputSchema.parse({
        provider: "google_docs",
        operation: "search_documents",
        query: "O'Brien",
      }),
      "previous",
    );
    expect(net.calls[0]?.url.hostname).toBe("www.googleapis.com");
    expect(net.calls[0]?.url.searchParams.get("q")).toBe(
      "trashed = false and mimeType = 'application/vnd.google-apps.document' and name contains 'O\\'Brien'",
    );
    expect(net.calls[0]?.url.searchParams.get("pageToken")).toBe("previous");
    expect(result.nextLink).toBe("opaque");
  });
  it("uses revision preconditions and the selected tab when editing a document", async () => {
    const net = network([
      { body: { writeControl: { requiredRevisionId: "new" } } },
    ]);
    await adapter.execute(
      "test-token",
      workspaceInputSchema.parse({
        provider: "google_docs",
        operation: "edit_document",
        document_id: "doc",
        expected_revision: "revision",
        edits: [
          { type: "insert_text", index: 1, tab_id: "tab", text: "hello" },
        ],
      }),
    );
    expect(net.calls[0]?.body).toEqual({
      writeControl: { requiredRevisionId: "revision" },
      requests: [
        { insertText: { location: { index: 1, tabId: "tab" }, text: "hello" } },
      ],
    });
  });
  it("returns the created document ID when initial text insertion fails without creating it again", async () => {
    const net = network([
      { body: { documentId: "new-doc" } },
      { status: 503, body: { error: { message: "private" } } },
    ]);
    const result = await adapter.execute(
      "test-token",
      workspaceInputSchema.parse({
        provider: "google_docs",
        operation: "create_document",
        title: "test",
        text: "hello",
      }),
    );
    expect(result.result).toMatchObject({
      data: { documentId: "new-doc", content_written: false },
    });
    expect(net.fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps Bcc and attachments in Gmail draft MIME and never sends while drafting", async () => {
    const net = network([
      { body: { emailAddress: "owner@example.test" } },
      { body: { id: "draft", message: { id: "message" } } },
    ]);
    await adapter.execute(
      "test-token",
      workspaceInputSchema.parse({
        provider: "gmail",
        operation: "create_draft",
        to: ["to@example.test"],
        bcc: ["bcc@example.test"],
        subject: "Report",
        text: "hello",
        attachments: [
          {
            name: "hello.txt",
            content_type: "text/plain",
            content_base64: Buffer.from("attachment").toString("base64"),
          },
        ],
      }),
    );
    const request = net.calls[1];
    expect(request?.url.pathname).toBe("/gmail/v1/users/me/drafts");
    const data = JSON.parse(JSON.stringify(request?.body));
    const mime = Buffer.from(data.message.raw, "base64url").toString("utf8");
    expect(mime).toContain("Bcc: bcc@example.test");
    expect(mime).toContain("filename=hello.txt");
    expect(mime).toContain(Buffer.from("attachment").toString("base64"));
    expect(net.calls.some((c) => c.url.pathname.endsWith("/send"))).toBe(false);
  });
  it("decodes Gmail text and retains attachment identifiers", async () => {
    network([
      {
        body: {
          id: "mail",
          payload: {
            mimeType: "multipart/mixed",
            headers: [
              { name: "Subject", value: "hello" },
              { name: "X-Private", value: "omit" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: Buffer.from("你好").toString("base64url") },
              },
              {
                filename: "file.pdf",
                mimeType: "application/pdf",
                body: { attachmentId: "part", size: 5 },
              },
            ],
          },
        },
      },
    ]);
    const result = await adapter.execute(
      "test-token",
      workspaceInputSchema.parse({
        provider: "gmail",
        operation: "read_mail",
        message_id: "mail",
      }),
    );
    expect(result.result).toMatchObject({
      data: {
        headers: [{ name: "Subject", value: "hello" }],
        parts: [
          { mime_type: "text/plain", text: "你好" },
          { attachment_id: "part", name: "file.pdf" },
        ],
      },
    });
  });
  it.each(["gmail", "outlook"] as const)(
    "never retries an ambiguous %s send",
    async (provider) => {
      const net = network([
        ...(provider === "outlook" ? [{ body: { isDraft: true } }] : []),
        {
          body: {
            error: { code: "ServiceUnavailable", message: "sensitive-error" },
          },
          status: 503,
        },
      ]);
      await expect(
        adapter.execute(
          "test-token",
          workspaceInputSchema.parse({
            provider,
            operation: "send_draft",
            draft_id: "draft",
          }),
        ),
      ).rejects.toMatchObject({ code: "CONNECTION_UNAVAILABLE" });
      expect(net.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    },
  );
  it("creates Outlook drafts using Graph attachment and recipient structures", async () => {
    const net = network([{ body: { id: "draft", isDraft: true } }]);
    await adapter.execute(
      "test-token",
      workspaceInputSchema.parse({
        provider: "outlook",
        operation: "create_draft",
        to: ["to@example.test"],
        bcc: ["bcc@example.test"],
        subject: "report",
        text: "hello",
        attachments: [
          {
            name: "file.txt",
            content_type: "text/plain",
            content_base64: "aGk=",
          },
        ],
      }),
    );
    expect(net.calls[0]?.body).toMatchObject({
      body: { contentType: "Text", content: "hello" },
      bccRecipients: [{ emailAddress: { address: "bcc@example.test" } }],
      attachments: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          contentBytes: "aGk=",
        },
      ],
    });
    expect(net.calls[0]?.url.pathname).toBe("/v1.0/me/messages");
  });
  it("does not send an Outlook message which is no longer a draft", async () => {
    const net = network([{ body: { isDraft: false } }]);
    await expect(
      adapter.execute(
        "test-token",
        workspaceInputSchema.parse({
          provider: "outlook",
          operation: "send_draft",
          draft_id: "draft",
        }),
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
    expect(net.fetch).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404, 412])(
    "maps Outlook HTTP %s to a safe actionable error",
    async (status) => {
      network([
        {
          status,
          body: {
            error: { code: "provider_error", message: "private-content" },
          },
        },
      ]);
      await expect(
        adapter.execute(
          "test-token",
          workspaceInputSchema.parse({
            provider: "outlook",
            operation: "read_mail",
            message_id: "mail",
          }),
        ),
      ).rejects.toMatchObject({
        code:
          status === 401
            ? "CONNECTION_REQUIRED"
            : status === 412
              ? "CONNECTION_FILE_CONFLICT"
              : "CONNECTION_ACCESS_DENIED",
      });
    },
  );
  it("rejects Outlook pagination to any other host before sending credentials", async () => {
    const net = network([]);
    await expect(
      adapter.execute(
        "test-token",
        workspaceInputSchema.parse({
          provider: "outlook",
          operation: "search_mail",
          query: "",
        }),
        "https://attacker.test/v1.0/me/messages",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(net.fetch).not.toHaveBeenCalled();
  });
});

it("exports an existing Google document as binary PDF using Drive", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(new Uint8Array([37, 80, 68, 70]), {
        headers: { "content-type": "application/pdf" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const result = await adapter.execute(
    "test-token",
    workspaceInputSchema.parse({
      provider: "google_docs",
      operation: "export_document",
      document_id: "doc",
      format: "pdf",
    }),
  );
  expect(result.result).toEqual({
    kind: "workspace_file",
    name: "doc.pdf",
    content_type: "application/pdf",
    content_base64: "JVBERg==",
  });
  const request = fetch.mock.calls[0]?.[0];
  const url = new URL(
    request instanceof Request ? request.url : String(request),
  );
  expect(url.pathname).toBe("/drive/v3/files/doc/export");
  expect(url.searchParams.get("mimeType")).toBe("application/pdf");
});

it("creates a Gmail reply draft in the original thread without sending it", async () => {
  const net = network([
    {
      body: {
        threadId: "thread",
        payload: {
          headers: [
            { name: "From", value: "sender@example.test" },
            { name: "Subject", value: "Question" },
            { name: "Message-ID", value: "<original@example.test>" },
          ],
        },
      },
    },
    { body: { emailAddress: "owner@example.test" } },
    { body: { id: "draft", message: { id: "message", threadId: "thread" } } },
  ]);
  await adapter.execute(
    "test-token",
    workspaceInputSchema.parse({
      provider: "gmail",
      operation: "reply_draft",
      message_id: "message",
      text: "reply",
    }),
  );
  const request = JSON.parse(JSON.stringify(net.calls[2]?.body));
  expect(request.message.threadId).toBe("thread");
  const raw = Buffer.from(request.message.raw, "base64url").toString();
  expect(raw).toContain("In-Reply-To: <original@example.test>");
  expect(raw).toContain("To: sender@example.test");
  expect(net.calls[2]?.url.pathname).toBe("/gmail/v1/users/me/drafts");
});

it("returns only mutation identifiers from Outlook without copying the message body into context", async () => {
  network([
    {
      body: {
        id: "draft",
        isDraft: true,
        body: { content: "private email" },
        "@odata.context": "provider metadata",
      },
    },
  ]);
  const result = await adapter.execute(
    "test-token",
    workspaceInputSchema.parse({
      provider: "outlook",
      operation: "reply_draft",
      message_id: "message",
      text: "reply",
    }),
  );
  expect(result.result).toMatchObject({ data: { id: "draft", isDraft: true } });
  expect(JSON.stringify(result)).not.toContain("private email");
  expect(JSON.stringify(result)).not.toContain("@odata");
});
