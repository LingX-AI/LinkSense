import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { desktopArtifactObjectKey } from "../src/modules/files/desktop-artifact-storage.js";
import {
  FileService,
  resolveVerifiedArtifactMetadata,
  type VerifiedDesktopArtifactInput,
} from "../src/modules/files/service.js";
import { testConfig } from "./test-config.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION_ID = "20000000-0000-4000-8000-000000000002";
const TURN_ID = "40000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "30000000-0000-4000-8000-000000000001";
const DOWNLOAD_CARD_EVENT_ID = "50000000-0000-4000-8000-000000000002";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const PDF_SHA256 = createHash("sha256").update(PDF).digest("hex");
const OBJECT_KEY = `conversations/${CONVERSATION_ID}/artifacts/${ARTIFACT_ID}/content`;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function receipt(
  overrides: Partial<VerifiedDesktopArtifactInput> = {},
): VerifiedDesktopArtifactInput {
  return {
    ownerId: OWNER_ID,
    conversationId: CONVERSATION_ID,
    projectionTurnId: TURN_ID,
    artifactId: ARTIFACT_ID,
    displayName: "季度复盘.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF.byteLength,
    sha256: PDF_SHA256,
    ...overrides,
  };
}

function runningTurn(overrides: Record<string, unknown> = {}) {
  return {
    id: TURN_ID,
    conversationId: CONVERSATION_ID,
    submittedBy: OWNER_ID,
    status: "running",
    interruptRequestedAt: null,
    completedAt: null,
    ...overrides,
  };
}

/** Applies the service's equality filters exactly as the database would. */
function matchTurn(turn: Record<string, unknown>) {
  return async (input: { where: Record<string, unknown> }) =>
    Object.entries(input.where).every(([key, value]) => turn[key] === value)
      ? { id: TURN_ID }
      : null;
}

function committedArtifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_ID,
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    kind: "artifact",
    source: "agent_generated",
    status: "registered",
    filename: "季度复盘.pdf",
    mimeType: "application/pdf",
    sizeBytes: BigInt(PDF.byteLength),
    checksumSha256: PDF_SHA256,
    storageBackend: "minio",
    minioObjectKey: OBJECT_KEY,
    downloadable: true,
    downloadCardEventId: DOWNLOAD_CARD_EVENT_ID,
    ...overrides,
  };
}

function desktopArtifactFixture(
  options: {
    config?: Record<string, string | undefined>;
    userDataRoot?: string;
  } = {},
) {
  const prisma = {
    conversationTurn: {
      findFirst: vi.fn(async () => ({ id: TURN_ID, submittedBy: OWNER_ID })),
    },
    $transaction: vi.fn(),
  };
  const conversations = {
    assertOwner: vi.fn(async () => ({
      id: CONVERSATION_ID,
      ownerId: OWNER_ID,
      archiveStatus: "active",
      executionTarget: "local",
      workspaceRelPath: `${OWNER_ID}/home/workspace`,
    })),
    assertInteractiveFileAccess: vi.fn(async () => undefined),
  };
  const storage = {
    putObject: vi.fn(async () => undefined),
    getObjectSize: vi.fn(async () => PDF.byteLength),
    getObjectStream: vi.fn(),
    getObjectRangeStream: vi.fn(),
    removeObject: vi.fn(async () => undefined),
    presignedGetObject: vi.fn(),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const redis = {
    acquireConversationLock: vi.fn(async () => "desktop-artifact-lock"),
    releaseConversationLock: vi.fn(async () => undefined),
    publishConversationEvent: vi.fn(async () => undefined),
  };
  const cleanup = {
    enqueueObjectDelete: vi.fn(async () => undefined),
    enqueueWorkspaceDirectoryRemoval: vi.fn(async () => undefined),
  };
  const service = new FileService(
    prisma as never,
    conversations as never,
    storage as never,
    audit as never,
    testConfig({
      ...(options.userDataRoot
        ? { LINKSENSE_USER_DATA_ROOT: options.userDataRoot }
        : {}),
      ...options.config,
    }),
    redis as never,
    cleanup,
  );
  return { prisma, conversations, storage, audit, redis, cleanup, service };
}

function desktopArtifactTransactionFixture(
  createdRow: Record<string, unknown> = committedArtifactRow(),
) {
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.length > 0 ? [{ id: CONVERSATION_ID }] : [],
    ),
    $executeRaw: vi.fn(async () => 1),
    conversationTurn: {
      findFirst: vi.fn(matchTurn(runningTurn())),
    },
    conversationFile: {
      findFirst: vi.fn(async () => null as Record<string, unknown> | null),
      create: vi.fn(async () => createdRow),
    },
    conversationEvent: {
      findFirst: vi.fn(async () => ({ sequenceNo: 10n })),
      create: vi.fn(
        async (input: { data: Record<string, unknown> }) => input.data,
      ),
    },
    webArtifactBundle: { create: vi.fn(async () => ({})) },
    auditLog: {
      create: vi.fn(
        async (input: { data: Record<string, unknown> }) => input.data,
      ),
    },
  };
  return tx;
}

function useTransaction(
  fixture: ReturnType<typeof desktopArtifactFixture>,
  tx: ReturnType<typeof desktopArtifactTransactionFixture>,
) {
  fixture.prisma.$transaction.mockImplementationOnce(
    async (operation: (transaction: typeof tx) => Promise<unknown>) =>
      operation(tx),
  );
}

describe("FileService verified desktop artifact registration", () => {
  it("registers a verified desktop artifact under its server-issued identity without touching object storage", async () => {
    const fixture = desktopArtifactFixture();
    const tx = desktopArtifactTransactionFixture();
    useTransaction(fixture, tx);

    const result = await fixture.service.registerVerifiedDesktopArtifact(
      receipt(),
      vi.fn(async () => undefined),
    );

    expect(result).toEqual({
      success: true,
      artifact_id: ARTIFACT_ID,
      file_id: ARTIFACT_ID,
      display_name: "季度复盘.pdf",
      download_card_event_id: DOWNLOAD_CARD_EVENT_ID,
    });
    expect(fixture.redis.acquireConversationLock).toHaveBeenCalledWith(
      CONVERSATION_ID,
      120_000,
    );
    expect(fixture.redis.releaseConversationLock).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "desktop-artifact-lock",
    );
    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
    // No unlocked ownership or turn reads before the locked transaction.
    expect(fixture.conversations.assertOwner).not.toHaveBeenCalled();
    expect(fixture.prisma.conversationTurn.findFirst).not.toHaveBeenCalled();
    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: ARTIFACT_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        kind: "artifact",
        source: "agent_generated",
        status: "registered",
        filename: "季度复盘.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(PDF.byteLength),
        checksumSha256: PDF_SHA256,
        storageBackend: "minio",
        minioObjectKey: OBJECT_KEY,
        downloadable: true,
      }),
    });
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
    expect(fixture.cleanup.enqueueObjectDelete).not.toHaveBeenCalled();

    expect(
      tx.conversationEvent.create.mock.calls.map(
        ([input]) => input.data.eventType,
      ),
    ).toEqual([
      "conversation.system_capability.used",
      "conversation.artifact.created",
    ]);
    const publishedPayloads = JSON.stringify(
      tx.conversationEvent.create.mock.calls.map(([input]) => input.data),
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    );
    expect(publishedPayloads).not.toContain("conversations/");
    expect(publishedPayloads).not.toContain(OBJECT_KEY);
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "conversation_artifact_registered",
        targetType: "conversation_file",
        targetId: ARTIFACT_ID,
        metadataJson: {
          conversation_id: CONVERSATION_ID,
          turn_id: TURN_ID,
          size_bytes: PDF.byteLength,
          mime_type: "application/pdf",
        },
      }),
    });
  });

  it("locks the conversation, fences the run, and reads the running turn before the receipt in one transaction", async () => {
    const fixture = desktopArtifactFixture();
    const tx = desktopArtifactTransactionFixture();
    useTransaction(fixture, tx);
    const order: string[] = [];
    let fencedWith: Prisma.TransactionClient | undefined;
    tx.$queryRaw.mockImplementationOnce(async () => {
      order.push("lock");
      return [{ id: CONVERSATION_ID }];
    });
    const check = vi.fn(async (transaction: Prisma.TransactionClient) => {
      fencedWith = transaction;
      order.push("check");
    });
    const runningLookup = matchTurn(runningTurn());
    tx.conversationTurn.findFirst.mockImplementationOnce(async (input) => {
      order.push("turn");
      return runningLookup(input);
    });
    tx.conversationFile.findFirst.mockImplementationOnce(async () => {
      order.push("receipt");
      return null;
    });
    tx.conversationFile.create.mockImplementationOnce(async () => {
      order.push("create");
      return committedArtifactRow();
    });

    await fixture.service.registerVerifiedDesktopArtifact(receipt(), check);

    expect(order).toEqual(["lock", "check", "turn", "receipt", "create"]);
    expect(check).toHaveBeenCalledOnce();
    expect(fencedWith).toBe(tx);
    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();

    const lockCall = tx.$queryRaw.mock.calls[0];
    const lockSql = lockCall?.[0]?.join("") ?? "";
    expect(lockSql).toContain("owner_id = ");
    expect(lockSql).toContain("archive_status = 'active'");
    expect(lockSql).toContain("execution_target = 'local'");
    expect(lockSql).toContain("FOR UPDATE");
    expect(lockCall).toEqual(
      expect.arrayContaining([CONVERSATION_ID, OWNER_ID]),
    );
    expect(tx.conversationTurn.findFirst).toHaveBeenCalledWith({
      where: {
        id: TURN_ID,
        conversationId: CONVERSATION_ID,
        submittedBy: OWNER_ID,
        status: "running",
        interruptRequestedAt: null,
        completedAt: null,
      },
      select: { id: true },
    });
    expect(tx.conversationFile.findFirst).toHaveBeenCalledWith({
      where: { id: ARTIFACT_ID },
    });
  });

  it("replays an identical committed receipt under a live fence without a second write or event", async () => {
    const fixture = desktopArtifactFixture();
    const tx = desktopArtifactTransactionFixture();
    useTransaction(fixture, tx);
    tx.conversationFile.findFirst.mockResolvedValueOnce(
      committedArtifactRow(),
    );
    const check = vi.fn(async () => undefined);

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(receipt(), check),
    ).resolves.toEqual({
      success: true,
      artifact_id: ARTIFACT_ID,
      file_id: ARTIFACT_ID,
      display_name: "季度复盘.pdf",
      download_card_event_id: DOWNLOAD_CARD_EVENT_ID,
    });

    expect(check).toHaveBeenCalledOnce();
    expect(tx.conversationFile.create).not.toHaveBeenCalled();
    expect(tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
    expect(fixture.cleanup.enqueueObjectDelete).not.toHaveBeenCalled();
  });

  it("fences the run before reading a committed receipt, so a revoked run cannot replay one", async () => {
    const fixture = desktopArtifactFixture();
    const tx = desktopArtifactTransactionFixture();
    useTransaction(fixture, tx);
    tx.conversationFile.findFirst.mockResolvedValueOnce(
      committedArtifactRow(),
    );
    const check = vi.fn(async () => {
      throw new AppError("AUTH_REQUIRED");
    });

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(receipt(), check),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(tx.conversationTurn.findFirst).not.toHaveBeenCalled();
    expect(tx.conversationFile.findFirst).not.toHaveBeenCalled();
    expect(tx.conversationFile.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["terminal", { status: "completed", completedAt: new Date() }],
    ["interrupted", { interruptRequestedAt: new Date() }],
    ["failed", { status: "failed", completedAt: new Date() }],
    ["owned by another user", { submittedBy: OTHER_OWNER_ID }],
  ] as Array<[string, Record<string, unknown> | null]>)(
    "rejects a committed receipt when its turn is %s",
    async (_label, overrides) => {
      const fixture = desktopArtifactFixture();
      const tx = desktopArtifactTransactionFixture();
      useTransaction(fixture, tx);
      if (overrides === null) {
        tx.conversationTurn.findFirst.mockResolvedValueOnce(null);
      } else {
        tx.conversationTurn.findFirst.mockImplementationOnce(
          matchTurn(runningTurn(overrides)),
        );
      }
      tx.conversationFile.findFirst.mockResolvedValueOnce(
        committedArtifactRow(),
      );

      await expect(
        fixture.service.registerVerifiedDesktopArtifact(receipt(), vi.fn()),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(tx.conversationFile.findFirst).not.toHaveBeenCalled();
      expect(tx.conversationFile.create).not.toHaveBeenCalled();
      expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    },
  );

  it("rejects a conversation that is not owned, active, and local inside the locked transaction", async () => {
    const fixture = desktopArtifactFixture();
    const tx = desktopArtifactTransactionFixture();
    useTransaction(fixture, tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    const check = vi.fn(async () => undefined);

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(receipt(), check),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
    expect(tx.conversationTurn.findFirst).not.toHaveBeenCalled();
    expect(tx.conversationFile.findFirst).not.toHaveBeenCalled();
    expect(tx.conversationFile.create).not.toHaveBeenCalled();
    expect(fixture.redis.releaseConversationLock).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "desktop-artifact-lock",
    );
  });

  it.each([
    ["turn", { turnId: null }],
    ["conversation", { conversationId: OTHER_CONVERSATION_ID }],
    ["status", { status: "staged" }],
    ["kind", { kind: "attachment" }],
    ["source", { source: "system_generated" }],
    ["downloadability", { downloadable: false }],
    ["storage backend", { storageBackend: "workspace" }],
    ["object key", { minioObjectKey: `${OBJECT_KEY}.other` }],
    ["display name", { filename: "季度复盘-副本.pdf" }],
    ["mime type", { mimeType: "text/plain" }],
    ["size", { sizeBytes: BigInt(PDF.byteLength + 1) }],
    ["checksum", { checksumSha256: "0".repeat(64) }],
  ] as Array<[string, Record<string, unknown>]>)(
    "rejects a duplicate receipt whose committed %s no longer matches",
    async (_label, overrides) => {
      const fixture = desktopArtifactFixture();
      const tx = desktopArtifactTransactionFixture();
      useTransaction(fixture, tx);
      tx.conversationFile.findFirst.mockResolvedValueOnce(
        committedArtifactRow(overrides),
      );

      await expect(
        fixture.service.registerVerifiedDesktopArtifact(receipt(), vi.fn()),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(tx.conversationFile.create).not.toHaveBeenCalled();
      expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
      expect(fixture.storage.removeObject).not.toHaveBeenCalled();
    },
  );

  it("propagates a rejected run fence on first registration without writing or deleting", async () => {
    const fixture = desktopArtifactFixture();
    const tx = desktopArtifactTransactionFixture();
    useTransaction(fixture, tx);
    const check = vi.fn(async () => {
      throw new AppError("AUTH_REQUIRED");
    });

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(receipt(), check),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    expect(tx.conversationTurn.findFirst).not.toHaveBeenCalled();
    expect(tx.conversationFile.create).not.toHaveBeenCalled();
    expect(tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
    expect(fixture.cleanup.enqueueObjectDelete).not.toHaveBeenCalled();
  });

  it("does not delete the verified object when the registration transaction fails ambiguously", async () => {
    const fixture = desktopArtifactFixture();
    fixture.prisma.$transaction.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    fixture.storage.removeObject.mockRejectedValue(
      new Error("object store unavailable"),
    );

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(receipt(), vi.fn()),
    ).rejects.toThrow("database unavailable");

    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
    expect(fixture.cleanup.enqueueObjectDelete).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["a negative size", { sizeBytes: -1 }],
    ["a fractional size", { sizeBytes: 1.5 }],
    ["an unsafe size", { sizeBytes: Number.MAX_SAFE_INTEGER + 1 }],
    ["a non-UUID artifact id", { artifactId: "artifact-1" }],
    ["a non-UUID conversation id", { conversationId: "conversation-1" }],
    ["a malformed checksum", { sha256: "abc" }],
    ["a blank display name", { displayName: "" }],
  ] as Array<[string, Partial<VerifiedDesktopArtifactInput>]>)(
    "rejects %s before taking the conversation lock",
    async (_label, overrides) => {
      const fixture = desktopArtifactFixture();

      await expect(
        fixture.service.registerVerifiedDesktopArtifact(
          receipt(overrides),
          vi.fn(),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
      expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects a display name that disagrees with the verified MIME type", async () => {
    const fixture = desktopArtifactFixture();

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(
        receipt({ displayName: "季度复盘.txt" }),
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });

    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
  });

  it("rejects an oversized receipt against the configured artifact limit", async () => {
    const fixture = desktopArtifactFixture({
      config: { LINKSENSE_UPLOAD_MAX_FILE_SIZE_MB: "1" },
    });

    await expect(
      fixture.service.registerVerifiedDesktopArtifact(
        receipt({ sizeBytes: 1024 * 1024 + 1 }),
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: "FILE_LIMIT_EXCEEDED" });

    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
  });
});

describe("cloud artifact registration regression", () => {
  it("keeps the workspace artifact publication path unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-cloud-artifact-"));
    temporaryDirectories.push(root);
    const conversationRoot = join(root, OWNER_ID, "home", "workspace");
    await mkdir(conversationRoot, { recursive: true });
    await writeFile(join(conversationRoot, "report.txt"), "artifact");
    const fixture = desktopArtifactFixture({ userDataRoot: root });
    const tx = desktopArtifactTransactionFixture(
      committedArtifactRow({
        filename: "report.txt",
        mimeType: "text/plain",
        sizeBytes: 8n,
        checksumSha256: createHash("sha256").update("artifact").digest("hex"),
        minioObjectKey: `conversations/${CONVERSATION_ID}/artifacts/${ARTIFACT_ID}/report.txt`,
      }),
    );
    useTransaction(fixture, tx);

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "report.txt",
        displayName: "report.txt",
        mimeType: "text/plain",
      }),
    ).resolves.toEqual({
      success: true,
      artifact_id: ARTIFACT_ID,
      file_id: ARTIFACT_ID,
      display_name: "report.txt",
      download_card_event_id: DOWNLOAD_CARD_EVENT_ID,
    });

    expect(fixture.storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/report\\.txt$`,
          "u",
        ),
      ),
      Buffer.from("artifact"),
      { "content-type": "text/plain" },
    );
    expect(
      tx.conversationEvent.create.mock.calls.map(
        ([input]) => input.data.eventType,
      ),
    ).toEqual([
      "conversation.system_capability.used",
      "conversation.artifact.created",
    ]);
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "conversation_artifact_registered",
      }),
    });
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
    expect(fixture.cleanup.enqueueObjectDelete).not.toHaveBeenCalled();
  });
});

describe("resolveVerifiedArtifactMetadata", () => {
  it("resolves the verified MIME type and display name from the bytes", async () => {
    await expect(
      resolveVerifiedArtifactMetadata({ data: PDF, filename: "季度复盘.pdf" }),
    ).resolves.toEqual({
      filename: "季度复盘.pdf",
      mimeType: "application/pdf",
    });
    await expect(
      resolveVerifiedArtifactMetadata({
        data: Buffer.from("plain text"),
        filename: "notes.txt",
      }),
    ).resolves.toEqual({ filename: "notes.txt", mimeType: "text/plain" });
  });

  it("keeps only the basename and applies the extension policy", async () => {
    await expect(
      resolveVerifiedArtifactMetadata({
        data: PDF,
        filename: "nested/dir/季度复盘.pdf",
      }),
    ).resolves.toEqual({
      filename: "季度复盘.pdf",
      mimeType: "application/pdf",
    });
    await expect(
      resolveVerifiedArtifactMetadata({
        data: PDF,
        filename: "季度复盘",
        reportedMimeType: "application/pdf",
      }),
    ).resolves.toEqual({
      filename: "季度复盘.pdf",
      mimeType: "application/pdf",
    });
  });

  it("accepts a generic reported type when the content and extension agree", async () => {
    await expect(
      resolveVerifiedArtifactMetadata({
        data: PDF,
        filename: "季度复盘.pdf",
        reportedMimeType: "application/octet-stream",
      }),
    ).resolves.toEqual({
      filename: "季度复盘.pdf",
      mimeType: "application/pdf",
    });
  });

  it("rejects content that disagrees with the declared name or reported type", async () => {
    await expect(
      resolveVerifiedArtifactMetadata({ data: PDF, filename: "季度复盘.txt" }),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });
    await expect(
      resolveVerifiedArtifactMetadata({
        data: PDF,
        filename: "季度复盘.pdf",
        reportedMimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });
  });
});

describe("desktopArtifactObjectKey", () => {
  it("derives the immutable content key from server-issued identifiers", () => {
    expect(desktopArtifactObjectKey(CONVERSATION_ID, ARTIFACT_ID)).toBe(
      OBJECT_KEY,
    );
    expect(
      desktopArtifactObjectKey(
        CONVERSATION_ID.toUpperCase(),
        ARTIFACT_ID.toUpperCase(),
      ),
    ).toBe(OBJECT_KEY);
  });

  it("rejects identifiers that are not UUIDs", () => {
    for (const call of [
      () => desktopArtifactObjectKey("../../outside", ARTIFACT_ID),
      () => desktopArtifactObjectKey(CONVERSATION_ID, "content"),
    ]) {
      expect(call).toThrow(AppError);
      try {
        call();
      } catch (error) {
        expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
      }
    }
  });
});
