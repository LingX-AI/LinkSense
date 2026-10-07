import type {
  AutomationRunStatus,
  AutomationStatus,
  ReasoningEffort,
} from "@linksense/shared";

export type AutomationRecord = {
  id: string;
  ownerId: string;
  conversationId: string;
  title: string;
  instruction: string;
  status: AutomationStatus;
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  frequency: "hourly" | "daily" | "weekly" | "monthly" | "yearly";
  intervalCount: number;
  minuteOfHour: number | null;
  timeOfDayMinutes: number | null;
  weekdays: number[];
  dayOfMonth: number | null;
  monthOfYear: number | null;
  timeZone: string;
  anchorAt: Date;
  nextRunAt: Date | null;
  expiresAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: AutomationRunStatus | null;
  lastErrorCode: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AutomationConversationRecord = {
  id: string;
  ownerId: string;
  title: string;
  archiveStatus: string;
  pinnedAt: Date | null;
};

export type AutomationWithConversationRecord = AutomationRecord & {
  conversation: AutomationConversationRecord | null;
};

export type AutomationRunRecord = {
  id: string;
  automationId: string;
  ownerId: string;
  conversationId: string;
  scheduledFor: Date;
  idempotencyKey: string;
  status: AutomationRunStatus;
  turnId: string | null;
  pendingRequestId: string | null;
  errorCode: string | null;
  completedAt: Date | null;
  completionReadAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAutomationRecord = Omit<
  AutomationRecord,
  | "id"
  | "lastRunAt"
  | "lastRunStatus"
  | "lastErrorCode"
  | "deletedAt"
  | "createdAt"
  | "updatedAt"
>;

export type UpdateAutomationRecord = Partial<
  Pick<
    AutomationRecord,
    | "conversationId"
    | "title"
    | "instruction"
    | "status"
    | "modelId"
    | "reasoningEffort"
    | "frequency"
    | "intervalCount"
    | "minuteOfHour"
    | "timeOfDayMinutes"
    | "weekdays"
    | "dayOfMonth"
    | "monthOfYear"
    | "timeZone"
    | "anchorAt"
    | "nextRunAt"
    | "expiresAt"
  >
>;

export type AutomationOccurrenceClaim = {
  automation: AutomationRecord;
  run: AutomationRunRecord;
  shouldDispatch: boolean;
};

export interface AutomationRepository {
  listByOwner(ownerId: string): Promise<AutomationWithConversationRecord[]>;
  findById(automationId: string): Promise<AutomationRecord | null>;
  findOwnedRecord(
    ownerId: string,
    automationId: string,
  ): Promise<AutomationRecord | null>;
  findOwned(
    ownerId: string,
    automationId: string,
  ): Promise<AutomationWithConversationRecord | null>;
  listPinnedConversations(
    ownerId: string,
  ): Promise<AutomationConversationRecord[]>;
  findPinnedConversation(
    ownerId: string,
    conversationId: string,
  ): Promise<AutomationConversationRecord | null>;
  createWithinOwnerLimit(
    input: CreateAutomationRecord,
    limit: number,
  ): Promise<AutomationWithConversationRecord | null>;
  updateOwned(
    ownerId: string,
    automationId: string,
    input: UpdateAutomationRecord,
  ): Promise<AutomationWithConversationRecord | null>;
  softDeleteOwned(
    ownerId: string,
    automationId: string,
    deletedAt: Date,
  ): Promise<AutomationRecord | null>;
  listDue(now: Date, limit: number): Promise<AutomationRecord[]>;
  latestUnreadCompletion(ownerId: string): Promise<{
    conversationId: string;
    completedAt: Date;
  } | null>;
  claimOccurrence(input: {
    automationId: string;
    scheduledFor: Date;
    nextRunAt: Date | null;
    claimedAt: Date;
    idempotencyKey: string;
  }): Promise<AutomationOccurrenceClaim | null>;
  claimManualRun(input: {
    ownerId: string;
    automationId: string;
    requestedAt: Date;
    idempotencyKey: string;
  }): Promise<AutomationOccurrenceClaim | null>;
  markRunStarted(input: {
    runId: string;
    automationId: string;
    turnId: string;
    triggeredAt: Date;
  }): Promise<void>;
  markRunQueued(input: {
    runId: string;
    automationId: string;
    pendingRequestId: string;
    triggeredAt: Date;
  }): Promise<void>;
  markRunFailed(input: {
    runId: string;
    automationId: string;
    errorCode: string;
    triggeredAt: Date;
    pause: boolean;
  }): Promise<void>;
}

export class AutomationTargetNotPinnedError extends Error {
  constructor() {
    super("automation target is not an active pinned task");
    this.name = "AutomationTargetNotPinnedError";
  }
}

export class AutomationTargetCollaborationModeError extends Error {
  constructor() {
    super("automation target must use the default collaboration mode");
    this.name = "AutomationTargetCollaborationModeError";
  }
}
