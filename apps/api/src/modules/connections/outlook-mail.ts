import {
  Client,
  RedirectHandlerOptions,
  RetryHandlerOptions,
} from "@microsoft/microsoft-graph-client";
import { z } from "zod";
import type { WorkspaceInput } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import {
  workspaceData,
  workspaceFile,
  type WorkspaceAdapter,
  type WorkspacePage,
} from "./workspace-response.js";
const messageFields =
  "id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,body,conversationId,webLink";
const pageSchema = z.object({
  value: z.array(z.json()).max(100),
  "@odata.nextLink": z.url().optional(),
});
export class OutlookMailAdapter implements WorkspaceAdapter {
  async execute(
    token: string,
    input: WorkspaceInput,
    next?: string,
    signal?: AbortSignal,
  ): Promise<WorkspacePage> {
    const client = Client.initWithMiddleware({
      authProvider: { getAccessToken: async () => token },
    });
    const request = (path: string) =>
      client
        .api(path)
        .option(
          "signal",
          AbortSignal.any([
            AbortSignal.timeout(45000),
            ...(signal ? [signal] : []),
          ]),
        )
        .option("redirect", "error")
        .middlewareOptions([
          new RedirectHandlerOptions(0),
          new RetryHandlerOptions(0, 0),
        ]);
    const write = async (
      path: string,
      method: "POST" | "PATCH",
      body?: unknown,
    ): Promise<unknown> => {
      const result: unknown =
        method === "POST"
          ? await request(path).post(body)
          : await request(path).patch(body);
      return z
        .object({
          id: z.string().optional(),
          isDraft: z.boolean().optional(),
          conversationId: z.string().optional(),
          parentFolderId: z.string().optional(),
          accepted: z.boolean().optional(),
        })
        .parse(result ?? { accepted: true });
    };
    const message =
      "message_id" in input
        ? `/me/messages/${encodeURIComponent(input.message_id)}`
        : "";
    switch (input.operation) {
      case "search_mail": {
        let path = "/me/messages";
        if (next) {
          const url = new URL(next);
          if (
            url.origin !== "https://graph.microsoft.com" ||
            url.pathname !== "/v1.0/me/messages" ||
            url.username ||
            url.password ||
            url.hash
          )
            throw new AppError("VALIDATION_ERROR");
          path = next;
        }
        let query = request(path);
        if (!next) {
          query = query.select(messageFields).top(50);
          if (input.query)
            query = query.query({
              $search: encodeURIComponent(JSON.stringify(input.query)),
            });
        }
        const result = pageSchema.parse(await query.get());
        return workspaceData(result.value, result["@odata.nextLink"] ?? null);
      }
      case "read_mail":
        return workspaceData(
          await request(message)
            .select(messageFields)
            .expand("attachments($select=id,name,contentType,size,isInline)")
            .header("Prefer", 'outlook.body-content-type="text"')
            .get(),
        );
      case "read_draft": {
        const value = z
          .object({ isDraft: z.literal(true) })
          .passthrough()
          .parse(
            await request(`/me/messages/${encodeURIComponent(input.draft_id)}`)
              .select(messageFields)
              .get(),
          );
        return workspaceData(value);
      }
      case "list_labels":
      case "list_drafts":
      case "read_thread": {
        const base =
          input.operation === "list_labels"
            ? "/me/mailFolders"
            : input.operation === "list_drafts"
              ? "/me/mailFolders/drafts/messages"
              : "/me/messages";
        let target = base;
        if (next) {
          const url = new URL(next);
          if (
            url.origin !== "https://graph.microsoft.com" ||
            url.pathname !== `/v1.0${base}` ||
            url.username ||
            url.password ||
            url.hash
          )
            throw new AppError("VALIDATION_ERROR");
          target = next;
        }
        let query = request(target);
        if (!next) {
          query = query
            .top(50)
            .select(
              input.operation === "list_labels"
                ? "id,displayName,parentFolderId,childFolderCount"
                : messageFields,
            );
          if (input.operation === "read_thread")
            query = query.filter(`conversationId eq '${input.thread_id}'`);
        }
        const result = pageSchema.parse(await query.get());
        return workspaceData(result.value, result["@odata.nextLink"] ?? null);
      }
      case "download_attachment": {
        const result = z
          .object({
            name: z.string(),
            contentType: z.string(),
            contentBytes: z.string(),
          })
          .parse(
            await request(
              `${message}/attachments/${encodeURIComponent(input.attachment_id)}`,
            ).get(),
          );
        return workspaceFile(
          result.name,
          result.contentType,
          Buffer.from(result.contentBytes, "base64"),
        );
      }
      case "create_draft":
      case "update_draft": {
        const recipients = (values: string[]) =>
          values.map((address) => ({ emailAddress: { address } }));
        const content = {
          subject: input.subject,
          body: { contentType: "Text", content: input.text },
          toRecipients: recipients(input.to),
          ccRecipients: recipients(input.cc),
          bccRecipients: recipients(input.bcc),
        };
        if (input.operation === "update_draft") {
          const path = `/me/messages/${encodeURIComponent(input.draft_id)}`;
          const current = z
            .object({ isDraft: z.boolean() })
            .parse(await request(path).select("isDraft").get());
          if (!current.isDraft) throw new AppError("CONNECTION_ACCESS_DENIED");
          // Existing attachment content is retained; replace the draft's body and recipients.
          if (input.attachments.length) throw new AppError("VALIDATION_ERROR");
          return workspaceData(await write(path, "PATCH", content));
        }
        return workspaceData(
          await write("/me/messages", "POST", {
            ...content,
            attachments: input.attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.content_type,
              contentBytes: a.content_base64,
            })),
          }),
        );
      }
      case "reply_draft":
        return workspaceData(
          await write(`${message}/createReply`, "POST", {
            comment: input.text,
          }),
        );
      case "send_draft": {
        const path = `/me/messages/${encodeURIComponent(input.draft_id)}`;
        const current = z
          .object({ isDraft: z.boolean() })
          .parse(await request(path).select("isDraft").get());
        if (!current.isDraft) throw new AppError("CONNECTION_ACCESS_DENIED");
        return workspaceData(await write(`${path}/send`, "POST"));
      }
      case "move_mail":
        return workspaceData(
          await write(`${message}/move`, "POST", {
            destinationId: input.folder_id,
          }),
        );
      case "modify_mail":
        return workspaceData(
          input.action === "mark_read" || input.action === "mark_unread"
            ? await write(message, "PATCH", {
                isRead: input.action === "mark_read",
              })
            : await write(`${message}/move`, "POST", {
                destinationId:
                  input.action === "archive" ? "archive" : "deleteditems",
              }),
        );
      default:
        throw new AppError("VALIDATION_ERROR");
    }
  }
}
