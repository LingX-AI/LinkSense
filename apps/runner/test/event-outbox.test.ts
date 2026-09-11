import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT } from "@linksense/shared";

import type { LinkSensePublishedEvent } from "../src/codex/event-mapper.js";
import { RunnerEventOutboxStore } from "../src/workspace/event-outbox.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";
import { deferred } from "./deferred.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename), readFile: vi.fn(actual.readFile) };
});

const conversationId = "01900000-0000-7000-8000-000000000001";
const ownerId = "01900000-0000-7000-8000-000000000002";
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.open).mockReset();
  vi.mocked(fs.rename).mockReset();
  vi.mocked(fs.readFile).mockReset();
  const actual = await vi.importActual<typeof fs>("node:fs/promises");
  vi.mocked(fs.open).mockImplementation(actual.open);
  vi.mocked(fs.rename).mockImplementation(actual.rename);
  vi.mocked(fs.readFile).mockImplementation(actual.readFile);
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("durable event batch append", () => {
  it("reads a bounded batch concurrently while returning original event order", async () => {
    const { outbox } = await fixture();
    const expected = await outbox.appendBatch(conversationId, [delta("a"), delta("b"), delta("c")]);
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    const reads = deferred<void>();
    let started = 0;
    vi.mocked(fs.readFile).mockImplementation(async (...args) => {
      started += 1;
      await reads.promise;
      return actual.readFile(...args);
    });
    const reading = outbox.peekBatch(conversationId, 3, 1024 * 1024);
    try {
      await vi.waitFor(() => expect(started).toBe(3));
      reads.resolve();
      expect(await reading).toEqual(expected);
    } finally {
      reads.resolve();
      await reading;
    }
  });

  it("finishes staging the whole batch before starting file syncs", async () => {
    const { outbox } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    const slowWrite = deferred<void>();
    const writingStarted = deferred<void>();
    let writesFinished = 0;
    const writesSeenBySync: number[] = [];
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (String(args[0]).includes(".pending-")) {
        const write = handle.writeFile.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementation(async (...input) => {
          writingStarted.resolve();
          await slowWrite.promise;
          await write(...input);
          writesFinished += 1;
        });
        const sync = handle.sync.bind(handle);
        vi.spyOn(handle, "sync").mockImplementation(async () => {
          writesSeenBySync.push(writesFinished);
          await sync();
        });
      }
      return handle;
    });
    const writing = outbox.appendBatch(conversationId, [delta("a"), delta("b"), delta("c")]);
    await writingStarted.promise;
    expect(writesSeenBySync).toEqual([]);
    slowWrite.resolve();
    await writing;
    expect(writesSeenBySync).toEqual([3, 3, 3]);
  });

  it("overlaps file syncs on slow storage and resolves only after all files and their directory are durable", async () => {
    const { outbox, manager } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    const files = deferred<void>();
    const directory = deferred<void>();
    let fileSyncs = 0;
    let directorySyncs = 0;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        if (String(args[0]).includes(".pending-")) {
          fileSyncs += 1;
          await files.promise;
        } else {
          directorySyncs += 1;
          await directory.promise;
        }
        await sync();
      });
      return handle;
    });
    const events = [delta("甲"), delta("乙"), delta("丙")];
    let settled = false;
    const writing = outbox.appendBatch(conversationId, events).then(entries => {
      settled = true;
      return entries;
    });
    try {
      await vi.waitFor(() => expect(fileSyncs).toBe(3));
      expect(settled).toBe(false);
      expect(await outbox.list(conversationId)).toEqual([]);
      files.resolve();
      await vi.waitFor(() => expect(directorySyncs).toBe(1));
      expect(settled).toBe(false);
      directory.resolve();
      const entries = await writing;
      expect(new Set(entries.map(entry => entry.deliveryId)).size).toBe(3);
      const recovered = await new RunnerEventOutboxStore(manager).list(conversationId);
      expect(recovered.map(entry => entry.event)).toEqual(events);
      expect(recovered.map(entry => entry.deliveryId)).toEqual(entries.map(entry => entry.deliveryId));
      expect(recovered.map(entry => entry.sequence)).toEqual([...recovered.map(entry => entry.sequence)].sort((a, b) => a - b));
      const first = entries[0];
      if (!first) throw new Error("missing persisted entry");
      expect(await fs.stat(first.path).then(stat => stat.mode & 0o777)).toBe(0o600);
    } finally {
      files.resolve();
      directory.resolve();
      await writing.catch(() => undefined);
    }
  });

  it("does not expose any files when one file sync fails and waits for every outstanding write before cleanup", async () => {
    const { outbox, directory } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    const pending = deferred<void>();
    let opened = 0;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const index = opened++;
      const handle = await actual.open(...args);
      if (index === 1) vi.spyOn(handle, "sync").mockRejectedValue(new Error("disk sync failed"));
      if (index === 2) vi.spyOn(handle, "sync").mockImplementation(() => pending.promise);
      return handle;
    });
    let settled = false;
    const writing = outbox.appendBatch(conversationId, [delta("a"), delta("b"), delta("c")]);
    const rejected = writing.catch(error => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(opened).toBe(3));
      expect(settled).toBe(false);
      expect(await outbox.list(conversationId)).toEqual([]);
      pending.resolve();
      expect(await rejected).toMatchObject({ message: "disk sync failed" });
      expect(await fs.readdir(directory)).toEqual([]);
    } finally {
      pending.resolve();
      await rejected;
    }
  });

  it("closes every opened file and removes staged data after a write failure", async () => {
    const { outbox, directory } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    const closed: string[] = [];
    let opened = 0;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const index = opened++;
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closed.push(String(args[0]));
        await close();
      });
      if (index === 1) vi.spyOn(handle, "writeFile").mockRejectedValue(new Error("disk full"));
      return handle;
    });
    await expect(outbox.appendBatch(conversationId, [delta("a"), delta("b"), delta("c")])).rejects.toThrow("disk full");
    expect(opened).toBe(3);
    expect(new Set(closed).size).toBe(3);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("leaves only an ordered recoverable prefix when a rename fails and never publishes a later file first", async () => {
    const { outbox, directory } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.rename).mockImplementationOnce(actual.rename).mockRejectedValueOnce(new Error("rename failed"));
    await expect(outbox.appendBatch(conversationId, [delta("a"), delta("b"), delta("c")])).rejects.toThrow("rename failed");
    expect((await outbox.list(conversationId)).map(entry => entry.event)).toEqual([delta("a")]);
    expect((await fs.readdir(directory)).every(file => file.endsWith(".json"))).toBe(true);
  });

  it("rejects a failed directory sync instead of reporting durable success", async () => {
    const { outbox, directory } = await fixture();
    const actual = await vi.importActual<typeof fs>("node:fs/promises");
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (String(args[0]) === directory) vi.spyOn(handle, "sync").mockRejectedValue(new Error("directory sync failed"));
      return handle;
    });
    await expect(outbox.appendBatch(conversationId, [delta("a"), delta("b")])).rejects.toThrow("directory sync failed");
  });

  it("serializes concurrent batches and individual events without changing disk records or delivery order", async () => {
    const { outbox } = await fixture();
    await Promise.all([
      outbox.appendBatch(conversationId, [delta("a"), delta("b")]),
      outbox.append(conversationId, delta("c")),
      outbox.appendBatch(conversationId, [delta("d"), delta("e")]),
    ]);
    const entries = await outbox.list(conversationId);
    expect(entries.map(entry => entry.event)).toEqual(["a", "b", "c", "d", "e"].map(delta));
    expect(new Set(entries.map(entry => entry.sequence)).size).toBe(5);
    for (const entry of entries) {
      expect(JSON.parse(await fs.readFile(entry.path, "utf8"))).toEqual({ schema_version: 2, delivery_id: entry.deliveryId, event: entry.event });
    }
  });

  it("validates the entire bounded batch before writing files", async () => {
    const { outbox } = await fixture();
    await expect(outbox.appendBatch(conversationId, [])).resolves.toEqual([]);
    await expect(outbox.appendBatch(conversationId, Array.from({ length: RUNNER_EVENT_OUTBOX_BATCH_MAX_COUNT + 1 }, () => delta("x")))).rejects.toThrow();
    await expect(outbox.appendBatch(conversationId, [delta("a"), { ...delta("b"), visibility: "invalid" } as unknown as LinkSensePublishedEvent])).rejects.toThrow();
    expect(await outbox.list(conversationId)).toEqual([]);
    expect(fs.open).not.toHaveBeenCalled();
  });
});

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), "linksense-outbox-batch-"));
  roots.push(root);
  const manager = new WorkspaceManager(root, undefined, { fixedOwnerId: ownerId });
  return { manager, outbox: new RunnerEventOutboxStore(manager), directory: join(manager.pathsFor(conversationId).taskControl, "outbox") };
}

function delta(text: string): LinkSensePublishedEvent {
  return { method: "item/agentMessage/delta", visibility: "user_visible", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: text } };
}
