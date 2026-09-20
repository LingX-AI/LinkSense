import { describe, expect, it } from "vitest";

import {
  FEEDBACK_MAX_CONTENT_LENGTH,
  adminFeedbackPageSchema,
  feedbackContentSchema,
  feedbackReplyInputSchema,
  feedbackDetailsSchema,
  feedbackImageMimeTypeSchema,
} from "../src/feedback.js";

describe("feedback contracts", () => {
  it("trims required feedback content and enforces the character limit", () => {
    expect(feedbackContentSchema.parse("  改进建议  ")).toBe("改进建议");
    expect(feedbackContentSchema.safeParse("   ").success).toBe(false);
    expect(
      feedbackContentSchema.safeParse(
        "a".repeat(FEEDBACK_MAX_CONTENT_LENGTH + 1),
      ).success,
    ).toBe(false);
  });

  it("accepts only the supported image MIME types", () => {
    expect(feedbackImageMimeTypeSchema.parse("image/webp")).toBe("image/webp");
    expect(feedbackImageMimeTypeSchema.safeParse("image/svg+xml").success).toBe(
      false,
    );
  });

  it("does not expose object storage keys in the administrator contract", () => {
    const result = adminFeedbackPageSchema.safeParse({
      items: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          content: "改进建议",
          reply_count: 0,
          created_at: "2026-08-03T00:00:00.000Z",
          submitter: {
            id: "10000000-0000-4000-8000-000000000002",
            name: "林晓",
            email: "lin@example.com",
          },
          images: [
            {
              id: "10000000-0000-4000-8000-000000000003",
              filename: "screen.png",
              mime_type: "image/png",
              size_bytes: 1024,
              sort_order: 0,
              object_key: "feedbacks/private/screen.png",
            },
          ],
        },
      ],
      next_cursor: null,
    });

    expect(result.success).toBe(false);
  });
  it("requires text or images for a reply and enforces all limits", () => {
    expect(
      feedbackReplyInputSchema.parse({ content: "  reply  ", image_count: 0 })
        .content,
    ).toBe("reply");
    expect(
      feedbackReplyInputSchema.safeParse({ content: "", image_count: 1 })
        .success,
    ).toBe(true);
    for (const input of [
      { content: " ", image_count: 0 },
      { content: "a".repeat(2001), image_count: 0 },
      { content: "reply", image_count: 10 },
    ]) {
      expect(feedbackReplyInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("requires reply status and exposes only the reply author's display identity", () => {
    const details = {
      id: "10000000-0000-4000-8000-000000000001",
      content: "feedback",
      images: [],
      created_at: "2026-09-09T00:00:00.000Z",
      replies: [],
    };
    expect(feedbackDetailsSchema.safeParse(details).success).toBe(false);
    expect(
      feedbackDetailsSchema.safeParse({ ...details, reply_count: 0 }).success,
    ).toBe(true);
    expect(
      feedbackDetailsSchema.safeParse({
        ...details,
        reply_count: 1,
        replies: [
          {
            id: "10000000-0000-4000-8000-000000000003",
            author: {
              name: "周蕊",
              email: "private@example.com",
            },
            content: "reply",
            created_at: "2026-09-09T01:00:00.000Z",
            images: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      feedbackDetailsSchema.safeParse({
        ...details,
        reply_count: 1,
        replies: [
          {
            id: "10000000-0000-4000-8000-000000000003",
            author: {
              name: "周蕊",
            },
            content: "reply",
            created_at: "2026-09-09T01:00:00.000Z",
            images: [],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
