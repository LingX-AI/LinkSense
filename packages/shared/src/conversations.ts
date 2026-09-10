import { z } from "zod";

import { applicationIconSchema } from "./applications.js";
import {
  capabilitySelectionIdSchema,
  capabilityTypeSchema,
  priorityCapabilityIdsSchema,
} from "./capabilities.js";
import { timestampSchema, uniqueArraySchema, uuidSchema } from "./common.js";
import {
  conversationFormResponseContentSchema,
  conversationFormResponseSemanticsSchema,
  conversationFormRequestedSchema,
  conversationFormUiHintsSchema,
} from "./conversation-forms.js";
import {
  knowledgeBaseIdsSchema,
  publicKnowledgeCitationSchema,
} from "./knowledge.js";
import {
  modelIdentifierSchema,
  reasoningEffortSchema,
} from "./model-provider.js";

export const conversationArchiveStatusSchema = z.enum(["active", "archived"]);
export const conversationOrderGroupSchema = z.enum(["pinned", "recent"]);
export const conversationOrderUpdateSchema = z.strictObject({
  group: conversationOrderGroupSchema,
  conversation_ids: uniqueArraySchema(uuidSchema).min(2).max(10_000),
});
export const conversationOrderResultSchema = conversationOrderUpdateSchema;
export const conversationTitleSourceSchema = z.enum([
  "generated",
  "fallback",
  "manual",
]);
export const turnStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "interrupted",
]);
export const conversationTaskKindSchema = z.enum(["turn", "goal", "compact"]);
export const conversationCollaborationModeSchema = z.enum([
  "default",
  "plan",
]);
export const threadGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
const threadGoalUsageSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const threadGoalSchema = z.strictObject({
  thread_id: z.string().min(1),
  objective: z.string().trim().min(1).max(4_000),
  status: threadGoalStatusSchema,
  token_budget: threadGoalUsageSchema.nullable(),
  tokens_used: threadGoalUsageSchema,
  time_used_seconds: threadGoalUsageSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export const conversationExecutionStatusSchema = z.enum([
  "idle",
  "running",
  "pending",
  "completed",
  "failed",
  "interrupted",
]);

export const conversationSchema = z.strictObject({
  id: uuidSchema,
  owner_id: uuidSchema,
  title: z.string().min(1).max(240),
  title_source: conversationTitleSourceSchema,
  archive_status: conversationArchiveStatusSchema,
  archived_at: timestampSchema.nullable(),
  pinned_at: timestampSchema.nullable(),
  sort_order: z.number().int().nonnegative().nullable(),
  codex_thread_id: z.string().min(1).nullable(),
  agents_template_version: z.string().min(1).max(80).nullable(),
  collaboration_mode: conversationCollaborationModeSchema,
  last_turn_status: turnStatusSchema.nullable(),
  execution_status: conversationExecutionStatusSchema,
  last_run_at: timestampSchema.nullable(),
  has_unread_completion: z.boolean().default(false),
  has_automation: z.boolean().default(false),
  selected_knowledge_base_ids: knowledgeBaseIdsSchema,
  application: z
    .strictObject({
      id: uuidSchema,
      name: z.string().min(1).max(160),
      kind: z.enum(["standard", "interactive"]).default("standard"),
      package_id: uuidSchema.nullable().default(null),
      icon: applicationIconSchema.optional(),
    })
    .nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const completionNotificationSourceSchema = z.enum([
  "task",
  "automation",
]);
export const completionNotificationStatusSchema = z.enum([
  "completed",
  "failed",
  "interrupted",
]);

export const completionNotificationSchema = z.strictObject({
  turn_id: uuidSchema,
  conversation_id: uuidSchema,
  source: completionNotificationSourceSchema,
  task_title: z.string().trim().min(1).max(240),
  status: completionNotificationStatusSchema,
  terminal_at: timestampSchema,
});

export const completionNotificationFeedSchema = z.strictObject({
  items: z.array(completionNotificationSchema).max(100),
  next_cursor: z.string().min(1).max(320),
});

export const archivedConversationClearResultSchema = z.strictObject({
  deleted_count: z.number().int().nonnegative(),
});

export const pendingRequestStatusSchema = z.enum([
  "waiting_previous_turn",
  "blocked_overload",
  "blocked_preflight",
  "steering",
]);

export const pendingRequestBlockCodeSchema = z.enum([
  "priority_capability_unavailable",
  "required_credential_unavailable",
  "credential_binding_ambiguous",
  "attachment_unavailable",
  "agents_template_unavailable",
  "workspace_invalid",
  "runner_unavailable",
  "execution_environment_invalid",
  "token_limit_exceeded",
]);

export const pendingRequestSchema = z
  .strictObject({
    id: uuidSchema,
    conversation_id: uuidSchema,
    queue_no: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    submitted_by: uuidSchema,
    input_text: z.string(),
    priority_capability_ids: priorityCapabilityIdsSchema,
    knowledge_base_ids: knowledgeBaseIdsSchema,
    collaboration_mode: conversationCollaborationModeSchema,
    status: pendingRequestStatusSchema,
    block_code: pendingRequestBlockCodeSchema.nullable(),
    idempotency_key: z.string().min(1).max(120).nullable(),
    display: z
      .lazy(() => officeAnnotationDisplaySchema)
      .nullable()
      .optional(),
    last_start_checked_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine((request, context) => {
    const shouldHaveBlockCode = request.status === "blocked_preflight";
    if (shouldHaveBlockCode !== (request.block_code !== null)) {
      context.addIssue({
        code: "custom",
        path: ["block_code"],
        message: "pending_request_block_code_does_not_match_status",
      });
    }
  });

export const turnSubmitModeSchema = z.enum([
  "normal",
  "next_turn",
  "manual_retry",
]);
export const conversationTurnSchema = z.strictObject({
  id: uuidSchema,
  conversation_id: uuidSchema,
  sequence_no: z.number().int().positive(),
  submitted_by: uuidSchema,
  codex_thread_id: z.string().min(1),
  codex_turn_id: z.string().min(1),
  status: turnStatusSchema,
  task_kind: conversationTaskKindSchema.default("turn"),
  collaboration_mode: conversationCollaborationModeSchema,
  submit_mode: turnSubmitModeSchema,
  idempotency_key: z.string().min(1).max(120).nullable(),
  knowledge_base_ids: knowledgeBaseIdsSchema,
  model: modelIdentifierSchema.nullable(),
  reasoning_effort: reasoningEffortSchema.nullable().optional(),
  started_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
  interrupt_requested_at: timestampSchema.nullable(),
  interrupted_at: timestampSchema.nullable(),
  error_code: z.string().min(1).max(120).nullable(),
  error_message: z.string().max(2_000).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const runningTurnSubmitChoiceSchema = z.enum([
  "steer_current_turn",
  "create_pending_request",
  "cancel",
]);

export const conversationUserInputRequestStatusSchema = z.enum([
  "pending",
  "answering",
  "answered",
  "expired",
  "cancelled",
]);

export const conversationUserInputQuestionOptionSchema = z.strictObject({
  label: z.string().min(1).max(500),
  description: z.string().max(2_000),
});

export const conversationUserInputQuestionSchema = z.strictObject({
  id: z.string().min(1).max(160),
  header: z.string().min(1).max(160),
  question: z.string().min(1).max(4_000),
  is_other: z.boolean(),
  is_secret: z.boolean(),
  options: z
    .array(conversationUserInputQuestionOptionSchema)
    .max(20)
    .nullable(),
});

const conversationUserInputRequestBaseShape = {
  id: uuidSchema,
  conversation_id: uuidSchema,
  turn_id: uuidSchema,
  item_id: z.string().min(1).max(240),
  status: conversationUserInputRequestStatusSchema,
  auto_resolve_at: timestampSchema.nullable(),
  resolved_at: timestampSchema.nullable(),
  resolved_action: z.enum(["accept", "decline", "cancel"]).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
};

export const conversationUserInputRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      ...conversationUserInputRequestBaseShape,
      kind: z.literal("questions"),
      questions: z.array(conversationUserInputQuestionSchema).min(1).max(3),
    }),
    z.strictObject({
      ...conversationUserInputRequestBaseShape,
      kind: z.literal("form"),
      server_name: z.string().min(1).max(240),
      message: z.string().min(1).max(4_000),
      requested_schema: conversationFormRequestedSchema,
      ui_hints: conversationFormUiHintsSchema,
      response_semantics: conversationFormResponseSemanticsSchema,
      response_content: conversationFormResponseContentSchema.nullable(),
    }),
  ],
);

export const conversationUserInputAnswersSchema = z.record(
  z.string().min(1).max(160),
  z.array(z.string().max(4_000)).min(1).max(1),
);

export const conversationPlanReviewStatusSchema = z.enum([
  "preparing",
  "pending",
  "resolved",
  "cancelled",
]);
export const conversationPlanReviewActionSchema = z.enum([
  "implement",
  "revise",
  "skip",
  "exit",
]);

export const conversationPlanReviewSchema = z
  .strictObject({
    id: uuidSchema,
    conversation_id: uuidSchema,
    source_turn_id: uuidSchema,
    plan_message_id: uuidSchema,
    status: conversationPlanReviewStatusSchema,
    decision: conversationPlanReviewActionSchema.nullable(),
    follow_up_turn_id: uuidSchema.nullable(),
    resolved_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine((review, context) => {
    const active = review.status === "preparing" || review.status === "pending";
    const cancelled = review.status === "cancelled";
    const startsTurn =
      review.decision === "implement" || review.decision === "revise";
    const closesWithoutTurn =
      review.decision === "skip" || review.decision === "exit";
    const valid = active
      ? review.decision === null &&
        review.follow_up_turn_id === null &&
        review.resolved_at === null
      : cancelled
        ? review.decision === null &&
          review.follow_up_turn_id === null &&
          review.resolved_at !== null
        : review.status === "resolved" &&
          review.decision !== null &&
          review.resolved_at !== null &&
          ((startsTurn && review.follow_up_turn_id !== null) ||
            (closesWithoutTurn && review.follow_up_turn_id === null));
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "conversation_plan_review_state_is_inconsistent",
      });
    }
  });

export const conversationMessageRoleSchema = z.enum(["user", "assistant"]);

export const presentationAnnotationElementSchema = z.strictObject({
  element_id: z.string().trim().min(1).max(500),
  shape_id: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240).optional(),
  text: z.string().max(20_000).optional(),
  bounds: z.strictObject({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    rotation: z.number().optional(),
  }),
});

export const maximumOfficeAnnotationCount = 20;

export const presentationAnnotationSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  slide_number: z.number().int().positive().max(100_000),
  elements: z.array(presentationAnnotationElementSchema).min(1).max(50),
});

export const presentationAnnotationInputSchema = z.strictObject({
  kind: z.literal("presentation_annotation"),
  file_id: uuidSchema,
  annotations: z
    .array(presentationAnnotationSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
});

export const presentationAnnotationDisplayItemSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  slide_number: z.number().int().positive().max(100_000),
  selection_count: z.number().int().positive().max(10_000),
});

export const presentationAnnotationDisplaySchema = z.strictObject({
  kind: z.literal("presentation_annotation"),
  file_id: uuidSchema,
  file_name: z.string().min(1).max(260),
  annotations: z
    .array(presentationAnnotationDisplayItemSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
  annotation_count: z.number().int().positive().max(maximumOfficeAnnotationCount),
}).refine((value) => value.annotation_count === value.annotations.length, {
  message: "annotation_count_mismatch",
  path: ["annotation_count"],
});

const boundedSelectionTextSchema = z
  .string()
  .max(20_000)
  .refine((value) => value.trim().length > 0, "selection_text_required");
const boundedLocatorTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\r\n]/u.test(value), "locator_must_be_single_line");
const documentIndexSchema = z.number().int().nonnegative().max(1_000_000);

export const wordAnnotationSelectionSchema = z.strictObject({
  type: z.literal("text"),
  para_id: boundedLocatorTextSchema.optional(),
  selected_text: boundedSelectionTextSchema,
  paragraph_text: z.string().max(20_000).optional(),
  before: z.string().max(4_000).optional(),
  after: z.string().max(4_000).optional(),
  start_paragraph_index: documentIndexSchema,
  end_paragraph_index: documentIndexSchema,
  is_multi_paragraph: z.boolean(),
  page_number: z.number().int().positive().max(100_000).optional(),
  position_from: documentIndexSchema.optional(),
  position_to: documentIndexSchema.optional(),
});

export const wordAnnotationSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  selection: wordAnnotationSelectionSchema,
});

export const wordAnnotationInputSchema = z.strictObject({
  kind: z.literal("word_annotation"),
  file_id: uuidSchema,
  annotations: z
    .array(wordAnnotationSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
});

export const wordAnnotationDisplayItemSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  selection_type: z.literal("text"),
  paragraph_number: z.number().int().positive().max(1_000_001),
  page_number: z.number().int().positive().max(100_000).nullable(),
  selection_count: z.literal(1),
});

export const wordAnnotationDisplaySchema = z.strictObject({
  kind: z.literal("word_annotation"),
  file_id: uuidSchema,
  file_name: z.string().min(1).max(260),
  annotations: z
    .array(wordAnnotationDisplayItemSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
  annotation_count: z.number().int().positive().max(maximumOfficeAnnotationCount),
}).refine((value) => value.annotation_count === value.annotations.length, {
  message: "annotation_count_mismatch",
  path: ["annotation_count"],
});

export const spreadsheetRangeAnnotationSelectionSchema = z.strictObject({
  type: z.literal("range"),
  range_address: boundedLocatorTextSchema,
  active_cell_address: boundedLocatorTextSchema.optional(),
  start_row: documentIndexSchema,
  start_column: documentIndexSchema,
  end_row: documentIndexSchema,
  end_column: documentIndexSchema,
  selected_text: z.string().max(20_000).optional(),
  selected_formula: z.string().max(4_000).optional(),
});

export const spreadsheetImageAnnotationSelectionSchema = z.strictObject({
  type: z.literal("image"),
  object_id: boundedLocatorTextSchema,
  name: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(1_000).optional(),
});

export const spreadsheetChartElementSelectionSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("chart") }),
    z.strictObject({
      kind: z.literal("series"),
      series_id: boundedLocatorTextSchema,
      series_index: documentIndexSchema,
    }),
    z.strictObject({
      kind: z.literal("point"),
      series_id: boundedLocatorTextSchema,
      series_index: documentIndexSchema,
      point_index: documentIndexSchema,
    }),
    z.strictObject({
      kind: z.literal("legend_entry"),
      series_id: boundedLocatorTextSchema,
      series_index: documentIndexSchema,
    }),
  ],
);

export const spreadsheetChartAnnotationSelectionSchema = z.strictObject({
  type: z.literal("chart"),
  object_id: boundedLocatorTextSchema,
  name: z.string().trim().min(1).max(240).optional(),
  title: z.string().max(500).optional(),
  chart_type: z.string().trim().min(1).max(120),
  element: spreadsheetChartElementSelectionSchema.optional(),
  formula: z.string().max(4_000).optional(),
});

export const spreadsheetAnnotationSelectionSchema = z.discriminatedUnion(
  "type",
  [
    spreadsheetRangeAnnotationSelectionSchema,
    spreadsheetImageAnnotationSelectionSchema,
    spreadsheetChartAnnotationSelectionSchema,
  ],
);

export const spreadsheetAnnotationSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  sheet_name: z.string().trim().min(1).max(240),
  sheet_index: documentIndexSchema,
  selection: spreadsheetAnnotationSelectionSchema,
});

export const spreadsheetAnnotationInputSchema = z.strictObject({
  kind: z.literal("spreadsheet_annotation"),
  file_id: uuidSchema,
  annotations: z
    .array(spreadsheetAnnotationSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
});

export const spreadsheetAnnotationDisplayItemSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  sheet_name: z.string().min(1).max(240),
  sheet_index: documentIndexSchema,
  selection_type: z.enum(["range", "image", "chart"]),
  selection_label: z.string().min(1).max(500),
  selection_count: z.literal(1),
});

export const spreadsheetAnnotationDisplaySchema = z.strictObject({
  kind: z.literal("spreadsheet_annotation"),
  file_id: uuidSchema,
  file_name: z.string().min(1).max(260),
  annotations: z
    .array(spreadsheetAnnotationDisplayItemSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
  annotation_count: z.number().int().positive().max(maximumOfficeAnnotationCount),
}).refine((value) => value.annotation_count === value.annotations.length, {
  message: "annotation_count_mismatch",
  path: ["annotation_count"],
});

const htmlAttributeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z_:][a-zA-Z0-9:._-]*$/u);

export const htmlAnnotationElementSchema = z.strictObject({
  selector: z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .refine((value) => !/[\r\n]/u.test(value), "selector_must_be_single_line"),
  dom_path: z.array(documentIndexSchema).min(1).max(128),
  tag_name: z.string().trim().min(1).max(80),
  id: z.string().trim().min(1).max(500).optional(),
  class_names: uniqueArraySchema(z.string().trim().min(1).max(120)).max(50),
  text: z.string().max(4_000).optional(),
  outer_html: z.string().max(8_000).optional(),
  attributes: z
    .record(htmlAttributeNameSchema, z.string().max(2_000))
    .refine(
      (attributes) => Object.keys(attributes).length <= 50,
      "too_many_html_attributes",
    ),
  bounds: z.strictObject({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
});

export const htmlAnnotationSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  elements: z.array(htmlAnnotationElementSchema).min(1).max(20),
});

export const htmlAnnotationInputSchema = z.strictObject({
  kind: z.literal("html_annotation"),
  file_id: uuidSchema,
  annotations: z
    .array(htmlAnnotationSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
});

export const htmlAnnotationDisplayItemSchema = z.strictObject({
  request: z.string().trim().min(1).max(20_000),
  selection_count: z.number().int().positive().max(20),
});

export const htmlAnnotationDisplaySchema = z.strictObject({
  kind: z.literal("html_annotation"),
  file_id: uuidSchema,
  file_name: z.string().min(1).max(260),
  annotations: z
    .array(htmlAnnotationDisplayItemSchema)
    .min(1)
    .max(maximumOfficeAnnotationCount),
  annotation_count: z.number().int().positive().max(maximumOfficeAnnotationCount),
}).refine((value) => value.annotation_count === value.annotations.length, {
  message: "annotation_count_mismatch",
  path: ["annotation_count"],
});

export const officeAnnotationInputSchema = z.discriminatedUnion("kind", [
  presentationAnnotationInputSchema,
  wordAnnotationInputSchema,
  spreadsheetAnnotationInputSchema,
  htmlAnnotationInputSchema,
]);

export const officeAnnotationDisplaySchema = z.discriminatedUnion("kind", [
  presentationAnnotationDisplaySchema,
  wordAnnotationDisplaySchema,
  spreadsheetAnnotationDisplaySchema,
  htmlAnnotationDisplaySchema,
]);

export const interactiveApplicationMessageSourceSchema = z.literal(
  "interactive_application",
);
export const interactiveApplicationMessageDisplaySchema = z.strictObject({
  kind: interactiveApplicationMessageSourceSchema,
  application_id: uuidSchema,
});

export const userMessageDisplaySchema = z.discriminatedUnion("kind", [
  ...officeAnnotationDisplaySchema.options,
  interactiveApplicationMessageDisplaySchema,
]);

export const userMessageCapabilitySchema = z.strictObject({
  id: capabilitySelectionIdSchema,
  name: z.string().min(1).max(160),
  type: capabilityTypeSchema,
});

export const conversationMessageSchema = z.strictObject({
  id: uuidSchema,
  conversation_id: uuidSchema,
  turn_id: uuidSchema.nullable(),
  sequence_no: z.number().int().positive(),
  role: conversationMessageRoleSchema,
  content_text: z.string(),
  usage_type: z.literal("steer_current_turn").optional(),
  event_sequence_no: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  display: userMessageDisplaySchema.nullable().optional(),
  selected_capabilities: z
    .array(userMessageCapabilitySchema)
    .max(100)
    .optional(),
  selected_knowledge_base_ids: knowledgeBaseIdsSchema.optional(),
  knowledge_citations: z.array(publicKnowledgeCitationSchema).optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const conversationFileKindSchema = z.enum(["attachment", "artifact"]);
export const conversationFileSourceSchema = z.enum([
  "user_upload",
  "agent_generated",
  "system_generated",
]);
export const conversationFileStatusSchema = z.enum([
  "staged",
  "pending",
  "bound",
  "registered",
]);
export const fileStorageBackendSchema = z.enum(["workspace", "minio"]);

export const conversationFileSchema = z.strictObject({
  id: uuidSchema,
  conversation_id: uuidSchema,
  pending_request_id: uuidSchema.nullable(),
  turn_id: uuidSchema.nullable(),
  kind: conversationFileKindSchema,
  source: conversationFileSourceSchema,
  status: conversationFileStatusSchema,
  filename: z.string().min(1).max(260),
  mime_type: z.string().min(1).max(160).nullable(),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  checksum_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .nullable(),
  storage_backend: fileStorageBackendSchema,
  workspace_relative_path: z.string().min(1).nullable(),
  downloadable: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationOrderGroup = z.infer<
  typeof conversationOrderGroupSchema
>;
export type CompletionNotification = z.infer<
  typeof completionNotificationSchema
>;
export type CompletionNotificationFeed = z.infer<
  typeof completionNotificationFeedSchema
>;
export type ArchivedConversationClearResult = z.infer<
  typeof archivedConversationClearResultSchema
>;
export type PendingRequest = z.infer<typeof pendingRequestSchema>;
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;
export type ConversationTaskKind = z.infer<typeof conversationTaskKindSchema>;
export type ConversationCollaborationMode = z.infer<
  typeof conversationCollaborationModeSchema
>;
export type ConversationUserInputRequest = z.infer<
  typeof conversationUserInputRequestSchema
>;
export type ConversationPlanReview = z.infer<
  typeof conversationPlanReviewSchema
>;
export type ConversationPlanReviewAction = z.infer<
  typeof conversationPlanReviewActionSchema
>;
export type ThreadGoal = z.infer<typeof threadGoalSchema>;
export type ThreadGoalStatus = z.infer<typeof threadGoalStatusSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type PresentationAnnotationInput = z.infer<
  typeof presentationAnnotationInputSchema
>;
export type PresentationAnnotation = z.infer<
  typeof presentationAnnotationSchema
>;
export type PresentationAnnotationElement = z.infer<
  typeof presentationAnnotationElementSchema
>;
export type PresentationAnnotationDisplay = z.infer<
  typeof presentationAnnotationDisplaySchema
>;
export type PresentationAnnotationDisplayItem = z.infer<
  typeof presentationAnnotationDisplayItemSchema
>;
export type WordAnnotationSelection = z.infer<
  typeof wordAnnotationSelectionSchema
>;
export type WordAnnotation = z.infer<typeof wordAnnotationSchema>;
export type WordAnnotationInput = z.infer<typeof wordAnnotationInputSchema>;
export type WordAnnotationDisplay = z.infer<typeof wordAnnotationDisplaySchema>;
export type WordAnnotationDisplayItem = z.infer<
  typeof wordAnnotationDisplayItemSchema
>;
export type SpreadsheetRangeAnnotationSelection = z.infer<
  typeof spreadsheetRangeAnnotationSelectionSchema
>;
export type SpreadsheetImageAnnotationSelection = z.infer<
  typeof spreadsheetImageAnnotationSelectionSchema
>;
export type SpreadsheetChartElementSelection = z.infer<
  typeof spreadsheetChartElementSelectionSchema
>;
export type SpreadsheetChartAnnotationSelection = z.infer<
  typeof spreadsheetChartAnnotationSelectionSchema
>;
export type SpreadsheetAnnotationSelection = z.infer<
  typeof spreadsheetAnnotationSelectionSchema
>;
export type SpreadsheetAnnotation = z.infer<
  typeof spreadsheetAnnotationSchema
>;
export type SpreadsheetAnnotationInput = z.infer<
  typeof spreadsheetAnnotationInputSchema
>;
export type SpreadsheetAnnotationDisplay = z.infer<
  typeof spreadsheetAnnotationDisplaySchema
>;
export type SpreadsheetAnnotationDisplayItem = z.infer<
  typeof spreadsheetAnnotationDisplayItemSchema
>;
export type HtmlAnnotationElement = z.infer<typeof htmlAnnotationElementSchema>;
export type HtmlAnnotation = z.infer<typeof htmlAnnotationSchema>;
export type HtmlAnnotationInput = z.infer<typeof htmlAnnotationInputSchema>;
export type HtmlAnnotationDisplay = z.infer<typeof htmlAnnotationDisplaySchema>;
export type HtmlAnnotationDisplayItem = z.infer<
  typeof htmlAnnotationDisplayItemSchema
>;
export type OfficeAnnotationInput = z.infer<typeof officeAnnotationInputSchema>;
export type OfficeAnnotationDisplay = z.infer<
  typeof officeAnnotationDisplaySchema
>;
export type InteractiveApplicationMessageSource = z.infer<
  typeof interactiveApplicationMessageSourceSchema
>;
export type UserMessageDisplay = z.infer<typeof userMessageDisplaySchema>;
export type UserMessageCapability = z.infer<typeof userMessageCapabilitySchema>;

function spreadsheetAnnotationSelectionLabel(
  annotation: SpreadsheetAnnotation,
): string {
  const selection = annotation.selection;
  if (selection.type === "range") return selection.range_address;
  if (selection.type === "image") {
    return selection.name?.trim() || selection.object_id;
  }
  return (
    selection.title?.trim() || selection.name?.trim() || selection.object_id
  );
}

/**
 * Builds the safe, user-visible projection for an Office annotation.
 * Keep both persisted and optimistic messages on this shared projection so
 * admission latency cannot change the shape of a message after submission.
 */
export function buildOfficeAnnotationDisplay(
  annotation: OfficeAnnotationInput,
  fileName: string,
): OfficeAnnotationDisplay {
  if (annotation.kind === "presentation_annotation") {
    return {
      kind: "presentation_annotation",
      file_id: annotation.file_id,
      file_name: fileName,
      annotations: annotation.annotations.map((item) => ({
        request: item.request,
        slide_number: item.slide_number,
        selection_count: item.elements.length,
      })),
      annotation_count: annotation.annotations.length,
    };
  }
  if (annotation.kind === "word_annotation") {
    return {
      kind: "word_annotation",
      file_id: annotation.file_id,
      file_name: fileName,
      annotations: annotation.annotations.map((item) => ({
        request: item.request,
        selection_type: "text" as const,
        paragraph_number: item.selection.start_paragraph_index + 1,
        page_number: item.selection.page_number ?? null,
        selection_count: 1 as const,
      })),
      annotation_count: annotation.annotations.length,
    };
  }
  if (annotation.kind === "spreadsheet_annotation") {
    return {
      kind: "spreadsheet_annotation",
      file_id: annotation.file_id,
      file_name: fileName,
      annotations: annotation.annotations.map((item) => ({
        request: item.request,
        sheet_name: item.sheet_name,
        sheet_index: item.sheet_index,
        selection_type: item.selection.type,
        selection_label: spreadsheetAnnotationSelectionLabel(item),
        selection_count: 1 as const,
      })),
      annotation_count: annotation.annotations.length,
    };
  }
  return {
    kind: "html_annotation",
    file_id: annotation.file_id,
    file_name: fileName,
    annotations: annotation.annotations.map((item) => ({
      request: item.request,
      selection_count: item.elements.length,
    })),
    annotation_count: annotation.annotations.length,
  };
}

export function officeAnnotationRequestText(
  annotation: OfficeAnnotationInput | OfficeAnnotationDisplay,
): string {
  if (annotation.annotations.length === 1) {
    return annotation.annotations[0]?.request ?? "";
  }
  return annotation.annotations
    .map((item, index) => `${index + 1}. ${item.request}`)
    .join("\n");
}
