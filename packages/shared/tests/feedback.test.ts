import { describe, expect, it } from "vitest";

import {
  FEEDBACK_MAX_CONTENT_LENGTH,
  adminFeedbackPageSchema,
  feedbackContentSchema,
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
});
