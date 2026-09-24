import { docs, type docs_v1 } from "@googleapis/docs";
import { drive } from "@googleapis/drive";
import { gmail, type gmail_v1 } from "@googleapis/gmail";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { z } from "zod";
import type { WorkspaceInput } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import {
  workspaceData,
  workspaceFile,
  type WorkspaceAdapter,
  type WorkspacePage,
} from "./workspace-response.js";

const identity = z.object({ emailAddress: z.email() });
export class GoogleWorkspaceAdapter implements WorkspaceAdapter {
  async execute(
    token: string,
    input: WorkspaceInput,
    next?: string,
    signal?: AbortSignal,
  ): Promise<WorkspacePage> {
    const options = {
      headers: { Authorization: `Bearer ${token}` },
      retry: false,
      timeout: 45000,
      maxRedirects: 0,
      maxContentLength: 28 * 1024 * 1024,
      fetchImplementation: globalThis.fetch,
      signal: AbortSignal.any([
        AbortSignal.timeout(45000),
        ...(signal ? [signal] : []),
      ]),
    };
    const documents = docs({ version: "v1", ...options });
    const files = drive({ version: "v3", ...options });
    const mail = gmail({ version: "v1", ...options });
    switch (input.operation) {
      case "search_documents": {
        const escaped = input.query
          .replace(/\\/gu, "\\\\")
          .replace(/'/gu, "\\'");
        const response = await files.files.list({
          q: `trashed = false and mimeType = 'application/vnd.google-apps.document'${escaped ? ` and name contains '${escaped}'` : ""}`,
          pageSize: 50,
          ...(next ? { pageToken: next } : {}),
          fields: "nextPageToken,files(id,name,webViewLink,modifiedTime)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        return workspaceData(
          response.data.files ?? [],
          response.data.nextPageToken ?? null,
        );
      }
      case "read_document":
        return workspaceData(
          (
            await documents.documents.get({
              documentId: input.document_id,
              includeTabsContent: true,
            })
          ).data,
        );
      case "export_document": {
        const types = {
          pdf: "application/pdf",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          txt: "text/plain",
        };
        const response = await files.files.export(
          { fileId: input.document_id, mimeType: types[input.format] },
          { responseType: "arraybuffer" },
        );
        return workspaceFile(
          `${input.document_id}.${input.format}`,
          types[input.format],
          Buffer.from(z.instanceof(ArrayBuffer).parse(response.data)),
        );
      }
      case "create_document": {
        const created = (
          await documents.documents.create({
            requestBody: { title: input.title },
          })
        ).data;
        const documentId = z.string().parse(created.documentId);
        if (input.text) {
          try {
            await documents.documents.batchUpdate({
              documentId,
              requestBody: {
                requests: [
                  {
                    insertText: { endOfSegmentLocation: {}, text: input.text },
                  },
                ],
              },
            });
          } catch {
            return workspaceData({
              documentId,
              url: `https://docs.google.com/document/d/${documentId}/edit`,
              content_written: false,
            });
          }
        }
        return workspaceData({
          documentId,
          url: `https://docs.google.com/document/d/${documentId}/edit`,
          content_written: true,
        });
      }
      case "edit_document": {
        const requests: docs_v1.Schema$Request[] = input.edits.map((edit) => {
          if (edit.type === "insert_text")
            return {
              insertText: {
                location: {
                  index: edit.index,
                  ...(edit.tab_id ? { tabId: edit.tab_id } : {}),
                },
                text: edit.text,
              },
            };
          if (edit.type === "replace_text")
            return {
              replaceAllText: {
                containsText: { text: edit.find, matchCase: edit.match_case },
                replaceText: edit.replace,
                ...(edit.tab_id
                  ? { tabsCriteria: { tabIds: [edit.tab_id] } }
                  : {}),
              },
            };
          const style = {
            ...(edit.bold === undefined ? {} : { bold: edit.bold }),
            ...(edit.italic === undefined ? {} : { italic: edit.italic }),
            ...(edit.underline === undefined
              ? {}
              : { underline: edit.underline }),
          };
          return {
            updateTextStyle: {
              range: {
                startIndex: edit.start,
                endIndex: edit.end,
                ...(edit.tab_id ? { tabId: edit.tab_id } : {}),
              },
              textStyle: style,
              fields: Object.entries(style)
                .filter(([, v]) => v !== undefined)
                .map(([k]) => k)
                .join(","),
            },
          };
        });
        return workspaceData(
          (
            await documents.documents.batchUpdate({
              documentId: input.document_id,
              requestBody: {
                writeControl: { requiredRevisionId: input.expected_revision },
                requests,
              },
            })
          ).data,
        );
      }
      case "search_mail": {
        const response = await mail.users.messages.list({
          userId: "me",
          q: input.query,
          maxResults: 50,
          ...(next ? { pageToken: next } : {}),
        });
        return workspaceData(
          response.data.messages ?? [],
          response.data.nextPageToken ?? null,
        );
      }
      case "read_mail": {
        const message = (
          await mail.users.messages.get({
            userId: "me",
            id: input.message_id,
            format: "full",
          })
        ).data;
        return workspaceData(projectGmailMessage(message));
      }
      case "list_drafts": {
        const response = await mail.users.drafts.list({
          userId: "me",
          maxResults: 50,
          ...(next ? { pageToken: next } : {}),
        });
        return workspaceData(
          response.data.drafts ?? [],
          response.data.nextPageToken ?? null,
        );
      }
      case "read_draft": {
        const response = (
          await mail.users.drafts.get({
            userId: "me",
            id: input.draft_id,
            format: "full",
          })
        ).data;
        return workspaceData({
          id: response.id,
          message: projectGmailMessage(response.message ?? {}),
        });
      }
      case "read_thread": {
        const response = (
          await mail.users.threads.get({
            userId: "me",
            id: input.thread_id,
            format: "full",
          })
        ).data;
        return workspaceData({
          id: response.id,
          messages: (response.messages ?? []).map(projectGmailMessage),
        });
      }
      case "list_labels":
        return workspaceData(
          (await mail.users.labels.list({ userId: "me" })).data.labels ?? [],
        );
      case "download_attachment": {
        const result = (
          await mail.users.messages.attachments.get({
            userId: "me",
            messageId: input.message_id,
            id: input.attachment_id,
          })
        ).data;
        return workspaceFile(
          "attachment",
          "application/octet-stream",
          Buffer.from(z.string().parse(result.data), "base64url"),
        );
      }
      case "create_draft":
      case "update_draft": {
        const profile = identity.parse(
          (await mail.users.getProfile({ userId: "me" })).data,
        );
        const composed = new MailComposer({
          from: profile.emailAddress,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          subject: input.subject,
          text: input.text,
          attachments: input.attachments.map((a) => ({
            filename: a.name,
            contentType: a.content_type,
            content: Buffer.from(a.content_base64, "base64"),
          })),
        }).compile();
        // Gmail derives recipients from MIME, including Bcc; there is no separate SMTP envelope.
        composed.keepBcc = true;
        const raw = await composed.build();
        const message = { raw: raw.toString("base64url") };
        const response =
          input.operation === "create_draft"
            ? await mail.users.drafts.create({
                userId: "me",
                requestBody: { message },
              })
            : await mail.users.drafts.update({
                userId: "me",
                id: input.draft_id,
                requestBody: { message },
              });
        return workspaceData(response.data);
      }
      case "reply_draft": {
        const original = (
          await mail.users.messages.get({
            userId: "me",
            id: input.message_id,
            format: "metadata",
            metadataHeaders: [
              "Reply-To",
              "From",
              "Subject",
              "Message-ID",
              "References",
            ],
          })
        ).data;
        const headers = original.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
            ?.value ?? "";
        const recipient = header("Reply-To") || header("From");
        if (!recipient || /[\r\n]/u.test(recipient))
          throw new AppError("VALIDATION_ERROR");
        const profile = identity.parse(
          (await mail.users.getProfile({ userId: "me" })).data,
        );
        const raw = await new MailComposer({
          from: profile.emailAddress,
          to: recipient,
          subject: header("Subject").replace(/^(?!Re:)/iu, "Re: "),
          text: input.text,
          inReplyTo: header("Message-ID"),
          references: [header("References"), header("Message-ID")]
            .filter(Boolean)
            .join(" "),
        })
          .compile()
          .build();
        return workspaceData(
          (
            await mail.users.drafts.create({
              userId: "me",
              requestBody: {
                message: {
                  raw: raw.toString("base64url"),
                  ...(original.threadId ? { threadId: original.threadId } : {}),
                },
              },
            })
          ).data,
        );
      }
      case "send_draft":
        return workspaceData(
          (
            await mail.users.drafts.send({
              userId: "me",
              requestBody: { id: input.draft_id },
            })
          ).data,
        );
      case "label_mail":
        return workspaceData(
          (
            await mail.users.messages.modify({
              userId: "me",
              id: input.message_id,
              requestBody: {
                addLabelIds: input.add,
                removeLabelIds: input.remove,
              },
            })
          ).data,
        );
      case "modify_mail": {
        if (input.action === "trash")
          return workspaceData(
            (
              await mail.users.messages.trash({
                userId: "me",
                id: input.message_id,
              })
            ).data,
          );
        return workspaceData(
          (
            await mail.users.messages.modify({
              userId: "me",
              id: input.message_id,
              requestBody: {
                addLabelIds: input.action === "mark_unread" ? ["UNREAD"] : [],
                removeLabelIds:
                  input.action === "archive"
                    ? ["INBOX"]
                    : input.action === "mark_read"
                      ? ["UNREAD"]
                      : [],
              },
            })
          ).data,
        );
      }
      default:
        throw new AppError("VALIDATION_ERROR");
    }
  }
}

export function projectGmailMessage(message: gmail_v1.Schema$Message): unknown {
  const parts: Array<{
    mime_type: string;
    text?: string;
    attachment_id?: string;
    name?: string;
    size?: number;
  }> = [];
  function visit(part: gmail_v1.Schema$MessagePart, depth = 0): void {
    if (depth > 30 || parts.length > 200)
      throw new AppError("CONNECTION_FILE_TOO_LARGE");
    if (part.body?.attachmentId)
      parts.push({
        mime_type: part.mimeType ?? "application/octet-stream",
        attachment_id: part.body.attachmentId,
        name: part.filename ?? "attachment",
        size: part.body.size ?? 0,
      });
    else if (part.body?.data && part.mimeType?.startsWith("text/"))
      parts.push({
        mime_type: part.mimeType,
        text: Buffer.from(part.body.data, "base64url").toString("utf8"),
      });
    for (const child of part.parts ?? []) visit(child, depth + 1);
  }
  if (message.payload) visit(message.payload);
  return {
    id: message.id ?? null,
    thread_id: message.threadId ?? null,
    labels: message.labelIds ?? [],
    snippet: message.snippet ?? "",
    headers: (message.payload?.headers ?? []).filter((h) =>
      [
        "from",
        "to",
        "cc",
        "bcc",
        "subject",
        "date",
        "reply-to",
        "message-id",
      ].includes(h.name?.toLowerCase() ?? ""),
    ),
    parts,
  };
}
