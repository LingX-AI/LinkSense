import type { JsonValue, WorkspaceInput } from "@linksense/shared";
import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";

const optionalText = z.string().nullish();
const optionalCount = z.number().int().nonnegative().nullish();
const optionalFlag = z.boolean().nullish();
const optionalWebLink = z.url({ protocol: /^https$/u }).nullish();
const jsonValue = z.json();

const googleDocumentRef = z.object({
  id: optionalText,
  name: optionalText,
  webViewLink: optionalWebLink,
  modifiedTime: optionalText,
});
const googleContent = z.object({ content: z.array(z.unknown()).nullish() });
const googleDocument = z.object({
  documentId: optionalText,
  title: optionalText,
  revisionId: optionalText,
  body: googleContent.nullish(),
  tabs: z.array(z.unknown()).nullish(),
});
const googleTab = z.object({
  tabProperties: z.object({ tabId: optionalText, title: optionalText }).nullish(),
  documentTab: z.object({ body: googleContent.nullish() }).nullish(),
  childTabs: z.array(z.unknown()).nullish(),
});
const googleStructuralElement = z.object({
  paragraph: z.object({
    elements: z.array(z.object({
      textRun: z.object({ content: optionalText }).nullish(),
    })).nullish(),
  }).nullish(),
  table: z.object({
    tableRows: z.array(z.object({
      tableCells: z.array(googleContent).nullish(),
    })).nullish(),
  }).nullish(),
  tableOfContents: googleContent.nullish(),
});

const gmailMessageRef = z.object({ id: optionalText, threadId: optionalText });
const gmailLabel = z.object({
  id: optionalText,
  name: optionalText,
  type: optionalText,
  messageListVisibility: optionalText,
  labelListVisibility: optionalText,
  messagesTotal: optionalCount,
  messagesUnread: optionalCount,
  threadsTotal: optionalCount,
  threadsUnread: optionalCount,
});
const gmailHeaders = new Set(["from", "to", "cc", "bcc", "subject", "date", "reply-to", "message-id"]);
const gmailPart = z.object({
  mime_type: z.string(),
  attachment_id: optionalText,
  name: optionalText,
  size: optionalCount,
  text: optionalText,
}).transform(({ text, ...metadata }) => {
  const mimeType = metadata.mime_type.split(";", 1)[0]?.trim().toLowerCase();
  if (metadata.attachment_id || typeof text !== "string" || !mimeType?.startsWith("text/")) return metadata;
  return { ...metadata, text: mimeType === "text/html" ? plainTextFromHtml(text) : text };
});
const gmailMessage = z.object({
  id: z.string().nullable(),
  thread_id: z.string().nullable(),
  labels: z.array(z.string()),
  snippet: z.string(),
  headers: z.array(z.object({ name: z.string(), value: optionalText }))
    .transform(headers => headers.filter(({ name }) => gmailHeaders.has(name.toLowerCase()))),
  parts: z.array(gmailPart),
});
const gmailDraft = z.object({ id: optionalText, message: gmailMessage });
const gmailDraftRef = z.object({ id: optionalText, message: gmailMessageRef.nullish() });
const gmailThread = z.object({ id: optionalText, messages: z.array(gmailMessage) });

const outlookRecipient = z.object({
  emailAddress: z.object({ address: optionalText, name: optionalText }).nullish(),
});
const outlookFolder = z.object({
  id: optionalText,
  displayName: optionalText,
  parentFolderId: optionalText,
  childFolderCount: optionalCount,
});
const outlookAttachment = z.object({
  id: optionalText,
  name: optionalText,
  contentType: optionalText,
  size: optionalCount,
  isInline: optionalFlag,
});
const outlookBody = z.object({
  contentType: z.string().toLowerCase().pipe(z.enum(["text", "html"])),
  content: optionalText,
}).transform(({ contentType, content }) => ({
  contentType: "text" as const,
  content: contentType === "html" && typeof content === "string" ? plainTextFromHtml(content) : content ?? null,
}));
const outlookMessage = z.object({
  id: optionalText,
  subject: optionalText,
  conversationId: optionalText,
  receivedDateTime: optionalText,
  webLink: optionalWebLink,
  isRead: optionalFlag,
  isDraft: optionalFlag,
  hasAttachments: optionalFlag,
  from: outlookRecipient.nullish(),
  toRecipients: z.array(outlookRecipient).nullish(),
  ccRecipients: z.array(outlookRecipient).nullish(),
  body: outlookBody.nullish(),
  attachments: z.array(outlookAttachment).nullish(),
});

function parseProviderData<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError("CONNECTION_UNAVAILABLE");
  return parsed.data;
}

const ignoredHtmlElements = new Set(["iframe", "math", "script", "style", "svg", "template"]);
const lineBreakElements = new Set([
  "blockquote", "br", "div", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "p", "pre", "tr",
]);
function plainTextFromHtml(html: string): string {
  const pending: Array<DefaultTreeAdapterMap["childNode"] | "\n"> = parseFragment(html).childNodes.reverse();
  const text: string[] = [];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node === "\n") text.push(node);
    else if (defaultTreeAdapter.isTextNode(node)) text.push(node.value);
    else if (defaultTreeAdapter.isElementNode(node) && !ignoredHtmlElements.has(node.tagName)) {
      if (lineBreakElements.has(node.tagName)) {
        text.push("\n");
        pending.push("\n");
      }
      for (const child of node.childNodes.reverse()) pending.push(child);
    }
  }
  return text.join("").split("\n").map(line => line.trim()).filter(Boolean).join("\n");
}

function documentText(content: readonly unknown[]): string {
  const pending = [...content].reverse();
  const text: string[] = [];
  while (pending.length) {
    const element = parseProviderData(googleStructuralElement, pending.pop());
    for (const part of element.paragraph?.elements ?? []) {
      if (part.textRun?.content) text.push(part.textRun.content);
    }
    for (const entry of (element.tableOfContents?.content ?? []).reverse()) pending.push(entry);
    for (const row of (element.table?.tableRows ?? []).reverse()) {
      for (const cell of (row.tableCells ?? []).reverse()) {
        for (const entry of (cell.content ?? []).reverse()) pending.push(entry);
      }
    }
  }
  return text.join("");
}

type DesktopGoogleTab = {
  tabId?: string | null | undefined;
  title?: string | null | undefined;
  text: string;
  childTabs?: DesktopGoogleTab[];
};
function projectGoogleTab(data: unknown): DesktopGoogleTab {
  const { tabProperties, documentTab, childTabs } = parseProviderData(googleTab, data);
  return {
    ...tabProperties,
    text: documentText(documentTab?.body?.content ?? []),
    ...(childTabs?.length ? { childTabs: childTabs.map(projectGoogleTab) } : {}),
  };
}

export function projectDesktopWorkspaceData(input: WorkspaceInput, data: unknown): JsonValue {
  const projected = projectWorkspaceData(input, data);
  return jsonValue.parse(projected);
}

function projectWorkspaceData(input: WorkspaceInput, data: unknown): unknown {
  switch (input.operation) {
    case "search_documents":
      return parseProviderData(z.array(googleDocumentRef), data);
    case "read_document": {
      const { body, tabs, ...metadata } = parseProviderData(googleDocument, data);
      return tabs?.length
        ? { ...metadata, tabs: tabs.map(projectGoogleTab) }
        : { ...metadata, text: documentText(body?.content ?? []) };
    }
    case "search_mail":
      return parseProviderData(z.array(input.provider === "gmail" ? gmailMessageRef : outlookMessage), data);
    case "read_mail":
      return parseProviderData(input.provider === "gmail" ? gmailMessage : outlookMessage, data);
    case "list_labels":
      return parseProviderData(z.array(input.provider === "gmail" ? gmailLabel : outlookFolder), data);
    case "list_drafts":
      return parseProviderData(z.array(input.provider === "gmail" ? gmailDraftRef : outlookMessage), data);
    case "read_draft":
      return parseProviderData(input.provider === "gmail" ? gmailDraft : outlookMessage, data);
    case "read_thread":
      return parseProviderData(input.provider === "gmail" ? gmailThread : z.array(outlookMessage), data);
    default:
      throw new AppError("CONNECTION_ACCESS_DENIED");
  }
}
