import { z } from "zod";

import { reasoningEffortSchema } from "@linksense/shared";

import type {
  Automation as PrismaAutomation,
  AutomationRun as PrismaAutomationRun,
  PrismaClient,
} from "../../generated/prisma/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import {
  AutomationTargetCollaborationModeError,
  AutomationTargetNotPinnedError,
  type AutomationConversationRecord,
  type AutomationOccurrenceClaim,
  type AutomationRecord,
  type AutomationRepository,
  type AutomationRunRecord,
  type AutomationWithConversationRecord,
  type CreateAutomationRecord,
  type UpdateAutomationRecord,
} from "./types.js";

const automationStatusSchema = z.enum(["active", "paused"]);
const automationFrequencySchema = z.enum([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);
const automationRunStatusSchema = z.enum([
  "dispatching",
  "queued",
  "started",
  "failed",
]);
const lockedAutomationConversationSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  archiveStatus: z.string(),
  pinnedAt: z.date().nullable(),
  collaborationMode: z.string(),
});
const MANUAL_RUN_TIMESTAMP_ATTEMPTS = 1_000;

export class PrismaAutomationRepository implements AutomationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByOwner(
    ownerId: string,
  ): Promise<AutomationWithConversationRecord[]> {
    const rows = await this.prisma.automation.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return this.attachConversations(rows);
  }

  async findOwned(
    ownerId: string,
    automationId: string,
  ): Promise<AutomationWithConversationRecord | null> {
    const row = await this.prisma.automation.findFirst({
      where: { id: automationId, ownerId, deletedAt: null },
    });
    if (!row) return null;
    return (await this.attachConversations([row]))[0] ?? null;
  }

  async findById(automationId: string): Promise<AutomationRecord | null> {
    const row = await this.prisma.automation.findUnique({
      where: { id: automationId },
    });
    return row ? parseAutomationRecord(row) : null;
  }

  async findOwnedRecord(
    ownerId: string,
    automationId: string,
  ): Promise<AutomationRecord | null> {
    const row = await this.prisma.automation.findFirst({
      where: { id: automationId, ownerId, deletedAt: null },
    });
    return row ? parseAutomationRecord(row) : null;
  }

  async listPinnedConversations(
    ownerId: string,
  ): Promise<AutomationConversationRecord[]> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        ownerId,
        archiveStatus: "active",
        pinnedAt: { not: null },
        collaborationMode: "default",
      },
      select: {
        id: true,
        ownerId: true,
        title: true,
        archiveStatus: true,
        pinnedAt: true,
      },
      orderBy: [{ pinnedAt: "desc" }, { id: "asc" }],
    });
    return rows;
  }

  async findPinnedConversation(
    ownerId: string,
    conversationId: string,
  ): Promise<AutomationConversationRecord | null> {
    return this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ownerId,
        archiveStatus: "active",
        pinnedAt: { not: null },
        collaborationMode: "default",
      },
      select: {
        id: true,
        ownerId: true,
        title: true,
        archiveStatus: true,
        pinnedAt: true,
      },
    });
  }

  createWithinOwnerLimit(
    input: CreateAutomationRecord,
    limit: number,
  ): Promise<AutomationWithConversationRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockOwner(transaction, input.ownerId);
      const conversation = await lockPinnedConversation(
        transaction,
        input.ownerId,
        input.conversationId,
      );
      const count = await transaction.automation.count({
        where: { ownerId: input.ownerId, deletedAt: null },
      });
      if (count >= limit) return null;
      const created = await transaction.automation.create({ data: input });
      return {
        ...parseAutomationRecord(created),
        conversation,
      };
    });
  }

  updateOwned(
    ownerId: string,
    automationId: string,
    input: UpdateAutomationRecord,
  ): Promise<AutomationWithConversationRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, automationId);
      const current = await transaction.automation.findFirst({
        where: { id: automationId, ownerId, deletedAt: null },
      });
      if (!current) return null;
      const conversation = await lockPinnedConversation(
        transaction,
        ownerId,
        input.conversationId ?? current.conversationId,
      );
      const updated = await transaction.automation.update({
        where: { id: automationId },
        data: input,
      });
      return { ...parseAutomationRecord(updated), conversation };
    });
  }

  softDeleteOwned(
    ownerId: string,
    automationId: string,
    deletedAt: Date,
  ): Promise<AutomationRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, automationId);
      const current = await transaction.automation.findFirst({
        where: { id: automationId, ownerId, deletedAt: null },
      });
      if (!current) return null;
      return parseAutomationRecord(
        await transaction.automation.update({
          where: { id: automationId },
          data: { status: "paused", nextRunAt: null, deletedAt },
        }),
      );
    });
  }

  async listDue(now: Date, limit: number): Promise<AutomationRecord[]> {
    const rows = await this.prisma.automation.findMany({
      where: {
        status: "active",
        deletedAt: null,
        nextRunAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(parseAutomationRecord);
  }

  async latestUnreadCompletion(ownerId: string): Promise<{
    conversationId: string;
    completedAt: Date;
  } | null> {
    const unreadConversations = await this.prisma.conversation.findMany({
      where: { ownerId, completionUnread: true },
      select: { id: true },
    });
    if (unreadConversations.length === 0) return null;

    const latest = await this.prisma.automationRun.findFirst({
      where: {
        ownerId,
        conversationId: {
          in: unreadConversations.map((conversation) => conversation.id),
        },
        completedAt: { not: null },
        completionReadAt: null,
      },
      select: { conversationId: true, completedAt: true },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    });
    if (!latest?.completedAt) return null;
    return {
      conversationId: latest.conversationId,
      completedAt: latest.completedAt,
    };
  }

  async markCompletionNotificationsRead(
    ownerId: string,
    through: Date,
    readAt: Date,
  ): Promise<void> {
    await this.prisma.automationRun.updateMany({
      where: {
        ownerId,
        completedAt: { not: null, lte: through },
        completionReadAt: null,
      },
      data: { completionReadAt: readAt },
    });
  }

  claimOccurrence(input: {
    automationId: string;
    scheduledFor: Date;
    nextRunAt: Date | null;
    claimedAt: Date;
    idempotencyKey: string;
  }): Promise<AutomationOccurrenceClaim | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, input.automationId);
      const automationRow = await transaction.automation.findUnique({
        where: { id: input.automationId },
      });
      if (!automationRow) return null;
      const automation = parseAutomationRecord(automationRow);
      const existingRun = await transaction.automationRun.findUnique({
        where: {
          automationId_scheduledFor: {
            automationId: input.automationId,
            scheduledFor: input.scheduledFor,
          },
        },
      });
      if (existingRun) {
        const run = parseAutomationRunRecord(existingRun);
        if (
          automation.deletedAt ||
          automation.status !== "active" ||
          (automation.expiresAt !== null &&
            automation.expiresAt.getTime() <= input.claimedAt.getTime()) ||
          automation.conversationId !== run.conversationId
        ) {
          if (run.status === "dispatching") {
            const failed = await transaction.automationRun.update({
              where: { id: run.id },
              data: {
                status: "failed",
                errorCode:
                  automation.expiresAt !== null &&
                  automation.expiresAt.getTime() <= input.claimedAt.getTime()
                    ? "AUTOMATION_EXPIRED"
                    : "AUTOMATION_NOT_ACTIVE",
              },
            });
            return {
              automation,
              run: parseAutomationRunRecord(failed),
              shouldDispatch: false,
            };
          }
          return { automation, run, shouldDispatch: false };
        }
        return {
          automation,
          run,
          shouldDispatch: run.status === "dispatching",
        };
      }
      if (
        automation.deletedAt ||
        automation.status !== "active" ||
        (automation.expiresAt !== null &&
          automation.expiresAt.getTime() <= input.claimedAt.getTime()) ||
        automation.nextRunAt?.getTime() !== input.scheduledFor.getTime()
      ) {
        return null;
      }
      const updatedAutomation = await transaction.automation.update({
        where: { id: automation.id },
        data: { nextRunAt: input.nextRunAt },
      });
      const run = await transaction.automationRun.create({
        data: {
          automationId: automation.id,
          ownerId: automation.ownerId,
          conversationId: automation.conversationId,
          scheduledFor: input.scheduledFor,
          idempotencyKey: input.idempotencyKey,
          status: "dispatching",
        },
      });
      return {
        automation: parseAutomationRecord(updatedAutomation),
        run: parseAutomationRunRecord(run),
        shouldDispatch: true,
      };
    });
  }

  claimManualRun(input: {
    ownerId: string;
    automationId: string;
    requestedAt: Date;
    idempotencyKey: string;
  }): Promise<AutomationOccurrenceClaim | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, input.automationId);
      const automationRow = await transaction.automation.findFirst({
        where: {
          id: input.automationId,
          ownerId: input.ownerId,
          deletedAt: null,
        },
      });
      if (!automationRow) return null;
      const automation = parseAutomationRecord(automationRow);
      if (
        automation.expiresAt !== null &&
        automation.expiresAt.getTime() <= input.requestedAt.getTime()
      ) {
        return null;
      }
      const existingRun = await transaction.automationRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existingRun) {
        const run = parseAutomationRunRecord(existingRun);
        if (
          run.automationId !== automation.id ||
          run.ownerId !== automation.ownerId ||
          automation.conversationId !== run.conversationId
        ) {
          return null;
        }
        return {
          automation,
          run,
          shouldDispatch: run.status === "dispatching",
        };
      }

      const scheduledFor = await findAvailableManualRunTimestamp(
        transaction,
        automation.id,
        input.requestedAt,
      );
      const run = await transaction.automationRun.create({
        data: {
          automationId: automation.id,
          ownerId: automation.ownerId,
          conversationId: automation.conversationId,
          scheduledFor,
          idempotencyKey: input.idempotencyKey,
          status: "dispatching",
        },
      });
      return {
        automation,
        run: parseAutomationRunRecord(run),
        shouldDispatch: true,
      };
    });
  }

  markRunStarted(input: {
    runId: string;
    automationId: string;
    turnId: string;
    triggeredAt: Date;
  }): Promise<void> {
    return this.finishRun({
      ...input,
      status: "started",
      turnId: input.turnId,
      pendingRequestId: null,
      errorCode: null,
      pause: false,
    });
  }

  markRunQueued(input: {
    runId: string;
    automationId: string;
    pendingRequestId: string;
    triggeredAt: Date;
  }): Promise<void> {
    return this.finishRun({
      ...input,
      status: "queued",
      turnId: null,
      pendingRequestId: input.pendingRequestId,
      errorCode: null,
      pause: false,
    });
  }

  markRunFailed(input: {
    runId: string;
    automationId: string;
    errorCode: string;
    triggeredAt: Date;
    pause: boolean;
  }): Promise<void> {
    return this.finishRun({
      ...input,
      status: "failed",
      turnId: null,
      pendingRequestId: null,
    });
  }

  private async attachConversations(
    rows: PrismaAutomation[],
  ): Promise<AutomationWithConversationRecord[]> {
    const conversationIds = [...new Set(rows.map((row) => row.conversationId))];
    const conversations =
      conversationIds.length === 0
        ? []
        : await this.prisma.conversation.findMany({
            where: { id: { in: conversationIds } },
            select: {
              id: true,
              ownerId: true,
              title: true,
              archiveStatus: true,
              pinnedAt: true,
            },
          });
    const conversationById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );
    return rows.map((row) => ({
      ...parseAutomationRecord(row),
      conversation: conversationById.get(row.conversationId) ?? null,
    }));
  }

  private finishRun(input: {
    runId: string;
    automationId: string;
    status: "queued" | "started" | "failed";
    turnId: string | null;
    pendingRequestId: string | null;
    errorCode: string | null;
    triggeredAt: Date;
    pause: boolean;
  }): Promise<void> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.automationRun.updateMany({
        where: {
          id: input.runId,
          automationId: input.automationId,
          status: "dispatching",
        },
        data: {
          status: input.status,
          turnId: input.turnId,
          pendingRequestId: input.pendingRequestId,
          errorCode: input.errorCode,
        },
      });
      if (updated.count !== 1) return;
      await transaction.automation.updateMany({
        where: { id: input.automationId },
        data: {
          lastRunAt: input.triggeredAt,
          lastRunStatus: input.status,
          lastErrorCode: input.errorCode,
          ...(input.pause ? { status: "paused", nextRunAt: null } : {}),
        },
      });
    });
  }
}

function parseAutomationRecord(row: PrismaAutomation): AutomationRecord {
  return {
    ...row,
    status: automationStatusSchema.parse(row.status),
    frequency: automationFrequencySchema.parse(row.frequency),
    lastRunStatus:
      row.lastRunStatus === null
        ? null
        : automationRunStatusSchema.parse(row.lastRunStatus),
    reasoningEffort:
      row.reasoningEffort === null
        ? null
        : reasoningEffortSchema.parse(row.reasoningEffort),
  };
}

function parseAutomationRunRecord(
  row: PrismaAutomationRun,
): AutomationRunRecord {
  return {
    ...row,
    status: automationRunStatusSchema.parse(row.status),
  };
}

async function lockOwner(
  transaction: Prisma.TransactionClient,
  ownerId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`linksense:automation-owner:${ownerId}`}, 0)
    )
  `;
}

async function lockAutomation(
  transaction: Prisma.TransactionClient,
  automationId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`linksense:automation:${automationId}`}, 0)
    )
  `;
}

async function lockPinnedConversation(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  conversationId: string,
): Promise<AutomationConversationRecord> {
  const [row] = await transaction.$queryRaw<Array<unknown>>`
    SELECT
      id,
      owner_id AS "ownerId",
      title,
      archive_status AS "archiveStatus",
      pinned_at AS "pinnedAt",
      collaboration_mode AS "collaborationMode"
    FROM conversations
    WHERE id = ${conversationId}::uuid
      AND owner_id = ${ownerId}::uuid
    FOR UPDATE
  `;
  if (!row) throw new AutomationTargetNotPinnedError();
  const conversation = lockedAutomationConversationSchema.parse(row);
  if (
    conversation.ownerId !== ownerId ||
    conversation.archiveStatus !== "active" ||
    !conversation.pinnedAt
  ) {
    throw new AutomationTargetNotPinnedError();
  }
  if (conversation.collaborationMode !== "default") {
    throw new AutomationTargetCollaborationModeError();
  }
  return {
    id: conversation.id,
    ownerId: conversation.ownerId,
    title: conversation.title,
    archiveStatus: conversation.archiveStatus,
    pinnedAt: conversation.pinnedAt,
  };
}

async function findAvailableManualRunTimestamp(
  transaction: Prisma.TransactionClient,
  automationId: string,
  requestedAt: Date,
): Promise<Date> {
  for (let offset = 0; offset < MANUAL_RUN_TIMESTAMP_ATTEMPTS; offset += 1) {
    const candidate = new Date(requestedAt.getTime() + offset);
    const existing = await transaction.automationRun.findUnique({
      where: {
        automationId_scheduledFor: {
          automationId,
          scheduledFor: candidate,
        },
      },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error("Unable to reserve a manual automation run timestamp");
}
