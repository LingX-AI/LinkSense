import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, readdir, rename, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import {
  RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT,
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
    const [entry] = await this.appendBatch(conversationId, [event]);
    if (!entry) throw new Error("runner event append returned no entry");
    return entry;
  }

  /**
   * Each event keeps its own atomic file and delivery id. File syncs may overlap,
   * but renames stay ordered and the shared directory is synced before success.
   * A failed append may leave a recoverable prefix, just as individual appends do.
   */
  async appendBatch(
    conversationId: string,
    events: readonly LinkSensePublishedEvent[],
  ): Promise<RunnerEventOutboxEntry[]> {
    if (events.length === 0) return [];
    if (events.length > RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT) {
      throw new RangeError("runner event append batch is too large");
    }
    // Validate and snapshot the entire input before starting any filesystem I/O.
    const records = events.map((event): PersistedOutboxEntry => {
      const codexEvent = runnerCodexEventSchema.safeParse(event);
      return codexEvent.success
        ? { schema_version: 2, delivery_id: randomUUID(), event: codexEvent.data }
        : { schema_version: 3, delivery_id: randomUUID(), event: runnerLinkSenseEventSchema.parse(event) };
    });
    return this.withAppendLock(conversationId, async () => {
      const directory = this.directoryFor(conversationId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const staged: Array<{ entry: RunnerEventOutboxEntry; temporaryPath: string; contents: string }> = [];
      for (const record of records) {
        const sequence = await this.allocateSequence(conversationId, directory);
        const deliveryId = record.delivery_id;
        staged.push({
          entry: {
            conversationId, deliveryId, sequence, event: record.event,
            path: join(directory, `${String(sequence).padStart(16, "0")}-${deliveryId}.json`),
          },
          temporaryPath: join(directory, `.pending-${deliveryId}`),
          contents: JSON.stringify(record),
        });
      }
      try {
        // Wait for every writer before cleanup, including when another fails.
        // Otherwise a late writer could recreate an abandoned temporary file.
        const handles: FileHandle[] = [];
        let closeFailure: PromiseRejectedResult | undefined;
        try {
          const writes = await Promise.allSettled(staged.map(async ({ temporaryPath, contents }) => {
            const handle = await open(temporaryPath, "wx", 0o600);
            handles.push(handle);
            await handle.writeFile(contents, "utf8");
          }));
          const writeFailure = writes.find(result => result.status === "rejected");
          if (writeFailure?.status === "rejected") throw writeFailure.reason;
          // Stage all data first so syncs can share the filesystem's journal
          // commit. Every file is still explicitly synced before any rename.
          const syncs = await Promise.allSettled(handles.map(handle => handle.sync()));
          const syncFailure = syncs.find(result => result.status === "rejected");
          if (syncFailure?.status === "rejected") throw syncFailure.reason;
        } finally {
          const closes = await Promise.allSettled(handles.map(handle => handle.close()));
          closeFailure = closes.find(result => result.status === "rejected");
        }
        if (closeFailure) throw closeFailure.reason;
        for (const { temporaryPath, entry } of staged) {
          await rename(temporaryPath, entry.path);
        }
        await syncDirectory(directory);
      } catch (error) {
        await Promise.allSettled(staged.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
        throw error;
      }
      return staged.map(({ entry }) => entry);
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
    return (await this.peekBatch(conversationId, 1, Number.MAX_SAFE_INTEGER))[0] ?? null;
  }

  async peekBatch(
    conversationId: string,
    limit: number,
    targetBytes: number,
  ): Promise<RunnerEventOutboxEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(targetBytes) || targetBytes < 1) {
      throw new RangeError("invalid runner event batch limits");
    }
    return this.withAppendLock(conversationId, async () => {
      const directory = this.directoryFor(conversationId);
      let files;
      try {
        files = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const candidates = files.filter(file => file.isFile() && outboxFilePattern.test(file.name))
        .sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit);
      // Files are immutable while this lock is held. Read the bounded window
      // concurrently, then apply byte limits and failures in sequence order.
      const reads = await Promise.allSettled(candidates.map(file =>
        this.readEntry(conversationId, directory, file.name),
      ));
      const entries: RunnerEventOutboxEntry[] = [];
      let bytes = Buffer.byteLength(JSON.stringify({ conversationId, events: [] }));
      for (const result of reads) {
        if (result.status === "rejected") {
          // Do not hold valid earlier records behind a corrupt later record.
          // The corrupt head remains on disk and fails the next read explicitly.
          if (entries.length > 0) break;
          throw result.reason;
        }
        const entry = result.value;
        if (!entry) continue;
        const entryBytes = Buffer.byteLength(JSON.stringify({ deliveryId: entry.deliveryId, event: entry.event })) + 1;
        if (entries.length > 0 && bytes + entryBytes > targetBytes) break;
        entries.push(entry);
        bytes += entryBytes;
      }
      return entries;
    });
  }

  async remove(entry: RunnerEventOutboxEntry): Promise<void> {
    await this.removeBatch([entry]);
  }

  async removeBatch(entries: readonly RunnerEventOutboxEntry[]): Promise<void> {
    const conversationId = entries[0]?.conversationId;
    if (!conversationId) return;
    if (entries.some(entry => entry.conversationId !== conversationId)) {
      throw new Error("runner event cleanup spans conversations");
    }
    await this.withAppendLock(conversationId, async () => {
      // Every entry has already been acknowledged by the API. A crash during
      // cleanup can only replay the same delivery ids, never lose pending data.
      const removals = await Promise.allSettled(entries.map(entry => rm(entry.path, { force: true })));
      await syncDirectory(this.directoryFor(conversationId));
      const failure = removals.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    });
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
  if ("preparation" in event && event.preparation) return null;
  if ("method" in event) {
    const threadId = event.params.threadId;
    return typeof threadId === "string" && threadId.length > 0
      ? threadId
      : null;
  }
  return event.threadId;
}
