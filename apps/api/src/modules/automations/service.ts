import { createHash } from "node:crypto";

import {
  automationCreateInputSchema,
  automationUpdateInputSchema,
  errorCodeSchema,
  type Automation,
  type AutomationCompletionNotification,
  type AutomationCompletionNotificationReadInput,
  type AutomationCreateInput,
  type AutomationRunNowResult,
  type AutomationSchedule,
  type AutomationUpdateInput,
  type Locale,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import type { ConversationService } from "../conversations/service.js";
import {
  automationExpirationAt,
  automationExpirationOn,
  isAutomationExpired,
  minutesToTimeOfDay,
  nextAutomationRunBeforeExpiration,
  normalizeAutomationSchedule,
  timeOfDayToMinutes,
} from "./schedule.js";
import {
  AutomationTargetCollaborationModeError,
  AutomationTargetNotPinnedError,
  type AutomationOccurrenceClaim,
  type AutomationRecord,
  type AutomationRepository,
  type AutomationRunRecord,
  type AutomationWithConversationRecord,
  type CreateAutomationRecord,
  type UpdateAutomationRecord,
} from "./types.js";

const AUTOMATION_LIMIT_PER_OWNER = 100;
const AUTOMATION_DUE_BATCH_SIZE = 200;

type AutomationConversationGateway = Pick<
  ConversationService,
  "createPinnedConversation" | "delete" | "submitScheduledTurn"
>;

export class AutomationService {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly conversations: AutomationConversationGateway,
    private readonly audit: AuditService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(ownerId: string): Promise<{ items: Automation[] }> {
    return {
      items: (await this.repository.listByOwner(ownerId)).map(
        projectAutomation,
      ),
    };
  }

  async get(ownerId: string, automationId: string): Promise<Automation> {
    const automation = await this.repository.findOwned(ownerId, automationId);
    if (!automation) throw new AppError("AUTOMATION_NOT_FOUND");
    return projectAutomation(automation);
  }

  async listPinnedConversations(ownerId: string) {
    return {
      items: (await this.repository.listPinnedConversations(ownerId)).map(
        (conversation) => {
          if (!conversation.pinnedAt) {
            throw new AppError("AUTOMATION_TASK_NOT_PINNED");
          }
          return {
            id: conversation.id,
            title: conversation.title,
            pinned_at: conversation.pinnedAt.toISOString(),
          };
        },
      ),
    };
  }

  async completionNotifications(
    ownerId: string,
  ): Promise<AutomationCompletionNotification> {
    const latestUnread =
      await this.repository.latestUnreadCompletion(ownerId);
    return {
      latest_unread: latestUnread
        ? {
            conversation_id: latestUnread.conversationId,
            completed_at: latestUnread.completedAt.toISOString(),
          }
        : null,
    };
  }

  async markCompletionNotificationsRead(
    ownerId: string,
    input: AutomationCompletionNotificationReadInput,
  ): Promise<AutomationCompletionNotification> {
    await this.repository.markCompletionNotificationsRead(
      ownerId,
      new Date(input.through),
      this.now(),
    );
    return this.completionNotifications(ownerId);
  }

  async create(
    ownerId: string,
    rawInput: AutomationCreateInput,
    context: AuditContext,
    fallbackLocale?: Locale,
  ): Promise<Automation> {
    const input = automationCreateInputSchema.parse(rawInput);
    const schedule = parseSchedule(input.schedule);
    const anchorAt = this.now();
    const expiresAt = input.expires_on
      ? parseExpiration(input.expires_on, schedule.time_zone)
      : null;
    const nextRunAt = nextAutomationRunBeforeExpiration(
      schedule,
      anchorAt,
      anchorAt,
      expiresAt,
    );
    let createdConversationId: string | null = null;

    try {
      const conversationId =
        input.target.mode === "existing_task"
          ? input.target.conversation_id
          : await this.createTargetConversation(
              ownerId,
              input.title,
              fallbackLocale,
            );
      if (input.target.mode === "new_task") {
        createdConversationId = conversationId;
      }
      const created = await this.repository.createWithinOwnerLimit(
        {
          ownerId,
          conversationId,
          title: input.title,
          instruction: input.instruction,
          status: "active",
          ...scheduleToRecord(schedule),
          anchorAt,
          nextRunAt,
          expiresAt,
          modelId: input.model_preference?.model_id ?? null,
          reasoningEffort: input.model_preference?.reasoning_effort ?? null,
        },
        AUTOMATION_LIMIT_PER_OWNER,
      );
      if (!created) throw new AppError("AUTOMATION_LIMIT_REACHED");
      await this.writeAudit(context, {
        actorId: ownerId,
        action: "automation_created",
        targetId: created.id,
        conversationId: created.conversationId,
        frequency: created.frequency,
        status: created.status,
      });
      return projectAutomation(created);
    } catch (error) {
      if (createdConversationId) {
        await this.conversations
          .delete(ownerId, createdConversationId, context)
          .catch(() => undefined);
      }
      throw mapAutomationError(error);
    }
  }

  async update(
    ownerId: string,
    automationId: string,
    rawInput: AutomationUpdateInput,
    context: AuditContext,
    fallbackLocale?: Locale,
  ): Promise<Automation> {
    const input = automationUpdateInputSchema.parse(rawInput);
    const existing = await this.repository.findOwnedRecord(
      ownerId,
      automationId,
    );
    if (!existing) throw new AppError("AUTOMATION_NOT_FOUND");

    let createdConversationId: string | null = null;
    try {
      const update: UpdateAutomationRecord = {};
      if (input.title !== undefined) update.title = input.title;
      if (input.instruction !== undefined)
        update.instruction = input.instruction;
      if (input.target?.mode === "existing_task") {
        update.conversationId = input.target.conversation_id;
      } else if (input.target?.mode === "new_task") {
        createdConversationId = await this.createTargetConversation(
          ownerId,
          input.title ?? existing.title,
          fallbackLocale,
        );
        update.conversationId = createdConversationId;
      }
      if (input.model_preference !== undefined) {
        update.modelId = input.model_preference?.model_id ?? null;
        update.reasoningEffort =
          input.model_preference?.reasoning_effort ?? null;
      }

      const now = this.now();
      const schedule = input.schedule
        ? parseSchedule(input.schedule)
        : scheduleFromRecord(existing);
      if (input.schedule) {
        Object.assign(update, scheduleToRecord(schedule), { anchorAt: now });
      }
      if (input.status !== undefined) update.status = input.status;

      let expiresAt = existing.expiresAt;
      if (input.expires_on !== undefined) {
        expiresAt = input.expires_on
          ? parseExpiration(input.expires_on, schedule.time_zone)
          : null;
        update.expiresAt = expiresAt;
      } else if (input.schedule && existing.expiresAt) {
        expiresAt = parseExpiration(
          automationExpirationOn(existing.expiresAt, existing.timeZone),
          schedule.time_zone,
        );
        update.expiresAt = expiresAt;
      }

      const nextStatus = input.status ?? existing.status;
      if (nextStatus === "paused") {
        update.nextRunAt = null;
      } else if (
        input.schedule ||
        input.expires_on !== undefined ||
        existing.status === "paused"
      ) {
        update.nextRunAt = nextAutomationRunBeforeExpiration(
          schedule,
          input.schedule ? now : existing.anchorAt,
          now,
          expiresAt,
        );
      }

      const updated = await this.repository.updateOwned(
        ownerId,
        automationId,
        update,
      );
      if (!updated) throw new AppError("AUTOMATION_NOT_FOUND");
      await this.writeAudit(context, {
        actorId: ownerId,
        action: "automation_updated",
        targetId: updated.id,
        conversationId: updated.conversationId,
        frequency: updated.frequency,
        status: updated.status,
      });
      return projectAutomation(updated);
    } catch (error) {
      if (createdConversationId) {
        await this.conversations
          .delete(ownerId, createdConversationId, context)
          .catch(() => undefined);
      }
      throw mapAutomationError(error);
    }
  }

  async delete(
    ownerId: string,
    automationId: string,
    context: AuditContext,
  ): Promise<void> {
    const deleted = await this.repository.softDeleteOwned(
      ownerId,
      automationId,
      this.now(),
    );
    if (!deleted) throw new AppError("AUTOMATION_NOT_FOUND");
    await this.writeAudit(context, {
      actorId: ownerId,
      action: "automation_deleted",
      targetId: deleted.id,
      conversationId: deleted.conversationId,
      frequency: deleted.frequency,
      status: deleted.status,
    });
  }

  listDue(now = this.now(), limit = AUTOMATION_DUE_BATCH_SIZE) {
    return this.repository.listDue(now, limit);
  }

  async runNow(
    ownerId: string,
    automationId: string,
    requestId: string,
    context: AuditContext,
  ): Promise<AutomationRunNowResult> {
    const automation = await this.repository.findOwned(ownerId, automationId);
    if (!automation) throw new AppError("AUTOMATION_NOT_FOUND");
    const requestedAt = this.now();
    if (isAutomationExpired(automation.expiresAt, requestedAt)) {
      throw new AppError("AUTOMATION_EXPIRED");
    }
    const claim = await this.repository.claimManualRun({
      ownerId,
      automationId,
      requestedAt,
      idempotencyKey: automationManualRunIdempotencyKey(
        automationId,
        requestId,
      ),
    });
    if (!claim) {
      const current = await this.repository.findOwned(ownerId, automationId);
      if (current && isAutomationExpired(current.expiresAt, this.now())) {
        throw new AppError("AUTOMATION_EXPIRED");
      }
      throw new AppError("AUTOMATION_NOT_FOUND");
    }
    if (!claim.shouldDispatch) return completedManualRunResult(claim.run);
    const result = await this.dispatchClaim(claim, context, true);
    if (!result) throw new AppError("INTERNAL_ERROR");
    return result;
  }

  async dispatchOccurrence(
    automationId: string,
    scheduledFor: Date,
  ): Promise<void> {
    const initial = await this.repository.findById(automationId);
    if (!initial || initial.deletedAt || initial.status !== "active") return;
    const now = this.now();
    if (isAutomationExpired(initial.expiresAt, now)) return;
    const nextRunAt = nextAutomationRunBeforeExpiration(
      scheduleFromRecord(initial),
      initial.anchorAt,
      new Date(Math.max(now.getTime(), scheduledFor.getTime())),
      initial.expiresAt,
    );
    const claim = await this.repository.claimOccurrence({
      automationId,
      scheduledFor,
      nextRunAt,
      claimedAt: now,
      idempotencyKey: automationRunIdempotencyKey(automationId, scheduledFor),
    });
    if (!claim?.shouldDispatch) return;

    await this.dispatchClaim(claim, {}, false);
  }

  private async dispatchClaim(
    claim: AutomationOccurrenceClaim,
    context: AuditContext,
    reportDispatchFailure: boolean,
  ): Promise<AutomationRunNowResult | null> {
    let result:
      | { status: "started"; turnId: string }
      | { status: "queued"; pendingRequestId: string };
    try {
      if (isAutomationExpired(claim.automation.expiresAt, this.now())) {
        throw new AppError("AUTOMATION_EXPIRED");
      }
      const conversation = await this.repository.findPinnedConversation(
        claim.automation.ownerId,
        claim.run.conversationId,
      );
      if (!conversation) throw new AppError("AUTOMATION_TASK_NOT_PINNED");
      result = await this.conversations.submitScheduledTurn(
        claim.automation.ownerId,
        claim.run.conversationId,
        claim.automation.instruction,
        claim.run.idempotencyKey,
        claim.automation.modelId && claim.automation.reasoningEffort
          ? {
              modelId: claim.automation.modelId,
              reasoningEffort: claim.automation.reasoningEffort,
            }
          : undefined,
      );
    } catch (error) {
      const mapped = mapAutomationError(error);
      const errorCode =
        mapped instanceof AppError ? mapped.code : "INTERNAL_ERROR";
      await this.repository.markRunFailed({
        runId: claim.run.id,
        automationId: claim.automation.id,
        errorCode,
        triggeredAt: this.now(),
        pause: shouldPauseAfterFailure(errorCode),
      });
      await this.writeAudit(context, {
        actorId: claim.automation.ownerId,
        action: "automation_dispatch_failed",
        targetId: claim.automation.id,
        conversationId: claim.run.conversationId,
        frequency: claim.automation.frequency,
        status: "failed",
        errorCode,
      });
      if (reportDispatchFailure) throw mapped;
      return null;
    }

    const triggeredAt = this.now();
    if (result.status === "started") {
      await this.repository.markRunStarted({
        runId: claim.run.id,
        automationId: claim.automation.id,
        turnId: result.turnId,
        triggeredAt,
      });
    } else {
      await this.repository.markRunQueued({
        runId: claim.run.id,
        automationId: claim.automation.id,
        pendingRequestId: result.pendingRequestId,
        triggeredAt,
      });
    }
    await this.writeAudit(context, {
      actorId: claim.automation.ownerId,
      action: "automation_dispatched",
      targetId: claim.automation.id,
      conversationId: claim.run.conversationId,
      frequency: claim.automation.frequency,
      status: result.status,
    });
    return result.status === "started"
      ? { status: "started", turn_id: result.turnId }
      : { status: "queued", pending_request_id: result.pendingRequestId };
  }

  private async createTargetConversation(
    ownerId: string,
    title: string,
    fallbackLocale?: Locale,
  ): Promise<string> {
    const conversation = await this.conversations.createPinnedConversation(
      ownerId,
      title,
      fallbackLocale,
    );
    return conversation.id;
  }

  private writeAudit(
    context: AuditContext,
    input: {
      actorId: string;
      action: string;
      targetId: string;
      conversationId: string;
      frequency: string;
      status: string;
      errorCode?: string;
    },
  ): Promise<void> {
    return this.audit.write({
      ...context,
      actorId: input.actorId,
      action: input.action,
      targetType: "automation",
      targetId: input.targetId,
      result: input.action.endsWith("failed") ? "failed" : "success",
      metadata: {
        conversation_id: input.conversationId,
        frequency: input.frequency,
        status: input.status,
        ...(input.errorCode ? { error_code: input.errorCode } : {}),
      },
    });
  }
}

function parseSchedule(schedule: AutomationSchedule): AutomationSchedule {
  try {
    return normalizeAutomationSchedule(schedule);
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}

function scheduleToRecord(
  schedule: AutomationSchedule,
): Pick<
  CreateAutomationRecord,
  | "frequency"
  | "intervalCount"
  | "minuteOfHour"
  | "timeOfDayMinutes"
  | "weekdays"
  | "dayOfMonth"
  | "monthOfYear"
  | "timeZone"
> {
  return {
    frequency: schedule.frequency,
    intervalCount: schedule.interval,
    minuteOfHour: schedule.frequency === "hourly" ? schedule.minute : null,
    timeOfDayMinutes:
      schedule.frequency === "hourly"
        ? null
        : timeOfDayToMinutes(schedule.time),
    weekdays: schedule.frequency === "weekly" ? schedule.weekdays : [],
    dayOfMonth:
      schedule.frequency === "monthly" || schedule.frequency === "yearly"
        ? schedule.day_of_month
        : null,
    monthOfYear:
      schedule.frequency === "yearly" ? schedule.month_of_year : null,
    timeZone: schedule.time_zone,
  };
}

function scheduleFromRecord(record: AutomationRecord): AutomationSchedule {
  const base = {
    interval: record.intervalCount,
    time_zone: record.timeZone,
  };
  switch (record.frequency) {
    case "hourly":
      return parseSchedule({
        frequency: "hourly",
        ...base,
        minute: requiredNumber(record.minuteOfHour),
      });
    case "daily":
      return parseSchedule({
        frequency: "daily",
        ...base,
        time: minutesToTimeOfDay(requiredNumber(record.timeOfDayMinutes)),
      });
    case "weekly":
      return parseSchedule({
        frequency: "weekly",
        ...base,
        weekdays: record.weekdays,
        time: minutesToTimeOfDay(requiredNumber(record.timeOfDayMinutes)),
      });
    case "monthly":
      return parseSchedule({
        frequency: "monthly",
        ...base,
        day_of_month: requiredNumber(record.dayOfMonth),
        time: minutesToTimeOfDay(requiredNumber(record.timeOfDayMinutes)),
      });
    case "yearly":
      return parseSchedule({
        frequency: "yearly",
        ...base,
        month_of_year: requiredNumber(record.monthOfYear),
        day_of_month: requiredNumber(record.dayOfMonth),
        time: minutesToTimeOfDay(requiredNumber(record.timeOfDayMinutes)),
      });
  }
}

function projectAutomation(
  record: AutomationWithConversationRecord,
): Automation {
  if (!record.conversation?.pinnedAt) {
    throw new AppError("AUTOMATION_TASK_NOT_PINNED");
  }
  return {
    id: record.id,
    title: record.title,
    instruction: record.instruction,
    status: record.status,
    conversation: {
      id: record.conversation.id,
      title: record.conversation.title,
      pinned_at: record.conversation.pinnedAt.toISOString(),
    },
    schedule: scheduleFromRecord(record),
    next_run_at: record.nextRunAt?.toISOString() ?? null,
    expires_on: record.expiresAt
      ? automationExpirationOn(record.expiresAt, record.timeZone)
      : null,
    last_run_at: record.lastRunAt?.toISOString() ?? null,
    last_run_status: record.lastRunStatus,
    last_error_code: record.lastErrorCode,
    model_preference:
      record.modelId && record.reasoningEffort
        ? {
            model_id: record.modelId,
            reasoning_effort: record.reasoningEffort,
          }
        : null,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

function parseExpiration(expiresOn: string, timeZone: string): Date {
  try {
    return automationExpirationAt(expiresOn, timeZone);
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}

function requiredNumber(value: number | null): number {
  if (value === null) throw new AppError("INTERNAL_ERROR");
  return value;
}

function automationRunIdempotencyKey(
  automationId: string,
  scheduledFor: Date,
): string {
  return `automation:${createHash("sha256")
    .update(`${automationId}:${scheduledFor.toISOString()}`)
    .digest("hex")}`;
}

function automationManualRunIdempotencyKey(
  automationId: string,
  requestId: string,
): string {
  return `automation:manual:${createHash("sha256")
    .update(`${automationId}:${requestId}`)
    .digest("hex")}`;
}

function completedManualRunResult(
  run: AutomationRunRecord,
): AutomationRunNowResult {
  if (run.status === "started" && run.turnId) {
    return { status: "started", turn_id: run.turnId };
  }
  if (run.status === "queued" && run.pendingRequestId) {
    return { status: "queued", pending_request_id: run.pendingRequestId };
  }
  if (run.status === "failed") {
    const errorCode = errorCodeSchema.safeParse(run.errorCode);
    throw new AppError(errorCode.success ? errorCode.data : "INTERNAL_ERROR");
  }
  throw new AppError("INTERNAL_ERROR");
}

function mapAutomationError(error: unknown): unknown {
  if (error instanceof AutomationTargetCollaborationModeError) {
    return new AppError("COLLABORATION_MODE_UNAVAILABLE");
  }
  if (error instanceof AutomationTargetNotPinnedError) {
    return new AppError("AUTOMATION_TASK_NOT_PINNED");
  }
  return error;
}

function shouldPauseAfterFailure(errorCode: string): boolean {
  return [
    "AUTOMATION_TASK_NOT_PINNED",
    "CONVERSATION_NOT_FOUND",
    "USER_DISABLED",
  ].includes(errorCode);
}
