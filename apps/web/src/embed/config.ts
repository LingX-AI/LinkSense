import { z } from "zod"

import { applicationIconSchema, localeSchema } from "@linksense/shared"

export const embedFrameConfigSchema = z.strictObject({
  app_id: z.string().min(16).max(80),
  parent_origin: z.string().url(),
  auth_mode: z.enum(["required", "public"]),
  locale: localeSchema,
  starter_questions: z.array(z.string().trim().min(1).max(500)).max(4),
  application: z.strictObject({
    id: z.string().uuid(),
    name: z.string().min(1).max(160),
    description: z.string().max(4_000).nullable(),
    icon: applicationIconSchema,
    allows_user_model_selection: z.boolean(),
  }),
})

export type EmbedFrameConfig = z.infer<typeof embedFrameConfigSchema>
