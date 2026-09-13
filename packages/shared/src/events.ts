import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import {
  conversationFormAutoResolutionMs,
  conversationFormResponseSemanticsSchema,
  conversationFormRequestedSchema,
  conversationFormUiHintsSchema,
} from "./conversation-forms.js";
import {
  capabilitySelectionIdSchema,
  capabilitySourceTypeSchema,
  capabilityStatusSchema,
  capabilityTypeSchema,
} from "./capabilities.js";
import {
  conversationExecutionStatusSchema,
  codexAsyncUserInputQuestionsSchema,
  conversationMessageRoleSchema,
  conversationPlanReviewActionSchema,
  conversationPlanReviewStatusSchema,
  pendingRequestBlockCodeSchema,
  pendingRequestStatusSchema,
  turnStatusSchema,
} from "./conversations.js";
import { knowledgeNoAvailableBasesCodeSchema } from "./knowledge.js";
import { coreMcpServerKey } from "./mcp.js";

export const conversationEventVisibilitySchema = z.enum([
  "user_visible",
  "user_collapsed",
  "internal_sanitized",
]);

const legacyConversationEventTypeValues = [
  "conversation.status.changed",
  "conversation.pending_request.updated",
  "conversation.pending_request.cancelled",
  "conversation.user_input_request.updated",
  "conversation.plan_review.updated",
  "conversation.message.delta",
  "conversation.message.completed",
  "conversation.title.updated",
  "conversation.step.started",
  "conversation.step.completed",
  "conversation.tool.started",
  "conversation.tool.completed",
  "conversation.capability.attached",
  "conversation.capability.used",
  "conversation.system_capability.used",
  "conversation.file.created",
  "conversation.file.updated",
  "conversation.artifact.created",
  "conversation.reconnect",
  "conversation.error",
  "conversation.interrupted",
  "conversation.completed",
] as const;

const runnerCodexEventMethodValues = [
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "error",
  "turn/started",
  "hook/started",
  "turn/completed",
  "hook/completed",
  "thread/tokenUsage/updated",
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/tool/requestUserInput",
  "serverRequest/resolved",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
] as const;

const runnerLinkSenseEventMethodValues = ["linksense/form/request"] as const;

export const conversationEventTypeSchema = z.enum([
  ...legacyConversationEventTypeValues,
  ...runnerCodexEventMethodValues,
  ...runnerLinkSenseEventMethodValues,
]);

const eventBaseShape = {
  id: uuidSchema,
  conversation_id: uuidSchema,
  turn_id: uuidSchema.nullable(),
  sequence_no: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  visibility: conversationEventVisibilitySchema,
  sse_event_id: z.string().min(1).max(160),
  created_at: timestampSchema,
};

const schemaVersionShape = { schema_version: z.literal(1) };
const safeSummarySchema = z.string().max(2_000);

const statusChangedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.status.changed"),
  payload: z.strictObject({
    ...schemaVersionShape,
    turn_id: uuidSchema.nullable(),
    turn_status: turnStatusSchema.nullable(),
    conversation_execution_status: conversationExecutionStatusSchema,
  }),
});

const pendingUpdatedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.pending_request.updated"),
  payload: z.strictObject({
    ...schemaVersionShape,
    pending_request_id: uuidSchema,
    status: pendingRequestStatusSchema,
    block_code: pendingRequestBlockCodeSchema.nullable(),
    queue_no: z.number().int().positive(),
    last_start_checked_at: timestampSchema.nullable().optional(),
  }),
});

const pendingCancelledEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.pending_request.cancelled"),
  payload: z.strictObject({
    ...schemaVersionShape,
    pending_request_id: uuidSchema,
  }),
});

const userInputRequestUpdatedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.user_input_request.updated"),
  payload: z.strictObject({
    ...schemaVersionShape,
    user_input_request_id: uuidSchema,
    status: z.enum(["pending", "answering", "answered", "expired", "cancelled"]),
  }),
});

const planReviewUpdatedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.plan_review.updated"),
  payload: z.strictObject({
    ...schemaVersionShape,
    plan_review_id: uuidSchema,
    source_turn_id: uuidSchema,
    status: conversationPlanReviewStatusSchema,
    decision: conversationPlanReviewActionSchema.nullable(),
    follow_up_turn_id: uuidSchema.nullable(),
  }),
});

const messageDeltaEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.message.delta"),
  payload: z.strictObject({
    ...schemaVersionShape,
    message_id: uuidSchema,
    role: conversationMessageRoleSchema,
    delta: z.string(),
  }),
});

const messageCompletedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.message.completed"),
  payload: z.strictObject({
    ...schemaVersionShape,
    message_id: uuidSchema,
    role: conversationMessageRoleSchema,
    item_id: z.string().min(1).max(240).optional(),
    usage_type: z.literal("steer_current_turn").optional(),
  }),
});

const titleUpdatedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.title.updated"),
  payload: z.strictObject({
    ...schemaVersionShape,
    title: z.string().min(1).max(240),
    thread_id: z.string().min(1).max(160).optional(),
  }),
});

function progressEventSchema(
  eventType:
    | "conversation.step.started"
    | "conversation.step.completed"
    | "conversation.tool.started"
    | "conversation.tool.completed",
) {
  return z.strictObject({
    ...eventBaseShape,
    event_type: z.literal(eventType),
    payload: z.strictObject({
      ...schemaVersionShape,
      item_id: z.string().min(1).max(160),
      action: z.string().min(1).max(120),
      capability_name: z.string().min(1).max(240).optional(),
      safe_summary: safeSummarySchema,
    }),
  });
}

export const capabilityAttachedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.capability.attached"),
  payload: z.strictObject({
    ...schemaVersionShape,
    capability_id: capabilitySelectionIdSchema,
    capability_type: capabilityTypeSchema,
    usage_type: z.enum(["auto_plugin", "auto_skill"]),
    priority_requested: z.boolean(),
    name: z.string().min(1).max(160),
    source_type: z.union([capabilitySourceTypeSchema, z.literal("builtin")]),
    status: capabilityStatusSchema,
  }),
});

const capabilityUsedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.capability.used"),
  payload: z.strictObject({
    ...schemaVersionShape,
    capability_id: uuidSchema,
    capability_type: capabilityTypeSchema,
    usage_type: z.enum(["auto_plugin", "auto_skill"]),
    name: z.string().min(1).max(160),
    safe_summary: safeSummarySchema,
  }),
});

const systemCapabilityUsedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.system_capability.used"),
  payload: z.strictObject({
    ...schemaVersionShape,
    system_capability_key: z.literal("linksense_file_service"),
    usage_type: z.literal("system_file_service"),
    name: z.string().min(1).max(160),
    safe_summary: safeSummarySchema,
  }),
});

const fileCreatedPayloadSchema = z.strictObject({
  ...schemaVersionShape,
  file_id: uuidSchema,
  display_name: z.string().min(1).max(260),
  mime_type: z.string().min(1).max(160).nullable(),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

function fileEventSchema(
  eventType: "conversation.file.created" | "conversation.artifact.created",
) {
  return z.strictObject({
    ...eventBaseShape,
    event_type: z.literal(eventType),
    payload: fileCreatedPayloadSchema,
  });
}

const fileUpdatedEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.file.updated"),
  payload: z.strictObject({
    ...schemaVersionShape,
    file_id: uuidSchema,
    status: z.literal("removed"),
  }),
});

const reconnectEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.reconnect"),
  payload: z.strictObject({
    ...schemaVersionShape,
    codex_turn_id: z.string().min(1),
    reason_code: z.string().min(1).max(120),
    will_retry: z.literal(true),
    message_key: z.string().min(1).max(200),
  }),
});

const errorEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("conversation.error"),
  payload: z.strictObject({
    ...schemaVersionShape,
    error_code: z.string().min(1).max(120),
    message_key: z.string().min(1).max(200),
    retryable: z.boolean().optional(),
  }),
});

function terminalEventSchema(
  eventType: "conversation.interrupted" | "conversation.completed",
  status: "interrupted" | "completed",
) {
  return z.strictObject({
    ...eventBaseShape,
    event_type: z.literal(eventType),
    payload: z.strictObject({
      ...schemaVersionShape,
      turn_id: uuidSchema,
      codex_turn_id: z.string().min(1),
      status: z.literal(status),
    }),
  });
}

export const legacyConversationEventSchema = z.discriminatedUnion(
  "event_type",
  [
    statusChangedEventSchema,
    pendingUpdatedEventSchema,
    pendingCancelledEventSchema,
    userInputRequestUpdatedEventSchema,
    planReviewUpdatedEventSchema,
    messageDeltaEventSchema,
    messageCompletedEventSchema,
    titleUpdatedEventSchema,
    progressEventSchema("conversation.step.started"),
    progressEventSchema("conversation.step.completed"),
    progressEventSchema("conversation.tool.started"),
    progressEventSchema("conversation.tool.completed"),
    capabilityAttachedEventSchema,
    capabilityUsedEventSchema,
    systemCapabilityUsedEventSchema,
    fileEventSchema("conversation.file.created"),
    fileUpdatedEventSchema,
    fileEventSchema("conversation.artifact.created"),
    reconnectEventSchema,
    errorEventSchema,
    terminalEventSchema("conversation.interrupted", "interrupted"),
    terminalEventSchema("conversation.completed", "completed"),
  ],
);

const runnerEventBaseShape = {
  visibility: conversationEventVisibilitySchema,
  threadId: z.string().min(1).max(240),
};

const runnerTurnEventBaseShape = {
  ...runnerEventBaseShape,
  turnId: z.string().min(1).max(240),
};

function runnerEvent<TType extends string, TPayload extends z.ZodType>(
  eventType: TType,
  payload: TPayload,
) {
  return z.strictObject({
    ...runnerTurnEventBaseShape,
    eventType: z.literal(eventType),
    payload,
  });
}

const runnerSchemaVersionShape = { schema_version: z.literal(1) };
const runnerProgressPayloadSchema = z.strictObject({
  ...runnerSchemaVersionShape,
  item_id: z.string().min(1).max(160),
  action: z.string().min(1).max(120),
  capability_reference: z.string().min(1).max(240).optional(),
  capability_fallback_reference: z.string().min(1).max(240).optional(),
});

/**
 * Authenticated Runner -> API wire contract. Native Codex identifiers remain
 * strings here and are replaced with local UUID projections before SSE fan-out.
 */
export const legacyRunnerConversationEventSchema = z.discriminatedUnion(
  "eventType",
  [
    runnerEvent(
      "conversation.status.changed",
      z.strictObject({
        ...runnerSchemaVersionShape,
        turn_status: turnStatusSchema,
        conversation_execution_status: conversationExecutionStatusSchema,
        error_code: z.string().min(1).max(120).optional(),
      }),
    ),
    runnerEvent(
      "conversation.message.delta",
      z.strictObject({
        ...runnerSchemaVersionShape,
        item_id: z.string().min(1).max(160),
        delta: z.string().max(1_000_000),
      }),
    ),
    runnerEvent(
      "conversation.message.completed",
      z.strictObject({
        ...runnerSchemaVersionShape,
        item_id: z.string().min(1).max(160),
        text: z.string().max(10_000_000),
      }),
    ),
    z.strictObject({
      ...runnerEventBaseShape,
      eventType: z.literal("conversation.title.updated"),
      visibility: z.literal("user_visible"),
      payload: z.strictObject({
        ...runnerSchemaVersionShape,
        title: z.string().max(1_000),
      }),
    }),
    runnerEvent("conversation.step.started", runnerProgressPayloadSchema),
    runnerEvent("conversation.step.completed", runnerProgressPayloadSchema),
    runnerEvent("conversation.tool.started", runnerProgressPayloadSchema),
    runnerEvent("conversation.tool.completed", runnerProgressPayloadSchema),
    runnerEvent(
      "conversation.capability.used",
      z.strictObject({
        ...runnerSchemaVersionShape,
        capability_reference: z.string().min(1).max(240),
        capability_fallback_reference: z.string().min(1).max(240).optional(),
        capability_type: capabilityTypeSchema,
        usage_type: z.enum(["auto_plugin", "auto_skill"]),
        safe_summary: safeSummarySchema,
      }),
    ),
    runnerEvent(
      "conversation.reconnect",
      z.strictObject({
        ...runnerSchemaVersionShape,
        reason_code: z.string().min(1).max(120),
        will_retry: z.literal(true),
        message_key: z.string().min(1).max(200),
      }),
    ),
    runnerEvent(
      "conversation.error",
      z.strictObject({
        ...runnerSchemaVersionShape,
        error_code: z.string().min(1).max(120),
        message_key: z.string().min(1).max(200),
      }),
    ),
    runnerEvent(
      "conversation.interrupted",
      z.strictObject({
        ...runnerSchemaVersionShape,
        turn_id: z.string().min(1).max(240),
      }),
    ),
    runnerEvent(
      "conversation.completed",
      z.strictObject({
        ...runnerSchemaVersionShape,
        turn_id: z.string().min(1).max(240),
      }),
    ),
  ],
);

export const runnerNativeIdSchema = z.string().min(1).max(240);
const runnerNativeTextSchema = z.string().max(10_000_000);
export const runnerCodexPreviewLimits = {
  activityTextCharacters: 4_000,
  activityTextParts: 64,
  commandCharacters: 2_000,
  errorMessageCharacters: 2_000,
  pathCharacters: 1_000,
  queryCharacters: 1_000,
  urlCharacters: 2_000,
  patternCharacters: 1_000,
  commandActions: 100,
  fileChanges: 200,
  searchQueries: 20,
  subAgents: 100,
  agentLabelCharacters: 80,
} as const;

function runnerCodexSafeTextPreviewSchema(maximum: number) {
  return z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => !hasControlCharacter(value), "unsafe_preview_control")
    .refine(
      (value) => !hasObviousUnredactedSecret(value),
      "unsafe_preview_secret",
    )
    .refine((value) => !hasRawAbsolutePath(value), "unsafe_preview_path");
}

export const runnerCodexErrorMessageSchema = runnerCodexSafeTextPreviewSchema(
  runnerCodexPreviewLimits.errorMessageCharacters,
);

const runnerCodexCommandPreviewSchema = runnerCodexSafeTextPreviewSchema(
  runnerCodexPreviewLimits.commandCharacters,
);
const runnerCodexPathPreviewSchema = z
  .string()
  .min(1)
  .max(runnerCodexPreviewLimits.pathCharacters)
  .refine((value) => !hasControlCharacter(value), "unsafe_preview_control")
  .refine(
    (value) => !hasObviousUnredactedSecret(value),
    "unsafe_preview_secret",
  )
  .refine(isSafePathPreview, "unsafe_preview_path");
const runnerCodexQueryPreviewSchema = runnerCodexSafeTextPreviewSchema(
  runnerCodexPreviewLimits.queryCharacters,
);
const runnerCodexUrlPreviewSchema = runnerCodexSafeTextPreviewSchema(
  runnerCodexPreviewLimits.urlCharacters,
);
const runnerCodexPatternPreviewSchema = runnerCodexSafeTextPreviewSchema(
  runnerCodexPreviewLimits.patternCharacters,
);
const runnerCodexIdentityPreviewSchema = runnerCodexSafeTextPreviewSchema(240);
const runnerCodexStatusPreviewSchema = runnerCodexSafeTextPreviewSchema(120);
export const runnerCodexSubAgentStatusSchema = z.enum([
  "pendingInit",
  "running",
  "interrupted",
  "completed",
  "errored",
  "shutdown",
  "notFound",
]);
export const runnerCodexAgentKeySchema = z
  .string()
  .regex(/^agent_[A-Za-z0-9_-]{24}$/u);
export const runnerCodexAgentKeysSchema = z
  .array(runnerCodexAgentKeySchema)
  .min(1)
  .max(runnerCodexPreviewLimits.subAgents)
  .refine(
    (agentKeys) => new Set(agentKeys).size === agentKeys.length,
    "duplicate_subagent_key",
  );
const runnerCodexAgentLabelSchema = runnerCodexSafeTextPreviewSchema(
  runnerCodexPreviewLimits.agentLabelCharacters,
);
const runnerCodexSubAgentsSchema = z
  .array(
    z.strictObject({
      agentKey: runnerCodexAgentKeySchema,
      agentLabel: runnerCodexAgentLabelSchema.optional(),
      status: runnerCodexSubAgentStatusSchema.nullable(),
    }),
  )
  .max(runnerCodexPreviewLimits.subAgents)
  .refine(
    (agents) =>
      new Set(agents.map((agent) => agent.agentKey)).size === agents.length,
    "duplicate_subagent_key",
  );

const sharedLongSensitiveNameSource =
  "(?:token|secret|api[._-]?key|private[._-]?key|access[._-]?key|password|passwd|passphrase|authorization|cookie|credential|signature|session[._-]?id)";
const sharedSensitiveNameSource = `(?:[A-Za-z0-9_.-]*${sharedLongSensitiveNameSource}[A-Za-z0-9_.-]*|(?:[A-Za-z0-9_.-]*[._-])?(?:sig|pwd|jwt)(?:[._-][A-Za-z0-9_.-]*)?)`;
const sharedSensitiveKeySource = `${sharedSensitiveNameSource}(?:\\[[A-Za-z0-9_.-]*\\])*`;
const sharedSensitiveAssignmentPattern = new RegExp(
  `(?<![A-Za-z0-9_.-])(?:--)?${sharedSensitiveKeySource}(?:\\s*[:=]\\s*|\\s+)("[^"]*"|'[^']*'|[^\\s,;&|]+)`,
  "giu",
);
const sharedQuotedSensitiveAssignmentPattern = new RegExp(
  `["']${sharedSensitiveKeySource}["']\\s*[:=]\\s*("[^"]*"|'[^']*'|[^\\s,;&|}]+)`,
  "giu",
);
const sharedApiKeyPhrasePattern =
  /\bapi[\s_-]?key(?:\s*[:=]\s*|\s+)("[^"]*"|'[^']*'|[^\s,;&|]+)/giu;
const sharedBearerPattern = /\bbearer\s+("[^"]*"|'[^']*'|[^\s,;&|]+)/giu;
const sharedUrlUserInfoPattern = /\b[a-z][a-z0-9+.-]*:\/\/([^@\s/]+)@/giu;
const sharedEnvironmentAssignmentPattern =
  /(?:^|[\s;,(])(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*("[^"]*"|'[^']*'|[^\s,;&|)]+)/giu;
const sharedControlCharacterPattern = /[\u0000-\u001f\u007f-\u009f]/u;
const sharedControlCharacterGlobalPattern = /[\u0000-\u001f\u007f-\u009f]/gu;
const sharedDefaultIgnorablePattern = /\p{Default_Ignorable_Code_Point}/u;
const sharedDefaultIgnorableGlobalPattern =
  /\p{Default_Ignorable_Code_Point}/gu;
const sharedSlashLikePattern = /[\u2044\u2215\u29f8\uff0f]/gu;
const sharedBackslashLikePattern = /[\u29f5\uff3c]/gu;
const sharedEncodedPathSeparatorPattern = /%(?:25)*(?:2f|5c)/iu;
const sharedHttpUrlPattern = /\bhttps?:\/\/[^\s"'<>]+/giu;
const sharedHomeExpandedPathPattern =
  /(^|[\s=(:,"';|&<>@\[{?#`])(?:~[A-Za-z0-9._-]*|\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\})[\\/]/iu;
const sharedKnownCredentialPatterns = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|AGPA)[A-Z0-9]{16}\b/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /\bnpm_[A-Za-z0-9]{20,}\b/u,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/u,
] as const;

function hasControlCharacter(value: string): boolean {
  return securityPreviewCandidates(value).some(hasDirectUnsafeFormatting);
}

function hasDirectUnsafeFormatting(value: string): boolean {
  return (
    sharedControlCharacterPattern.test(value) ||
    sharedDefaultIgnorablePattern.test(value)
  );
}

function hasObviousUnredactedSecret(value: string): boolean {
  return securityPreviewCandidates(value, true).some(
    hasDirectObviousUnredactedSecret,
  );
}

function hasDirectObviousUnredactedSecret(value: string): boolean {
  for (const pattern of [
    sharedSensitiveAssignmentPattern,
    sharedQuotedSensitiveAssignmentPattern,
    sharedApiKeyPhrasePattern,
    sharedBearerPattern,
    sharedUrlUserInfoPattern,
    sharedEnvironmentAssignmentPattern,
  ]) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      if (!isRedactedValue(match[1])) return true;
    }
  }
  return (
    /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/u.test(value) ||
    sharedKnownCredentialPatterns.some((pattern) => pattern.test(value))
  );
}

function isRedactedValue(value: string | undefined): boolean {
  return value?.replace(/^["']|["']$/gu, "") === "[REDACTED]";
}

function hasRawAbsolutePath(value: string): boolean {
  return securityPreviewCandidates(value, true).some((candidate) =>
    hasDirectRawAbsolutePath(candidate, new Set<string>()),
  );
}

function hasDirectRawAbsolutePath(
  value: string,
  visited: Set<string>,
): boolean {
  if (visited.has(value)) return false;
  visited.add(value);

  if (sharedHomeExpandedPathPattern.test(value)) return true;
  if (/\bfile:[\\/]+[^\s"'<>]+/iu.test(value)) return true;

  const urlSuffixes: string[] = [];
  sharedHttpUrlPattern.lastIndex = 0;
  const withoutUrls = value.replace(sharedHttpUrlPattern, (url) => {
    const suffixIndex = url.search(/[?#]/u);
    if (suffixIndex >= 0) urlSuffixes.push(url.slice(suffixIndex));
    return "";
  });
  if (
    urlSuffixes.some((suffix) =>
      hasDirectRawAbsolutePath(
        canonicalizePreviewSyntax(suffix, true),
        visited,
      ),
    )
  ) {
    return true;
  }

  if (hasMalformedPercentEncodedPath(withoutUrls)) return true;
  const decodedCandidate = decodeRepeatedPercentEncoding(withoutUrls);
  const canonicalDecodedCandidate = canonicalizePreviewSyntax(
    decodedCandidate,
    true,
  );
  if (
    canonicalDecodedCandidate !== withoutUrls &&
    (hasMalformedPercentEncodedPath(canonicalDecodedCandidate) ||
      hasDirectRawAbsolutePath(canonicalDecodedCandidate, visited))
  ) {
    return true;
  }
  const pathPlaceholderPattern =
    /\$(?:WORKSPACE|CODEX_HOME|ABSOLUTE)(?:[\\/][^\s"'|;&<>(){},]*)?/gu;
  const placeholders = withoutUrls.match(pathPlaceholderPattern) ?? [];
  if (placeholders.some((path) => !isSafePathPreview(path))) return true;
  const withoutPlaceholders = withoutUrls.replace(pathPlaceholderPattern, "");
  return (
    /(^|[\s=(:,"';|&<>@\[{?#`])\/[^\s"'|;&<>()\[\]{},]/u.test(
      withoutPlaceholders,
    ) ||
    /(^|[\s=(:,"';|&<>@\[{?#`])[A-Za-z]:[\\/]/u.test(withoutPlaceholders) ||
    /(^|[\s=(:,"';|&<>@\[{?#`])\\/u.test(withoutPlaceholders)
  );
}

function hasMalformedPercentEncodedPath(value: string): boolean {
  return value.split(/\s+/u).some((token) => {
    const lastSeparator = Math.max(
      token.lastIndexOf("/"),
      token.lastIndexOf("\\"),
    );
    if (lastSeparator <= 0) return false;
    const pathPrefix = token.slice(0, lastSeparator);
    if (!pathPrefix.includes("%")) return false;
    try {
      decodeURIComponent(pathPrefix);
      return false;
    } catch {
      return true;
    }
  });
}

function decodeRepeatedPercentEncoding(value: string): string {
  let decoded = value;
  for (
    let pass = 0;
    pass < value.length && /%[0-9a-f]{2}/iu.test(decoded);
    pass += 1
  ) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return decodeAsciiPercentEncoding(decoded);
    }
  }
  return decoded;
}

function decodeAsciiPercentEncoding(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < value.length; pass += 1) {
    const next = decoded.replace(
      /%([0-9a-f]{2})/giu,
      (match, hexadecimal: string) => {
        const byte = Number.parseInt(hexadecimal, 16);
        return byte <= 0x9f ? String.fromCharCode(byte) : match;
      },
    );
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function securityPreviewCandidates(
  value: string,
  stripUnsafeFormatting = false,
): string[] {
  const candidates: string[] = [];
  const pending = [value];
  const seen = new Set<string>();

  while (pending.length > 0 && seen.size < 24) {
    const candidate = pending.shift();
    if (candidate === undefined || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);

    const canonical = canonicalizePreviewSyntax(
      candidate,
      stripUnsafeFormatting,
    );
    if (!seen.has(canonical)) pending.push(canonical);

    const sensitiveCanonical = canonicalizeSensitiveSyntax(candidate);
    if (!seen.has(sensitiveCanonical)) pending.push(sensitiveCanonical);

    const decoded = decodeRepeatedPercentEncoding(candidate);
    if (!seen.has(decoded)) pending.push(decoded);
  }

  return candidates;
}

function canonicalizeSensitiveSyntax(value: string): string {
  return value
    .replace(/\\(?=[A-Za-z0-9_.-])/gu, "")
    .replace(/\$?(?:''|"")/gu, "")
    .replace(/%(?![0-9a-f]{2})[A-Za-z0-9]{0,2}/giu, "");
}

function canonicalizePreviewSyntax(
  value: string,
  stripUnsafeFormatting = false,
): string {
  let canonical = value
    .normalize("NFKC")
    .replace(sharedSlashLikePattern, "/")
    .replace(sharedBackslashLikePattern, "\\");
  if (stripUnsafeFormatting) {
    canonical = canonical
      .replace(sharedControlCharacterGlobalPattern, "")
      .replace(sharedDefaultIgnorableGlobalPattern, "");
  }
  return canonical;
}

function isSafePathPreview(value: string): boolean {
  const canonical = canonicalizePreviewSyntax(value, true);
  if (
    canonical.includes("\\") ||
    canonical.includes("`") ||
    hasMalformedPercentEncodedPath(canonical)
  ) {
    return false;
  }

  if (sharedEncodedPathSeparatorPattern.test(canonical)) return false;

  const decoded = canonicalizePreviewSyntax(
    decodeRepeatedPercentEncoding(canonical),
    true,
  );
  if (
    countPathSeparators(decoded) !== countPathSeparators(canonical) ||
    hasDirectUnsafeFormatting(decoded) ||
    hasMalformedPercentEncodedPath(decoded) ||
    hasDirectObviousUnredactedSecret(decoded) ||
    /^[a-z][a-z0-9+.-]*:\/\//iu.test(decoded) ||
    /\bfile:[\\/]+/iu.test(decoded)
  ) {
    return false;
  }

  return isSafeDecodedPathPreview(decoded);
}

function countPathSeparators(value: string): number {
  return [...value].filter((character) => character === "/").length;
}

function isSafeDecodedPathPreview(value: string): boolean {
  if (
    value === "$WORKSPACE" ||
    value === "$CODEX_HOME" ||
    value === "$ABSOLUTE"
  ) {
    return true;
  }
  if (value.startsWith("$ABSOLUTE/")) {
    return isNormalizedRelativePath(value.slice("$ABSOLUTE/".length), false);
  }
  if (value.startsWith("$WORKSPACE/")) {
    return isNormalizedRelativePath(value.slice("$WORKSPACE/".length), true);
  }
  if (value.startsWith("$CODEX_HOME/")) {
    return isNormalizedRelativePath(value.slice("$CODEX_HOME/".length), true);
  }
  return isNormalizedRelativePath(value, true);
}

function isNormalizedRelativePath(
  value: string,
  allowNested: boolean,
): boolean {
  if (
    !value ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    /^(?:~[A-Za-z0-9._-]*|\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\})[\\/]/iu.test(
      value,
    )
  )
    return false;
  const segments = value.split("/");
  if (!allowNested && segments.length !== 1) return false;
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}
const runnerCommandStatusSchema = z.enum([
  "inProgress",
  "completed",
  "failed",
  "declined",
]);
const runnerToolStatusSchema = z.enum(["inProgress", "completed", "failed"]);
const runnerCollabAgentToolStatusSchema = z.enum([
  "inProgress",
  "completed",
  "failed",
  "interrupted",
]);

export const runnerCodexEventMethodSchema = z.enum(
  runnerCodexEventMethodValues,
);

export const runnerCodexErrorInfoSchema = z.union([
  z.enum([
    "contextWindowExceeded",
    "sessionBudgetExceeded",
    "usageLimitExceeded",
    "rateLimitExceeded",
    "serverOverloaded",
    "cyberPolicy",
    "misalignmentPolicyViolation",
    "internalServerError",
    "unauthorized",
    "badRequest",
    "threadRollbackFailed",
    "sandboxError",
    "other",
  ]),
  z.strictObject({
    httpConnectionFailed: z.strictObject({
      httpStatusCode: z.number().int().nullable(),
    }),
  }),
  z.strictObject({
    responseStreamConnectionFailed: z.strictObject({
      httpStatusCode: z.number().int().nullable(),
    }),
  }),
  z.strictObject({
    responseStreamDisconnected: z.strictObject({
      httpStatusCode: z.number().int().nullable(),
    }),
  }),
  z.strictObject({
    responseTooManyFailedAttempts: z.strictObject({
      httpStatusCode: z.number().int().nullable(),
    }),
  }),
  z.strictObject({
    activeTurnNotSteerable: z.strictObject({
      turnKind: z.enum(["review", "compact"]),
    }),
  }),
]);

const runnerCodexAgentMessageItemSchema = z.strictObject({
  type: z.literal("agentMessage"),
  id: runnerNativeIdSchema,
  text: runnerNativeTextSchema,
  phase: z.enum(["commentary", "final_answer"]).nullable(),
  delivery: z.literal("async").optional(),
  questions: codexAsyncUserInputQuestionsSchema.optional(),
});

const runnerCodexPlanItemSchema = z.strictObject({
  type: z.literal("plan"),
  id: runnerNativeIdSchema,
  text: z.string().max(1_000_000),
});

const runnerCodexReasoningItemSchema = z.strictObject({
  type: z.literal("reasoning"),
  id: runnerNativeIdSchema,
  summary: z
    .array(
      runnerCodexSafeTextPreviewSchema(
        runnerCodexPreviewLimits.activityTextCharacters,
      ),
    )
    .max(runnerCodexPreviewLimits.activityTextParts)
    .optional(),
});

const runnerCodexReadCommandActionSchema = z.strictObject({
  type: z.literal("read"),
  command: runnerCodexCommandPreviewSchema.optional(),
  name: runnerCodexIdentityPreviewSchema.optional(),
  path: runnerCodexPathPreviewSchema.optional(),
});

const runnerCodexListFilesCommandActionSchema = z.strictObject({
  type: z.literal("listFiles"),
  command: runnerCodexCommandPreviewSchema.optional(),
  path: runnerCodexPathPreviewSchema.nullable().optional(),
});

const runnerCodexSearchCommandActionSchema = z.strictObject({
  type: z.literal("search"),
  command: runnerCodexCommandPreviewSchema.optional(),
  query: runnerCodexQueryPreviewSchema.nullable().optional(),
  path: runnerCodexPathPreviewSchema.nullable().optional(),
});

const runnerCodexUnknownCommandActionSchema = z.strictObject({
  type: z.literal("unknown"),
  command: runnerCodexCommandPreviewSchema.optional(),
});

const runnerCodexCommandActionSchema = z.discriminatedUnion("type", [
  runnerCodexReadCommandActionSchema,
  runnerCodexListFilesCommandActionSchema,
  runnerCodexSearchCommandActionSchema,
  runnerCodexUnknownCommandActionSchema,
]);

const runnerCodexCommandExecutionItemSchema = z.strictObject({
  type: z.literal("commandExecution"),
  id: runnerNativeIdSchema,
  source: z
    .enum([
      "agent",
      "userShell",
      "unifiedExecStartup",
      "unifiedExecInteraction",
    ])
    .optional(),
  status: runnerCommandStatusSchema,
  commandActions: z
    .array(runnerCodexCommandActionSchema)
    .max(runnerCodexPreviewLimits.commandActions),
  command: runnerCodexCommandPreviewSchema.optional(),
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().nonnegative().finite().nullable().optional(),
});

const runnerCodexFileChangeItemSchema = z.strictObject({
  type: z.literal("fileChange"),
  id: runnerNativeIdSchema,
  status: runnerCommandStatusSchema,
  changes: z
    .array(
      z.strictObject({
        kind: z.strictObject({
          type: z.enum(["add", "delete", "update"]),
        }),
        path: runnerCodexPathPreviewSchema.optional(),
      }),
    )
    .max(runnerCodexPreviewLimits.fileChanges),
});

const runnerCodexMcpToolCallItemSchema = z
  .strictObject({
    type: z.literal("mcpToolCall"),
    id: runnerNativeIdSchema,
    server: runnerCodexIdentityPreviewSchema,
    tool: runnerCodexIdentityPreviewSchema,
    status: runnerToolStatusSchema,
    pluginId: runnerCodexIdentityPreviewSchema.nullable().optional(),
    durationMs: z.number().nonnegative().finite().nullable().optional(),
    /**
     * Stable, non-sensitive outcome projected from the LinkSense knowledge
     * MCP result. Raw tool arguments, results, and errors remain forbidden.
     */
    failureCode: knowledgeNoAvailableBasesCodeSchema.optional(),
  })
  .superRefine((item, context) => {
    if (item.failureCode === undefined) return;
    if (
      item.server !== coreMcpServerKey ||
      item.tool !== "search_knowledge_base" ||
      item.status === "inProgress"
    ) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "knowledge_failure_code_requires_terminal_knowledge_search",
      });
    }
  });

const runnerCodexDynamicToolCallItemSchema = z.strictObject({
  type: z.literal("dynamicToolCall"),
  id: runnerNativeIdSchema,
  namespace: runnerCodexIdentityPreviewSchema.nullable().optional(),
  tool: runnerCodexIdentityPreviewSchema,
  status: runnerToolStatusSchema,
  success: z.boolean().nullable().optional(),
  durationMs: z.number().nonnegative().finite().nullable().optional(),
});

const runnerCodexCollabAgentToolCallItemSchema = z.strictObject({
  type: z.literal("collabAgentToolCall"),
  id: runnerNativeIdSchema,
  tool: z.enum([
    "spawnAgent",
    "sendInput",
    "resumeAgent",
    "wait",
    "closeAgent",
    "sendMessage",
    "followupTask",
    "interruptAgent",
    "listAgents",
  ]),
  status: runnerCollabAgentToolStatusSchema,
  /**
   * Correlation-safe subagent projection. Raw thread ids, prompts, and status
   * messages never leave the Runner; agentKey is a deterministic opaque key.
   */
  agents: runnerCodexSubAgentsSchema.optional(),
});

const runnerCodexSubAgentActivityItemSchema = z.strictObject({
  type: z.literal("subAgentActivity"),
  id: runnerNativeIdSchema,
  kind: z.enum(["started", "interacted", "interrupted", "completed"]),
  /** Opaque key matching collabAgentToolCall.agents[].agentKey. */
  agentKey: runnerCodexAgentKeySchema.optional(),
  /** Optional bounded display label derived from a safe logical agent path. */
  agentLabel: runnerCodexAgentLabelSchema.optional(),
});

const runnerCodexWebSearchActionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("search"),
    query: runnerCodexQueryPreviewSchema.nullable().optional(),
    queries: z
      .array(runnerCodexQueryPreviewSchema)
      .max(runnerCodexPreviewLimits.searchQueries)
      .nullable()
      .optional(),
  }),
  z.strictObject({
    type: z.literal("openPage"),
    url: runnerCodexUrlPreviewSchema.nullable().optional(),
  }),
  z.strictObject({
    type: z.literal("findInPage"),
    url: runnerCodexUrlPreviewSchema.nullable().optional(),
    pattern: runnerCodexPatternPreviewSchema.nullable().optional(),
  }),
  z.strictObject({ type: z.literal("other") }),
]);

const runnerCodexWebSearchItemSchema = z.strictObject({
  type: z.literal("webSearch"),
  id: runnerNativeIdSchema,
  query: runnerCodexQueryPreviewSchema.optional(),
  action: runnerCodexWebSearchActionSchema.nullable(),
});

const runnerCodexImageViewItemSchema = z.strictObject({
  type: z.literal("imageView"),
  id: runnerNativeIdSchema,
  path: runnerCodexPathPreviewSchema.optional(),
  fileId: z.uuid().optional(),
});

const runnerCodexSleepItemSchema = z.strictObject({
  type: z.literal("sleep"),
  id: runnerNativeIdSchema,
  durationMs: z.number().nonnegative().finite(),
});

const runnerCodexImageGenerationItemSchema = z.strictObject({
  type: z.literal("imageGeneration"),
  id: runnerNativeIdSchema,
  status: runnerCodexStatusPreviewSchema,
  revisedPrompt: runnerCodexSafeTextPreviewSchema(
    runnerCodexPreviewLimits.activityTextCharacters,
  )
    .nullable()
    .optional(),
  savedPath: runnerCodexPathPreviewSchema.optional(),
});

const runnerCodexReviewItemSchema = z.strictObject({
  type: z.enum(["enteredReviewMode", "exitedReviewMode"]),
  id: runnerNativeIdSchema,
  review: runnerCodexSafeTextPreviewSchema(
    runnerCodexPreviewLimits.activityTextCharacters,
  ).optional(),
});

const runnerCodexContextCompactionItemSchema = z.strictObject({
  type: z.literal("contextCompaction"),
  id: runnerNativeIdSchema,
});

/**
 * Sanitized, shape-preserving projection of codex app-server ThreadItem.
 * Bounded Codex-authored reasoning summaries and safe command, path, search,
 * prompt, and review previews are allowed. Raw reasoning content, tool
 * inputs/outputs, diffs, command output, working directories, and collaboration
 * prompts, agent ids, status messages, and paths remain absent and therefore
 * fail strict parsing.
 */
export const runnerCodexItemSchema = z.union([
  runnerCodexAgentMessageItemSchema,
  runnerCodexPlanItemSchema,
  runnerCodexReasoningItemSchema,
  runnerCodexCommandExecutionItemSchema,
  runnerCodexFileChangeItemSchema,
  runnerCodexMcpToolCallItemSchema,
  runnerCodexDynamicToolCallItemSchema,
  runnerCodexCollabAgentToolCallItemSchema,
  runnerCodexSubAgentActivityItemSchema,
  runnerCodexWebSearchItemSchema,
  runnerCodexImageViewItemSchema,
  runnerCodexSleepItemSchema,
  runnerCodexImageGenerationItemSchema,
  runnerCodexReviewItemSchema,
  runnerCodexContextCompactionItemSchema,
]);

const runnerCodexSubAgentDetailTurnSchema = z.strictObject({
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
  items: z.array(runnerCodexItemSchema).max(100_000),
  startedAt: z.number().finite().nullable().optional(),
  completedAt: z.number().finite().nullable().optional(),
  durationMs: z.number().nonnegative().finite().nullable().optional(),
});

/**
 * Safe, bounded snapshot of one Codex collaboration sub-thread. The owning
 * Runner resolves agentKey back to a native child thread only after proving
 * that it belongs to the requested parent turn. Native child thread ids,
 * prompts, local agent paths, user messages, and raw tool output stay absent.
 */
export const runnerCodexSubAgentDetailSchema = z.strictObject({
  agentKey: runnerCodexAgentKeySchema,
  agentLabel: runnerCodexAgentLabelSchema.optional(),
  status: runnerCodexSubAgentStatusSchema,
  turns: z.array(runnerCodexSubAgentDetailTurnSchema).max(1_000),
});

export const runnerCodexSubAgentSummarySchema = z.strictObject({
  agentKey: runnerCodexAgentKeySchema,
  agentLabel: runnerCodexAgentLabelSchema.optional(),
  status: runnerCodexSubAgentStatusSchema,
});

export const runnerCodexSubAgentSummariesSchema = z.strictObject({
  agents: z
    .array(runnerCodexSubAgentSummarySchema)
    .max(runnerCodexPreviewLimits.subAgents)
    .refine(
      (agents) =>
        new Set(agents.map((agent) => agent.agentKey)).size === agents.length,
      "duplicate_subagent_key",
    ),
});

export const runnerCodexTurnSchema = z.strictObject({
  id: runnerNativeIdSchema,
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
  items: z.array(runnerCodexItemSchema).max(100_000).optional(),
  itemsView: z.enum(["notLoaded", "summary", "full"]).optional(),
  error: z
    .strictObject({
      message: runnerCodexErrorMessageSchema.optional(),
      codexErrorInfo: runnerCodexErrorInfoSchema.nullable(),
    })
    .nullable()
    .optional(),
  startedAt: z.number().finite().nullable().optional(),
  completedAt: z.number().finite().nullable().optional(),
  durationMs: z.number().nonnegative().finite().nullable().optional(),
});

function runnerCodexEvent<TMethod extends string, TParams extends z.ZodType>(
  method: TMethod,
  params: TParams,
) {
  return z.strictObject({
    method: z.literal(method),
    visibility: conversationEventVisibilitySchema,
    params,
  });
}

const runnerCodexThreadNameParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  threadName: z.string().min(1).max(1_000),
});
const runnerCodexGoalStatusSchema = z.enum([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);
const runnerCodexGoalUsageSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const runnerCodexGoalSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  objective: z.string().trim().min(1).max(4_000),
  status: runnerCodexGoalStatusSchema,
  tokenBudget: runnerCodexGoalUsageSchema.nullable(),
  tokensUsed: runnerCodexGoalUsageSchema,
  timeUsedSeconds: runnerCodexGoalUsageSchema,
  createdAt: runnerCodexGoalUsageSchema,
  updatedAt: runnerCodexGoalUsageSchema,
});
const runnerCodexGoalUpdatedParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema.nullable(),
  goal: runnerCodexGoalSchema,
});
const runnerCodexGoalClearedParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
});
const runnerCodexErrorParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  willRetry: z.boolean(),
  error: z.strictObject({
    message: runnerCodexErrorMessageSchema.optional(),
    codexErrorInfo: runnerCodexErrorInfoSchema.nullable(),
  }),
});
const runnerCodexTurnParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turn: runnerCodexTurnSchema,
});
export const runnerCodexHookEventNameSchema = z.enum([
  "preToolUse",
  "permissionRequest",
  "postToolUse",
  "preCompact",
  "postCompact",
  "sessionStart",
  "sessionEnd",
  "userPromptSubmit",
  "subagentStart",
  "subagentStop",
  "stop",
  "interrupt",
]);
export const runnerCodexHookRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "blocked",
  "stopped",
]);
export const runnerCodexHookRunSchema = z.strictObject({
  eventName: runnerCodexHookEventNameSchema,
  status: runnerCodexHookRunStatusSchema,
});
const runnerCodexHookStartedParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema.nullable(),
  run: runnerCodexHookRunSchema,
});
const runnerCodexHookCompletedParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema.nullable(),
  run: runnerCodexHookRunSchema,
  supersededItemId: runnerNativeIdSchema.optional(),
}).refine(
  ({ run, supersededItemId }) =>
    supersededItemId === undefined ||
    (run.eventName === "stop" && run.status === "blocked"),
  { path: ["supersededItemId"], message: "invalid_hook_supersession" },
);
const runnerCodexTokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const runnerCodexTokenUsageBreakdownSchema = z.strictObject({
  totalTokens: runnerCodexTokenCountSchema,
  inputTokens: runnerCodexTokenCountSchema,
  cachedInputTokens: runnerCodexTokenCountSchema,
  outputTokens: runnerCodexTokenCountSchema,
  reasoningOutputTokens: runnerCodexTokenCountSchema,
});
export const runnerCodexTokenUsageParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  tokenUsage: z.strictObject({
    total: runnerCodexTokenUsageBreakdownSchema,
    last: runnerCodexTokenUsageBreakdownSchema,
    modelContextWindow: runnerCodexTokenCountSchema.nullable(),
  }),
});
const runnerCodexTurnPlanParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  plan: z
    .array(
      z.strictObject({
        step: z.string().max(100_000),
        status: z.enum(["pending", "inProgress", "completed"]),
      }),
    )
    .max(10_000),
});
const runnerCodexItemLifecycleBaseShape = {
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  item: runnerCodexItemSchema,
};
const runnerCodexItemStartedParamsSchema = z.strictObject({
  ...runnerCodexItemLifecycleBaseShape,
  startedAtMs: z.number().nonnegative().finite().optional(),
});
const runnerCodexItemCompletedParamsSchema = z.strictObject({
  ...runnerCodexItemLifecycleBaseShape,
  completedAtMs: z.number().nonnegative().finite().optional(),
});

// Correlates native compaction items emitted before turn/start with the
// admitted local request. Native thread/turn/item identities stay unchanged.
const runnerPreparationShape = {
  preparation: z.strictObject({ turnId: uuidSchema }).optional(),
};
function validPreparationItem(event: {
  preparation?: { turnId: string } | undefined;
  params: { item: { type: string } };
}): boolean {
  return !event.preparation || event.params.item.type === "contextCompaction";
}
const runnerCodexDeltaParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  itemId: runnerNativeIdSchema,
  delta: runnerNativeTextSchema,
});
export const runnerCodexUserInputQuestionSchema = z.strictObject({
  id: z.string().min(1).max(160),
  header: z.string().min(1).max(160),
  question: z.string().min(1).max(4_000),
  isOther: z.boolean(),
  isSecret: z.boolean(),
  options: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(500),
        description: z.string().max(2_000),
      }),
    )
    .max(20)
    .nullable(),
});
const runnerCodexUserInputRequestParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  itemId: runnerNativeIdSchema,
  requestId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  questions: z.array(runnerCodexUserInputQuestionSchema).min(1).max(3),
  isBlocking: z.boolean(),
  autoResolutionMs: z
    .number()
    .int()
    .min(60_000)
    .max(240_000)
    .nullable(),
});
const runnerLinkSenseFormRequestParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  itemId: runnerNativeIdSchema,
  requestId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  serverName: z.string().min(1).max(240),
  message: z.string().min(1).max(4_000),
  requestedSchema: conversationFormRequestedSchema,
  uiHints: conversationFormUiHintsSchema,
  responseSemantics: conversationFormResponseSemanticsSchema,
  autoResolutionMs: z
    .number()
    .int()
    .min(60_000)
    .max(conversationFormAutoResolutionMs),
});
export const runnerInteractiveApplicationCustomEventParamsSchema =
  z.strictObject({
    eventId: uuidSchema,
    threadId: runnerNativeIdSchema,
    turnId: runnerNativeIdSchema,
    name: z.string().min(1).max(120),
    eventSchemaVersion: z.number().int().min(1).max(1_000),
    payload: z.json(),
  });
const runnerCodexServerRequestResolvedParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  requestId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const runnerCodexReasoningPartParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  itemId: runnerNativeIdSchema,
  summaryIndex: z.number().int().nonnegative(),
});
const runnerCodexReasoningSummaryDeltaParamsSchema = z.strictObject({
  threadId: runnerNativeIdSchema,
  turnId: runnerNativeIdSchema,
  itemId: runnerNativeIdSchema,
  delta: runnerCodexSafeTextPreviewSchema(
    runnerCodexPreviewLimits.activityTextCharacters,
  ),
  summaryIndex: z.number().int().nonnegative(),
});

/**
 * New authenticated Runner -> API events keep the native app-server method and
 * sanitized parameter shape. One app-server notification may produce zero or
 * one of these events; it is never expanded into LinkSense lifecycle events.
 */
export const runnerCodexEventSchema = z.discriminatedUnion("method", [
  runnerCodexEvent("thread/name/updated", runnerCodexThreadNameParamsSchema),
  runnerCodexEvent(
    "thread/goal/updated",
    runnerCodexGoalUpdatedParamsSchema,
  ),
  runnerCodexEvent(
    "thread/goal/cleared",
    runnerCodexGoalClearedParamsSchema,
  ),
  runnerCodexEvent("error", runnerCodexErrorParamsSchema),
  runnerCodexEvent("turn/started", runnerCodexTurnParamsSchema),
  runnerCodexEvent("hook/started", runnerCodexHookStartedParamsSchema),
  runnerCodexEvent("turn/completed", runnerCodexTurnParamsSchema),
  runnerCodexEvent("hook/completed", runnerCodexHookCompletedParamsSchema),
  runnerCodexEvent(
    "thread/tokenUsage/updated",
    runnerCodexTokenUsageParamsSchema,
  ),
  runnerCodexEvent("turn/plan/updated", runnerCodexTurnPlanParamsSchema),
  runnerCodexEvent("item/started", runnerCodexItemStartedParamsSchema)
    .extend(runnerPreparationShape)
    .refine(validPreparationItem),
  runnerCodexEvent("item/completed", runnerCodexItemCompletedParamsSchema)
    .extend(runnerPreparationShape)
    .refine(validPreparationItem),
  runnerCodexEvent("item/agentMessage/delta", runnerCodexDeltaParamsSchema),
  runnerCodexEvent("item/plan/delta", runnerCodexDeltaParamsSchema),
  runnerCodexEvent(
    "item/tool/requestUserInput",
    runnerCodexUserInputRequestParamsSchema,
  ),
  runnerCodexEvent(
    "serverRequest/resolved",
    runnerCodexServerRequestResolvedParamsSchema,
  ),
  runnerCodexEvent(
    "item/reasoning/summaryTextDelta",
    runnerCodexReasoningSummaryDeltaParamsSchema,
  ),
  runnerCodexEvent(
    "item/reasoning/summaryPartAdded",
    runnerCodexReasoningPartParamsSchema,
  ),
]);

export const runnerLinkSenseEventSchema = z.discriminatedUnion("method", [
  runnerCodexEvent(
    "linksense/form/request",
    runnerLinkSenseFormRequestParamsSchema,
  ),
  runnerCodexEvent(
    "linksense/application/custom-event",
    runnerInteractiveApplicationCustomEventParamsSchema,
  ),
]);

const nativeConversationEventLocalSchema = z.strictObject({
  message_id: uuidSchema.optional(),
  user_input_request_id: uuidSchema.optional(),
  plan_review_id: uuidSchema.optional(),
  superseded_message_id: uuidSchema.optional(),
  superseded_item_id: runnerNativeIdSchema.optional(),
});

function nativeConversationEvent<
  TMethod extends string,
  TParams extends z.ZodType,
>(method: TMethod, params: TParams) {
  return z.strictObject({
    ...eventBaseShape,
    event_type: z.literal(method),
    payload: z.strictObject({
      schema_version: z.literal(2),
      source: z.literal("codex_app_server"),
      method: z.literal(method),
      params,
      local: nativeConversationEventLocalSchema.optional(),
    }),
  });
}

/**
 * Public API/SSE envelope for sanitized native app-server notifications.
 * event_type and payload.method are bound to the same native method literal.
 */
export const nativeConversationEventSchema = z.discriminatedUnion(
  "event_type",
  [
    nativeConversationEvent(
      "thread/name/updated",
      runnerCodexThreadNameParamsSchema,
    ),
    nativeConversationEvent(
      "thread/goal/updated",
      runnerCodexGoalUpdatedParamsSchema,
    ),
    nativeConversationEvent(
      "thread/goal/cleared",
      runnerCodexGoalClearedParamsSchema,
    ),
    nativeConversationEvent(
      "thread/tokenUsage/updated",
      runnerCodexTokenUsageParamsSchema,
    ),
    nativeConversationEvent("error", runnerCodexErrorParamsSchema),
    nativeConversationEvent("turn/started", runnerCodexTurnParamsSchema),
    nativeConversationEvent(
      "hook/started",
      runnerCodexHookStartedParamsSchema,
    ),
    nativeConversationEvent("turn/completed", runnerCodexTurnParamsSchema),
    nativeConversationEvent(
      "hook/completed",
      runnerCodexHookCompletedParamsSchema,
    ),
    nativeConversationEvent(
      "turn/plan/updated",
      runnerCodexTurnPlanParamsSchema,
    ),
    nativeConversationEvent("item/started", runnerCodexItemStartedParamsSchema),
    nativeConversationEvent(
      "item/completed",
      runnerCodexItemCompletedParamsSchema,
    ),
    nativeConversationEvent(
      "item/agentMessage/delta",
      runnerCodexDeltaParamsSchema,
    ),
    nativeConversationEvent("item/plan/delta", runnerCodexDeltaParamsSchema),
    nativeConversationEvent(
      "item/tool/requestUserInput",
      runnerCodexUserInputRequestParamsSchema,
    ),
    nativeConversationEvent(
      "serverRequest/resolved",
      runnerCodexServerRequestResolvedParamsSchema,
    ),
    nativeConversationEvent(
      "item/reasoning/summaryTextDelta",
      runnerCodexReasoningSummaryDeltaParamsSchema,
    ),
    nativeConversationEvent(
      "item/reasoning/summaryPartAdded",
      runnerCodexReasoningPartParamsSchema,
    ),
  ],
);

const linkSenseConversationEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("linksense/form/request"),
  payload: z.strictObject({
    schema_version: z.literal(1),
    source: z.literal("linksense_runner"),
    method: z.literal("linksense/form/request"),
    params: runnerLinkSenseFormRequestParamsSchema,
    local: nativeConversationEventLocalSchema.optional(),
  }),
});

const interactiveApplicationCustomConversationEventSchema = z.strictObject({
  ...eventBaseShape,
  event_type: z.literal("linksense/application/custom-event"),
  payload: z.strictObject({
    schema_version: z.literal(1),
    source: z.literal("linksense_runner"),
    method: z.literal("linksense/application/custom-event"),
    params: runnerInteractiveApplicationCustomEventParamsSchema,
    local: nativeConversationEventLocalSchema.optional(),
  }),
});

/** Old custom events and new native app-server events remain readable. */
export const conversationEventSchema = z.union([
  nativeConversationEventSchema,
  linkSenseConversationEventSchema,
  interactiveApplicationCustomConversationEventSchema,
  legacyConversationEventSchema,
]);

/**
 * Transitional parser: old custom v1 Runner events remain readable while all
 * new Codex notifications are written as runnerCodexEventSchema events.
 */
export const runnerConversationEventSchema = z.union([
  runnerCodexEventSchema,
  runnerLinkSenseEventSchema,
  legacyRunnerConversationEventSchema,
]);

export const RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT = 32;
export const RUNNER_EVENT_BATCH_MAX_COUNT = 64;
export const RUNNER_EVENT_BATCH_TARGET_BYTES = 256 * 1024;

const runnerTextDeltaBatchIdentitySchema = z.object({
  method: z.enum(["item/agentMessage/delta", "item/plan/delta", "item/reasoning/summaryTextDelta"]),
  preparation: z.never().optional(),
  params: z.object({
    ...runnerCodexDeltaParamsSchema.shape,
    summaryIndex: z.number().int().nonnegative().optional(),
  }),
}).refine(input => input.method !== "item/reasoning/summaryTextDelta" || input.params.summaryIndex !== undefined);

/** Explicit eligibility, never a list of events that are required to flush. */
export function runnerTextDeltaBatchKey(input: unknown): string | null {
  const parsed = runnerTextDeltaBatchIdentitySchema.safeParse(input);
  if (!parsed.success) return null;
  const { method, params } = parsed.data;
  return JSON.stringify([method, params.threadId, params.turnId, params.itemId, params.summaryIndex ?? null]);
}

export type RunnerTextDeltaEvent = Extract<RunnerCodexEvent, {
  method: "item/agentMessage/delta" | "item/plan/delta" | "item/reasoning/summaryTextDelta";
}>;

export function isRunnerTextDeltaEvent(input: RunnerConversationEvent): input is RunnerTextDeltaEvent {
  return runnerTextDeltaBatchKey(input) !== null;
}

export const runnerEventBatchSchema = z.strictObject({
  conversationId: z.uuid(),
  events: z.array(z.strictObject({
    deliveryId: z.uuid(),
    event: runnerConversationEventSchema,
  })).min(1).max(RUNNER_EVENT_BATCH_MAX_COUNT),
});
export const runnerEventBatchReceiptSchema = z.strictObject({
  accepted_delivery_ids: z.array(z.uuid()).max(RUNNER_EVENT_BATCH_MAX_COUNT),
});

export type LegacyRunnerConversationEvent = z.infer<
  typeof legacyRunnerConversationEventSchema
>;
export type RunnerCodexItem = z.infer<typeof runnerCodexItemSchema>;
export type RunnerCodexSubAgentDetail = z.infer<
  typeof runnerCodexSubAgentDetailSchema
>;
export type RunnerCodexSubAgentSummary = z.infer<
  typeof runnerCodexSubAgentSummarySchema
>;
export type RunnerCodexSubAgentSummaries = z.infer<
  typeof runnerCodexSubAgentSummariesSchema
>;
export type RunnerCodexTurn = z.infer<typeof runnerCodexTurnSchema>;
export type RunnerCodexGoal = z.infer<typeof runnerCodexGoalSchema>;
export type RunnerCodexEvent = z.infer<typeof runnerCodexEventSchema>;
export type RunnerLinkSenseEvent = z.infer<typeof runnerLinkSenseEventSchema>;
export type RunnerConversationEvent = z.infer<
  typeof runnerConversationEventSchema
>;
export type NativeConversationEvent = z.infer<
  typeof nativeConversationEventSchema
>;
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

export function referencedRunnerCodexSubAgentKeys(
  item: RunnerCodexItem,
): string[] {
  if (item.type === "subAgentActivity") {
    return item.agentKey ? [item.agentKey] : [];
  }
  if (item.type === "collabAgentToolCall") {
    return (item.agents ?? []).map((agent) => agent.agentKey);
  }
  return [];
}
