import { z } from "zod";

import { timestampSchema, uniqueArraySchema, uuidSchema } from "./common.js";
import {
  createKnowledgeBaseWithSourceInputSchema,
  knowledgeBaseSourceTypeSchema,
  knowledgeSourceSyncStatusSchema,
} from "./knowledge-sources.js";

export const knowledgeBaseLifecycleStatusSchema = z.enum([
  "active",
  "archived",
  "deleted",
]);
export const knowledgeBaseAvailabilityStatusSchema = z.enum([
  "enabled",
  "disabled",
]);
export const knowledgeCleanupStatusSchema = z.enum([
  "pending",
  "running",
  "failed",
  "completed",
]);

export const knowledgeDocumentStatusSchema = z.enum([
  "processing",
  "ready",
  "failed",
  "deleted",
]);
export const knowledgeDocumentVersionStatusSchema = z.enum([
  "processing",
  "ready",
  "failed",
  "superseded",
  "deleted",
]);
export const knowledgeProcessingOperationSchema = z.enum([
  "upload",
  "replace",
  "retry",
  "reprocess",
  "rebuild_index",
]);
export const knowledgeProcessingStageSchema = z.enum([
  "uploading",
  "validating",
  "queued",
  "parsing",
  "chunking",
  "image_understanding",
  "parenting",
  "embedding",
  "indexing",
  "activating",
  "completed",
  "failed",
]);

export const knowledgeDocumentFormatSchema = z.enum([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "vsdx",
  "odt",
  "ods",
  "odp",
  "txt",
  "md",
  "html",
  "htm",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "bmp",
  "webp",
]);

export const knowledgeDocumentFormats = knowledgeDocumentFormatSchema.options;
export const knowledgeFilePreviewFormats = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
  "txt",
  "md",
  "html",
  "htm",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "tif",
  "tiff",
  "bmp",
  "webp",
] as const satisfies readonly z.infer<typeof knowledgeDocumentFormatSchema>[];
export const knowledgeImagePreviewFormats = [
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const satisfies readonly z.infer<typeof knowledgeDocumentFormatSchema>[];
export const knowledgeBaseIdsSchema = uniqueArraySchema(uuidSchema);
export const knowledgeByteCountSchema = z.number().int().safe().nonnegative();
export const knowledgeSha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const knowledgePageNumbersSchema = uniqueArraySchema(
  z.number().int().positive(),
)
  .max(1_000)
  .refine(
    (pages) =>
      pages.every((page, index) => index === 0 || pages[index - 1]! < page),
    { message: "page_numbers_must_be_sorted" },
  );

export const knowledgeUploadLimitsSchema = z.strictObject({
  max_file_size_bytes: z.number().int().safe().positive(),
  max_files_per_batch: z.number().int().safe().positive(),
  storage_quota_bytes: z.number().int().safe().positive(),
});

export const knowledgeSearchCapabilitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    reason_code: z.null(),
    checked_at: timestampSchema,
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason_code: z.enum([
      "EMBEDDING_DIMENSION_MISMATCH",
      "KNOWLEDGE_SEARCH_UNAVAILABLE",
    ]),
    checked_at: timestampSchema,
  }),
  z.strictObject({
    status: z.literal("not_installed"),
    reason_code: z.literal("KNOWLEDGE_NOT_INSTALLED"),
    checked_at: timestampSchema,
  }),
]);
export type KnowledgeSearchCapability = z.infer<
  typeof knowledgeSearchCapabilitySchema
>;

const knowledgeCreationChecksSchema = z.strictObject({
  object_storage: z.enum(["available", "unavailable"]),
  document_parsing: z.enum(["available", "unavailable"]),
  embedding_model: z.enum([
    "available",
    "not_configured",
    "unavailable",
  ]),
  search_and_indexing: z.enum(["available", "unavailable"]),
});

export const knowledgeBaseCreationCapabilitySchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      status: z.literal("ready"),
      checks: z.strictObject({
        object_storage: z.literal("available"),
        document_parsing: z.literal("available"),
        embedding_model: z.literal("available"),
        search_and_indexing: z.literal("available"),
      }),
      checked_at: timestampSchema,
    }),
    z.strictObject({
      status: z.literal("unready"),
      checks: knowledgeCreationChecksSchema,
      checked_at: timestampSchema,
    }),
    z.strictObject({
      status: z.literal("not_installed"),
      checks: z.null(),
      checked_at: timestampSchema,
    }),
  ],
);
export type KnowledgeBaseCreationCapability = z.infer<
  typeof knowledgeBaseCreationCapabilitySchema
>;

export const createKnowledgeBaseInputSchema =
  createKnowledgeBaseWithSourceInputSchema;

export const updateKnowledgeBaseInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "knowledge_base_update_must_not_be_empty",
  });

export const knowledgeBaseListQuerySchema = z.strictObject({
  scope: z.enum(["all", "owned", "shared"]).default("all"),
  lifecycle_status: z.enum(["all", "active", "archived"]).optional(),
  search: z.string().trim().max(160).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const knowledgeBaseOwnerSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(120),
});

export const knowledgeBasePermissionsSchema = z.strictObject({
  view_content: z.boolean(),
  update: z.boolean(),
  manage_documents: z.boolean(),
  manage_grants: z.boolean(),
  create_grants: z.boolean(),
  revoke_grants: z.boolean(),
  archive: z.boolean(),
  restore: z.boolean(),
  delete: z.boolean(),
  remove_direct_share: z.boolean(),
});

export const knowledgeBaseSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(4_000).nullable(),
  source_type: knowledgeBaseSourceTypeSchema.default("local"),
  source_sync: z
    .strictObject({
      status: knowledgeSourceSyncStatusSchema,
      stable_error_code: z.string().max(120).nullable(),
      last_synced_at: timestampSchema.nullable(),
    })
    .nullable()
    .default(null),
  lifecycle_status: knowledgeBaseLifecycleStatusSchema,
  availability_status: knowledgeBaseAvailabilityStatusSchema,
  owner: knowledgeBaseOwnerSchema,
  is_owner: z.boolean(),
  access_sources: z.array(
    z.strictObject({
      type: z.enum(["owner", "direct", "user_group"]),
      id: uuidSchema.optional(),
      name: z.string().max(120).optional(),
    }),
  ),
  document_count: z.number().int().nonnegative(),
  ready_document_count: z.number().int().nonnegative(),
  storage_used_bytes: knowledgeByteCountSchema,
  storage_reserved_bytes: knowledgeByteCountSchema,
  storage_quota_bytes: knowledgeByteCountSchema,
  permissions: knowledgeBasePermissionsSchema,
  archived_at: timestampSchema.nullable(),
  disabled_reason: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const knowledgeBaseGrantTargetTypeSchema = z.enum([
  "user",
  "user_group",
]);
export const createKnowledgeBaseGrantInputSchema = z.strictObject({
  target_type: knowledgeBaseGrantTargetTypeSchema,
  target_id: uuidSchema,
});
export const revokeKnowledgeBaseGrantInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_000).optional(),
});
export const knowledgeBaseGrantListQuerySchema = z.strictObject({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const knowledgeBaseGrantSchema = z.strictObject({
  id: uuidSchema,
  knowledge_base_id: uuidSchema,
  target_type: knowledgeBaseGrantTargetTypeSchema,
  target: z.strictObject({
    id: uuidSchema,
    name: z.string().min(1).max(120),
    email_hint: z.string().nullable(),
  }),
  status: z.enum(["active", "revoked"]),
  can_revoke: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  revoked_at: timestampSchema.nullable(),
});
export const knowledgeBaseGrantPageSchema = z.strictObject({
  items: z.array(knowledgeBaseGrantSchema),
  next_cursor: uuidSchema.nullable(),
});

export const knowledgeBaseGrantAccessSourceTypeSchema = z.enum([
  "owner",
  "direct",
  "user_group",
]);
const knowledgeBaseGrantAccessSourceTypesSchema = uniqueArraySchema(
  knowledgeBaseGrantAccessSourceTypeSchema,
);
const remainingUserKnowledgeBaseAccessSchema = z
  .strictObject({
    subject_type: z.literal("user"),
    has_access: z.boolean(),
    source_types: knowledgeBaseGrantAccessSourceTypesSchema,
  })
  .superRefine((result, context) => {
    if (result.has_access !== result.source_types.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["source_types"],
        message: "remaining_access_sources_must_match_access_status",
      });
    }
  });
const remainingUserGroupKnowledgeBaseAccessSchema = z
  .strictObject({
    subject_type: z.literal("user_group"),
    member_access: z.enum(["none", "some", "all"]),
    source_types: knowledgeBaseGrantAccessSourceTypesSchema,
  })
  .superRefine((result, context) => {
    if ((result.member_access !== "none") !== result.source_types.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["source_types"],
        message: "remaining_member_sources_must_match_access_status",
      });
    }
  });
export const knowledgeBaseGrantRevocationResultSchema = z
  .strictObject({
    revoked_grant_id: uuidSchema,
    target_type: knowledgeBaseGrantTargetTypeSchema,
    target_id: uuidSchema,
    remaining_access: z.union([
      remainingUserKnowledgeBaseAccessSchema,
      remainingUserGroupKnowledgeBaseAccessSchema,
    ]),
  })
  .superRefine((result, context) => {
    if (result.target_type !== result.remaining_access.subject_type) {
      context.addIssue({
        code: "custom",
        path: ["remaining_access", "subject_type"],
        message: "remaining_access_subject_must_match_target_type",
      });
    }
  });

export const knowledgeShareTargetQuerySchema = z.strictObject({
  knowledge_base_id: uuidSchema.optional(),
  type: z.enum(["user", "group"]),
  search: z.string().trim().max(160).default(""),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const knowledgeShareTargetSchema = z.strictObject({
  id: uuidSchema,
  type: z.enum(["user", "group"]),
  name: z.string().min(1).max(120),
  secondary_label: z.string().nullable(),
});

export const knowledgeDocumentProcessingSchema = z.strictObject({
  operation: z.enum(["upload", "replace", "retry", "reprocess", "rebuild"]),
  processing_generation: uuidSchema,
  stage: knowledgeProcessingStageSchema,
  progress_percent: z.number().int().min(0).max(100),
  revision: z.number().int().safe().nonnegative(),
  stable_error_code: z.string().max(120).nullable(),
  retry_at: timestampSchema.nullable(),
  retry_attempt: z.number().int().min(0).max(2),
  cancellable: z.boolean(),
});
export const knowledgeDocumentPreviewCapabilitiesSchema = z.strictObject({
  parsed: z.literal(true),
  original_supported: z.boolean(),
  renderer: z.literal("file").nullable(),
});
export const knowledgeDocumentCandidateFailureSchema = z.strictObject({
  operation: z.enum(["upload", "replace", "retry", "reprocess", "rebuild"]),
  processing_generation: uuidSchema,
  revision: z.number().int().safe().nonnegative(),
  stable_error_code: z.string().min(1).max(120),
  retryable: z.literal(true),
});
export const knowledgeDocumentSchema = z.strictObject({
  id: uuidSchema,
  knowledge_base_id: uuidSchema,
  display_name: z.string().min(1).max(260),
  canonical_extension: knowledgeDocumentFormatSchema,
  mime_type: z.string().min(1).max(160),
  size_bytes: knowledgeByteCountSchema,
  status: knowledgeDocumentStatusSchema,
  current_version_id: uuidSchema.nullable(),
  searchable: z.boolean(),
  rebuild_required: z.boolean(),
  processing: knowledgeDocumentProcessingSchema.nullable(),
  candidate_failure: knowledgeDocumentCandidateFailureSchema.nullable(),
  preview: knowledgeDocumentPreviewCapabilitiesSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const knowledgeBaseEntryTypeSchema = z.enum(["folder", "document"]);
export const knowledgeBaseEntryBreadcrumbSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(260),
});
const knowledgeBaseEntryBaseSchema = z.strictObject({
  id: uuidSchema,
  knowledge_base_id: uuidSchema,
  parent_entry_id: uuidSchema.nullable(),
  name: z.string().min(1).max(260),
  path: z.array(z.string().min(1).max(260)).min(1).max(65).optional(),
  updated_at: timestampSchema,
});
export const knowledgeBaseFolderEntrySchema =
  knowledgeBaseEntryBaseSchema.extend({
    entry_type: z.literal("folder"),
    document: z.null(),
  });
export const knowledgeBaseDocumentEntrySchema =
  knowledgeBaseEntryBaseSchema.extend({
    entry_type: z.literal("document"),
    document: knowledgeDocumentSchema,
  });
export const knowledgeBaseEntrySchema = z.discriminatedUnion("entry_type", [
  knowledgeBaseFolderEntrySchema,
  knowledgeBaseDocumentEntrySchema,
]);
export const knowledgeBaseEntryListQuerySchema = z.strictObject({
  parent_entry_id: uuidSchema.optional(),
  view: z.enum(["directory", "flat"]).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export const knowledgeBaseEntryPageSchema = z.strictObject({
  breadcrumbs: z.array(knowledgeBaseEntryBreadcrumbSchema).max(64),
  items: z.array(knowledgeBaseEntrySchema),
  next_cursor: uuidSchema.nullable(),
});

export const knowledgeDocumentRebuildBatchSize = 100;
const knowledgeDocumentRebuildIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(knowledgeDocumentRebuildBatchSize)
  .superRefine((items, context) => {
    if (items.length > knowledgeDocumentRebuildBatchSize) return;
    if (new Set(items).size !== items.length) {
      context.addIssue({
        code: "custom",
        message: "array_must_contain_unique_items",
      });
    }
  });
export const knowledgeDocumentRebuildInputSchema = z.union([
  z.strictObject({
    document_ids: knowledgeDocumentRebuildIdsSchema,
    cursor: z.never().optional(),
  }),
  z.strictObject({
    document_ids: z.never().optional(),
    cursor: uuidSchema.optional(),
  }),
]);

export const knowledgeDocumentRebuildBatchResultSchema = z.strictObject({
  items: z
    .array(
      z.discriminatedUnion("status", [
        z.strictObject({
          document_id: uuidSchema,
          status: z.literal("accepted"),
          document: knowledgeDocumentSchema,
        }),
        z.strictObject({
          document_id: uuidSchema,
          status: z.literal("rejected"),
          error_code: z.string().min(1).max(120),
        }),
      ]),
    )
    .max(knowledgeDocumentRebuildBatchSize),
  next_cursor: uuidSchema.nullable(),
});

export const knowledgeDocumentListQuerySchema = z.strictObject({
  search: z.string().trim().max(260).optional(),
  status: knowledgeDocumentStatusSchema.exclude(["deleted"]).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const knowledgeUploadConflictResolutionSchema = z.enum([
  "replace",
  "keep_both",
  "replace_path",
]);
const knowledgeUploadOcrEnabledSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
export const knowledgeDocumentUploadOptionsSchema = z.union([
  z.strictObject({
    conflict_resolution: z.literal("replace"),
    replace_document_id: uuidSchema,
    ocr_enabled: knowledgeUploadOcrEnabledSchema,
    relative_path: z.string().min(1).max(16_384).optional(),
    parent_entry_id: uuidSchema.optional(),
  }),
  z.strictObject({
    conflict_resolution: z.literal("keep_both"),
    replace_document_id: z.never().optional(),
    ocr_enabled: knowledgeUploadOcrEnabledSchema,
    relative_path: z.string().min(1).max(16_384).optional(),
    parent_entry_id: uuidSchema.optional(),
  }),
  z.strictObject({
    conflict_resolution: z.literal("replace_path"),
    replace_document_id: z.never().optional(),
    ocr_enabled: knowledgeUploadOcrEnabledSchema,
    relative_path: z.string().min(1).max(16_384),
    parent_entry_id: uuidSchema.optional(),
  }),
  z.strictObject({
    conflict_resolution: z.undefined().optional(),
    replace_document_id: z.never().optional(),
    ocr_enabled: knowledgeUploadOcrEnabledSchema,
    relative_path: z.string().min(1).max(16_384).optional(),
    parent_entry_id: uuidSchema.optional(),
  }),
]);

export const knowledgeDocumentCommandInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_000).optional(),
});
export const deleteKnowledgeResourceInputSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1_000),
});

export const knowledgeDocumentParsedContentSchema = z.strictObject({
  document_id: uuidSchema,
  document_version_id: uuidSchema,
  markdown: z.string(),
});

export const knowledgeDocumentEventSchema = z.strictObject({
  type: z.enum([
    "knowledge_document_processing_updated",
    "knowledge_document_deleted",
  ]),
  knowledge_base_id: uuidSchema,
  document_id: uuidSchema,
  processing_generation: uuidSchema.nullable(),
  status: knowledgeDocumentStatusSchema,
  stage: knowledgeProcessingStageSchema.nullable(),
  progress_percent: z.number().int().min(0).max(100).nullable(),
  revision: z.number().int().safe().nonnegative(),
  retry_at: timestampSchema.nullable(),
  retry_attempt: z.number().int().min(0).max(2),
  stable_error_code: z.string().max(120).nullable(),
  updated_at: timestampSchema,
});

export const KNOWLEDGE_SEARCH_MAX_NUM_CANDIDATES = 10_000;

export const searchKnowledgeBaseInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(32_000),
  final_top_k: z.number().int().min(1).max(100).default(5),
  candidate_multiplier: z.number().int().min(1).max(10).default(3),
  num_candidates: z
    .number()
    .int()
    .positive()
    .max(KNOWLEDGE_SEARCH_MAX_NUM_CANDIDATES)
    .optional(),
  min_score: z.number().finite().default(0.2),
});

export const knowledgeDocumentReferenceSchema = z.string().min(16).max(256);
export const knowledgeDocumentCursorSchema = z.string().min(16).max(256);

export const listKnowledgeDocumentsInputSchema = z.strictObject({
  cursor: knowledgeDocumentCursorSchema.optional(),
});

export const knowledgeDocumentListItemSchema = z.strictObject({
  document_ref: knowledgeDocumentReferenceSchema,
  knowledge_base_name: z.string().min(1).max(200),
  document_name: z.string().min(1).max(260),
  file_type: knowledgeDocumentFormatSchema,
});

export const knowledgeDocumentListSuccessSchema = z.strictObject({
  success: z.literal(true),
  documents: z.array(knowledgeDocumentListItemSchema).max(100),
  next_cursor: knowledgeDocumentCursorSchema.nullable(),
  unavailable_knowledge_base_count: z.number().int().nonnegative().default(0),
});

export const getKnowledgeDocumentMarkdownInputSchema = z.strictObject({
  document_ref: knowledgeDocumentReferenceSchema,
  cursor: knowledgeDocumentCursorSchema.optional(),
});

export const knowledgeDocumentMarkdownSuccessSchema = z.strictObject({
  success: z.literal(true),
  document_ref: knowledgeDocumentReferenceSchema,
  knowledge_base_name: z.string().min(1).max(200),
  document_name: z.string().min(1).max(260),
  file_type: knowledgeDocumentFormatSchema,
  markdown: z.string(),
  chunk_index: z.number().int().nonnegative(),
  byte_start: z.number().int().safe().nonnegative(),
  byte_end: z.number().int().safe().nonnegative(),
  total_bytes: z.number().int().safe().nonnegative(),
  next_cursor: knowledgeDocumentCursorSchema.nullable(),
  complete: z.boolean(),
});

export const knowledgeDocumentToolFailureCodeSchema = z.enum([
  "KNOWLEDGE_DOCUMENT_LIST_INVALID",
  "KNOWLEDGE_DOCUMENT_LIST_FORBIDDEN",
  "KNOWLEDGE_DOCUMENT_LIST_UNAVAILABLE",
  "KNOWLEDGE_DOCUMENT_MARKDOWN_INVALID",
  "KNOWLEDGE_DOCUMENT_MARKDOWN_FORBIDDEN",
  "KNOWLEDGE_DOCUMENT_MARKDOWN_NOT_FOUND",
  "KNOWLEDGE_DOCUMENT_MARKDOWN_UNAVAILABLE",
  "KNOWLEDGE_NO_AVAILABLE_BASES",
]);

export const knowledgeDocumentToolFailureSchema = z.strictObject({
  code: knowledgeDocumentToolFailureCodeSchema,
  retryable: z.boolean(),
});

export const knowledgeSearchResultItemSchema = z.strictObject({
  source_ref: z.string().min(16).max(256),
  citation_marker: z.string().min(1).max(320),
  document_ref: knowledgeDocumentReferenceSchema,
  knowledge_base_name: z.string().min(1).max(200),
  document_name: z.string().min(1).max(260),
  document_version_id: uuidSchema,
  title_path: z.array(z.string().min(1).max(500)).max(64),
  page_numbers: knowledgePageNumbersSchema,
  location: z.string().min(1).max(1_000),
  content: z.string().min(1),
});

export const knowledgeSearchSuccessSchema = z.strictObject({
  success: z.literal(true),
  results: z.array(knowledgeSearchResultItemSchema),
  unavailable_knowledge_base_count: z.number().int().nonnegative().default(0),
});

export const knowledgeSearchFailureCodeSchema = z.enum([
  "KNOWLEDGE_SEARCH_INVALID",
  "KNOWLEDGE_SEARCH_FORBIDDEN",
  "KNOWLEDGE_SEARCH_UNAVAILABLE",
  "KNOWLEDGE_NO_AVAILABLE_BASES",
]);

export const knowledgeNoAvailableBasesCodeSchema = z.literal(
  knowledgeSearchFailureCodeSchema.enum.KNOWLEDGE_NO_AVAILABLE_BASES,
);

export const knowledgeSearchFailureSchema = z.strictObject({
  code: knowledgeSearchFailureCodeSchema,
  retryable: z.boolean(),
});

export const knowledgeCitationProjectionSourceSchema = z.strictObject({
  knowledge_base_id: uuidSchema,
  document_id: uuidSchema,
  document_version_id: uuidSchema,
  parent_id: z.string().min(1).max(160),
  title_path: z.array(z.string().max(500)).max(64).default([]),
  matched_child_ids: uniqueArraySchema(z.string().min(1).max(160)).default([]),
  page_numbers: knowledgePageNumbersSchema.default([]),
});

export const knowledgeCitationProjectionSchema = z.strictObject({
  citation_no: z.number().int().positive(),
  source: knowledgeCitationProjectionSourceSchema,
  anchor_offsets_utf16: uniqueArraySchema(z.number().int().nonnegative()).min(
    1,
  ),
});

/**
 * Browser-safe citation metadata. Exact source identifiers, version ids,
 * parent ids and source ranges stay server-side in the citation relation.
 */
export const knowledgeCitationDisplaySummarySchema = z.strictObject({
  knowledge_base_name: z.string().min(1).max(160),
  document_name: z.string().min(1).max(260),
  title_path: z.array(z.string().max(500)).max(64),
  page_numbers: knowledgePageNumbersSchema,
});

export const knowledgeCitationAnchorSchema = z.strictObject({
  occurrence_no: z.number().int().positive(),
  after_offset_utf16: z.number().int().nonnegative(),
});

export const publicKnowledgeCitationSchema = z.strictObject({
  citation_id: uuidSchema,
  citation_no: z.number().int().positive(),
  anchors: z.array(knowledgeCitationAnchorSchema).min(1),
  summary: knowledgeCitationDisplaySummarySchema,
});

export const knowledgeCitationOriginalCapabilitySchema = z.discriminatedUnion(
  "supported",
  [
    z.strictObject({
      supported: z.literal(true),
      renderer: z.literal("file"),
    }),
    z.strictObject({
      supported: z.literal(false),
      renderer: z.null(),
    }),
  ],
);

const availableKnowledgeCitationPreviewSchema = z.strictObject({
  status: z.literal("available"),
  citation_id: uuidSchema,
  citation_no: z.number().int().positive(),
  summary: knowledgeCitationDisplaySummarySchema,
  parent_excerpt: z.string().min(1),
  original: knowledgeCitationOriginalCapabilitySchema,
});

const historicalUnavailableKnowledgeCitationPreviewSchema = z.strictObject({
  status: z.literal("historical_unavailable"),
  citation_id: uuidSchema,
  citation_no: z.number().int().positive(),
  summary: knowledgeCitationDisplaySummarySchema,
});

export const knowledgeCitationPreviewSchema = z.discriminatedUnion("status", [
  availableKnowledgeCitationPreviewSchema,
  historicalUnavailableKnowledgeCitationPreviewSchema,
]);

/**
 * Browser-safe notification that the persisted source behind a citation may
 * have changed. Source resource identifiers intentionally remain server-side;
 * the client must reauthorize the citation by its opaque citation id.
 */
export const knowledgeCitationEventSchema = z.strictObject({
  type: z.literal("knowledge_citation_source_changed"),
});

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;
export type KnowledgeBaseGrant = z.infer<typeof knowledgeBaseGrantSchema>;
export type KnowledgeBaseGrantRevocationResult = z.infer<
  typeof knowledgeBaseGrantRevocationResultSchema
>;
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
export type KnowledgeBaseEntry = z.infer<typeof knowledgeBaseEntrySchema>;
export type KnowledgeBaseEntryPage = z.infer<
  typeof knowledgeBaseEntryPageSchema
>;
export type KnowledgeDocumentRebuildInput = z.infer<
  typeof knowledgeDocumentRebuildInputSchema
>;
export type KnowledgeDocumentRebuildBatchResult = z.infer<
  typeof knowledgeDocumentRebuildBatchResultSchema
>;
export type KnowledgeDocumentEvent = z.infer<
  typeof knowledgeDocumentEventSchema
>;
export type KnowledgeCitationProjection = z.infer<
  typeof knowledgeCitationProjectionSchema
>;
export type PublicKnowledgeCitation = z.infer<
  typeof publicKnowledgeCitationSchema
>;
export type KnowledgeCitationPreview = z.infer<
  typeof knowledgeCitationPreviewSchema
>;
export type KnowledgeCitationEvent = z.infer<
  typeof knowledgeCitationEventSchema
>;
export type KnowledgeSearchSuccess = z.infer<
  typeof knowledgeSearchSuccessSchema
>;
export type KnowledgeSearchFailure = z.infer<
  typeof knowledgeSearchFailureSchema
>;
export type KnowledgeDocumentListSuccess = z.infer<
  typeof knowledgeDocumentListSuccessSchema
>;
export type KnowledgeDocumentMarkdownSuccess = z.infer<
  typeof knowledgeDocumentMarkdownSuccessSchema
>;
export type KnowledgeDocumentToolFailure = z.infer<
  typeof knowledgeDocumentToolFailureSchema
>;
