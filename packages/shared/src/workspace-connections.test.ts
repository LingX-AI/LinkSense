import { describe, expect, it } from "vitest";
import {
  connectionInputSchema,
  isConnectionWrite,
  workspaceInputSchema,
} from "./workspace-connections.js";

describe("workspace connector contracts", () => {
  it.each(["gmail", "outlook"])(
    "accepts %s drafts but rejects header injection, malformed attachments and traversal",
    (provider) => {
      const draft = {
        provider,
        operation: "create_draft",
        to: ["to@example.test"],
        subject: "Report",
        text: "hello",
      };
      expect(workspaceInputSchema.parse(draft)).toMatchObject({
        cc: [],
        bcc: [],
        attachments: [],
      });
      expect(
        workspaceInputSchema.safeParse({
          ...draft,
          subject: "test\r\nBcc: unexpected@example.test",
        }).success,
      ).toBe(false);
      expect(
        workspaceInputSchema.safeParse({
          ...draft,
          attachments: [
            {
              name: "../secret",
              content_type: "text/plain",
              content_base64: "aGk=",
            },
          ],
        }).success,
      ).toBe(false);
      for (const message_id of ["..", ".", "../mail", "https://example.test"])
        expect(
          workspaceInputSchema.safeParse({
            provider,
            operation: "read_mail",
            message_id,
          }).success,
        ).toBe(false);
    },
  );
  it("enforces the total attachment limit at the API boundary", () => {
    const content_base64 = "AAAA".repeat(700_000);
    expect(
      workspaceInputSchema.safeParse({
        provider: "gmail",
        operation: "create_draft",
        to: ["to@example.test"],
        subject: "",
        text: "",
        attachments: [
          { name: "one", content_type: "text/plain", content_base64 },
          { name: "two", content_type: "text/plain", content_base64 },
        ],
      }).success,
    ).toBe(false);
  });
  it("rejects invalid Docs edits and requires the revision read by the caller", () => {
    const edit = {
      provider: "google_docs",
      operation: "edit_document",
      document_id: "document",
      edits: [{ type: "format_text", start: 5, end: 3, bold: true }],
    };
    expect(workspaceInputSchema.safeParse(edit).success).toBe(false);
    expect(
      workspaceInputSchema.safeParse({ ...edit, expected_revision: "revision" })
        .success,
    ).toBe(false);
    expect(
      workspaceInputSchema.safeParse({
        ...edit,
        expected_revision: "revision",
        edits: [{ type: "format_text", start: 1, end: 3 }],
      }).success,
    ).toBe(false);
  });
  it.each([
    [
      {
        provider: "google_docs",
        operation: "read_document",
        document_id: "id",
      },
      false,
    ],
    [{ provider: "gmail", operation: "send_draft", draft_id: "draft" }, true],
    [
      {
        provider: "outlook",
        operation: "modify_mail",
        message_id: "mail",
        action: "trash",
      },
      true,
    ],
    [{ provider: "onedrive", operation: "list_drives" }, false],
  ])(
    "preserves write classification across connection families",
    (request, write) => {
      expect(isConnectionWrite(connectionInputSchema.parse(request))).toBe(
        write,
      );
    },
  );
});
