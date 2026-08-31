import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  runnerMemoryUsageCaptureSchema,
  type RunnerMemoryUsageCapture,
} from "@linksense/shared";

import { WorkspaceManager } from "./workspace-manager.js";

const captureFilePattern = /^([0-9a-f-]{36})\.json$/iu;

export type MemoryUsageOutboxEntry = {
  ownerId: string;
  capture: RunnerMemoryUsageCapture;
  path: string;
};

/**
 * Persists metering facts outside task workspaces so deleting a conversation
 * cannot discard an already-observed memory-generation request.
 */
export class MemoryUsageOutboxStore {
  private readonly appendLocks = new Map<string, Promise<void>>();

  constructor(private readonly workspaceManager: WorkspaceManager) {}

  async append(
    capture: RunnerMemoryUsageCapture,
  ): Promise<MemoryUsageOutboxEntry> {
    const sanitized = runnerMemoryUsageCaptureSchema.parse(capture);
    return this.withAppendLock(sanitized.owner_id, async () => {
      const directory = this.directoryFor(sanitized.owner_id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const finalPath = join(directory, `${sanitized.request_id}.json`);
      const temporaryPath = join(directory, `.pending-${randomUUID()}`);
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(sanitized), "utf8");
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
        ownerId: sanitized.owner_id,
        capture: sanitized,
        path: finalPath,
      };
    });
  }

  async peek(ownerId: string): Promise<MemoryUsageOutboxEntry | null> {
    const directory = this.directoryFor(ownerId);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    const fileName = entries
      .filter((entry) => entry.isFile() && captureFilePattern.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))[0];
    if (!fileName) return null;
    const match = captureFilePattern.exec(fileName);
    if (!match) return null;
    const capture = runnerMemoryUsageCaptureSchema.parse(
      JSON.parse(await readFile(join(directory, fileName), "utf8")),
    );
    if (capture.owner_id !== ownerId || capture.request_id !== match[1]) {
      throw new Error("memory usage outbox identity mismatch");
    }
    return {
      ownerId,
      capture,
      path: join(directory, fileName),
    };
  }

  async remove(entry: MemoryUsageOutboxEntry): Promise<void> {
    await rm(entry.path, { force: true });
    await syncDirectory(this.directoryFor(entry.ownerId));
  }

  private directoryFor(ownerId: string): string {
    return join(
      this.workspaceManager.ownerPathsFor(ownerId).control,
      "memory-usage-outbox",
    );
  }

  private async withAppendLock<T>(
    ownerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.appendLocks.get(ownerId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.appendLocks.set(ownerId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.appendLocks.get(ownerId) === tail) {
        this.appendLocks.delete(ownerId);
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
