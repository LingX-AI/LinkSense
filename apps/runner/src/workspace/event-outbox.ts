import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  legacyRunnerConversationEventSchema,
  runnerCodexEventSchema,
  runnerLinkSenseEventSchema,
} from "@linksense/shared";

import {
  type LinkSensePublishedEvent,
  type LinkSenseRunnerEvent,
} from "../codex/event-mapper.js";
import { WorkspaceManager } from "./workspace-manager.js";

const outboxFilePattern = /^(\d{16})-([0-9a-f-]{36})\.json$/iu;
const persistedOutboxEntrySchema = z.discriminatedUnion("schema_version", [
  z.strictObject({
    schema_version: z.literal(1),
    delivery_id: z.uuid(),
    event: legacyRunnerConversationEventSchema,
  }),
  z.strictObject({
    schema_version: z.literal(2),
    delivery_id: z.uuid(),
    event: runnerCodexEventSchema,
  }),
  z.strictObject({
    schema_version: z.literal(3),
    delivery_id: z.uuid(),
    event: runnerLinkSenseEventSchema,
  }),
]);

type PersistedOutboxEntry = z.infer<typeof persistedOutboxEntrySchema>;

export type RunnerEventOutboxEntry = {
  conversationId: string;
  deliveryId: string;
  event: LinkSenseRunnerEvent;
  path: string;
  sequence: number;
};

/**
 * Stores only the sanitized Runner event contract. Legacy custom events remain
 * readable as v1 records, mapped app-server events use v2, and LinkSense-owned
 * method events use v3.
 * The conversation id is derived from the containing task control directory
 * and is not duplicated in the payload on disk.
 */
export class RunnerEventOutboxStore {
  private readonly appendLocks = new Map<string, Promise<void>>();
  private readonly nextSequences = new Map<string, number>();

  constructor(private readonly workspaceManager: WorkspaceManager) {}

  async append(
    conversationId: string,
    event: LinkSensePublishedEvent,
  ): Promise<RunnerEventOutboxEntry> {
    return this.withAppendLock(conversationId, async () => {
      const codexEvent = runnerCodexEventSchema.safeParse(event);
      const sanitizedEvent = codexEvent.success
        ? codexEvent.data
        : runnerLinkSenseEventSchema.parse(event);
      const directory = this.directoryFor(conversationId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const sequence = await this.allocateSequence(conversationId, directory);
      const deliveryId = randomUUID();
      const fileName = `${String(sequence).padStart(16, "0")}-${deliveryId}.json`;
      const finalPath = join(directory, fileName);
      const temporaryPath = join(directory, `.pending-${deliveryId}`);
      const persisted: PersistedOutboxEntry = codexEvent.success
        ? {
            schema_version: 2,
            delivery_id: deliveryId,
            event: codexEvent.data,
          }
        : {
            schema_version: 3,
            delivery_id: deliveryId,
            event: runnerLinkSenseEventSchema.parse(sanitizedEvent),
          };

      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(persisted), "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
      await handle.close();
      try {
        await rename(temporaryPath, finalPath);
        await syncDirectory(directory);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }

      return {
        conversationId,
        deliveryId,
        event: sanitizedEvent,
        path: finalPath,
        sequence,
      };
    });
  }

  async list(conversationId: string): Promise<RunnerEventOutboxEntry[]> {
    const directory = this.directoryFor(conversationId);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const restored: RunnerEventOutboxEntry[] = [];
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!entry.isFile()) continue;
      const restoredEntry = await this.readEntry(
        conversationId,
        directory,
        entry.name,
      );
      if (restoredEntry) restored.push(restoredEntry);
    }
    return restored;
  }

  async peek(conversationId: string): Promise<RunnerEventOutboxEntry | null> {
    const directory = this.directoryFor(conversationId);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }

    let oldestFileName: string | null = null;
    for (const entry of entries) {
      if (!entry.isFile() || !outboxFilePattern.test(entry.name)) continue;
      if (oldestFileName === null || entry.name < oldestFileName) {
        oldestFileName = entry.name;
      }
    }
    if (oldestFileName === null) return null;
    return this.readEntry(conversationId, directory, oldestFileName);
  }

  async remove(entry: RunnerEventOutboxEntry): Promise<void> {
    await rm(entry.path, { force: true });
    await syncDirectory(this.directoryFor(entry.conversationId));
  }

  async removeForeignThreadEntries(
    conversationId: string,
    codexThreadId: string,
  ): Promise<number> {
    return this.withAppendLock(conversationId, async () => {
      const entries = await this.list(conversationId);
      const foreignEntries = entries.filter((entry) => {
        const eventThreadId = runnerEventThreadId(entry.event);
        return eventThreadId !== null && eventThreadId !== codexThreadId;
      });
      if (foreignEntries.length === 0) return 0;

      await Promise.all(
        foreignEntries.map((entry) => rm(entry.path, { force: true })),
      );
      await syncDirectory(this.directoryFor(conversationId));
      return foreignEntries.length;
    });
  }

  private directoryFor(conversationId: string): string {
    return join(
      this.workspaceManager.pathsFor(conversationId).taskControl,
      "outbox",
    );
  }

  private async readEntry(
    conversationId: string,
    directory: string,
    fileName: string,
  ): Promise<RunnerEventOutboxEntry | null> {
    const match = outboxFilePattern.exec(fileName);
    if (!match) return null;
    const path = join(directory, fileName);
    const persisted = persistedOutboxEntrySchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (persisted.delivery_id !== match[2]) {
      throw new Error("runner event outbox delivery id mismatch");
    }
    return {
      conversationId,
      deliveryId: persisted.delivery_id,
      event: persisted.event,
      path,
      sequence: Number(match[1]),
    };
  }

  private async allocateSequence(
    conversationId: string,
    directory: string,
  ): Promise<number> {
    const cached = this.nextSequences.get(conversationId);
    if (cached !== undefined) {
      this.nextSequences.set(conversationId, cached + 1);
      return cached;
    }

    const entries = await readdir(directory);
    const maximum = entries.reduce((current, fileName) => {
      const match = outboxFilePattern.exec(fileName);
      if (!match) return current;
      return Math.max(current, Number(match[1]));
    }, 0);
    const next = Math.max(Date.now() * 1_000, maximum + 1);
    this.nextSequences.set(conversationId, next + 1);
    return next;
  }

  private async withAppendLock<T>(
    conversationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.appendLocks.get(conversationId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.appendLocks.set(conversationId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.appendLocks.get(conversationId) === tail) {
        this.appendLocks.delete(conversationId);
      }
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function runnerEventThreadId(event: LinkSenseRunnerEvent): string | null {
  if ("method" in event) {
    const threadId = event.params.threadId;
    return typeof threadId === "string" && threadId.length > 0
      ? threadId
      : null;
  }
  return event.threadId;
}
