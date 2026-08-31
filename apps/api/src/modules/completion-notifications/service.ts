import {
  completionNotificationFeedSchema,
  type CompletionNotification,
  type CompletionNotificationFeed,
} from "@linksense/shared";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

const MIN_CURSOR_ID = "00000000-0000-4000-8000-000000000000";
const EPOCH = new Date(0);
const COMPLETION_REPLAY_WINDOW_MILLISECONDS = 2 * 60 * 1_000;
const AUTOMATION_EMPTY_RESULT_ERROR_CODE = "AUTOMATION_EMPTY_RESULT";
const PLAN_OUTPUT_MISSING_ERROR_CODE = "PLAN_OUTPUT_MISSING";

export type CompletionNotificationPosition = Readonly<{
  terminalAt: Date;
  turnId: string;
}>;

export type CompletionNotificationReplay = Readonly<{
  upper: CompletionNotificationPosition;
  before: CompletionNotificationPosition;
  expiresAt: Date;
  final: boolean;
}>;

export type CompletionNotificationCursor = Readonly<{
  baseline: CompletionNotificationPosition;
  position: CompletionNotificationPosition;
  nextLane: "forward" | "replay";
  replay: CompletionNotificationReplay | null;
}>;

export type CompletionNotificationFeedInput = Readonly<{
  cursor?: CompletionNotificationCursor;
  limit: number;
}>;

export class CompletionNotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    ownerId: string,
    input: CompletionNotificationFeedInput,
  ): Promise<CompletionNotificationFeed> {
    if (!input.cursor) {
      const baseline =
        (await latestTerminalPosition(this.prisma, ownerId)) ??
        terminalPosition(MIN_CURSOR_ID, EPOCH);
      return completionNotificationFeedSchema.parse({
        items: [],
        next_cursor: encodeCompletionNotificationCursor({
          baseline,
          position: baseline,
          nextLane: "forward",
          replay: null,
        }),
      });
    }

    let turns: CompletionTurn[];
    let nextCursor: CompletionNotificationCursor;
    if (input.cursor.nextLane === "forward") {
      const forwardTurns = await findForwardTerminalTurns(
        this.prisma,
        ownerId,
        input.cursor.position,
        input.limit,
      );
      const lastForwardTurn = forwardTurns.at(-1);
      const nextPosition = lastForwardTurn
        ? terminalPositionForTurn(lastForwardTurn)
        : input.cursor.position;
      const replay =
        input.cursor.replay ??
        (lastForwardTurn
          ? startReplayGeneration(nextPosition, this.now())
          : null);
      turns = forwardTurns;
      nextCursor = {
        baseline: input.cursor.baseline,
        position: nextPosition,
        nextLane: replay ? "replay" : "forward",
        replay,
      };
    } else {
      const now = this.now();
      const replay = input.cursor.replay;
      if (!replay) {
        throw new Error("completion notification replay state is missing");
      }
      const activeReplay =
        !replay.final && now.getTime() >= replay.expiresAt.getTime()
          ? { ...replay, before: replay.upper, final: true }
          : replay;
      const replayRows = await findReplayTerminalTurns(
        this.prisma,
        ownerId,
        input.cursor.baseline,
        activeReplay,
        input.limit + 1,
      );
      const hasMoreReplayRows = replayRows.length > input.limit;
      const replayTurns = replayRows.slice(0, input.limit);
      const oldestReplayTurn = replayTurns.at(-1);

      let nextReplay: CompletionNotificationReplay | null;
      if (hasMoreReplayRows && oldestReplayTurn) {
        nextReplay = {
          ...activeReplay,
          before: terminalPositionForTurn(oldestReplayTurn),
        };
      } else if (!activeReplay.final) {
        nextReplay = { ...activeReplay, before: activeReplay.upper };
      } else if (
        compareTerminalPositions(input.cursor.position, activeReplay.upper) > 0
      ) {
        nextReplay = startReplayGeneration(input.cursor.position, now);
      } else {
        nextReplay = null;
      }

      turns = replayTurns.reverse();
      nextCursor = {
        baseline: input.cursor.baseline,
        position: input.cursor.position,
        nextLane: "forward",
        replay: nextReplay,
      };
    }
    if (turns.length === 0) {
      return completionNotificationFeedSchema.parse({
        items: [],
        next_cursor: encodeCompletionNotificationCursor(nextCursor),
      });
    }

    const turnIds = turns.map((turn) => turn.id);
    const idempotencyKeys = turns.flatMap((turn) =>
      turn.idempotencyKey ? [turn.idempotencyKey] : [],
    );
    const conversationIds = [
      ...new Set(turns.map((turn) => turn.conversationId)),
    ];
    const completionData = await Promise.all([
      this.prisma.automationRun.findMany({
        where: {
          ownerId,
          OR: [
            { turnId: { in: turnIds } },
            ...(idempotencyKeys.length > 0
              ? [
                  {
                    turnId: null,
                    idempotencyKey: { in: idempotencyKeys },
                    status: "failed",
                    errorCode: AUTOMATION_EMPTY_RESULT_ERROR_CODE,
                  },
                ]
              : []),
          ],
        },
        select: {
          id: true,
          automationId: true,
          conversationId: true,
          turnId: true,
          idempotencyKey: true,
          status: true,
          errorCode: true,
          completedAt: true,
        },
      }),
      this.prisma.conversation.findMany({
        where: { id: { in: conversationIds }, ownerId },
        select: { id: true, title: true },
      }),
      this.prisma.conversationEvent.findMany({
        where: {
          conversationId: { in: conversationIds },
          turnId: { in: turnIds },
          eventType: "conversation.error",
          visibility: "user_visible",
          payloadJson: {
            path: ["error_code"],
            equals: PLAN_OUTPUT_MISSING_ERROR_CODE,
          },
        },
        select: { turnId: true },
      }),
    ]);
    const [automationRuns, conversations, planOutputMissingEvents] =
      completionData;
    const automationIds = [
      ...new Set(automationRuns.map((run) => run.automationId)),
    ];
    const automations =
      automationIds.length === 0
        ? []
        : await this.prisma.automation.findMany({
            where: { id: { in: automationIds }, ownerId },
            select: { id: true, title: true },
          });
    const conversationById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );
    const automationById = new Map(
      automations.map((automation) => [automation.id, automation]),
    );
    const automationRunByConversationAndTurnId = new Map(
      automationRuns.flatMap((run) =>
        run.turnId
          ? [[completionIdentity(run.conversationId, run.turnId), run] as const]
          : [],
      ),
    );
    const automationRunByConversationAndIdempotencyKey = new Map(
      automationRuns.flatMap((run) =>
        run.turnId === null &&
        run.status === "failed" &&
        run.errorCode === AUTOMATION_EMPTY_RESULT_ERROR_CODE
          ? [
              [
                completionIdentity(run.conversationId, run.idempotencyKey),
                run,
              ] as const,
            ]
          : [],
      ),
    );
    const planOutputMissingTurnIds = new Set(
      planOutputMissingEvents.flatMap((event) =>
        event.turnId ? [event.turnId] : [],
      ),
    );
    const items: CompletionNotification[] = [];

    for (const turn of turns) {
      const conversation = conversationById.get(turn.conversationId);
      if (!conversation) continue;
      const automationRun =
        automationRunByConversationAndTurnId.get(
          completionIdentity(turn.conversationId, turn.id),
        ) ??
        (turn.idempotencyKey
          ? automationRunByConversationAndIdempotencyKey.get(
              completionIdentity(turn.conversationId, turn.idempotencyKey),
            )
          : undefined);
      const status = notificationStatus(
        turn,
        automationRun,
        !automationRun && planOutputMissingTurnIds.has(turn.id),
      );
      if (!status) continue;
      const source = automationRun ? "automation" : "task";
      const taskTitle = automationRun
        ? (automationById.get(automationRun.automationId)?.title ??
          conversation.title)
        : conversation.title;
      items.push({
        turn_id: turn.id,
        conversation_id: turn.conversationId,
        source,
        task_title: taskTitle,
        status,
        terminal_at: terminalPositionForTurn(turn).terminalAt.toISOString(),
      });
    }

    return completionNotificationFeedSchema.parse({
      items,
      next_cursor: encodeCompletionNotificationCursor(nextCursor),
    });
  }
}

const completionTurnSelect = {
  id: true,
  conversationId: true,
  idempotencyKey: true,
  status: true,
  completedAt: true,
  interruptedAt: true,
} satisfies Prisma.ConversationTurnSelect;

type CompletionTurn = Prisma.ConversationTurnGetPayload<{
  select: typeof completionTurnSelect;
}>;

async function latestTerminalPosition(
  prisma: PrismaClient,
  ownerId: string,
): Promise<CompletionNotificationPosition | null> {
  const [completedOrFailed, interrupted] = await Promise.all([
    prisma.conversationTurn.findFirst({
      where: {
        submittedBy: ownerId,
        status: { in: ["completed", "failed"] },
        completedAt: { not: null },
      },
      select: { id: true, completedAt: true },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    }),
    prisma.conversationTurn.findFirst({
      where: {
        submittedBy: ownerId,
        status: "interrupted",
        interruptedAt: { not: null },
      },
      select: { id: true, interruptedAt: true },
      orderBy: [{ interruptedAt: "desc" }, { id: "desc" }],
    }),
  ]);
  const candidates = [
    ...(completedOrFailed?.completedAt
      ? [terminalPosition(completedOrFailed.id, completedOrFailed.completedAt)]
      : []),
    ...(interrupted?.interruptedAt
      ? [terminalPosition(interrupted.id, interrupted.interruptedAt)]
      : []),
  ];
  return candidates.sort(compareTerminalPositions).at(-1) ?? null;
}

async function findForwardTerminalTurns(
  prisma: PrismaClient,
  ownerId: string,
  position: CompletionNotificationPosition,
  limit: number,
): Promise<CompletionTurn[]> {
  const [completedOrFailed, interrupted] = await Promise.all([
    prisma.conversationTurn.findMany({
      where: {
        submittedBy: ownerId,
        status: { in: ["completed", "failed"] },
        completedAt: { not: null },
        ...afterTerminalPosition(position, "completedAt"),
      },
      select: completionTurnSelect,
      orderBy: [{ completedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
    prisma.conversationTurn.findMany({
      where: {
        submittedBy: ownerId,
        status: "interrupted",
        interruptedAt: { not: null },
        ...afterTerminalPosition(position, "interruptedAt"),
      },
      select: completionTurnSelect,
      orderBy: [{ interruptedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
  ]);
  return sortTerminalTurns([...completedOrFailed, ...interrupted], "asc").slice(
    0,
    limit,
  );
}

async function findReplayTerminalTurns(
  prisma: PrismaClient,
  ownerId: string,
  baseline: CompletionNotificationPosition,
  replay: CompletionNotificationReplay,
  take: number,
): Promise<CompletionTurn[]> {
  const windowStart = replayWindowStart(baseline, replay.upper);
  const [completedOrFailed, interrupted] = await Promise.all([
    prisma.conversationTurn.findMany({
      where: {
        submittedBy: ownerId,
        status: { in: ["completed", "failed"] },
        completedAt: { not: null },
        AND: [
          afterTerminalPosition(baseline, "completedAt"),
          beforeTerminalPosition(replay.before, "completedAt"),
          { completedAt: { gte: windowStart } },
        ],
      },
      select: completionTurnSelect,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take,
    }),
    prisma.conversationTurn.findMany({
      where: {
        submittedBy: ownerId,
        status: "interrupted",
        interruptedAt: { not: null },
        AND: [
          afterTerminalPosition(baseline, "interruptedAt"),
          beforeTerminalPosition(replay.before, "interruptedAt"),
          { interruptedAt: { gte: windowStart } },
        ],
      },
      select: completionTurnSelect,
      orderBy: [{ interruptedAt: "desc" }, { id: "desc" }],
      take,
    }),
  ]);
  return sortTerminalTurns(
    [...completedOrFailed, ...interrupted],
    "desc",
  ).slice(0, take);
}

function terminalPosition(
  turnId: string,
  terminalAt: Date,
): CompletionNotificationPosition {
  return { terminalAt, turnId };
}

function terminalPositionForTurn(
  turn: CompletionTurn,
): CompletionNotificationPosition {
  const terminalAt =
    turn.status === "interrupted" ? turn.interruptedAt : turn.completedAt;
  if (!terminalAt) {
    throw new Error("completion notification terminal source is incomplete");
  }
  return terminalPosition(turn.id, terminalAt);
}

function startReplayGeneration(
  upper: CompletionNotificationPosition,
  now: Date,
): CompletionNotificationReplay {
  return {
    upper,
    before: upper,
    expiresAt: new Date(now.getTime() + COMPLETION_REPLAY_WINDOW_MILLISECONDS),
    final: false,
  };
}

function afterTerminalPosition(
  position: CompletionNotificationPosition,
  field: "completedAt" | "interruptedAt",
): Prisma.ConversationTurnWhereInput {
  if (field === "interruptedAt") {
    return {
      OR: [
        { interruptedAt: { gt: position.terminalAt } },
        {
          interruptedAt: position.terminalAt,
          id: { gt: position.turnId },
        },
      ],
    };
  }
  return {
    OR: [
      { completedAt: { gt: position.terminalAt } },
      {
        completedAt: position.terminalAt,
        id: { gt: position.turnId },
      },
    ],
  };
}

function beforeTerminalPosition(
  position: CompletionNotificationPosition,
  field: "completedAt" | "interruptedAt",
): Prisma.ConversationTurnWhereInput {
  if (field === "interruptedAt") {
    return {
      OR: [
        { interruptedAt: { lt: position.terminalAt } },
        {
          interruptedAt: position.terminalAt,
          id: { lt: position.turnId },
        },
      ],
    };
  }
  return {
    OR: [
      { completedAt: { lt: position.terminalAt } },
      {
        completedAt: position.terminalAt,
        id: { lt: position.turnId },
      },
    ],
  };
}

function replayWindowStart(
  baseline: CompletionNotificationPosition,
  position: CompletionNotificationPosition,
): Date {
  return new Date(
    Math.max(
      baseline.terminalAt.getTime(),
      position.terminalAt.getTime() - COMPLETION_REPLAY_WINDOW_MILLISECONDS,
    ),
  );
}

function sortTerminalTurns(
  turns: CompletionTurn[],
  direction: "asc" | "desc",
): CompletionTurn[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return turns.sort(
    (left, right) =>
      compareTerminalPositions(
        terminalPositionForTurn(left),
        terminalPositionForTurn(right),
      ) * multiplier,
  );
}

function notificationStatus(
  turn: CompletionTurn,
  automationRun:
    Readonly<{ status: string; completedAt: Date | null }> | undefined,
  planOutputMissing: boolean,
): "completed" | "failed" | "interrupted" | null {
  if (turn.status === "failed" || turn.status === "interrupted") {
    return turn.status;
  }
  if (turn.status !== "completed") return null;
  if (!automationRun) return planOutputMissing ? "failed" : "completed";
  if (automationRun.status === "failed") return "failed";
  return automationRun.completedAt ? "completed" : null;
}

function completionIdentity(conversationId: string, value: string): string {
  return JSON.stringify([conversationId, value]);
}

export function parseCompletionNotificationCursor(
  value: string,
): CompletionNotificationCursor | null {
  const parts = value.split("|");
  const [
    version,
    baselineAtValue,
    baselineTurnId,
    terminalAtValue,
    turnId,
    nextLaneValue,
    replayUpperAtValue,
    replayUpperTurnId,
    replayBeforeAtValue,
    replayBeforeTurnId,
    replayExpiresAtValue,
    replayFinalValue,
  ] = parts;
  if (
    version !== "v3" ||
    !baselineAtValue ||
    !baselineTurnId ||
    !terminalAtValue ||
    !turnId ||
    (nextLaneValue !== "forward" && nextLaneValue !== "replay") ||
    replayUpperAtValue === undefined ||
    replayUpperTurnId === undefined ||
    replayBeforeAtValue === undefined ||
    replayBeforeTurnId === undefined ||
    replayExpiresAtValue === undefined ||
    replayFinalValue === undefined ||
    parts.length !== 12
  ) {
    return null;
  }
  const baselineTerminalAt = new Date(baselineAtValue);
  const terminalAt = new Date(terminalAtValue);
  if (
    Number.isNaN(baselineTerminalAt.getTime()) ||
    Number.isNaN(terminalAt.getTime()) ||
    !isUuid(baselineTurnId) ||
    !isUuid(turnId) ||
    compareTerminalPositions(
      { terminalAt: baselineTerminalAt, turnId: baselineTurnId },
      { terminalAt, turnId },
    ) > 0 ||
    !hasConsistentOptionalCursorFields([
      replayUpperAtValue,
      replayUpperTurnId,
      replayBeforeAtValue,
      replayBeforeTurnId,
      replayExpiresAtValue,
      replayFinalValue,
    ])
  ) {
    return null;
  }

  const baseline = {
    terminalAt: baselineTerminalAt,
    turnId: baselineTurnId,
  };
  const position = { terminalAt, turnId };
  const hasReplay = replayUpperAtValue.length > 0;
  if (!hasReplay) {
    if (nextLaneValue !== "forward") return null;
    return { baseline, position, nextLane: "forward", replay: null };
  }

  const replayUpperTerminalAt = new Date(replayUpperAtValue);
  const replayBeforeTerminalAt = new Date(replayBeforeAtValue);
  const replayExpiresAt = new Date(replayExpiresAtValue);
  if (
    Number.isNaN(replayUpperTerminalAt.getTime()) ||
    Number.isNaN(replayBeforeTerminalAt.getTime()) ||
    Number.isNaN(replayExpiresAt.getTime()) ||
    !isUuid(replayUpperTurnId) ||
    !isUuid(replayBeforeTurnId) ||
    (replayFinalValue !== "0" && replayFinalValue !== "1")
  ) {
    return null;
  }
  const replayUpper = {
    terminalAt: replayUpperTerminalAt,
    turnId: replayUpperTurnId,
  };
  const replayBefore = {
    terminalAt: replayBeforeTerminalAt,
    turnId: replayBeforeTurnId,
  };
  if (
    compareTerminalPositions(baseline, replayUpper) >= 0 ||
    compareTerminalPositions(replayUpper, position) > 0 ||
    compareTerminalPositions(baseline, replayBefore) >= 0 ||
    compareTerminalPositions(replayBefore, replayUpper) > 0 ||
    replayBefore.terminalAt.getTime() <
      replayWindowStart(baseline, replayUpper).getTime()
  ) {
    return null;
  }
  return {
    baseline,
    position,
    nextLane: nextLaneValue,
    replay: {
      upper: replayUpper,
      before: replayBefore,
      expiresAt: replayExpiresAt,
      final: replayFinalValue === "1",
    },
  };
}

function hasConsistentOptionalCursorFields(values: string[]): boolean {
  return (
    values.every((field) => field.length === 0) ||
    values.every((field) => field.length > 0)
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function compareTerminalPositions(
  left: CompletionNotificationPosition,
  right: CompletionNotificationPosition,
): number {
  const timeDifference = left.terminalAt.getTime() - right.terminalAt.getTime();
  if (timeDifference) return timeDifference;
  if (left.turnId === right.turnId) return 0;
  return left.turnId < right.turnId ? -1 : 1;
}

export function encodeCompletionNotificationCursor(
  cursor: CompletionNotificationCursor,
): string {
  return [
    "v3",
    cursor.baseline.terminalAt.toISOString(),
    cursor.baseline.turnId,
    cursor.position.terminalAt.toISOString(),
    cursor.position.turnId,
    cursor.nextLane,
    cursor.replay?.upper.terminalAt.toISOString() ?? "",
    cursor.replay?.upper.turnId ?? "",
    cursor.replay?.before.terminalAt.toISOString() ?? "",
    cursor.replay?.before.turnId ?? "",
    cursor.replay?.expiresAt.toISOString() ?? "",
    cursor.replay ? (cursor.replay.final ? "1" : "0") : "",
  ].join("|");
}
