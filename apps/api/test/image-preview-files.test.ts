import { describe, expect, it, vi } from "vitest";
import type { ConversationFile } from "../src/generated/prisma/client.js";
import { forkImageFileBinding, includeReferencedImageAttachments, referencedImageTurnIds } from "../src/modules/conversations/image-preview-files.js";
import { MAX_IMAGE_PREVIEW_BYTES, imagePreviewMimeTypeSchema } from "@linksense/shared";

const conversationId = "20000000-0000-4000-8000-000000000001";
const fileId = "30000000-0000-4000-8000-000000000001";
const preview = {
  id: fileId, conversationId, pendingRequestId: null, turnId: "40000000-0000-4000-8000-000000000001",
  kind: "attachment", source: "user_upload", status: "bound", filename: "image.png", mimeType: "image/png",
  sizeBytes: 128n, checksumSha256: "a".repeat(64), storageBackend: "workspace", workspaceRelativePath: `attachments/${fileId}/image.png`,
  workspaceRootRelPath: "owner/home/workspace", minioObjectKey: null, downloadable: false, downloadCardEventId: null,
  knowledgeAssetReferenceId: null, createdBy: null, createdAt: new Date(0), updatedAt: new Date(0),
} satisfies ConversationFile;

describe("referenced image attachments", () => {
  it.each(["attachment", "image_preview"])("loads only an explicitly viewed %s from unloaded history in the same conversation", async (kind) => {
    const file = { ...preview, kind, status: kind === "attachment" ? "bound" : "registered" };
    const findMany = vi.fn(async () => [file]);
    const result = await includeReferencedImageAttachments({ conversationFile: { findMany } } as never, {
      conversationId, files: [], messages: [], events: [{ payloadJson: {
        method: "item/completed", params: { item: { type: "imageView", id: "view-1", fileId } },
      } }],
    });
    expect(result).toEqual([file]);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        conversationId, id: { in: [fileId] }, pendingRequestId: null, knowledgeAssetReferenceId: null,
        OR: [{ kind: "attachment", status: "bound" }, { kind: "image_preview", status: "registered" }],
        storageBackend: "workspace", mimeType: { in: imagePreviewMimeTypeSchema.options },
        checksumSha256: { not: null }, sizeBytes: { gt: 0n, lte: BigInt(MAX_IMAGE_PREVIEW_BYTES) },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("resolves inline image identities without loading arbitrary or cross-conversation files", async () => {
    const findMany = vi.fn(async () => []);
    const result = await includeReferencedImageAttachments({ conversationFile: { findMany } } as never, {
      conversationId, files: [], events: [], messages: [{ contentText: `![image](linksense-artifact:${fileId})` }],
    });
    expect(result).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ conversationId, id: { in: [fileId] } }) }));
  });

  it("does not widen branch scope when referenced files are already present or no valid identity exists", async () => {
    const findMany = vi.fn();
    const result = await includeReferencedImageAttachments({ conversationFile: { findMany } } as never, {
      conversationId, files: [preview], messages: [{ contentText: `![image](linksense-artifact:${fileId}) linksense-artifact:invalid` }],
      events: [{ payloadJson: { method: "item/completed", params: { item: { type: "imageView", fileId: "invalid" } } } }],
    });
    expect(result).toEqual([preview]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(["attachment", "image_preview"])("binds an out-of-branch %s as preview context in the fork rather than an invalid unbound upload", (kind) => {
    const file = { ...preview, kind };
    const referencingTurnId = "40000000-0000-4000-8000-000000000002";
    const copiedTurnId = "40000000-0000-4000-8000-000000000003";
    const references = referencedImageTurnIds({
      events: [{ turnId: referencingTurnId, payloadJson: { method: "item/completed", params: { item: { type: "imageView", fileId } } } }],
      messages: [],
    });
    expect(forkImageFileBinding(file, new Map([[referencingTurnId, copiedTurnId]]), references)).toEqual({
      turnId: copiedTurnId, kind: "image_preview", source: "system_generated", status: "registered", downloadable: false, downloadCardEventId: null,
    });
    expect(file.turnId).toBe(preview.turnId);
    expect(file.kind).toBe(kind);
  });

  it("uses inline message references for fork context and preserves an ordinary copied upload binding", () => {
    const copiedTurnId = "40000000-0000-4000-8000-000000000003";
    const references = referencedImageTurnIds({ events: [], messages: [{ turnId: preview.turnId, contentText: `![image](linksense-artifact:${fileId})` }] });
    expect(references.get(fileId)).toBe(preview.turnId);
    expect(forkImageFileBinding(preview, new Map([[preview.turnId, copiedTurnId]]), references)).toEqual({
      turnId: copiedTurnId, kind: "attachment", source: "user_upload", status: "bound", downloadable: false, downloadCardEventId: null,
    });
    expect(() => forkImageFileBinding(preview, new Map(), new Map())).toThrow("image_preview_fork_turn_unavailable");
  });
});
