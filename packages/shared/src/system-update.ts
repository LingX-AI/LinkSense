import { z } from "zod";

import { timestampSchema } from "./common.js";

export const releaseVersionSchema = z
  .string()
  .regex(/^v\d+\.\d+\.\d+$/u);

export const systemReleaseSchema = z.strictObject({
  version: releaseVersionSchema,
  name: z.string().trim().min(1).max(200),
  published_at: timestampSchema,
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  }, "system_release_url_must_be_github_https"),
  release_notes: z.string().max(100_000).nullable(),
});

export const systemUpdateCheckErrorCodeSchema = z.enum([
  "GITHUB_UNAVAILABLE",
  "GITHUB_RATE_LIMITED",
  "GITHUB_RESPONSE_INVALID",
]);

export const systemUpdateStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.enum(["update_available", "up_to_date"]),
    current_version: releaseVersionSchema,
    latest_release: systemReleaseSchema,
    checked_at: timestampSchema,
    error_code: z.null(),
  }),
  z.strictObject({
    status: z.literal("check_failed"),
    current_version: releaseVersionSchema,
    latest_release: z.null(),
    checked_at: timestampSchema,
    error_code: systemUpdateCheckErrorCodeSchema,
  }),
]);

export type SystemRelease = z.infer<typeof systemReleaseSchema>;
export type SystemUpdateStatus = z.infer<typeof systemUpdateStatusSchema>;
export type SystemUpdateCheckErrorCode = z.infer<
  typeof systemUpdateCheckErrorCodeSchema
>;
