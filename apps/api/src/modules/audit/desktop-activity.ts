import {
  desktopActivityActionSchema,
  desktopActivityComputerActionSchema,
  desktopActivityComputerRequestSchema,
  desktopActivityDeliverySchema,
  desktopActivityItemSchema,
  desktopActivityLimit,
  desktopActivityListSchema,
  desktopApprovalDecisionSchema,
  type DesktopActivityAction,
  type DesktopActivityItem,
  type DesktopActivityList,
} from "@linksense/shared";
import type { z } from "zod";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

type MetadataMatch = Readonly<{
  path: readonly string[];
  equals: string;
}>;

type DesktopActivityRule = Readonly<{
  targetType: string;
  /**
   * At least one exact metadata match proves the desktop leg. Only this
   * account view's two tool exceptions need it: a computer.execute attempt
   * rather than another desktop tool call, and a continuation persisted with
   * a local target.
   */
  metadata?: readonly MetadataMatch[];
}>;

/**
 * The single source for the closed action/target pairs this account view may
 * read. The same rules drive both the query clauses and the row projection, so
 * a mismatched target or metadata value fails closed instead of being exposed.
 */
const desktopActivityRules: Readonly<
  Record<DesktopActivityAction, DesktopActivityRule>
> = {
  desktop_device_paired: { targetType: "desktop_device" },
  desktop_device_registered: { targetType: "desktop_device" },
  desktop_device_renamed: { targetType: "desktop_device" },
  desktop_device_revoked: { targetType: "desktop_device" },
  desktop_approval_responded: { targetType: "conversation_desktop_approval" },
  computer_session_started: { targetType: "local_computer_session" },
  computer_session_stopped: { targetType: "local_computer_session" },
  computer_permission_granted: { targetType: "computer_permission_grant" },
  computer_permission_revoked: { targetType: "computer_permission_grant" },
  desktop_tool_requested: {
    targetType: "local_computer",
    metadata: [{ path: ["operation"], equals: "computer.execute" }],
  },
  conversation_continued: {
    targetType: "conversation",
    metadata: [
      { path: ["execution_target"], equals: "local" },
      { path: ["source_target"], equals: "local" },
    ],
  },
};

export function desktopActivityWhere(
  actorId: string,
): Prisma.AuditLogWhereInput {
  return {
    actorId,
    OR: desktopActivityActionSchema.options.map((action) => {
      const rule = desktopActivityRules[action];
      return {
        action,
        targetType: rule.targetType,
        ...(rule.metadata
          ? {
              OR: rule.metadata.map(({ path, equals }) => ({
                metadataJson: { path: [...path], equals },
              })),
            }
          : {}),
      };
    }),
  };
}

type AuditRow = {
  id: string;
  action: string;
  targetType: string | null;
  result: string;
  metadataJson: unknown;
  createdAt: Date;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function known<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function matchesRule(
  metadata: Record<string, unknown>,
  rule: DesktopActivityRule,
): boolean {
  if (!rule.metadata) return true;
  return rule.metadata.some((match) => {
    let value: unknown = metadata;
    for (const key of match.path) value = record(value)[key];
    return value === match.equals;
  });
}

function projectDelivery(
  action: DesktopActivityAction,
  metadata: Record<string, unknown>,
): DesktopActivityItem["delivery"] {
  const stored = known(desktopActivityDeliverySchema, metadata.delivery);
  if (action === "desktop_approval_responded") return stored;
  // The tool attempt writer never proves delivery. Keep an exact stored
  // `unconfirmed`, but a drifted `confirmed` row is not a delivery claim.
  return action === "desktop_tool_requested" && stored === "unconfirmed"
    ? stored
    : undefined;
}

function project(row: AuditRow): DesktopActivityItem | null {
  const action = known(desktopActivityActionSchema, row.action);
  if (!action) return null;
  const rule = desktopActivityRules[action];
  const metadata = record(row.metadataJson);
  if (row.targetType !== rule.targetType || !matchesRule(metadata, rule)) {
    return null;
  }
  const delivery = projectDelivery(action, metadata);
  const computerRequest =
    action === "desktop_tool_requested"
      ? known(desktopActivityComputerRequestSchema, metadata.computer_request)
      : undefined;
  const computerAction =
    computerRequest === "act"
      ? known(desktopActivityComputerActionSchema, metadata.computer_action)
      : undefined;
  const approvalDecision =
    action === "desktop_approval_responded"
      ? known(desktopApprovalDecisionSchema, metadata.action)
      : undefined;
  const parsed = desktopActivityItemSchema.safeParse({
    id: row.id,
    created_at: row.createdAt.toISOString(),
    action,
    result: row.result,
    ...(delivery ? { delivery } : {}),
    ...(computerRequest ? { computer_request: computerRequest } : {}),
    ...(computerAction ? { computer_action: computerAction } : {}),
    ...(approvalDecision ? { approval_decision: approvalDecision } : {}),
  });
  // A malformed row is omitted instead of widened or passed through.
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the authenticated actor's own latest desktop audit rows. The actor ID
 * always comes from the authenticated request; the client cannot widen it, and
 * an administrator caller gets the same account-scoped read as a normal user.
 */
export async function listDesktopActivity(
  prisma: Pick<PrismaClient, "auditLog">,
  actorId: string,
): Promise<DesktopActivityList> {
  const rows = await prisma.auditLog.findMany({
    where: desktopActivityWhere(actorId),
    select: {
      id: true,
      action: true,
      targetType: true,
      result: true,
      metadataJson: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: desktopActivityLimit,
  });
  return desktopActivityListSchema.parse({
    items: rows.flatMap((row) => {
      const item = project(row);
      return item ? [item] : [];
    }),
  });
}
