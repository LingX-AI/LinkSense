import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  conversationEventSchema,
  publicKnowledgeRunnerProgressSchema,
  type ConversationEvent,
} from "@linksense/shared";
import type { Logger } from "pino";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import {
  type PrismaClient,
  type ConversationEvent as StoredEvent,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { nextConversationEventSequence } from "../events/sequence.js";
import { methodEventPayload } from "../events/method-event-payload.js";

export type PublicKnowledgeProgressDelivery = {
  deliveryId: string;
  event: z.infer<typeof publicKnowledgeRunnerProgressSchema>;
};
export interface PublicKnowledgeProgressStore {
  close(): void;
  step(
    conversationId: string,
    turnId: string,
    phase: "started" | "completed" | "failed",
  ): Promise<void>;
  terminal(
    conversationId: string,
    turnId: string,
    status: "completed" | "failed" | "interrupted",
  ): Promise<void>;
  ingest(
    conversationId: string,
    entries: readonly PublicKnowledgeProgressDelivery[],
  ): Promise<void>;
  snapshot(
    conversationId: string,
    runningTurnId?: string,
  ): Promise<{ events: ConversationEvent[]; event_cursor: string }>;
  stream(
    conversationId: string,
    after: bigint,
    signal: AbortSignal,
    authorize: () => Promise<void>,
  ): AsyncIterable<string>;
}

const project = (row: StoredEvent): ConversationEvent =>
  conversationEventSchema.parse({
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    sequence_no: Number(row.sequenceNo),
    event_type: row.eventType,
    visibility: row.visibility,
    payload: row.payloadJson,
    sse_event_id: row.sseEventId,
    created_at: row.createdAt.toISOString(),
  });

/** Shared durable event infrastructure; public authorization stays in its service. */
export class PrismaPublicKnowledgeProgress implements PublicKnowledgeProgressStore {
  private readonly shutdown = new AbortController();
  close(): void {
    this.shutdown.abort();
  }
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bus: Pick<
      LinkSenseRedis,
      "publishConversationEvents" | "duplicate"
    >,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  private async append(
    conversationId: string,
    events: readonly ConversationEvent[],
  ): Promise<void> {
    const rows = await this.prisma.$transaction(async (tx) => {
      let sequence = await nextConversationEventSequence(tx, conversationId);
      const unique = new Map(
        events.map((event) => [event.id.toLowerCase(), event]),
      );
      const existing = await tx.conversationEvent.findMany({
        where: { id: { in: [...unique.keys()] } },
      });
      const byId = new Map(existing.map((row) => [row.id, row]));
      const additions: StoredEvent[] = [];
      for (const [id, event] of unique) {
        const previous = byId.get(id);
        if (previous) {
          if (
            previous.conversationId !== conversationId ||
            previous.turnId !== event.turn_id ||
            previous.eventType !== event.event_type ||
            !isDeepStrictEqual(previous.payloadJson, event.payload)
          )
            throw new AppError("CONFLICT");
          continue;
        }
        const row: StoredEvent = {
          id,
          conversationId,
          turnId: event.turn_id,
          sequenceNo: sequence,
          eventType: event.event_type,
          visibility: event.visibility,
          payloadJson: z.record(z.string(), z.json()).parse(event.payload),
          sseEventId: `${conversationId}:${sequence}`,
          createdAt: new Date(event.created_at),
        };
        additions.push(row);
        byId.set(id, row);
        sequence += 1n;
      }
      if (additions.length)
        await tx.conversationEvent.createMany({
          data: additions.map((row) => ({
            ...row,
            payloadJson: z.record(z.string(), z.json()).parse(row.payloadJson),
          })),
        });
      return events
        .map((event) => byId.get(event.id.toLowerCase()))
        .filter((row) => row !== undefined);
    });
    try {
      await this.bus.publishConversationEvents(
        conversationId,
        rows.map(project),
      );
    } catch {
      this.logger.warn(
        { conversationId },
        "public progress notification deferred to durable replay",
      );
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }

  private event(
    conversationId: string,
    turnId: string,
    value: Record<string, unknown>,
  ): ConversationEvent {
    return conversationEventSchema.parse({
      id: randomUUID(),
      conversation_id: conversationId,
      turn_id: turnId,
      sequence_no: 0,
      sse_event_id: "pending",
      created_at: new Date().toISOString(),
      visibility: "user_collapsed",
      ...value,
    });
  }

  async step(
    conversationId: string,
    turnId: string,
    phase: "started" | "completed" | "failed",
  ): Promise<void> {
    await this.append(conversationId, [
      this.event(conversationId, turnId, {
        event_type:
          phase === "started"
            ? "conversation.step.started"
            : "conversation.step.completed",
        payload: {
          schema_version: 1,
          item_id: `${turnId}:knowledge-search`,
          action:
            phase === "failed" ? "knowledge_search_failed" : "knowledge_search",
          safe_summary: "",
        },
      }),
    ]);
  }

  async terminal(
    conversationId: string,
    turnId: string,
    status: "completed" | "failed" | "interrupted",
  ): Promise<void> {
    await this.append(conversationId, [
      this.event(
        conversationId,
        turnId,
        status === "failed"
          ? {
              event_type: "conversation.error",
              visibility: "user_visible",
              payload: {
                schema_version: 1,
                error_code: "RUNNER_UNAVAILABLE",
                message_key: "publicKnowledge.unavailable",
              },
            }
          : {
              event_type:
                status === "completed"
                  ? "conversation.completed"
                  : "conversation.interrupted",
              visibility: "user_visible",
              payload: {
                schema_version: 1,
                turn_id: turnId,
                codex_turn_id: turnId,
                status,
              },
            },
      ),
    ]);
  }

  async ingest(
    conversationId: string,
    entries: readonly PublicKnowledgeProgressDelivery[],
  ): Promise<void> {
    await this.append(
      conversationId,
      entries.map(({ deliveryId, event }) => {
        const { notification, turnId } =
          publicKnowledgeRunnerProgressSchema.parse(event).params;
        return this.event(conversationId, turnId, {
          id: deliveryId,
          event_type: notification.method,
          visibility: notification.visibility,
          payload: methodEventPayload(notification.method, notification.params),
        });
      }),
    );
  }

  async snapshot(
    conversationId: string,
    runningTurnId?: string,
  ): Promise<{ events: ConversationEvent[]; event_cursor: string }> {
    const [rows, firstActive] = await Promise.all([
      this.prisma.conversationEvent.findMany({
        where: {
          conversationId,
          eventType: {
            notIn: [
              "item/agentMessage/delta",
              "item/reasoning/summaryTextDelta",
              "item/reasoning/summaryPartAdded",
            ],
          },
        },
        orderBy: { sequenceNo: "desc" },
        take: 4096,
      }),
      runningTurnId
        ? this.prisma.conversationEvent.findFirst({
            where: { conversationId, turnId: runningTurnId },
            orderBy: { sequenceNo: "asc" },
          })
        : null,
    ]);
    const after = firstActive
      ? firstActive.sequenceNo - 1n
      : (rows[0]?.sequenceNo ?? 0n);
    return {
      events: rows.reverse().map(project),
      event_cursor: `${conversationId}:${after}`,
    };
  }

  async *stream(
    conversationId: string,
    after: bigint,
    requestSignal: AbortSignal,
    authorize: () => Promise<void>,
  ): AsyncIterable<string> {
    const signal = AbortSignal.any([requestSignal, this.shutdown.signal]);
    const subscriber = this.bus.duplicate();
    const channel = `linksense:conversation-events:${conversationId}`;
    let version = 0,
      wake: () => void = () => undefined,
      authorizationCheckedAt = 0;
    const notified = () => {
      version += 1;
      wake();
    };
    subscriber.on("message", notified);
    signal.addEventListener("abort", notified);
    try {
      await subscriber.connect();
      await subscriber.subscribe(channel);
      while (!signal.aborted) {
        if (Date.now() - authorizationCheckedAt >= 15_000) {
          await authorize();
          authorizationCheckedAt = Date.now();
        }
        const observed = version;
        const rows = await this.prisma.conversationEvent.findMany({
          where: { conversationId, sequenceNo: { gt: after } },
          orderBy: { sequenceNo: "asc" },
          take: 200,
        });
        for (const row of rows) {
          if (signal.aborted) return;
          const event = project(row);
          after = row.sequenceNo;
          yield `id: ${event.sse_event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
        }
        if (rows.length || version !== observed) continue;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            wake = () => undefined;
            resolve();
          }, 15_000);
          timer.unref();
          wake = () => {
            clearTimeout(timer);
            wake = () => undefined;
            resolve();
          };
          if (signal.aborted || version !== observed) wake();
        });
        if (!signal.aborted) yield ": keep-alive\n\n";
      }
    } finally {
      wake();
      signal.removeEventListener("abort", notified);
      subscriber.off("message", notified);
      subscriber.disconnect();
    }
  }
}
