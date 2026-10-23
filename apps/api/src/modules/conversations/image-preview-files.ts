import { z } from "zod";
import { MAX_IMAGE_PREVIEW_BYTES, imagePreviewMimeTypeSchema } from "@linksense/shared";

import type { ConversationFile, PrismaClient } from "../../generated/prisma/client.js";

const viewedImageReferenceSchema = z.object({
  method: z.literal("item/completed"),
  params: z.object({ item: z.object({ type: z.literal("imageView"), fileId: z.uuid() }) }),
});

type ImageReferenceInput = {
  events: readonly { payloadJson: unknown; turnId?: string | null }[];
  messages: readonly { contentText: string; turnId?: string | null }[];
};

export function referencedImageTurnIds(input: ImageReferenceInput): Map<string, string | null> {
  const references = new Map<string, string | null>();
  for (const event of input.events) {
    const parsed = viewedImageReferenceSchema.safeParse(event.payloadJson);
    if (parsed.success) references.set(parsed.data.params.item.fileId, event.turnId ?? null);
  }
  for (const message of input.messages) {
    for (const match of message.contentText.matchAll(/linksense-artifact:([0-9a-f-]{36})/giu)) {
      const id = z.uuid().safeParse(match[1]);
      if (id.success && !references.has(id.data)) references.set(id.data, message.turnId ?? null);
    }
  }
  return references;
}

export function forkImageFileBinding(
  file: ConversationFile,
  turnIdMap: ReadonlyMap<string, string>,
  referenceTurnIds: ReadonlyMap<string, string | null>,
): Pick<ConversationFile, "turnId" | "kind" | "source" | "status" | "downloadable" | "downloadCardEventId"> {
  const turnId = file.turnId ? turnIdMap.get(file.turnId) : undefined;
  const reference = referenceTurnIds.get(file.id);
  const referenceTurnId = reference ? turnIdMap.get(reference) : undefined;
  if (!turnId && referenceTurnId && (file.kind === "attachment" || file.kind === "image_preview")) {
    // A referenced historical image is context, rather than a new user upload
    // in the fork. Bind its private preview to the copied referencing turn.
    return { turnId: referenceTurnId, kind: "image_preview", source: "system_generated", status: "registered", downloadable: false, downloadCardEventId: null };
  }
  if (!turnId && file.kind !== "artifact") throw new Error("image_preview_fork_turn_unavailable");
  return { turnId: turnId ?? null, kind: file.kind, source: file.source, status: file.status, downloadable: file.downloadable, downloadCardEventId: file.downloadCardEventId };
}

/** Load only explicitly referenced workspace images; keep normal branch and artifact scope intact. */
export async function includeReferencedImageAttachments(
  prisma: Pick<PrismaClient, "conversationFile">,
  input: {
    conversationId: string;
    files: ConversationFile[];
    events: readonly { payloadJson: unknown }[];
    messages: readonly { contentText: string }[];
  },
): Promise<ConversationFile[]> {
  const present = new Set(input.files.map((file) => file.id));
  const missing = [...referencedImageTurnIds(input).keys()].filter((id) => !present.has(id));
  if (!missing.length) return input.files;
  const attachments = await prisma.conversationFile.findMany({
    where: {
      conversationId: input.conversationId,
      id: { in: missing },
      OR: [{ kind: "attachment", status: "bound" }, { kind: "image_preview", status: "registered" }],
      storageBackend: "workspace",
      mimeType: { in: imagePreviewMimeTypeSchema.options },
      checksumSha256: { not: null },
      sizeBytes: { gt: 0n, lte: BigInt(MAX_IMAGE_PREVIEW_BYTES) },
      pendingRequestId: null,
      knowledgeAssetReferenceId: null,
    },
    orderBy: { createdAt: "asc" },
  });
  return [...input.files, ...attachments];
}
