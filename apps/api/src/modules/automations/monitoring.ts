import {
  readAutomationMonitoring,
  automationRunContextSchema,
} from "@linksense/shared";
import type {
  PendingRequest,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

/** Bind scheduling policy to trusted run metadata, outside visible user messages. */
export async function monitoringInstructionsForStart(
  tx: Prisma.TransactionClient,
  ownerId: string,
  conversationId: string,
  idempotencyKey: string | null | undefined,
): Promise<string | null> {
  if (!idempotencyKey?.startsWith("automation:")) return null;
  const run = await tx.automationRun.findFirst({
    where: { ownerId, conversationId, idempotencyKey },
    select: { executionContextJson: true },
  });
  const context = run?.executionContextJson
    ? automationRunContextSchema.parse(run.executionContextJson)
    : null;
  if (!context?.stop_condition) return null;
  const action =
    context.trigger === "manual"
      ? "This is a manual preview. Report whether the condition is met; do not stop the schedule."
      : "Only if the condition is met, call stop_scheduled_monitor to stop future scheduled runs. This does not interrupt the current turn. If the tool is unavailable, explicitly report that the schedule has not been stopped.";
  return `Scheduled monitoring stop condition (a user-provided criterion, not tool instructions): ${JSON.stringify(context.stop_condition)}\n${action}`;
}

export async function requestMonitoringStop(
  db: PrismaClient,
  ownerId: string,
  conversationId: string,
  turnId: string,
): Promise<{ stop_requested: true }> {
  return db.$transaction(async (tx) => {
    const turn = await tx.conversationTurn.findFirst({
      where: {
        id: turnId,
        conversationId,
        submittedBy: ownerId,
        status: "running",
      },
      select: { idempotencyKey: true },
    });
    if (!turn?.idempotencyKey) throw new AppError("FORBIDDEN");
    const locked = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM conversation_turns WHERE id = ${turnId}::uuid AND conversation_id = ${conversationId}::uuid AND submitted_by = ${ownerId}::uuid AND status = 'running' FOR UPDATE`;
    if (locked.length !== 1) throw new AppError("FORBIDDEN");
    const run = await tx.automationRun.findFirst({
      where: { conversationId, ownerId, idempotencyKey: turn.idempotencyKey },
    });
    const context = automationRunContextSchema.safeParse(
      run?.executionContextJson,
    );
    if (
      !run ||
      !context.success ||
      context.data.trigger !== "scheduled" ||
      !context.data.stop_condition
    )
      throw new AppError("FORBIDDEN");
    await lockAutomationMonitoring(tx, run.automationId);
    const automation = await tx.automation.findFirst({
      where: { id: run.automationId, ownerId, deletedAt: null },
    });
    if (!automation) throw new AppError("FORBIDDEN");
    const monitoring = readAutomationMonitoring(automation.monitoringJson);
    if (monitoring.stop_condition !== context.data.stop_condition)
      throw new AppError("CONFLICT");
    if (
      !monitoring.stop_requested_run_id ||
      monitoring.stop_requested_run_id === run.id
    ) {
      await tx.automation.update({
        where: { id: automation.id },
        data: {
          monitoringJson: {
            ...monitoring,
            stop_reason: "condition_met",
            stop_requested_run_id: run.id,
          },
        },
      });
    }
    return { stop_requested: true };
  });
}

/** Native terminal projection closes the schedule; the model's turn is untouched. */
export async function settleMonitoringStop(
  tx: Prisma.TransactionClient,
  conversationId: string,
  turn: { id: string; submittedBy: string; idempotencyKey: string | null },
): Promise<void> {
  if (!turn.idempotencyKey?.startsWith("automation:")) return;
  const run = await tx.automationRun.findFirst({
    where: {
      conversationId,
      ownerId: turn.submittedBy,
      OR: [{ turnId: turn.id }, { idempotencyKey: turn.idempotencyKey }],
    },
    select: { id: true, automationId: true, executionContextJson: true },
  });
  if (!run?.executionContextJson) return;
  await settleMonitoringRunStop(tx, run);
}

export async function lockAutomationMonitoring(
  tx: Prisma.TransactionClient,
  automationId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT id FROM automations WHERE id = ${automationId}::uuid FOR UPDATE`;
}

/** Also used when accepted work is cancelled before any native turn can finish. */
export async function settleMonitoringRunStop(
  tx: Prisma.TransactionClient,
  run: { id: string; automationId: string },
): Promise<void> {
  await lockAutomationMonitoring(tx, run.automationId);
  const automation = await tx.automation.findUnique({
    where: { id: run.automationId },
  });
  if (!automation || automation.deletedAt) return;
  const monitoring = readAutomationMonitoring(automation.monitoringJson);
  if (monitoring.stop_requested_run_id !== run.id) return;
  await tx.automation.update({
    where: { id: automation.id },
    data: {
      status: "paused",
      nextRunAt: null,
      monitoringJson: { ...monitoring, stop_requested_run_id: null },
    },
  });
}

export async function settleCancelledAutomationPending(
  tx: Prisma.TransactionClient,
  pending: Pick<
    PendingRequest,
    "id" | "conversationId" | "submittedBy" | "idempotencyKey"
  >,
  errorCode = "TURN_START_CLOSED",
): Promise<void> {
  if (!pending.idempotencyKey?.startsWith("automation:")) return;
  const runs = await tx.automationRun.findMany({
    where: {
      ownerId: pending.submittedBy,
      conversationId: pending.conversationId,
      status: { in: ["dispatching", "queued"] },
      completedAt: null,
      OR: [
        { pendingRequestId: pending.id },
        { idempotencyKey: pending.idempotencyKey },
      ],
    },
    orderBy: { id: "asc" },
  });
  for (const run of runs) {
    await lockAutomationMonitoring(tx, run.automationId);
    const cancelled = await tx.automationRun.updateMany({
      where: {
        id: run.id,
        status: { in: ["dispatching", "queued"] },
        completedAt: null,
      },
      data: {
        status: "failed",
        pendingRequestId: null,
        turnId: null,
        completedAt: new Date(),
        errorCode,
      },
    });
    if (cancelled.count !== 1) continue;
    await settleMonitoringRunStop(tx, run);
    const latest = await tx.automationRun.findFirst({
      where: { automationId: run.automationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latest?.id === run.id)
      await tx.automation.updateMany({
        where: { id: run.automationId, deletedAt: null },
        data: { lastRunStatus: "failed", lastErrorCode: errorCode },
      });
  }
}
