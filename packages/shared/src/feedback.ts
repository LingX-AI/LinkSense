import { z } from "zod";

export const FEEDBACK_MAX_CONTENT_LENGTH = 2_000;
export const FEEDBACK_MAX_IMAGES = 9;
export const FEEDBACK_MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const FEEDBACK_MAX_TOTAL_IMAGE_SIZE_BYTES =
  FEEDBACK_MAX_IMAGES * FEEDBACK_MAX_IMAGE_SIZE_BYTES;

export const feedbackImageMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const feedbackContentSchema = z
  .string()
  .trim()
  .min(1)
  .max(FEEDBACK_MAX_CONTENT_LENGTH);

export const feedbackSubmissionResultSchema = z.strictObject({
  id: z.string().uuid(),
  created_at: z.iso.datetime({ offset: true }),
  image_count: z.number().int().min(0).max(FEEDBACK_MAX_IMAGES),
});

export const feedbackImageSchema = z.strictObject({
  id: z.string().uuid(),
  filename: z.string().min(1).max(260),
  mime_type: feedbackImageMimeTypeSchema,
  size_bytes: z.number().int().positive().max(FEEDBACK_MAX_IMAGE_SIZE_BYTES),
  sort_order: z
    .number()
    .int()
    .min(0)
    .max(FEEDBACK_MAX_IMAGES - 1),
});

export const adminFeedbackSchema = z.strictObject({
  id: z.string().uuid(),
  content: feedbackContentSchema,
  created_at: z.iso.datetime({ offset: true }),
  submitter: z.strictObject({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    email: z.email(),
  }),
  images: z.array(feedbackImageSchema).max(FEEDBACK_MAX_IMAGES),
  reply_count: z.number().int().nonnegative(),
});

export const myFeedbackSchema = adminFeedbackSchema.omit({ submitter: true });
export const myFeedbackPageSchema = z.strictObject({
  items: z.array(myFeedbackSchema),
  next_cursor: z.string().uuid().nullable(),
});

export const feedbackReplyContentSchema = z
  .string()
  .trim()
  .max(FEEDBACK_MAX_CONTENT_LENGTH);
export const feedbackReplyInputSchema = z
  .strictObject({
    content: feedbackReplyContentSchema,
    image_count: z.number().int().min(0).max(FEEDBACK_MAX_IMAGES),
  })
  .refine((input) => input.content.length > 0 || input.image_count > 0);

export const feedbackReplySchema = z.strictObject({
  id: z.string().uuid(),
  author: z.strictObject({
    name: z.string().min(1).max(120),
  }),
  content: feedbackReplyContentSchema,
  created_at: z.iso.datetime({ offset: true }),
  images: z.array(feedbackImageSchema).max(FEEDBACK_MAX_IMAGES),
});
export const feedbackDetailsSchema = myFeedbackSchema.extend({
  replies: z.array(feedbackReplySchema),
});

export const adminFeedbackPageSchema = z.strictObject({
  items: z.array(adminFeedbackSchema),
  next_cursor: z.string().uuid().nullable(),
});

export type FeedbackImageMimeType = z.infer<typeof feedbackImageMimeTypeSchema>;
export type FeedbackSubmissionResult = z.infer<
  typeof feedbackSubmissionResultSchema
>;
export type FeedbackImage = z.infer<typeof feedbackImageSchema>;
export type AdminFeedback = z.infer<typeof adminFeedbackSchema>;
export type AdminFeedbackPage = z.infer<typeof adminFeedbackPageSchema>;
export type MyFeedback = z.infer<typeof myFeedbackSchema>;
export type MyFeedbackPage = z.infer<typeof myFeedbackPageSchema>;
export type FeedbackReply = z.infer<typeof feedbackReplySchema>;
export type FeedbackDetails = z.infer<typeof feedbackDetailsSchema>;
