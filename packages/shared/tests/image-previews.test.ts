import { describe, expect, it } from "vitest";
import { conversationFileKindSchema } from "../src/conversations.js";
import { imagePreviewRegistrationSchema, imagePreviewRegistrationResultSchema } from "../src/image-previews.js";

const input = {
  conversationId: "20000000-0000-4000-8000-000000000001", turnId: "native-turn",
  workspaceRelativePath: ".linksense/inline-images/preview.png", displayName: "preview.png", mimeType: "image/png",
};

describe("image preview contracts", () => {
  it("keeps preview files distinct from attachments and deliverables", () => {
    for (const kind of ["attachment", "artifact", "image_preview"]) expect(conversationFileKindSchema.parse(kind)).toBe(kind);
  });
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts bounded %s previews", (mimeType) => {
    expect(imagePreviewRegistrationSchema.parse({ ...input, mimeType })).toEqual({ ...input, mimeType });
  });
  it.each([
    { ...input, mimeType: "image/svg+xml" }, { ...input, artifactKind: "inline_image" },
    { ...input, displayName: "" }, { ...input, turnId: "x".repeat(241) },
  ])("rejects unsupported or unbounded input", (value) => {
    expect(imagePreviewRegistrationSchema.safeParse(value).success).toBe(false);
  });
  it("returns a validated file identity without a download card or server path", () => {
    expect(imagePreviewRegistrationResultSchema.safeParse({ file_id: input.conversationId }).success).toBe(true);
    expect(imagePreviewRegistrationResultSchema.safeParse({ file_id: input.conversationId, download_card_event_id: input.conversationId }).success).toBe(false);
  });
});
