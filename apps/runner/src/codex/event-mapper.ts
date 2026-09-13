import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  coreMcpServerKey,
  knowledgeNoAvailableBasesCodeSchema,
  knowledgeSearchFailureSchema,
  runnerCodexErrorInfoSchema,
  runnerCodexEventSchema,
  runnerCodexItemSchema,
  runnerCodexPreviewLimits,
  runnerCodexSubAgentDetailSchema,
  runnerCodexUserInputQuestionSchema,
  runnerConversationEventSchema,
  type RunnerCodexEvent,
  type RunnerCodexItem,
  type RunnerCodexSubAgentDetail,
  type RunnerCodexTurn,
  type RunnerConversationEvent,
  type RunnerLinkSenseEvent,
} from "@linksense/shared";

import type {
  CodexThread,
  CodexThreadItem,
  CodexTurn,
  HookEventName,
  HookRunStatus,
  JsonRpcNotification,
  JsonRpcRequest,
  ThreadGoalClearedParams,
  ThreadGoalUpdatedParams,
  ThreadNameUpdatedParams,
  ThreadTokenUsageUpdatedParams,
} from "./protocol.js";

/** Transitional parser used by the durable outbox and API delivery boundary. */
export const linkSenseRunnerEventSchema = runnerConversationEventSchema;
/** Strict parser for events newly produced from Codex app-server notifications. */
export const linkSenseCodexEventSchema = runnerCodexEventSchema;
export type LinkSenseRunnerEvent = RunnerConversationEvent;
export type LinkSenseCodexEvent = RunnerCodexEvent;
export type LinkSensePublishedEvent = RunnerCodexEvent | RunnerLinkSenseEvent;
export type CodexEventPreviewContext = {
  workspace?: string;
  codexHome?: string;
};
export type CodexNotificationProjectionContext = {
  supersededItemId?: string;
  subAgentLabelsByThreadId?: ReadonlyMap<string, string | null>;
};

const turnStatuses = new Set([
  "completed",
  "interrupted",
  "failed",
  "inProgress",
]);
const commandStatuses = new Set([
  "inProgress",
  "completed",
  "failed",
  "declined",
]);
const toolStatuses = new Set(["inProgress", "completed", "failed"]);
const collabAgentToolStatuses = new Set([
  "inProgress",
  "completed",
  "failed",
  "interrupted",
]);
const maximumKnowledgeFailurePayloadCharacters = 4_096;
const maximumKnowledgeFailureContentBlocks = 8;
const commandSources = new Set([
  "agent",
  "userShell",
  "unifiedExecStartup",
  "unifiedExecInteraction",
]);
const commandActionTypes = new Set(["read", "listFiles", "search", "unknown"]);
const collabTools = new Set([
  "spawnAgent",
  "sendInput",
  "resumeAgent",
  "wait",
  "closeAgent",
  "sendMessage",
  "followupTask",
  "interruptAgent",
  "listAgents",
]);
const subAgentActivityKinds = new Set([
  "started",
  "interacted",
  "interrupted",
  "completed",
]);
const collabAgentStatuses = new Set([
  "pendingInit",
  "running",
  "interrupted",
  "completed",
  "errored",
  "shutdown",
  "notFound",
]);
const webSearchActionTypes = new Set([
  "search",
  "openPage",
  "findInPage",
  "other",
]);
const planStatuses = new Set(["pending", "inProgress", "completed"]);
const hookEventNames = new Set<HookEventName>([
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
const hookRunStatuses = new Set<HookRunStatus>([
  "running",
  "completed",
  "failed",
  "blocked",
  "stopped",
]);

/**
 * Converts one app-server notification into at most one same-method event.
 * Unsupported methods and unsafe item variants fail closed.
 */
export function mapCodexNotification(
  notification: JsonRpcNotification,
  previewContext: CodexEventPreviewContext = {},
  projectionContext: CodexNotificationProjectionContext = {},
): LinkSenseCodexEvent[] {
  const params = asRecord(notification.params);
  const threadId = nativeId(params.threadId);

  if (notification.method === "thread/name/updated") {
    const threadName = normalizeThreadName(
      (params as Partial<ThreadNameUpdatedParams>).threadName,
    );
    if (!threadId || !threadName) return [];
    return event({
      method: "thread/name/updated",
      visibility: "user_visible",
      params: { threadId, threadName },
    });
  }

  if (notification.method === "thread/goal/updated") {
    const goal = sanitizeGoal(
      (params as Partial<ThreadGoalUpdatedParams>).goal,
    );
    const turnIdValue = (params as Partial<ThreadGoalUpdatedParams>).turnId;
    const turnId = turnIdValue === null ? null : nativeId(turnIdValue);
    if (
      !threadId ||
      !goal ||
      goal.threadId !== threadId ||
      (turnIdValue !== null && !turnId)
    ) {
      return [];
    }
    return event({
      method: "thread/goal/updated",
      visibility: "user_visible",
      params: { threadId, turnId, goal },
    });
  }

  if (notification.method === "thread/goal/cleared") {
    const clearedThreadId = nativeId(
      (params as Partial<ThreadGoalClearedParams>).threadId,
    );
    if (!clearedThreadId) return [];
    return event({
      method: "thread/goal/cleared",
      visibility: "user_visible",
      params: { threadId: clearedThreadId },
    });
  }

  if (notification.method === "serverRequest/resolved") {
    if (!threadId || !isNonnegativeInteger(params.requestId)) return [];
    return event({
      method: "serverRequest/resolved",
      visibility: "user_visible",
      params: { threadId, requestId: params.requestId },
    });
  }

  if (notification.method === "error") {
    const turnId = nativeId(params.turnId);
    if (!threadId || !turnId || typeof params.willRetry !== "boolean")
      return [];
    const error = asRecord(params.error);
    const message = sanitizeTextPreview(
      error.message,
      runnerCodexPreviewLimits.errorMessageCharacters,
      previewContext,
    );
    return event({
      method: "error",
      visibility: params.willRetry ? "user_collapsed" : "user_visible",
      params: {
        threadId,
        turnId,
        willRetry: params.willRetry,
        error: {
          ...(message ? { message } : {}),
          codexErrorInfo: sanitizeCodexErrorInfo(error.codexErrorInfo),
        },
      },
    });
  }

  if (
    notification.method === "turn/started" ||
    notification.method === "turn/completed"
  ) {
    const turn = sanitizeTurn(params.turn, previewContext);
    if (!threadId || !turn) return [];
    return event({
      method: notification.method,
      visibility: "user_visible",
      params: { threadId, turn },
    });
  }

  if (
    notification.method === "hook/started" ||
    notification.method === "hook/completed"
  ) {
    const turnIdValue = params.turnId;
    const turnId = turnIdValue === null ? null : nativeId(turnIdValue);
    const run = sanitizeHookRun(params.run);
    if (!threadId || (turnIdValue !== null && !turnId) || !run) return [];
    const supersededItemId =
      notification.method === "hook/completed"
        ? projectionContext.supersededItemId
        : undefined;
    return event({
      method: notification.method,
      visibility: "user_collapsed",
      params: {
        threadId,
        turnId,
        run,
        ...(supersededItemId ? { supersededItemId } : {}),
      },
    });
  }

  if (notification.method === "thread/tokenUsage/updated") {
    const turnId = nativeId(params.turnId);
    const tokenUsage = sanitizeTokenUsage(
      (params as Partial<ThreadTokenUsageUpdatedParams>).tokenUsage,
    );
    if (!threadId || !turnId || !tokenUsage) return [];
    return event({
      method: "thread/tokenUsage/updated",
      visibility: "internal_sanitized",
      params: { threadId, turnId, tokenUsage },
    });
  }

  if (notification.method === "turn/plan/updated") {
    const turnId = nativeId(params.turnId);
    const plan = sanitizePlan(params.plan);
    if (!threadId || !turnId || !plan) return [];
    return event({
      method: "turn/plan/updated",
      visibility: "user_collapsed",
      params: { threadId, turnId, plan },
    });
  }

  if (
    notification.method === "item/agentMessage/delta" ||
    notification.method === "item/plan/delta"
  ) {
    const turnId = nativeId(params.turnId);
    const itemId = nativeId(params.itemId);
    // Agent message deltas are end-user-visible model output. Keep them
    // byte-for-byte consistent with the completed agentMessage item instead of
    // running path-preview redaction that can mistake HTML closing tags and URL
    // separators for local absolute paths.
    const delta = typeof params.delta === "string" ? params.delta : null;
    if (!threadId || !turnId || !itemId || delta === null) {
      return [];
    }
    return event({
      method: notification.method,
      visibility: "user_visible",
      params: { threadId, turnId, itemId, delta },
    });
  }

  if (notification.method === "item/reasoning/summaryTextDelta") {
    const turnId = nativeId(params.turnId);
    const itemId = nativeId(params.itemId);
    const delta = sanitizeReasoningSummaryDelta(params.delta, previewContext);
    if (
      !threadId ||
      !turnId ||
      !itemId ||
      delta === null ||
      !isNonnegativeInteger(params.summaryIndex)
    ) {
      return [];
    }
    return event({
      method: "item/reasoning/summaryTextDelta",
      visibility: "user_collapsed",
      params: {
        threadId,
        turnId,
        itemId,
        delta,
        summaryIndex: params.summaryIndex,
      },
    });
  }

  if (notification.method === "item/reasoning/summaryPartAdded") {
    const turnId = nativeId(params.turnId);
    const itemId = nativeId(params.itemId);
    if (
      !threadId ||
      !turnId ||
      !itemId ||
      !isNonnegativeInteger(params.summaryIndex)
    ) {
      return [];
    }
    return event({
      method: "item/reasoning/summaryPartAdded",
      visibility: "user_collapsed",
      params: {
        threadId,
        turnId,
        itemId,
        summaryIndex: params.summaryIndex,
      },
    });
  }

  if (
    notification.method === "item/started" ||
    notification.method === "item/completed"
  ) {
    const turnId = nativeId(params.turnId);
    const item = sanitizeItem(params.item, previewContext, projectionContext);
    if (!threadId || !turnId || !item) return [];
    const timestampKey =
      notification.method === "item/started" ? "startedAtMs" : "completedAtMs";
    const timestamp = nonnegativeNumber(params[timestampKey]);
    return event({
      method: notification.method,
      visibility:
        item.type === "agentMessage" || item.type === "plan"
          ? "user_visible"
          : "user_collapsed",
      params: {
        threadId,
        turnId,
        item,
        ...(timestamp === undefined ? {} : { [timestampKey]: timestamp }),
      },
    });
  }

  return [];
}

/**
 * Converts supported native server requests into the same sanitized event
 * contract used by app-server notifications.
 */
export function mapCodexServerRequest(
  request: JsonRpcRequest,
): LinkSenseCodexEvent[] {
  if (request.method !== "item/tool/requestUserInput") return [];
  const params = asRecord(request.params);
  const threadId = nativeId(params.threadId);
  const turnId = nativeId(params.turnId);
  const itemId = nativeId(params.itemId);
  const questions = Array.isArray(params.questions)
    ? params.questions.map((question) =>
        runnerCodexUserInputQuestionSchema.safeParse(question),
      )
    : [];
  const isBlocking = params.isBlocking;
  const autoResolutionMs = params.autoResolutionMs;
  if (
    !threadId ||
    !turnId ||
    !itemId ||
    questions.length === 0 ||
    questions.length > 3 ||
    questions.some((question) => !question.success) ||
    typeof isBlocking !== "boolean" ||
    (autoResolutionMs !== null &&
      (!isPositiveInteger(autoResolutionMs) ||
        autoResolutionMs < 60_000 ||
        autoResolutionMs > 240_000))
  ) {
    return [];
  }
  return event({
    method: "item/tool/requestUserInput",
    visibility: "user_visible",
    params: {
      threadId,
      turnId,
      itemId,
      requestId: request.id,
      questions: questions.map((question) => question.data),
      isBlocking,
      autoResolutionMs,
    },
  });
}

function event(value: unknown): LinkSenseCodexEvent[] {
  const parsed = runnerCodexEventSchema.safeParse(value);
  return parsed.success ? [parsed.data] : [];
}

function sanitizeTokenUsage(value: unknown) {
  const tokenUsage = asRecord(value);
  const total = sanitizeTokenUsageBreakdown(tokenUsage.total);
  const last = sanitizeTokenUsageBreakdown(tokenUsage.last);
  const modelContextWindow = tokenUsage.modelContextWindow;
  if (
    !total ||
    !last ||
    (modelContextWindow !== null && !isNonnegativeInteger(modelContextWindow))
  ) {
    return null;
  }
  return { total, last, modelContextWindow };
}

function sanitizeHookRun(value: unknown) {
  const run = asRecord(value);
  // Codex 0.150.1 derives this id from event, display order, and sourcePath.
  // Validate its presence but never project it across the Runner boundary.
  const privateRunId = boundedString(run.id, 4_096);
  const eventName = enumValue(run.eventName, hookEventNames);
  const status = enumValue(run.status, hookRunStatuses);
  if (!privateRunId || !eventName || !status) return null;
  return {
    eventName: eventName as HookEventName,
    status: status as HookRunStatus,
  };
}

function sanitizeGoal(value: unknown) {
  const goal = asRecord(value);
  const threadId = nativeId(goal.threadId);
  const objective =
    typeof goal.objective === "string" ? goal.objective.trim() : "";
  const status = enumValue(
    goal.status,
    new Set([
      "active",
      "paused",
      "blocked",
      "usageLimited",
      "budgetLimited",
      "complete",
    ]),
  );
  const tokenBudget = goal.tokenBudget;
  if (
    !threadId ||
    objective.length === 0 ||
    objective.length > 4_000 ||
    !status ||
    (tokenBudget !== null && !isNonnegativeInteger(tokenBudget)) ||
    !isNonnegativeInteger(goal.tokensUsed) ||
    !isNonnegativeInteger(goal.timeUsedSeconds) ||
    !isNonnegativeInteger(goal.createdAt) ||
    !isNonnegativeInteger(goal.updatedAt)
  ) {
    return null;
  }
  return {
    threadId,
    objective,
    status,
    tokenBudget: tokenBudget as number | null,
    tokensUsed: goal.tokensUsed as number,
    timeUsedSeconds: goal.timeUsedSeconds as number,
    createdAt: goal.createdAt as number,
    updatedAt: goal.updatedAt as number,
  };
}

function sanitizeTokenUsageBreakdown(value: unknown) {
  const usage = asRecord(value);
  const keys = [
    "totalTokens",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
  ] as const;
  if (keys.some((key) => !isNonnegativeInteger(usage[key]))) return null;
  return {
    totalTokens: usage.totalTokens as number,
    inputTokens: usage.inputTokens as number,
    cachedInputTokens: usage.cachedInputTokens as number,
    outputTokens: usage.outputTokens as number,
    reasoningOutputTokens: usage.reasoningOutputTokens as number,
  };
}

function sanitizeTurn(
  value: unknown,
  previewContext: CodexEventPreviewContext,
): RunnerCodexTurn | null {
  const turn = asRecord(value);
  const id = nativeId(turn.id);
  const status = enumValue(turn.status, turnStatuses);
  if (!id || !status) return null;

  const sanitized: Record<string, unknown> = { id, status };
  const itemsView = enumValue(
    turn.itemsView,
    new Set(["notLoaded", "summary", "full"]),
  );
  if (itemsView) sanitized.itemsView = itemsView;
  if (turn.error === null) {
    sanitized.error = null;
  } else if (isRecord(turn.error)) {
    const message = sanitizeTextPreview(
      turn.error.message,
      runnerCodexPreviewLimits.errorMessageCharacters,
      previewContext,
    );
    sanitized.error = {
      ...(message ? { message } : {}),
      codexErrorInfo: sanitizeCodexErrorInfo(turn.error.codexErrorInfo),
    };
  }
  copyNullableFiniteNumber(sanitized, turn, "startedAt");
  copyNullableFiniteNumber(sanitized, turn, "completedAt");
  copyNullableNonnegativeNumber(sanitized, turn, "durationMs");
  const parsed = runnerCodexEventSchema.safeParse({
    method: "turn/completed",
    visibility: "user_visible",
    params: { threadId: "validation-thread", turn: sanitized },
  });
  return parsed.success && parsed.data.method === "turn/completed"
    ? parsed.data.params.turn
    : null;
}

function sanitizePlan(value: unknown): Array<{
  step: string;
  status: "pending" | "inProgress" | "completed";
}> | null {
  if (!Array.isArray(value)) return null;
  const plan: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }> = [];
  for (const candidate of value) {
    const step = asRecord(candidate);
    const status = enumValue(step.status, planStatuses);
    if (typeof step.step !== "string" || !status) return null;
    plan.push({
      step: step.step,
      status: status as "pending" | "inProgress" | "completed",
    });
  }
  return plan;
}

type CollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

type SanitizedSubAgent = {
  agentKey: string;
  agentLabel?: string;
  status: CollabAgentStatus | null;
};

/**
 * Keeps only deterministic opaque correlation keys and native status enums.
 * The native prompt, raw receiver ids, and state messages never enter the
 * durable event contract.
 */
function sanitizeSubAgents(
  receiverThreadIds: unknown,
  agentsStates: unknown,
  subAgentLabelsByThreadId?: ReadonlyMap<string, string | null>,
): SanitizedSubAgent[] {
  const agents = new Map<string, SanitizedSubAgent>();
  const add = (rawAgentThreadId: unknown, status: CollabAgentStatus | null) => {
    const agentKey = opaqueAgentKey(rawAgentThreadId);
    if (!agentKey) return;
    const agentLabel =
      typeof rawAgentThreadId === "string"
        ? subAgentLabelsByThreadId?.get(rawAgentThreadId)
        : null;

    const existing = agents.get(agentKey);
    if (existing) {
      if (status) existing.status = status;
      if (!existing.agentLabel && agentLabel) existing.agentLabel = agentLabel;
      return;
    }
    if (agents.size >= runnerCodexPreviewLimits.subAgents) return;
    agents.set(agentKey, {
      agentKey,
      ...(agentLabel ? { agentLabel } : {}),
      status,
    });
  };

  if (Array.isArray(receiverThreadIds)) {
    for (const receiverThreadId of receiverThreadIds.slice(
      0,
      runnerCodexPreviewLimits.subAgents,
    )) {
      add(receiverThreadId, null);
    }
  }

  for (const [agentThreadId, state] of Object.entries(agentsStates ?? {}).slice(
    0,
    runnerCodexPreviewLimits.subAgents,
  )) {
    const status = enumValue(asRecord(state).status, collabAgentStatuses);
    if (!status) continue;
    add(agentThreadId, status as CollabAgentStatus);
  }

  return [...agents.values()];
}

export function opaqueAgentKey(value: unknown): string | null {
  const nativeAgentThreadId = nativeId(value);
  if (!nativeAgentThreadId) return null;
  return `agent_${createHash("sha256")
    .update(nativeAgentThreadId)
    .digest("base64url")
    .slice(0, 24)}`;
}

/**
 * Projects a collaboration child thread into a UI-safe snapshot. Callers must
 * first prove that the native child thread belongs to the authorized parent
 * turn. Native child thread/turn/item ids are replaced with local ordinals,
 * and user messages are intentionally omitted.
 */
export function projectCodexSubAgentThread(input: {
  agentKey: string;
  agentLabel?: string | null;
  status: RunnerCodexSubAgentDetail["status"];
  thread: CodexThread;
  parentTurns?: readonly CodexTurn[];
  previewContext?: CodexEventPreviewContext;
}): RunnerCodexSubAgentDetail {
  const previewContext = input.previewContext ?? {};
  const turns = filterChildOwnedCodexTurns(
    input.parentTurns ?? [],
    input.thread.turns ?? [],
  )
    .slice(0, 1_000)
    .map((turn) => {
      const items = turn.items
        .slice(0, 100_000)
        .flatMap((value, itemIndex): RunnerCodexItem[] => {
          const projected = sanitizeItem(value, previewContext);
          if (!projected) return [];
          const id = `detail-${itemIndex + 1}`;
          if (projected.type === "agentMessage" || projected.type === "plan") {
            const text = sanitizeAgentMessageDelta(
              projected.text,
              previewContext,
            );
            if (!text) return [];
            const sanitized = parseItem({
              ...projected,
              id,
              text: truncatePreview(text, 1_000_000),
            });
            return sanitized ? [sanitized] : [];
          }
          const sanitized = parseItem({ ...projected, id });
          return sanitized ? [sanitized] : [];
        });
      return {
        status: turn.status,
        items,
        ...(turn.startedAt !== undefined ? { startedAt: turn.startedAt } : {}),
        ...(turn.completedAt !== undefined
          ? { completedAt: turn.completedAt }
          : {}),
        ...(turn.durationMs !== undefined
          ? { durationMs: turn.durationMs }
          : {}),
      };
    });
  return runnerCodexSubAgentDetailSchema.parse({
    agentKey: input.agentKey,
    ...(input.agentLabel ? { agentLabel: input.agentLabel } : {}),
    status: input.status,
    turns,
  });
}

function itemWithoutNativeId(
  item: CodexThreadItem,
): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(item)) {
    if (key !== "id") value[key] = fieldValue;
  }
  return value;
}

export function isInheritedCodexParentTurn(
  parentTurn: CodexTurn,
  childTurn: CodexTurn,
): boolean {
  if (parentTurn.id === childTurn.id) return true;
  if (
    childTurn.items.length === 0 ||
    childTurn.items.length > parentTurn.items.length
  ) {
    return false;
  }
  return childTurn.items.every((childItem, itemIndex) => {
    const parentItem = parentTurn.items[itemIndex];
    return (
      parentItem !== undefined &&
      isDeepStrictEqual(
        itemWithoutNativeId(childItem),
        itemWithoutNativeId(parentItem),
      )
    );
  });
}

function isInheritedParentTurn(
  parentTurns: readonly CodexTurn[],
  childTurn: CodexTurn,
): boolean {
  return parentTurns.some((parentTurn) =>
    isInheritedCodexParentTurn(parentTurn, childTurn),
  );
}

/**
 * A forked child can contain a snapshot of its parent rollout. Codex Desktop
 * hides those inherited turns: a persisted copy can retain the same turn id,
 * or a different id whose items equal a prefix of the final parent rollout.
 * Keep only turns owned by the child so status and elapsed time are derived
 * from the child lifecycle rather than the copied parent lifecycle.
 */
export function filterChildOwnedCodexTurns(
  parentTurns: readonly CodexTurn[],
  childTurns: readonly CodexTurn[],
): CodexTurn[] {
  return childTurns.filter(
    (childTurn) => !isInheritedParentTurn(parentTurns, childTurn),
  );
}

function formatLogicalSubAgentName(value: string): string {
  const words = value
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!words) return value;
  return `${words.charAt(0).toLocaleUpperCase("en-US")}${words.slice(1)}`;
}

/**
 * Codex AgentPath is a logical collaboration path, not a filesystem path.
 * Match the native Desktop projection by displaying the normalized leaf of
 * the native `/root/<task_name>` namespace while keeping the full path private.
 */
export function deriveLogicalSubAgentPathLabel(
  value: unknown,
  previewContext: CodexEventPreviewContext = {},
): string | null {
  if (
    typeof value !== "string" ||
    /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(value) ||
    value.includes("\\") ||
    hasUnsafePercentEncodedPath(value)
  ) {
    return null;
  }
  const normalized = normalizePreviewText(value);
  if (!normalized) return null;
  const match = /^\/root\/(.+)$/u.exec(normalized);
  if (!match) return null;
  const pathValue = match[1];
  if (!pathValue) return null;
  const segments = pathValue
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  const leaf = segments.at(-1);
  if (!leaf || leaf === "." || leaf === "..") return null;
  return deriveSubAgentLabel(formatLogicalSubAgentName(leaf), previewContext);
}

/**
 * A native agentPath is never persisted. For the UI, retain only a conservative
 * logical leaf label after rejecting physical paths, URLs, control characters,
 * encodings, and anything redacted by the standard preview sanitizer.
 */
export function deriveSubAgentLabel(
  value: unknown,
  previewContext: CodexEventPreviewContext,
): string | null {
  if (
    typeof value !== "string" ||
    /[\p{Cc}\p{Default_Ignorable_Code_Point}]/u.test(value)
  ) {
    return null;
  }
  const normalized = normalizePreviewText(value);
  if (
    !normalized ||
    isAbsolutePathLike(normalized) ||
    normalized.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(normalized) ||
    hasUnsafePercentEncodedPath(normalized)
  ) {
    return null;
  }

  const segments = normalized
    .split(/[/>]/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }

  const label = sanitizeTextPreview(
    segments.at(-1),
    runnerCodexPreviewLimits.agentLabelCharacters,
    previewContext,
  );
  if (
    !label ||
    label.includes("[REDACTED]") ||
    /\$(?:WORKSPACE|CODEX_HOME|ABSOLUTE)/u.test(label) ||
    label.includes("\\") ||
    /^(?:[a-z][a-z0-9+.-]*:|[~$]|\/)/iu.test(label) ||
    hasUnsafePercentEncodedPath(label) ||
    /(?:^|\/)\.\.?(?:\/|$)/u.test(label)
  ) {
    return null;
  }
  return label;
}

/**
 * Resolves the best UI-safe label from the versioned thread metadata exposed
 * by codex app-server. The native thread id and full source payload stay local.
 */
export function deriveSubAgentThreadLabel(
  value: unknown,
  previewContext: CodexEventPreviewContext = {},
): string | null {
  const thread = asRecord(value);
  const source = asRecord(thread.source);
  const subAgent = asRecord(source.subAgent);
  const threadSpawn = asRecord(subAgent.thread_spawn);
  const logicalPathLabel = deriveLogicalSubAgentPathLabel(
    threadSpawn.agent_path,
    previewContext,
  );
  if (logicalPathLabel) return logicalPathLabel;
  const candidates = [
    threadSpawn.agent_nickname,
    thread.agentNickname,
    thread.name,
    threadSpawn.agent_role,
    thread.agentRole,
  ];

  for (const candidate of candidates) {
    const label = deriveSubAgentLabel(candidate, previewContext);
    if (label) return label;
  }
  return null;
}

function sanitizeItem(
  value: unknown,
  previewContext: CodexEventPreviewContext,
  projectionContext: CodexNotificationProjectionContext = {},
): RunnerCodexItem | null {
  const item = asRecord(value) as Record<string, unknown> &
    Partial<CodexThreadItem>;
  const type = typeof item.type === "string" ? item.type : null;
  const id = nativeId(item.id);
  if (!type || !id) return null;

  switch (type) {
    case "agentMessage": {
      if (typeof item.text !== "string") return null;
      const phase =
        item.phase === "commentary" || item.phase === "final_answer"
          ? item.phase
          : null;
      return parseItem({
        type, id, text: item.text, phase,
        ...(item.delivery === "async" ? { delivery: "async" } : {}),
        ...(item.questions != null ? { questions: item.questions } : {}),
      });
    }
    case "plan":
      return typeof item.text === "string"
        ? { type, id, text: item.text }
        : null;
    case "reasoning": {
      const summary = Array.isArray(item.summary)
        ? item.summary
            .slice(0, runnerCodexPreviewLimits.activityTextParts)
            .flatMap((candidate) => {
              const preview = sanitizeTextPreview(
                candidate,
                runnerCodexPreviewLimits.activityTextCharacters,
                previewContext,
              );
              return preview ? [preview] : [];
            })
        : [];
      return parseItem({ type, id, summary });
    }
    case "commandExecution": {
      const status = enumValue(item.status, commandStatuses);
      if (!status) return null;
      const source = enumValue(item.source, commandSources);
      const commandActions = Array.isArray(item.commandActions)
        ? item.commandActions
            .slice(0, runnerCodexPreviewLimits.commandActions)
            .flatMap((candidate) => {
              const action = asRecord(candidate);
              const actionType = enumValue(action.type, commandActionTypes);
              if (!actionType) return [];
              return [
                sanitizeCommandAction(actionType, action, previewContext),
              ];
            })
        : [];
      const result: Record<string, unknown> = {
        type,
        id,
        status,
        commandActions,
      };
      if (source) result.source = source;
      const command = sanitizeCommandPreview(item.command, previewContext);
      if (command) result.command = command;
      if (item.exitCode === null || Number.isInteger(item.exitCode)) {
        result.exitCode = item.exitCode;
      }
      copyNullableNonnegativeNumber(result, item, "durationMs");
      return parseItem(result);
    }
    case "fileChange": {
      const status = enumValue(item.status, commandStatuses);
      if (!status) return null;
      const changes = Array.isArray(item.changes)
        ? item.changes
            .slice(0, runnerCodexPreviewLimits.fileChanges)
            .flatMap((candidate) => {
              const change = asRecord(candidate);
              const kind = asRecord(change.kind);
              if (
                kind.type !== "add" &&
                kind.type !== "delete" &&
                kind.type !== "update"
              ) {
                return [];
              }
              const path = sanitizePathPreview(change.path, previewContext);
              return [
                {
                  kind: { type: kind.type },
                  ...(path ? { path } : {}),
                },
              ];
            })
        : [];
      return parseItem({ type, id, status, changes });
    }
    case "mcpToolCall": {
      const status = enumValue(item.status, toolStatuses);
      const server = sanitizeTextPreview(item.server, 240, previewContext);
      const tool = sanitizeTextPreview(item.tool, 240, previewContext);
      if (!status || !server || !tool) return null;
      const result: Record<string, unknown> = {
        type,
        id,
        server,
        tool,
        status,
      };
      if (item.pluginId === null) result.pluginId = null;
      else {
        const pluginId = sanitizeTextPreview(
          item.pluginId,
          240,
          previewContext,
        );
        if (pluginId) result.pluginId = pluginId;
      }
      const failureCode = projectKnowledgeSearchFailureCode(item);
      if (failureCode) result.failureCode = failureCode;
      copyNullableNonnegativeNumber(result, item, "durationMs");
      return parseItem(result);
    }
    case "dynamicToolCall": {
      const status = enumValue(item.status, toolStatuses);
      const tool = sanitizeTextPreview(item.tool, 240, previewContext);
      if (!status || !tool) return null;
      const result: Record<string, unknown> = { type, id, tool, status };
      if (item.namespace === null) result.namespace = null;
      else {
        const namespace = sanitizeTextPreview(
          item.namespace,
          240,
          previewContext,
        );
        if (namespace) result.namespace = namespace;
      }
      if (item.success === null || typeof item.success === "boolean") {
        result.success = item.success;
      }
      copyNullableNonnegativeNumber(result, item, "durationMs");
      return parseItem(result);
    }
    case "collabAgentToolCall": {
      const tool = enumValue(item.tool, collabTools);
      const status = enumValue(item.status, collabAgentToolStatuses);
      const agents = sanitizeSubAgents(
        item.receiverThreadIds,
        item.agentsStates,
        projectionContext.subAgentLabelsByThreadId,
      );
      return tool && status
        ? parseItem({ type, id, tool, status, agents })
        : null;
    }
    case "subAgentActivity": {
      const kind = enumValue(item.kind, subAgentActivityKinds);
      const agentKey = opaqueAgentKey(item.agentThreadId);
      if (!kind || !agentKey) return null;
      const agentLabel =
        deriveLogicalSubAgentPathLabel(item.agentPath, previewContext) ??
        (typeof item.agentThreadId === "string"
          ? projectionContext.subAgentLabelsByThreadId?.get(item.agentThreadId)
          : null);
      return parseItem({
        type,
        id,
        kind,
        agentKey,
        ...(agentLabel ? { agentLabel } : {}),
      });
    }
    case "webSearch": {
      const action = asRecord(item.action);
      const actionType = enumValue(action.type, webSearchActionTypes);
      const query = sanitizeTextPreview(
        item.query,
        runnerCodexPreviewLimits.queryCharacters,
        previewContext,
      );
      return parseItem({
        type,
        id,
        ...(query ? { query } : {}),
        action: actionType
          ? sanitizeWebSearchAction(actionType, action, previewContext)
          : null,
      });
    }
    case "imageView": {
      const path = sanitizePathPreview(item.path, previewContext);
      return parseItem({ type, id, ...(path ? { path } : {}) });
    }
    case "contextCompaction":
      return parseItem({ type, id });
    case "sleep": {
      const durationMs = nonnegativeNumber(item.durationMs);
      return durationMs === undefined
        ? null
        : parseItem({ type, id, durationMs });
    }
    case "imageGeneration": {
      const status = sanitizeTextPreview(item.status, 120, previewContext);
      if (!status) return null;
      const revisedPrompt = sanitizeTextPreview(
        item.revisedPrompt,
        runnerCodexPreviewLimits.activityTextCharacters,
        previewContext,
      );
      const savedPath = sanitizePathPreview(item.savedPath, previewContext);
      return parseItem({
        type,
        id,
        status,
        ...(item.revisedPrompt === null
          ? { revisedPrompt: null }
          : revisedPrompt
            ? { revisedPrompt }
            : {}),
        ...(savedPath ? { savedPath } : {}),
      });
    }
    case "enteredReviewMode":
    case "exitedReviewMode": {
      const review = sanitizeTextPreview(
        item.review,
        runnerCodexPreviewLimits.activityTextCharacters,
        previewContext,
      );
      return parseItem({ type, id, ...(review ? { review } : {}) });
    }
    default:
      return null;
  }
}

function sanitizeWebSearchAction(
  actionType: string,
  action: Record<string, unknown>,
  previewContext: CodexEventPreviewContext,
): Record<string, unknown> {
  if (actionType === "search") {
    const result: Record<string, unknown> = { type: "search" };
    copyNullablePreview(
      result,
      "query",
      action.query,
      runnerCodexPreviewLimits.queryCharacters,
      previewContext,
    );
    if (action.queries === null) {
      result.queries = null;
    } else if (Array.isArray(action.queries)) {
      result.queries = action.queries
        .slice(0, runnerCodexPreviewLimits.searchQueries)
        .flatMap((candidate) => {
          const query = sanitizeTextPreview(
            candidate,
            runnerCodexPreviewLimits.queryCharacters,
            previewContext,
          );
          return query ? [query] : [];
        });
    }
    return result;
  }

  if (actionType === "openPage") {
    const result: Record<string, unknown> = { type: "openPage" };
    copyNullablePreview(
      result,
      "url",
      action.url,
      runnerCodexPreviewLimits.urlCharacters,
      previewContext,
    );
    return result;
  }

  if (actionType === "findInPage") {
    const result: Record<string, unknown> = { type: "findInPage" };
    copyNullablePreview(
      result,
      "url",
      action.url,
      runnerCodexPreviewLimits.urlCharacters,
      previewContext,
    );
    copyNullablePreview(
      result,
      "pattern",
      action.pattern,
      runnerCodexPreviewLimits.patternCharacters,
      previewContext,
    );
    return result;
  }

  return { type: "other" };
}

function sanitizeCommandAction(
  actionType: string,
  action: Record<string, unknown>,
  previewContext: CodexEventPreviewContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = { type: actionType };
  const command = sanitizeCommandPreview(action.command, previewContext);
  if (command) result.command = command;

  if (actionType === "read") {
    const name = sanitizeTextPreview(action.name, 240, previewContext);
    if (name) result.name = name;
    copyPathPreview(result, "path", action.path, previewContext);
    return result;
  }

  if (actionType === "listFiles") {
    copyNullablePathPreview(result, "path", action.path, previewContext);
    return result;
  }

  if (actionType === "search") {
    copyNullablePreview(
      result,
      "query",
      action.query,
      runnerCodexPreviewLimits.queryCharacters,
      previewContext,
    );
    copyNullablePathPreview(result, "path", action.path, previewContext);
  }

  return result;
}

function copyNullablePreview(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  maximum: number,
  previewContext: CodexEventPreviewContext,
): void {
  if (value === null) {
    target[key] = null;
    return;
  }
  const preview = sanitizeTextPreview(value, maximum, previewContext);
  if (preview) target[key] = preview;
}

function copyPathPreview(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  previewContext: CodexEventPreviewContext,
): void {
  const preview = sanitizePathPreview(value, previewContext);
  if (preview) target[key] = preview;
}

function copyNullablePathPreview(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  previewContext: CodexEventPreviewContext,
): void {
  if (value === null) {
    target[key] = null;
    return;
  }
  copyPathPreview(target, key, value, previewContext);
}

function sanitizeCommandPreview(
  value: unknown,
  previewContext: CodexEventPreviewContext,
): string | null {
  return sanitizeTextPreview(
    value,
    runnerCodexPreviewLimits.commandCharacters,
    previewContext,
  );
}

function sanitizePathPreview(
  value: unknown,
  previewContext: CodexEventPreviewContext,
): string | null {
  const normalized = normalizePreviewText(value);
  if (!normalized) return null;
  const unquoted = unwrapPathPreview(normalized);
  const decodedPath =
    normalizePreviewText(decodeRepeatedPercentEncoding(unquoted)) ?? unquoted;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(decodedPath)) return null;
  const rooted = replaceKnownRoots(unquoted, previewContext);
  const redacted = redactSensitiveValues(rooted);
  const safePath = isAbsolutePathLike(redacted)
    ? absolutePathPreview(redacted)
    : redactUnknownAbsolutePaths(redacted);
  const normalizedPath = normalizeSafePathPreview(safePath);
  return normalizedPath
    ? truncatePreview(normalizedPath, runnerCodexPreviewLimits.pathCharacters)
    : null;
}

function sanitizeTextPreview(
  value: unknown,
  maximum: number,
  previewContext: CodexEventPreviewContext,
): string | null {
  const normalized = normalizePreviewText(value);
  if (!normalized) return null;
  const pathSafe = sanitizeNormalizedTextPreview(normalized, previewContext);
  const securityNormalized = normalizePreviewText(value, "");
  const securityRooted = securityNormalized
    ? replaceKnownRoots(securityNormalized, previewContext)
    : null;
  const securitySafe = securityRooted
    ? sanitizeNormalizedTextPreview(securityRooted, {})
    : null;
  const safeValue =
    securityRooted &&
    securitySafe &&
    protectionMarkerCount(securitySafe) > protectionMarkerCount(pathSafe)
      ? securitySafe
      : pathSafe;
  const compact = safeValue.replace(/\s+/gu, " ").trim();
  return compact ? truncatePreview(compact, maximum) : null;
}

function sanitizeReasoningSummaryDelta(
  value: unknown,
  previewContext: CodexEventPreviewContext,
): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const leadingSpace = /^\s/u.test(value);
  const trailingSpace = /\s$/u.test(value);
  const maximum = runnerCodexPreviewLimits.activityTextCharacters;
  const preview = sanitizeTextPreview(
    value,
    Math.max(1, maximum - Number(leadingSpace) - Number(trailingSpace)),
    previewContext,
  );
  if (!preview) return /\s/u.test(value) ? " " : null;
  return `${leadingSpace ? " " : ""}${preview}${trailingSpace ? " " : ""}`;
}

function sanitizeAgentMessageDelta(
  value: unknown,
  previewContext: CodexEventPreviewContext,
): string | null {
  if (typeof value !== "string") return null;
  return sanitizeNormalizedTextPreview(value, previewContext);
}

function sanitizeNormalizedTextPreview(
  value: string,
  previewContext: CodexEventPreviewContext,
): string {
  const rooted = replaceKnownRoots(value, previewContext);
  const redacted = redactSensitiveValues(rooted);
  const encodedRedacted = redactEncodedSensitiveValues(redacted);
  const controlSafe = sanitizeEncodedControlCharacters(encodedRedacted);
  return redactUnknownAbsolutePaths(controlSafe);
}

function protectionMarkerCount(value: string): number {
  return (
    value.match(/\[REDACTED\]|\$(?:WORKSPACE|CODEX_HOME|ABSOLUTE)/gu)?.length ??
    0
  );
}

const sensitiveNameSource =
  "(?:[A-Za-z0-9_.\\[\\]-]*(?:token|secret|api[._-]?key|private[._-]?key|access[._-]?key|password|passwd|passphrase|authorization|cookie|credential|signature|session[._-]?id|jwt)[A-Za-z0-9_.\\[\\]-]*|pwd|sig)";
const quotedSensitiveKeyPattern = new RegExp(
  `((?:["'])${sensitiveNameSource}(?:["'])\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&|}]+)`,
  "giu",
);
const sensitiveAssignmentPattern = new RegExp(
  `(^|[\\s;,(?&#])((?:--)?${sensitiveNameSource})(\\s*[:=]\\s*|\\s+)(?:"[^"]*"|'[^']*'|[^\\s,;&|]+)`,
  "giu",
);
const apiKeyPhrasePattern =
  /(\bapi\s+key)(\s*[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;&|]+)/giu;
const shellEnvironmentAssignmentPattern =
  /(^|[\s;,(])((?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s,;&|)]+)/giu;
const trailingSensitiveAssignmentPattern = new RegExp(
  `(?:--)?${sensitiveNameSource}(?:\\s*[:=]\\s*|\\s+)$`,
  "iu",
);
const sensitiveBasenamePattern =
  /(?:token|secret|api[._-]?key|private[._-]?key|access[._-]?key|password|passwd|passphrase|authorization|cookie|credential|signature|session[._-]?id|jwt|bearer)/iu;

const malformedPercentAssignmentPattern =
  /(^|[\s;,(?&#])((?:--)?[A-Za-z_][A-Za-z0-9_.[\]%'"$\\-]*%[A-Za-z0-9_.[\]%'"$\\-]*)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&|}]+)/giu;
const shellJoinedAssignmentPattern =
  /(^|[\s;,(?&#])((?:--)?[A-Za-z_][A-Za-z0-9_.[\]'"$\\-]*)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&|}]+)/giu;

const knownSecretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  /\bAIza[A-Za-z0-9_-]{30,}\b/gu,
  /\bnpm_[A-Za-z0-9]{20,}\b/gu,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/gu,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/gu,
] as const;

function redactSensitiveValues(value: string): string {
  let redacted = value
    .replace(
      malformedPercentAssignmentPattern,
      (match, prefix, key, separator) =>
        isMalformedPercentEncoding(key)
          ? `${prefix}${key}${separator}[REDACTED]`
          : match,
    )
    .replace(shellJoinedAssignmentPattern, (match, prefix, key, separator) => {
      const canonicalKey = canonicalizeShellJoinedKey(key);
      return canonicalKey !== key && isSensitiveKey(canonicalKey)
        ? `${prefix}${canonicalKey}${separator}[REDACTED]`
        : match;
    })
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/giu, "$1[REDACTED]@")
    .replace(
      /(["'])(?=[^"']*\b(?:authorization|cookie)\s*:)[^"']*\1/giu,
      (match) => `${match[0]}[REDACTED]${match[0]}`,
    )
    .replace(
      /\b(?:authorization|cookie)\s*:\s*[^"'|&]*/giu,
      (match) => `${match.slice(0, match.indexOf(":") + 1)} [REDACTED]`,
    )
    .replace(
      /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;&|]+)/giu,
      "Bearer [REDACTED]",
    )
    .replace(shellEnvironmentAssignmentPattern, "$1$2[REDACTED]")
    .replace(apiKeyPhrasePattern, "$1$2[REDACTED]")
    .replace(quotedSensitiveKeyPattern, "$1[REDACTED]")
    .replace(sensitiveAssignmentPattern, "$1$2$3[REDACTED]")
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]");

  for (const pattern of knownSecretPatterns) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function canonicalizeShellJoinedKey(value: string): string {
  return value
    .replace(/\\(?=[A-Za-z0-9_.[\]-])/gu, "")
    .replace(/\$?(?:''|"")/gu, "");
}

function isSensitiveKey(value: string): boolean {
  const key = value.replace(/^--/u, "");
  return new RegExp(`^${sensitiveNameSource}$`, "iu").test(key);
}

function isMalformedPercentEncoding(value: string): boolean {
  try {
    decodeURIComponent(value);
    return false;
  } catch {
    return true;
  }
}

function redactEncodedSensitiveValues(value: string): string {
  const decodedCandidate = decodeRepeatedPercentEncoding(value);
  if (decodedCandidate === value) return value;
  for (const candidate of [
    normalizePreviewText(decodedCandidate),
    normalizePreviewText(decodedCandidate, ""),
  ]) {
    if (!candidate) continue;
    const redactedCandidate = redactSensitiveValues(candidate);
    if (redactedCandidate !== candidate) return redactedCandidate;
  }
  return value;
}

function sanitizeEncodedControlCharacters(value: string): string {
  const decodedCandidate = decodeRepeatedPercentEncoding(value);
  if (
    decodedCandidate === value ||
    !hasPreviewControlCharacter(decodedCandidate)
  ) {
    return value;
  }
  return normalizePreviewText(decodedCandidate) ?? "[REDACTED]";
}

function unwrapPathPreview(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  return (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "`" && last === "`")
    ? value.slice(1, -1).trim()
    : value;
}

function normalizeSafePathPreview(value: string): string | null {
  const normalized = value.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  const placeholder =
    /^(\$(?:WORKSPACE|CODEX_HOME|ABSOLUTE))(?:\/(.*))?$/u.exec(normalized);
  const prefix = placeholder?.[1];
  const remainder = placeholder ? (placeholder[2] ?? "") : normalized;
  const segments: string[] = [];
  let containsTraversal = false;

  for (const segment of remainder.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      containsTraversal = true;
      continue;
    }
    segments.push(redactPathSegment(segment));
  }

  if (containsTraversal) {
    return absolutePathPreview(segments.at(-1) ?? "");
  }
  if (prefix === "$ABSOLUTE") {
    const basename = segments.at(-1);
    return basename ? `$ABSOLUTE/${basename}` : "$ABSOLUTE";
  }
  if (prefix === "$WORKSPACE" || prefix === "$CODEX_HOME") {
    return segments.length > 0 ? `${prefix}/${segments.join("/")}` : prefix;
  }
  if (homeExpandedPathPattern.test(normalized)) {
    return absolutePathPreview(segments.at(-1) ?? "");
  }
  return segments.length > 0 ? segments.join("/") : null;
}

function redactPathSegment(value: string): string {
  const decoded = decodeRepeatedPercentEncoding(value);
  const normalizedDecoded = normalizePreviewText(decoded, "");
  if (
    sensitiveBasenamePattern.test(value) ||
    (normalizedDecoded !== null &&
      (sensitiveBasenamePattern.test(normalizedDecoded) ||
        redactSensitiveValues(normalizedDecoded) !== normalizedDecoded)) ||
    hasUnsafePercentEncodedPath(value)
  ) {
    return "[REDACTED]";
  }
  return redactSensitiveValues(value);
}

function replaceKnownRoots(
  value: string,
  previewContext: CodexEventPreviewContext,
): string {
  const roots = [
    { path: previewContext.workspace, replacement: "$WORKSPACE" },
    { path: previewContext.codexHome, replacement: "$CODEX_HOME" },
  ]
    .flatMap(({ path, replacement }) => {
      if (typeof path !== "string") return [];
      const normalized = path.replace(/[\\/]+$/u, "");
      return normalized ? [{ path: normalized, replacement }] : [];
    })
    .sort((left, right) => right.path.length - left.path.length);

  return roots.reduce(
    (current, root) => replaceRoot(current, root.path, root.replacement),
    value,
  );
}

function replaceRoot(value: string, root: string, replacement: string): string {
  let cursor = 0;
  let result = "";
  while (cursor < value.length) {
    const index = value.indexOf(root, cursor);
    if (index < 0) return result + value.slice(cursor);
    const before = index === 0 ? undefined : value[index - 1];
    const after = value[index + root.length];
    if (isRootBoundary(before, true) && isRootBoundary(after, false)) {
      result += `${value.slice(cursor, index)}${replacement}`;
      cursor = index + root.length;
    } else {
      const next = index + root.length;
      result += value.slice(cursor, next);
      cursor = next;
    }
  }
  return result;
}

function isRootBoundary(value: string | undefined, before: boolean): boolean {
  if (value === undefined || /\s/u.test(value)) return true;
  return before
    ? `"'=(:,/\\\`?#`.includes(value)
    : `"',;:()[]/\\\`?#`.includes(value);
}

function redactUnknownAbsolutePaths(value: string): string {
  const urls: string[] = [];
  let result = value.replace(/\bfile:[\\/]+[^\s"'<>]+/giu, fileUriPathPreview);
  result = result.replace(
    /\$(?:WORKSPACE|CODEX_HOME|ABSOLUTE)(?:\/[^\s"'|;&<>(){},]*)?/gu,
    (path) =>
      hasUnsafePercentEncodedPath(path)
        ? path.slice(0, path.indexOf("/")) + "/[REDACTED]"
        : path,
  );
  result = result.replace(
    homeExpandedPathInTextPattern,
    (match, prefix: string) =>
      `${prefix}${absolutePathPreview(match.slice(prefix.length))}`,
  );
  result = result.replace(
    /\bkb-asset:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
    (url) => {
      const index = urls.push(url) - 1;
      return `__LINKSENSE_URL_${index}__`;
    },
  );
  result = result.replace(/\bhttps?:\/\/[^\s"'<>]+/giu, (url) => {
    const index = urls.push(sanitizeHttpUrlPreview(url)) - 1;
    return `__LINKSENSE_URL_${index}__`;
  });
  result = redactMalformedPercentEncodedPaths(result);
  const decodedCandidate = decodeRepeatedPercentEncoding(result);
  if (decodedCandidate !== result) {
    const normalizedCandidate = normalizePreviewText(decodedCandidate);
    const strippedCandidate = normalizePreviewText(decodedCandidate, "");
    const candidates = [normalizedCandidate, strippedCandidate].filter(
      (candidate): candidate is string => candidate !== null,
    );
    const malformedSafeCandidate = normalizedCandidate
      ? redactMalformedPercentEncodedPaths(normalizedCandidate)
      : null;
    const pathSafeCandidate = candidates.find(containsPlainAbsolutePath);
    if (
      malformedSafeCandidate &&
      malformedSafeCandidate !== normalizedCandidate
    ) {
      result = malformedSafeCandidate;
    } else if (pathSafeCandidate) {
      result = redactUnknownAbsolutePaths(pathSafeCandidate).replace(
        /\bhttps?:\/\/[^\s"'<>]+/giu,
        (url) => {
          const index = urls.push(url) - 1;
          return `__LINKSENSE_URL_${index}__`;
        },
      );
    } else if (
      hasPreviewControlCharacter(decodedCandidate) ||
      hasEncodedPathPlaceholder(result)
    ) {
      result = normalizedCandidate ?? strippedCandidate ?? result;
    }
  }
  result = result.replace(/\bfile:[\\/]+[^\s"'<>]+/giu, fileUriPathPreview);
  result = sanitizePathPlaceholders(result);
  result = result.replace(/"([^"]*)"/gu, (match, quoted: string) =>
    isAbsolutePathLike(quoted) ? `"${absolutePathPreview(quoted)}"` : match,
  );
  result = result.replace(/'([^']*)'/gu, (match, quoted: string) =>
    isAbsolutePathLike(quoted) ? `'${absolutePathPreview(quoted)}'` : match,
  );
  result = result.replace(/`([^`]*)`/gu, (match, quoted: string) =>
    isAbsolutePathLike(quoted) ? absolutePathPreview(quoted) : match,
  );
  result = result.replace(
    /(^|[\s=(:,;|&<>@[{`?#])\/[^\s"'`|;&<>()[\]{},?#]+/gu,
    (match, prefix: string) =>
      `${prefix}${absolutePathPreview(match.slice(prefix.length))}`,
  );
  result = result.replace(
    /(^|[\s=(:,;|&<>@[{`?#])[A-Za-z]:[\\/][^\s"'`|;&<>()[\]{},?#]*/gu,
    (match, prefix: string) =>
      `${prefix}${absolutePathPreview(match.slice(prefix.length))}`,
  );
  result = result.replace(
    /(^|[\s=(:,;|&<>@[{`?#])\\+[^\s"'`|;&<>()[\]{},?#]*/gu,
    (match, prefix: string) =>
      `${prefix}${absolutePathPreview(match.slice(prefix.length))}`,
  );
  return result.replace(
    /__LINKSENSE_URL_(\d+)__/gu,
    (placeholder, index: string) => urls[Number(index)] ?? placeholder,
  );
}

function sanitizeHttpUrlPreview(url: string): string {
  const suffixIndex = firstUrlSuffixIndex(url);
  if (suffixIndex < 0) return url;
  return `${url.slice(0, suffixIndex)}${redactUnknownAbsolutePaths(
    url.slice(suffixIndex),
  )}`;
}

function firstUrlSuffixIndex(url: string): number {
  const queryIndex = url.indexOf("?");
  const fragmentIndex = url.indexOf("#");
  if (queryIndex < 0) return fragmentIndex;
  if (fragmentIndex < 0) return queryIndex;
  return Math.min(queryIndex, fragmentIndex);
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

function hasUnsafePercentEncodedPath(value: string): boolean {
  if (!/%[0-9a-f]{2}/iu.test(value)) return false;
  try {
    decodeURIComponent(value);
  } catch {
    return true;
  }
  const decoded = decodeRepeatedPercentEncoding(value);
  if (decoded === value) return false;
  if (hasPreviewControlCharacter(decoded)) return true;
  const normalized = normalizePreviewText(decoded, "");
  if (!normalized) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(normalized)) return true;
  if (sensitiveBasenamePattern.test(normalized)) return true;
  if (redactSensitiveValues(normalized) !== normalized) return true;
  if (
    countPathSeparators(normalized) > countPathSeparators(value) ||
    normalized.split(/[\\/]/u).some((segment) => segment === "..")
  ) {
    return true;
  }
  return false;
}

function countPathSeparators(value: string): number {
  return Array.from(value).filter(
    (character) => character === "/" || character === "\\",
  ).length;
}

function hasPreviewControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function hasEncodedPathPlaceholder(value: string): boolean {
  return /\$(?:WORKSPACE|CODEX_HOME|ABSOLUTE)%(?:25)*(?:2f|5c)/iu.test(value);
}

function redactMalformedPercentEncodedPaths(value: string): string {
  return value.replace(/[^\s"'<>]+/gu, (token) =>
    isMalformedPercentEncodedPath(token) ? absolutePathPreview(token) : token,
  );
}

function isMalformedPercentEncodedPath(value: string): boolean {
  if (!value.includes("%") || !/[\\/]/u.test(value)) return false;
  const lastSeparator = Math.max(
    value.lastIndexOf("/"),
    value.lastIndexOf("\\"),
  );
  if (lastSeparator <= 0) return false;
  const prefix = value.slice(0, lastSeparator);
  if (!prefix.includes("%")) return false;
  try {
    decodeURIComponent(prefix);
    return false;
  } catch {
    return true;
  }
}

function containsPlainAbsolutePath(value: string): boolean {
  const candidate = value.replace(/\bhttps?:\/\/[^\s"'<>]+/giu, (url) => {
    const suffixIndex = firstUrlSuffixIndex(url);
    return suffixIndex < 0
      ? "__LINKSENSE_REMOTE_URL__"
      : url.slice(suffixIndex);
  });
  return (
    /\bfile:[\\/]+/iu.test(candidate) ||
    /(^|[\s=(:,;|&<>@[{`?#])\/[^\s"'`|;&<>()[\]{},?#]/u.test(candidate) ||
    /(^|[\s=(:,;|&<>@[{`?#])[A-Za-z]:[\\/]/u.test(candidate) ||
    /(^|[\s=(:,;|&<>@[{`?#])\\+/u.test(candidate) ||
    homeExpandedPathInTextEvidencePattern.test(candidate) ||
    sanitizePathPlaceholders(candidate) !== candidate
  );
}

function sanitizePathPlaceholders(value: string): string {
  return value.replace(
    /\$(WORKSPACE|CODEX_HOME|ABSOLUTE)(?:[\\/][^\s"'|;&<>(){},]*)?/gu,
    (path, rootName: string) => {
      const root = "$" + rootName;
      const suffix = path.slice(root.length);
      if (!suffix) return path;

      const segments = suffix
        .replace(/^[\\/]+/u, "")
        .split(/[\\/]/u)
        .filter(Boolean);
      if (
        rootName === "ABSOLUTE" &&
        (path.includes("\\") ||
          hasUnsafePercentEncodedPath(path) ||
          segments.length !== 1 ||
          segments[0] === "." ||
          segments[0] === "..")
      ) {
        return absolutePathPreview("/" + (segments.at(-1) ?? ""));
      }
      if (
        rootName !== "ABSOLUTE" &&
        (path.includes("\\") ||
          hasUnsafePercentEncodedPath(path) ||
          segments.some((segment) => segment === "." || segment === ".."))
      ) {
        return absolutePathPreview("/" + (segments.at(-1) ?? ""));
      }
      return path;
    },
  );
}

function fileUriPathPreview(url: string): string {
  let rawPath =
    url
      .slice(url.indexOf(":") + 1)
      .replace(/^[\\/]{2}localhost(?=[\\/])/iu, "")
      .split(/[?#]/u, 1)[0] ?? "";

  for (let pass = 0; pass < 5 && /%[0-9a-f]{2}/iu.test(rawPath); pass += 1) {
    try {
      const decoded = decodeURIComponent(rawPath);
      if (decoded === rawPath) break;
      rawPath = decoded;
    } catch {
      return "$ABSOLUTE/[REDACTED]";
    }
  }

  return /%[0-9a-f]{2}/iu.test(rawPath)
    ? "$ABSOLUTE/[REDACTED]"
    : absolutePathPreview(rawPath);
}

function isAbsolutePathLike(value: string): boolean {
  return (
    (value.startsWith("/") && value.length > 1) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    (value.startsWith("\\") && value.length > 1) ||
    homeExpandedPathPattern.test(value)
  );
}

function absolutePathPreview(value: string): string {
  const normalized = value.replace(/[\\/]+$/u, "");
  const basename = normalized.split(/[\\/]/u).filter(Boolean).at(-1);
  if (!basename) return "$ABSOLUTE";
  const cleanBasename = normalizePreviewText(basename);
  if (
    !cleanBasename ||
    sensitiveBasenamePattern.test(cleanBasename) ||
    hasUnsafePercentEncodedPath(cleanBasename)
  ) {
    return "$ABSOLUTE/[REDACTED]";
  }
  return truncatePreview(
    `$ABSOLUTE/${redactSensitiveValues(cleanBasename)}`,
    runnerCodexPreviewLimits.pathCharacters,
  );
}

function normalizePreviewText(
  value: unknown,
  controlReplacement = " ",
): string | null {
  if (typeof value !== "string") return null;
  const canonical = value
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/[\u2044\u2215\u29f8]/gu, "/")
    .replace(/[\u29f5]/gu, "\\");
  let result = "";
  let index = 0;
  while (index < canonical.length) {
    const code = canonical.charCodeAt(index);
    if (code === 0x1b) {
      result += controlReplacement;
      const marker = canonical.charCodeAt(index + 1);
      if (marker === 0x5b) {
        index = skipCsi(canonical, index + 2);
      } else if (
        marker === 0x5d ||
        marker === 0x50 ||
        marker === 0x5e ||
        marker === 0x5f
      ) {
        index = skipAnsiString(canonical, index + 2);
      } else {
        index += 1;
      }
      continue;
    }
    if (code === 0x9b) {
      result += controlReplacement;
      index = skipCsi(canonical, index + 1);
      continue;
    }
    if (code === 0x9d) {
      result += controlReplacement;
      index = skipAnsiString(canonical, index + 1);
      continue;
    }
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      result += controlReplacement;
      index += 1;
      continue;
    }
    result += canonical[index];
    index += 1;
  }
  const normalized = result.replace(/\s+/gu, " ").trim();
  return normalized || null;
}

function skipCsi(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    if (startsAbsolutePathEvidence(value, index)) return index;
    const code = value.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) break;
  }
  return index;
}

function skipAnsiString(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    if (startsAbsolutePathEvidence(value, index)) return index;
    const code = value.charCodeAt(index);
    if (code === 0x07) return index + 1;
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

const homeExpandedPathPattern =
  /^(?:~[A-Za-z0-9._-]*|\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\})[\\/]/iu;
const homeExpandedPathInTextPattern =
  /(^|[\s=(:,;|&<>@[{`?#"'])(?:~[A-Za-z0-9._-]*|\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\})(?:[\\/][^\s"'`|;&<>()[\]{},?#]*)+/giu;
const homeExpandedPathInTextEvidencePattern =
  /(^|[\s=(:,;|&<>@[{`?#"'])(?:~[A-Za-z0-9._-]*|\$(?:HOME|USERPROFILE)|\$\{(?:HOME|USERPROFILE)\})[\\/]/iu;

function startsAbsolutePathEvidence(value: string, index: number): boolean {
  const suffix = value.slice(index);
  return (
    /^\/[A-Za-z0-9_.$~{-]/u.test(suffix) ||
    /^\\(?:\\|[A-Za-z0-9_.$~{-])/u.test(suffix) ||
    /^[A-Za-z]:[\\/]/u.test(suffix) ||
    homeExpandedPathPattern.test(suffix)
  );
}

function truncatePreview(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const end = Math.max(0, maximum - 1);
  let candidate = value.slice(0, end);
  const redactionStart = candidate.lastIndexOf("[");
  if (
    redactionStart >= 0 &&
    "[REDACTED]".startsWith(candidate.slice(redactionStart)) &&
    candidate.slice(redactionStart) !== "[REDACTED]"
  ) {
    candidate = candidate.slice(0, redactionStart);
  }
  candidate = candidate.replace(trailingSensitiveAssignmentPattern, "");
  const lastCode = candidate.charCodeAt(candidate.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate}…`;
}

function parseItem(value: unknown): RunnerCodexItem | null {
  const parsed = runnerCodexItemSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function projectKnowledgeSearchFailureCode(
  item: Record<string, unknown>,
): "KNOWLEDGE_NO_AVAILABLE_BASES" | null {
  if (
    item.server !== coreMcpServerKey ||
    item.tool !== "search_knowledge_base" ||
    item.status === "inProgress"
  ) {
    return null;
  }

  const result = asRecord(item.result);
  const structuredFailure = parseKnowledgeSearchFailureCode(
    result.structuredContent,
  );
  if (structuredFailure) return structuredFailure;

  if (Array.isArray(result.content)) {
    for (const candidate of result.content.slice(
      0,
      maximumKnowledgeFailureContentBlocks,
    )) {
      const content = asRecord(candidate);
      if (content.type !== "text") continue;
      const contentFailure = parseKnowledgeSearchFailureText(content.text);
      if (contentFailure) return contentFailure;
    }
  }

  const error = asRecord(item.error);
  return parseKnowledgeSearchFailureText(error.message);
}

function parseKnowledgeSearchFailureText(
  value: unknown,
): "KNOWLEDGE_NO_AVAILABLE_BASES" | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumKnowledgeFailurePayloadCharacters
  ) {
    return null;
  }
  try {
    return parseKnowledgeSearchFailureCode(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function parseKnowledgeSearchFailureCode(
  value: unknown,
): "KNOWLEDGE_NO_AVAILABLE_BASES" | null {
  const failure = knowledgeSearchFailureSchema.safeParse(value);
  if (!failure.success) return null;
  const noAvailableBases = knowledgeNoAvailableBasesCodeSchema.safeParse(
    failure.data.code,
  );
  return noAvailableBases.success ? noAvailableBases.data : null;
}

function sanitizeCodexErrorInfo(value: unknown) {
  const parsed = runnerCodexErrorInfoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nativeId(value: unknown): string | null {
  return boundedString(value, 240);
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : null;
}

function enumValue(value: unknown, allowed: Set<string>): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonnegativeInteger(value) && value > 0;
}

function copyNullableFiniteNumber(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (value === null || (typeof value === "number" && Number.isFinite(value))) {
    target[key] = value;
  }
}

function copyNullableNonnegativeNumber(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  ) {
    target[key] = value;
  }
}

function normalizeThreadName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized) return null;
  let result = "";
  for (const symbol of normalized) {
    if (result.length + symbol.length > 1_000) break;
    result += symbol;
  }
  return result || null;
}
