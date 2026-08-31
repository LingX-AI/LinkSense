import {
  knowledgeBaseAvailabilityStatusSchema,
  knowledgeBaseCreationCapabilitySchema,
  knowledgeBaseGrantPageSchema,
  knowledgeBaseEntryPageSchema,
  knowledgeBaseGrantRevocationResultSchema,
  knowledgeBaseLifecycleStatusSchema,
  knowledgeBasePermissionsSchema,
  knowledgeBaseSchema,
  knowledgeDocumentEventSchema,
  knowledgeDocumentParsedContentSchema,
  knowledgeDocumentPreviewCapabilitiesSchema,
  knowledgeDocumentProcessingSchema,
  knowledgeDocumentRebuildBatchResultSchema,
  knowledgeDocumentSchema,
  knowledgeDocumentStatusSchema,
  knowledgeBaseGrantSchema,
  knowledgeSearchCapabilitySchema,
  knowledgeShareTargetSchema,
  knowledgeUploadLimitsSchema,
  type KnowledgeBase as SharedKnowledgeBase,
  type KnowledgeBaseCreationCapability as SharedKnowledgeBaseCreationCapability,
  type KnowledgeBaseEntry as SharedKnowledgeBaseEntry,
  type KnowledgeBaseEntryPage as SharedKnowledgeBaseEntryPage,
  type KnowledgeBaseGrant as SharedKnowledgeGrant,
  type KnowledgeBaseGrantRevocationResult as SharedKnowledgeBaseGrantRevocationResult,
  type KnowledgeDocument as SharedKnowledgeDocument,
  type KnowledgeDocumentEvent as SharedKnowledgeDocumentEvent,
  type KnowledgeSearchCapability as SharedKnowledgeSearchCapability,
} from "@linksense/shared"
import { z } from "zod"

export {
  knowledgeBasePermissionsSchema,
  knowledgeBaseSchema,
  knowledgeDocumentSchema,
  knowledgeDocumentStatusSchema,
  knowledgeDocumentProcessingSchema,
  knowledgeDocumentPreviewCapabilitiesSchema as knowledgeDocumentPreviewSchema,
  knowledgeBaseGrantSchema as knowledgeGrantSchema,
  knowledgeBaseGrantPageSchema as knowledgeGrantPageSchema,
  knowledgeBaseGrantRevocationResultSchema as knowledgeGrantRevocationResultSchema,
  knowledgeShareTargetSchema,
  knowledgeDocumentParsedContentSchema as knowledgeDocumentContentSchema,
  knowledgeDocumentEventSchema as knowledgeBaseEventSchema,
  knowledgeDocumentRebuildBatchResultSchema,
  knowledgeUploadLimitsSchema,
  knowledgeSearchCapabilitySchema,
  knowledgeBaseCreationCapabilitySchema,
  knowledgeBaseEntryPageSchema,
}

export const knowledgeBaseLifecycleSchema =
  knowledgeBaseLifecycleStatusSchema.exclude(["deleted"])
export const knowledgeBaseAvailabilitySchema =
  knowledgeBaseAvailabilityStatusSchema

export type KnowledgeBaseLifecycle = z.infer<
  typeof knowledgeBaseLifecycleSchema
>
export type KnowledgeDocumentStatus = z.infer<
  typeof knowledgeDocumentStatusSchema
>
export type KnowledgeBase = SharedKnowledgeBase
export type KnowledgeDocument = SharedKnowledgeDocument & {
  /** Client-only SSE reconciliation cursor; never sent by the API. */
  event_revision?: number
}
export type KnowledgeBaseEntry =
  | (Omit<
      Extract<SharedKnowledgeBaseEntry, { entry_type: "folder" }>,
      "document"
    > & { document: null })
  | (Omit<
      Extract<SharedKnowledgeBaseEntry, { entry_type: "document" }>,
      "document"
    > & { document: KnowledgeDocument })
export type KnowledgeBaseEntryPage = Omit<
  SharedKnowledgeBaseEntryPage,
  "items"
> & {
  items: KnowledgeBaseEntry[]
}
export type KnowledgeGrant = SharedKnowledgeGrant
export type KnowledgeGrantRevocationResult =
  SharedKnowledgeBaseGrantRevocationResult
export type KnowledgeShareTarget = z.infer<typeof knowledgeShareTargetSchema>
export type KnowledgeDocumentContent = z.infer<
  typeof knowledgeDocumentParsedContentSchema
>
export type KnowledgeBaseEvent = SharedKnowledgeDocumentEvent
export type KnowledgeUploadLimits = z.infer<typeof knowledgeUploadLimitsSchema>
export type KnowledgeSearchCapability = SharedKnowledgeSearchCapability
export type KnowledgeBaseCreationCapability =
  SharedKnowledgeBaseCreationCapability

export const knowledgeBasePageSchema = z.strictObject({
  items: z.array(knowledgeBaseSchema),
  next_cursor: z.string().uuid().nullable().optional(),
})

export const knowledgeDocumentPageSchema = z.strictObject({
  items: z.array(knowledgeDocumentSchema),
  next_cursor: z.string().uuid().nullable().optional(),
  has_processing_documents: z.boolean().default(false),
})

export const knowledgeShareTargetPageSchema = z.strictObject({
  items: z.array(knowledgeShareTargetSchema),
  next_cursor: z.string().uuid().nullable().optional(),
})

export const knowledgeUploadConflictSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("duplicate"),
    existing_document: knowledgeDocumentSchema,
  }),
  z.strictObject({
    status: z.literal("name_conflict"),
    existing_document: knowledgeDocumentSchema,
  }),
])

export const knowledgeUploadResultSchema = z.union([
  knowledgeDocumentSchema.transform((document) => ({
    status: "accepted" as const,
    document,
  })),
  knowledgeUploadConflictSchema,
])

export type KnowledgeUploadResult = z.infer<typeof knowledgeUploadResultSchema>

export type KnowledgeDocumentRebuildBatchResult = z.infer<
  typeof knowledgeDocumentRebuildBatchResultSchema
>
