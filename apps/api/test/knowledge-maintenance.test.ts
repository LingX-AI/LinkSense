import { describe, expect, it, vi } from "vitest";

import { sanitizeAuditMetadata } from "../src/modules/audit/service.js";
import {
  KnowledgeMaintenanceService,
  KnowledgeMaintenanceWorker,
  PrismaKnowledgeMaintenanceGate,
  PrismaKnowledgeMaintenanceStore,
  type KnowledgeMaintenanceStore,
  type KnowledgeMaintenanceTaskRecord,
} from "../src/modules/knowledge/maintenance.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import type { KnowledgeActor } from "../src/modules/knowledge/types.js";

const ADMIN: KnowledgeActor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  status: "active",
};
const USER: KnowledgeActor = { ...ADMIN, role: "user" };
const TASK_ID = "00000000-0000-4000-8000-000000000002";
const BASE_ID = "00000000-0000-4000-8000-000000000003";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000004";
const VERSION_ID = "00000000-0000-4000-8000-000000000005";
const GENERATION_ID = "00000000-0000-4000-8000-000000000006";
const NOW = new Date("2026-07-22T00:00:00.000Z");

describe("KnowledgeMaintenanceService", () => {
  it("requires an enabled administrator and explicit confirmation", async () => {
    const service = maintenanceService(fakeStore());

    await expect(
      service.requestRebuild(USER, {
        reason: "dimension change",
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.requestRebuild(ADMIN, {
        reason: " ",
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates one fixed all-document task and a reasoned audit", async () => {
    const createTask = vi.fn(async () => taskRecord());
    const writeAudit = vi.fn(async () => undefined);
    const service = maintenanceService(fakeStore({ createTask, writeAudit }));

    const result = await service.requestRebuild(ADMIN, {
      reason: "embedding dimensions changed",
      confirmed: true,
    });

    expect(result).toMatchObject({
      id: TASK_ID,
      status: "pending",
      total_count: 1,
    });
    expect(createTask).toHaveBeenCalledWith({
      id: TASK_ID,
      actorId: ADMIN.id,
      reason: "embedding dimensions changed",
      now: NOW,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "knowledge_base.maintenance_rebuild_requested",
        metadata: expect.objectContaining({ scope: "all_documents" }),
      }),
    );
  });

  it("rejects a second pending or running task", async () => {
    const service = maintenanceService(
      fakeStore({ findLatest: vi.fn(async () => taskRecord()) }),
    );

    await expect(
      service.requestRebuild(ADMIN, { reason: "again", confirmed: true }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_MAINTENANCE_IN_PROGRESS" });
  });
});

describe("PrismaKnowledgeMaintenanceStore", () => {
  it("casts the advisory-lock result so Prisma never deserializes PostgreSQL void", async () => {
    const queryRaw = vi.fn<
      (template: TemplateStringsArray) => Promise<unknown[]>
    >(async () => []);
    const database = { $queryRaw: queryRaw } as unknown as PrismaClient;
    const store = new PrismaKnowledgeMaintenanceStore(database);

    await store.lockTaskCreation();

    const template = queryRaw.mock.calls[0]?.[0] as
      TemplateStringsArray | undefined;
    expect(template?.join("?")).toContain(
      "pg_advisory_xact_lock(\n        hashtext('linksense:knowledge:maintenance:create')\n      )::text",
    );
  });

  it("accepts any internally consistent chunking provenance during recovery", async () => {
    const queryRaw = vi.fn<(query: unknown) => Promise<unknown[]>>(async () => [
      recoveryTarget(),
    ]);
    const store = new PrismaKnowledgeMaintenanceStore({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);

    await expect(
      store.resolveRecoveryTarget({
        documentId: DOCUMENT_ID,
        expectedEmbeddingProfileHash: "a".repeat(64),
      }),
    ).resolves.toEqual(recoveryTarget());

    const query = queryRaw.mock.calls[0]?.[0] as
      | { sql?: string; values?: unknown[] }
      | undefined;
    expect(query?.sql).toContain(
      'document."chunking_config_digest" = current_version."chunking_config_digest"',
    );
    expect(query?.values).not.toContain("b".repeat(64));
  });
});

describe("PrismaKnowledgeMaintenanceGate", () => {
  it("keeps retrieval blocked but permits a document repair after a failed full rebuild", async () => {
    const findFirst = vi.fn(async () => ({
      status: "failed",
      currentStage: "reconciling",
    }));
    const gate = new PrismaKnowledgeMaintenanceGate({
      knowledgeBaseMaintenanceTask: { findFirst },
    } as unknown as PrismaClient);

    await expect(gate.isBlocked()).resolves.toBe(true);
    await expect(gate.assertAvailable()).rejects.toMatchObject({
      code: "KNOWLEDGE_MAINTENANCE_UNAVAILABLE",
    });
    await expect(
      gate.assertDocumentRebuildAvailable(),
    ).resolves.toBeUndefined();
    await expect(
      gate.isDocumentRebuildExecutionAvailable(),
    ).resolves.toBe(true);
  });

  it.each([
    ["pending", null, false],
    ["running", "pausing_processing", false],
    ["running", "recreating_index", false],
    ["running", "rebuilding_documents", true],
    ["running", "reconciling", true],
  ] as const)(
    "accepts a document rebuild while full maintenance is %s/%s and reports execution readiness",
    async (status, currentStage, executionAvailable) => {
      const gate = new PrismaKnowledgeMaintenanceGate({
        knowledgeBaseMaintenanceTask: {
          findFirst: vi.fn(async () => ({ status, currentStage })),
        },
      } as unknown as PrismaClient);

      await expect(
        gate.assertDocumentRebuildAvailable(),
      ).resolves.toBeUndefined();
      await expect(
        gate.isDocumentRebuildExecutionAvailable(),
      ).resolves.toBe(executionAvailable);
    },
  );
});

describe("KnowledgeMaintenanceWorker", () => {
  it("pauses normal processing, recreates the shared index, rebuilds all targets, and resumes only after success", async () => {
    const events: string[] = [];
    const completeTask = vi.fn(async () => {
      events.push("completed");
    });
    const store = fakeStore({
      findPending: vi.fn(async () => taskRecord()),
      findLatest: vi.fn(async () =>
        taskRecord({ status: "running", succeededCount: 1n }),
      ),
      countTargets: vi.fn(async () => 1),
      listTargetPage: vi.fn(async () => [target()]),
      updateStage: vi.fn(async (_id, stage) => {
        events.push(stage);
      }),
      completeTask,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => {
          events.push("paused");
        }),
        resumeDocumentRebuilds: vi.fn(async () => {
          events.push("document-rebuilds-resumed");
        }),
        resume: vi.fn(async () => {
          events.push("resumed");
        }),
      },
      {
        recreateIndex: vi.fn(async () => {
          events.push("index-recreated");
        }),
        verifyIndexContract: vi.fn(async () => {
          events.push("index-verified");
        }),
      },
      {
        rebuild: vi.fn(async ({ requestedBy }) => {
          expect(requestedBy).toBe(ADMIN.id);
          events.push("document-rebuilt");
          return rebuildResult();
        }),
      },
      { now: () => NOW },
    );

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(events).toEqual([
      "pausing_processing",
      "paused",
      "recreating_index",
      "index-recreated",
      "rebuilding_documents",
      "document-rebuilds-resumed",
      "document-rebuilt",
      "reconciling",
      "index-verified",
      "completed",
      "resumed",
    ]);
  });

  it("keeps retrieval blocked but resumes processing for manual document repair after failure", async () => {
    const resume = vi.fn(async () => undefined);
    const failTask = vi.fn(async () => undefined);
    const store = fakeStore({
      findPending: vi.fn(async () => taskRecord()),
      findLatest: vi.fn(async () =>
        taskRecord({ status: "running", failedCount: 1n }),
      ),
      countTargets: vi.fn(async () => 1),
      listTargetPage: vi.fn(async () => [target()]),
      failTask,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume,
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      {
        rebuild: vi.fn(async () => {
          throw new Error("upstream private detail");
        }),
      },
      { now: () => NOW },
    );

    await worker.runOnce();

    expect(failTask).toHaveBeenCalledWith(
      TASK_ID,
      "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE",
      NOW,
    );
    expect(resume).toHaveBeenCalledOnce();
  });

  it("resumes processing for document repair when full maintenance fails before rebuilding targets", async () => {
    const failTask = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const worker = new KnowledgeMaintenanceWorker(
      fakeStore({
        findPending: vi.fn(async () => taskRecord()),
        failTask,
      }),
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume,
      },
      {
        recreateIndex: vi.fn(async () => {
          throw new Error("private upstream failure");
        }),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild: vi.fn() },
      { now: () => NOW },
    );

    await worker.runOnce();

    expect(failTask).toHaveBeenCalledWith(
      TASK_ID,
      "KNOWLEDGE_MAINTENANCE_REBUILD_FAILED",
      NOW,
    );
    expect(resume).toHaveBeenCalledOnce();
  });

  it("restores processing on startup when the latest full rebuild failed", async () => {
    const pauseAndWait = vi.fn(async () => undefined);
    const resume = vi.fn(async () => undefined);
    const worker = new KnowledgeMaintenanceWorker(
      fakeStore({
        findLatest: vi.fn(async () => taskRecord({ status: "failed" })),
      }),
      immediateLock(),
      {
        pauseAndWait,
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume,
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild: vi.fn() },
      { now: () => NOW, pollIntervalMs: 60_000 },
    );

    await worker.start();

    expect(resume).toHaveBeenCalledOnce();
    expect(pauseAndWait).not.toHaveBeenCalled();
    await worker.close();
  });

  it("completes a failed full rebuild after every current document passes exact PostgreSQL and Elasticsearch reconciliation", async () => {
    const completeRecoveredTask = vi.fn(async () => true);
    const reconcileActiveDocumentVersion = vi.fn(async () => undefined);
    const store = fakeStore({
      findLatest: vi.fn(async () =>
        taskRecord({
          status: "failed",
          currentStage: "reconciling",
          totalCount: 1n,
          succeededCount: 0n,
          failedCount: 1n,
          stableErrorCode: "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE",
        }),
      ),
      countTargets: vi.fn(async () => 1),
      listTargetPage: vi.fn(async () => [target()]),
      resolveRecoveryTarget: vi.fn(async () => recoveryTarget()),
      completeRecoveredTask,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild: vi.fn() },
      {
        now: () => NOW,
        recovery: recoveryDependencies({ reconcileActiveDocumentVersion }),
      },
    );

    worker.requestFailedTaskRecovery();
    await expect(worker.runOnce()).resolves.toBe(true);

    expect(reconcileActiveDocumentVersion).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      activeDocumentVersionId: VERSION_ID,
      expectedParentCount: 2,
      expectedChildCount: 3,
      expectedEmbeddingProfileHash: "a".repeat(64),
      expectedIndexIntegrityDigest: "d".repeat(64),
    });
    expect(completeRecoveredTask).toHaveBeenCalledWith({
      taskId: TASK_ID,
      expectedTotalCount: 1,
      expectedEmbeddingProfileHash: "a".repeat(64),
      now: NOW,
    });
  });

  it("keeps the failed maintenance gate closed when any current document is not compatible", async () => {
    const completeRecoveredTask = vi.fn(async () => true);
    const reconcileActiveDocumentVersion = vi.fn(async () => undefined);
    const store = fakeStore({
      findLatest: vi.fn(async () =>
        taskRecord({
          status: "failed",
          failedCount: 1n,
          stableErrorCode: "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE",
        }),
      ),
      countTargets: vi.fn(async () => 1),
      listTargetPage: vi.fn(async () => [target()]),
      resolveRecoveryTarget: vi.fn(async () => null),
      completeRecoveredTask,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild: vi.fn() },
      {
        now: () => NOW,
        recovery: recoveryDependencies({ reconcileActiveDocumentVersion }),
      },
    );

    worker.requestFailedTaskRecovery();
    await expect(worker.runOnce()).resolves.toBe(true);

    expect(reconcileActiveDocumentVersion).not.toHaveBeenCalled();
    expect(completeRecoveredTask).not.toHaveBeenCalled();
  });

  it("does not claim work when another deployment worker owns the lock", async () => {
    const startTask = vi.fn(async () => true);
    const worker = new KnowledgeMaintenanceWorker(
      fakeStore({ findPending: vi.fn(async () => taskRecord()), startTask }),
      {
        tryRunExclusive: vi.fn(async () => ({ acquired: false as const })),
        close: vi.fn(async () => undefined),
      },
      {
        pauseAndWait: vi.fn(),
        resumeDocumentRebuilds: vi.fn(),
        resume: vi.fn(),
      },
      { recreateIndex: vi.fn(), verifyIndexContract: vi.fn() },
      { rebuild: vi.fn() },
    );

    await expect(worker.runOnce()).resolves.toBe(false);
    expect(startTask).not.toHaveBeenCalled();
  });

  it("restores the pending-task pause without awaiting the long rebuild on startup", async () => {
    const recreate = deferred<void>();
    const recreateIndex = vi.fn(() => recreate.promise);
    const pauseAndWait = vi.fn(async () => undefined);
    const findPending = vi
      .fn<KnowledgeMaintenanceStore["findPending"]>()
      .mockResolvedValueOnce(taskRecord())
      .mockResolvedValue(null);
    const store = fakeStore({
      findLatest: vi
        .fn<KnowledgeMaintenanceStore["findLatest"]>()
        .mockResolvedValueOnce(taskRecord())
        .mockResolvedValue(taskRecord({ status: "running", totalCount: 0n })),
      findPending,
      listTargetPage: vi.fn(async () => []),
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait,
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex,
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild: vi.fn() },
      { now: () => NOW, pollIntervalMs: 5 },
    );

    await expect(worker.start()).resolves.toBeUndefined();
    expect(pauseAndWait).toHaveBeenCalled();
    await vi.waitFor(() => expect(recreateIndex).toHaveBeenCalledTimes(1));

    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    recreate.resolve();
    await closing;
    expect(closed).toBe(true);
  });

  it("serializes timer ticks and leaves no polling work after close", async () => {
    const pause = deferred<void>();
    const findPending = vi
      .fn<KnowledgeMaintenanceStore["findPending"]>()
      .mockResolvedValueOnce(taskRecord())
      .mockResolvedValue(null);
    const worker = new KnowledgeMaintenanceWorker(
      fakeStore({
        findLatest: vi.fn(async () => taskRecord({ status: "completed" })),
        findPending,
      }),
      immediateLock(),
      {
        pauseAndWait: vi.fn(() => pause.promise),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild: vi.fn() },
      { now: () => NOW, pollIntervalMs: 5 },
    );

    await worker.start();
    await vi.waitFor(() => expect(findPending).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(findPending).toHaveBeenCalledTimes(1);

    const closing = worker.close();
    pause.resolve();
    await closing;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(findPending).toHaveBeenCalledTimes(1);
  });

  it("reads targets in bounded UUID-keyset pages and advances from the last processed document", async () => {
    const documentIds = [
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000007",
      "00000000-0000-4000-8000-000000000008",
    ];
    const targets = documentIds.map((documentId) => target({ documentId }));
    const listTargetPage = vi.fn(
      async ({
        afterDocumentId,
        limit,
      }: {
        afterDocumentId: string | null;
        limit: number;
      }) => {
        const start =
          afterDocumentId === null
            ? 0
            : documentIds.findIndex((id) => id === afterDocumentId) + 1;
        return targets.slice(start, start + limit);
      },
    );
    const rebuiltDocumentIds: string[] = [];
    const rebuild = vi.fn(
      async (input: {
        target: ReturnType<typeof createTarget>;
        requestedBy: string;
      }) => {
        rebuiltDocumentIds.push(input.target.documentId);
        return rebuildResult();
      },
    );
    const store = fakeStore({
      findPending: vi.fn(async () => taskRecord()),
      findLatest: vi.fn(async () =>
        taskRecord({
          status: "running",
          totalCount: 3n,
          succeededCount: 3n,
        }),
      ),
      countTargets: vi.fn(async () => 3),
      listTargetPage,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild },
      { now: () => NOW, targetPageSize: 2 },
    );

    await expect(worker.runOnce()).resolves.toBe(true);

    expect(listTargetPage).toHaveBeenNthCalledWith(1, {
      afterDocumentId: null,
      limit: 2,
    });
    expect(listTargetPage).toHaveBeenNthCalledWith(2, {
      afterDocumentId: documentIds[1],
      limit: 2,
    });
    expect(listTargetPage).toHaveBeenCalledTimes(2);
    expect(rebuiltDocumentIds).toEqual(documentIds);
  });

  it("rebuilds documents concurrently without exceeding the configured limit", async () => {
    const documentIds = [
      "00000000-0000-4000-8000-000000000004",
      "00000000-0000-4000-8000-000000000007",
      "00000000-0000-4000-8000-000000000008",
      "00000000-0000-4000-8000-000000000009",
    ];
    const targets = documentIds.map((documentId) => target({ documentId }));
    const releaseRebuilds = deferred<void>();
    let activeRebuilds = 0;
    let maximumActiveRebuilds = 0;
    const startedDocumentIds: string[] = [];
    const rebuild = vi.fn(
      async (input: {
        target: ReturnType<typeof createTarget>;
        requestedBy: string;
      }) => {
        activeRebuilds += 1;
        maximumActiveRebuilds = Math.max(maximumActiveRebuilds, activeRebuilds);
        startedDocumentIds.push(input.target.documentId);
        await releaseRebuilds.promise;
        activeRebuilds -= 1;
        return rebuildResult();
      },
    );
    const recordDocumentResult = vi.fn(async () => undefined);
    const store = fakeStore({
      findPending: vi.fn(async () => taskRecord()),
      findLatest: vi.fn(async () =>
        taskRecord({
          status: "running",
          totalCount: 4n,
          succeededCount: 4n,
        }),
      ),
      countTargets: vi.fn(async () => 4),
      listTargetPage: vi.fn(async () => targets),
      recordDocumentResult,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild },
      {
        now: () => NOW,
        targetPageSize: 100,
        rebuildConcurrency: 2,
      },
    );

    const run = worker.runOnce();
    await vi.waitFor(() => expect(startedDocumentIds).toHaveLength(2));
    expect(activeRebuilds).toBe(2);
    expect(maximumActiveRebuilds).toBe(2);

    releaseRebuilds.resolve();
    await expect(run).resolves.toBe(true);

    expect(startedDocumentIds).toEqual(documentIds);
    expect(maximumActiveRebuilds).toBe(2);
    expect(recordDocumentResult).toHaveBeenCalledTimes(4);
  });

  it("completes an empty deployment rebuild after one bounded empty-page read", async () => {
    const listTargetPage = vi.fn(async () => []);
    const rebuild = vi.fn();
    const completeTask = vi.fn(async () => undefined);
    const store = fakeStore({
      findPending: vi.fn(async () => taskRecord({ totalCount: 0n })),
      findLatest: vi.fn(async () =>
        taskRecord({ status: "running", totalCount: 0n }),
      ),
      countTargets: vi.fn(async () => 0),
      listTargetPage,
      completeTask,
    });
    const worker = new KnowledgeMaintenanceWorker(
      store,
      immediateLock(),
      {
        pauseAndWait: vi.fn(async () => undefined),
        resumeDocumentRebuilds: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      {
        recreateIndex: vi.fn(async () => undefined),
        verifyIndexContract: vi.fn(async () => undefined),
      },
      { rebuild },
      { now: () => NOW, targetPageSize: 2 },
    );

    await worker.runOnce();

    expect(listTargetPage).toHaveBeenCalledOnce();
    expect(listTargetPage).toHaveBeenCalledWith({
      afterDocumentId: null,
      limit: 2,
    });
    expect(rebuild).not.toHaveBeenCalled();
    expect(completeTask).toHaveBeenCalledWith(TASK_ID, NOW);
  });
});

describe("knowledge maintenance audit metadata", () => {
  it("keeps stable result counters and removes private failure details", () => {
    expect(
      sanitizeAuditMetadata("knowledge_base.maintenance_rebuild_failed", {
        scope: "all_documents",
        total_count: 3,
        succeeded_count: 2,
        failed_count: 1,
        stable_error_code: "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE",
        upstream_error: "private provider response",
      }),
    ).toEqual({
      scope: "all_documents",
      total_count: 3,
      succeeded_count: 2,
      failed_count: 1,
      stable_error_code: "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE",
    });
  });
});

function maintenanceService(store: KnowledgeMaintenanceStore) {
  return new KnowledgeMaintenanceService(store, {
    now: () => NOW,
    createId: () => TASK_ID,
  });
}

function fakeStore(
  overrides: Partial<KnowledgeMaintenanceStore> = {},
): KnowledgeMaintenanceStore {
  const store: KnowledgeMaintenanceStore = {
    transaction: async <T>(
      work: (value: KnowledgeMaintenanceStore) => Promise<T>,
    ) => work(store),
    lockTaskCreation: vi.fn(async () => undefined),
    findLatest: vi.fn(async () => null),
    findPending: vi.fn(async () => null),
    findRunning: vi.fn(async () => null),
    createTask: vi.fn(async () => taskRecord()),
    startTask: vi.fn(async () => true),
    updateStage: vi.fn(async () => undefined),
    countTargets: vi.fn(async () => 0),
    listTargetPage: vi.fn(async () => []),
    setTotalCount: vi.fn(async () => undefined),
    recordDocumentResult: vi.fn(async () => undefined),
    resolveRecoveryTarget: vi.fn(async () => null),
    completeRecoveredTask: vi.fn(async () => false),
    completeTask: vi.fn(async () => undefined),
    failTask: vi.fn(async () => undefined),
    writeAudit: vi.fn(async () => undefined),
    ...overrides,
  };
  return store;
}

function immediateLock() {
  return {
    async tryRunExclusive<T>(operation: (signal: AbortSignal) => Promise<T>) {
      return {
        acquired: true as const,
        value: await operation(new AbortController().signal),
      };
    },
    close: vi.fn(async () => undefined),
  };
}

function taskRecord(
  overrides: Partial<KnowledgeMaintenanceTaskRecord> = {},
): KnowledgeMaintenanceTaskRecord {
  return {
    id: TASK_ID,
    status: "pending",
    requestedBy: ADMIN.id,
    reason: "dimension change",
    confirmedAt: NOW,
    currentStage: null,
    totalCount: 1n,
    succeededCount: 0n,
    failedCount: 0n,
    stableErrorCode: null,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function target(overrides: Partial<ReturnType<typeof createTarget>> = {}) {
  return { ...createTarget(), ...overrides };
}

function createTarget() {
  return {
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    processingGeneration: GENERATION_ID,
  };
}

function rebuildResult() {
  return {
    embeddingProfileHash: "a".repeat(64),
    chunkingConfigDigest: "b".repeat(64),
    retrievalManifestSha256: "c".repeat(64),
    indexIntegrityDigest: "d".repeat(64),
    parentCount: 2,
    childCount: 3,
  };
}

function recoveryTarget() {
  return {
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    expectedParentCount: 2,
    expectedChildCount: 3,
    expectedEmbeddingProfileHash: "a".repeat(64),
    expectedIndexIntegrityDigest: "d".repeat(64),
  };
}

function recoveryDependencies(input: {
  reconcileActiveDocumentVersion: (
    value: ReturnType<typeof recoveryReconciliationInput>,
  ) => Promise<void>;
}) {
  return {
    index: {
      reconcileActiveDocumentVersion: input.reconcileActiveDocumentVersion,
    },
    currentEmbeddingProfileHash: () => "a".repeat(64),
    runDocumentExclusive: async <T>(
      _documentId: string,
      operation: (signal: AbortSignal) => Promise<T>,
    ) => operation(new AbortController().signal),
  };
}

function recoveryReconciliationInput() {
  return {
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    activeDocumentVersionId: VERSION_ID,
    expectedParentCount: 2,
    expectedChildCount: 3,
    expectedEmbeddingProfileHash: "a".repeat(64),
    expectedIndexIntegrityDigest: "d".repeat(64),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
