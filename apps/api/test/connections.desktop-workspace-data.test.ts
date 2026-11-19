import type { WorkspaceInput } from "@linksense/shared";
import { describe, expect, it } from "vitest";
import { projectDesktopWorkspaceData } from "../src/modules/connections/desktop-workspace-data.js";

const omitted = {
  contentUri: "https://images.example.test/temporary-access",
  contentBytes: "discard",
  access_token: "discard",
};

function paragraph(content: string) {
  return {
    paragraph: {
      elements: [
        { textRun: { content, textStyle: omitted } },
        { inlineObjectElement: { inlineObjectId: "image" } },
      ],
    },
  };
}

const googleDocumentRead = {
  provider: "google_docs",
  operation: "read_document",
  document_id: "document",
} satisfies WorkspaceInput;

describe("desktop workspace response projection", () => {
  it("keeps Google Docs text in tab order and drops embedded resource access", () => {
    const metadata = {
      documentId: "document",
      title: "Meeting notes",
      revisionId: "revision",
    };
    const table = {
      table: {
        tableRows: [{ tableCells: [{ content: [paragraph("Nested cell\n")] }] }],
      },
    };
    const raw = {
      ...metadata,
      ...omitted,
      inlineObjects: { image: { imageProperties: omitted } },
      tabs: [
        {
          tabProperties: { tabId: "main", title: "Main", ...omitted },
          documentTab: {
            body: { content: [paragraph("Agenda\n"), table] },
            positionedObjects: { image: omitted },
          },
          childTabs: [
            {
              tabProperties: { tabId: "follow-up", title: "Follow-up" },
              documentTab: {
                body: {
                  content: [
                    { tableOfContents: { content: [paragraph("Outline\n")] } },
                    paragraph("Next steps\n"),
                  ],
                },
                inlineObjects: { image: { imageProperties: omitted } },
              },
            },
          ],
        },
      ],
    };
    expect(projectDesktopWorkspaceData(googleDocumentRead, raw)).toEqual({
      ...metadata,
      tabs: [
        {
          tabId: "main",
          title: "Main",
          text: "Agenda\nNested cell\n",
          childTabs: [
            {
              tabId: "follow-up",
              title: "Follow-up",
              text: "Outline\nNext steps\n",
            },
          ],
        },
      ],
    });
  });

  it("reads legacy Google Docs bodies without a tab or editor revision", () => {
    expect(
      projectDesktopWorkspaceData(googleDocumentRead, {
        documentId: "document",
        title: "Meeting notes",
        body: { content: [paragraph("Notes\n")] },
      }),
    ).toEqual({ documentId: "document", title: "Meeting notes", text: "Notes\n" });
  });

  const gmailMessage = {
    id: "message",
    thread_id: "thread",
    labels: ["INBOX"],
    snippet: "Meeting update",
    headers: [{ name: "Subject", value: "Plan" }],
    parts: [
      { mime_type: "text/html", text: "Agenda & notes" },
      { mime_type: "application/pdf", attachment_id: "attach", name: "notes.pdf", size: 21 },
    ],
  };
  const rawGmailMessage = {
    ...gmailMessage,
    ...omitted,
    headers: [
      { ...gmailMessage.headers[0], ...omitted },
      { name: "X-Private", value: "discard" },
    ],
    parts: [
      {
        mime_type: "text/html",
        text: '<p>Agenda &amp; notes<img src="data:image/png;base64,discard"></p>',
      },
      { ...gmailMessage.parts[1], ...omitted },
    ],
  };

  it.each([
    {
      input: { provider: "gmail", operation: "read_mail", message_id: "message" },
      raw: rawGmailMessage,
      expected: gmailMessage,
    },
    {
      input: { provider: "gmail", operation: "read_draft", draft_id: "draft" },
      raw: { id: "draft", message: rawGmailMessage, ...omitted },
      expected: { id: "draft", message: gmailMessage },
    },
    {
      input: { provider: "gmail", operation: "read_thread", thread_id: "thread" },
      raw: { id: "thread", messages: [rawGmailMessage], ...omitted },
      expected: { id: "thread", messages: [gmailMessage] },
    },
  ] satisfies Array<{ input: WorkspaceInput; raw: unknown; expected: unknown }>)(
    "keeps Gmail text and attachment references for $input.operation",
    ({ input, raw, expected }) => {
      expect(projectDesktopWorkspaceData(input, raw)).toEqual(expected);
    },
  );

  it("keeps Outlook message text and attachment IDs without provider payloads", () => {
    const emailAddress = { name: "Sender", address: "sender@example.test" };
    const attachment = { id: "attach", name: "notes.pdf", contentType: "application/pdf", size: 12, isInline: false };
    expect(
      projectDesktopWorkspaceData({
        provider: "outlook", operation: "read_mail", message_id: "message",
      }, {
        id: "message",
        subject: "Plan",
        from: { emailAddress: { ...emailAddress, ...omitted }, ...omitted },
        body: { contentType: "text", content: "Agenda", ...omitted },
        attachments: [{ ...attachment, item: omitted, ...omitted }],
        ...omitted,
      }),
    ).toEqual({
      id: "message",
      subject: "Plan",
      from: { emailAddress },
      body: { contentType: "text", content: "Agenda" },
      attachments: [attachment],
    });
  });

  it("returns the visible text from Outlook HTML drafts and omits image attributes", () => {
    expect(
      projectDesktopWorkspaceData({
        provider: "outlook", operation: "read_draft", draft_id: "draft",
      }, {
        id: "draft",
        isDraft: true,
        body: {
          contentType: "html",
          content: '<style>discard</style><p>Notes &amp; plans</p><img src="data:image/png;base64,discard"><div>Next<br>Tomorrow</div>',
        },
      }),
    ).toEqual({
      id: "draft",
      isDraft: true,
      body: { contentType: "text", content: "Notes & plans\nNext\nTomorrow" },
    });
  });

  it.each([
    {
      input: { provider: "google_docs", operation: "search_documents", query: "" },
      raw: [{ id: "document", name: "Plan", webViewLink: "https://docs.example.test/document", ...omitted }],
      expected: [{ id: "document", name: "Plan", webViewLink: "https://docs.example.test/document" }],
    },
    {
      input: { provider: "gmail", operation: "search_mail", query: "" },
      raw: [{ id: "message", threadId: "thread", ...omitted }],
      expected: [{ id: "message", threadId: "thread" }],
    },
    {
      input: { provider: "gmail", operation: "list_labels" },
      raw: [{ id: "INBOX", name: "Inbox", ...omitted }],
      expected: [{ id: "INBOX", name: "Inbox" }],
    },
    {
      input: { provider: "gmail", operation: "list_drafts" },
      raw: [{ id: "draft", message: { id: "message", threadId: "thread", ...omitted }, ...omitted }],
      expected: [{ id: "draft", message: { id: "message", threadId: "thread" } }],
    },
    {
      input: { provider: "outlook", operation: "search_mail", query: "" },
      raw: [{ id: "message", subject: "Plan", ...omitted }],
      expected: [{ id: "message", subject: "Plan" }],
    },
    {
      input: { provider: "outlook", operation: "list_labels" },
      raw: [{ id: "folder", displayName: "Inbox", childFolderCount: 1, ...omitted }],
      expected: [{ id: "folder", displayName: "Inbox", childFolderCount: 1 }],
    },
    {
      input: { provider: "outlook", operation: "list_drafts" },
      raw: [{ id: "draft", subject: "Plan", isDraft: true, ...omitted }],
      expected: [{ id: "draft", subject: "Plan", isDraft: true }],
    },
    {
      input: { provider: "outlook", operation: "read_thread", thread_id: "thread" },
      raw: [{ id: "message", conversationId: "thread", ...omitted }],
      expected: [{ id: "message", conversationId: "thread" }],
    },
  ] satisfies Array<{ input: WorkspaceInput; raw: unknown; expected: unknown }>)(
    "projects the $input.provider $input.operation collection",
    ({ input, raw, expected }) => {
      expect(projectDesktopWorkspaceData(input, raw)).toEqual(expected);
    },
  );

  it("rejects malformed nested text and operations that return file bytes", () => {
    expect(() => projectDesktopWorkspaceData(googleDocumentRead, {
      body: { content: [{ paragraph: { elements: [{ textRun: { content: omitted } }] } }] },
    })).toThrow(expect.objectContaining({ code: "CONNECTION_UNAVAILABLE" }));
    expect(() => projectDesktopWorkspaceData({
      provider: "google_docs", operation: "export_document", document_id: "document", format: "pdf",
    }, omitted)).toThrow(expect.objectContaining({ code: "CONNECTION_ACCESS_DENIED" }));
  });
});
