import { z } from "zod"
import {
  supportedLocales,
  applicationExternalOriginSchema,
  applicationIconSchema,
} from "@linksense/shared"

export const publicKnowledgeFrameSchema = z.strictObject({
  public_id: z.string().min(24).max(80),
  parent_origin: applicationExternalOriginSchema,
  locale: z.enum(supportedLocales),
  name: z.string(),
  description: z.string().nullable(),
  icon: applicationIconSchema,
  retention_days: z.number().int().positive(),
  show_references: z.boolean().default(true),
})
export type PublicKnowledgeFrame = z.infer<typeof publicKnowledgeFrameSchema>
