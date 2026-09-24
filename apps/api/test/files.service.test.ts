import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import {
  FileService,
  fileServiceTesting,
} from "../src/modules/files/service.js";
import { testConfig } from "./test-config.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE_CONVERSATION_ID = "20000000-0000-4000-8000-000000000002";
const FILE_ID = "30000000-0000-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const MP3 = Buffer.concat([
  Buffer.from("fffb9064", "hex"),
  Buffer.alloc(1_024),
]);
const MP4 = Buffer.from(
  "000000186674797069736f6d0000020069736f6d69736f32",
  "hex",
);
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
);
const LEGACY_XLS = createLegacyXlsFixture();
const GENERIC_CFB = createGenericCfbFixture();
const OVERSIZED_CFB = createOversizedCfbFixture();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileService workspace and MIME boundaries", () => {
  it("searches historical filenames without matching task titles and keeps a stable cursor", async () => {
    const fixture = await fileFixture();
    const first = { ...taskArtifactRow({ conversationId: SOURCE_CONVERSATION_ID }), kind: "artifact" };
    const second = { ...taskArtifactRow({ id: "30000000-0000-4000-8000-000000000002", conversationId: SOURCE_CONVERSATION_ID, createdAt: new Date("2026-08-09T08:00:00Z") }), kind: "attachment" };
    fixture.prisma.$queryRaw.mockResolvedValueOnce([first, second]);

    const page = await fixture.service.listReferenceableFiles(OWNER_ID, {
      search: "result", excludeConversationId: CONVERSATION_ID, limit: 1,
    });

    expect(page.items).toEqual([expect.objectContaining({ id: FILE_ID, task: expect.objectContaining({ title: "季度材料整理" }) })]);
    expect(page.next_cursor).toBe(`${first.createdAt.toISOString()}|${FILE_ID}`);
    const query = fixture.prisma.$queryRaw.mock.calls[0]?.[0];
    expect(query?.text).toContain("c.owner_id = CAST(");
    expect(query?.text).toContain("f.source = 'user_upload'");
    expect(query?.text).toContain("f.status = 'bound'");
    expect(query?.text).toContain("f.status = 'registered'");
    expect(query?.text).toContain("f.conversation_id <> CAST(");
    expect(query?.values).toContain(OWNER_ID);
    expect(query?.values).toContain(CONVERSATION_ID);
    expect(query?.text).toContain("strpos(lower(f.filename)");
    expect(query?.text).not.toContain("strpos(lower(c.title)");
    expect(query?.values).toContain("result");
  });

  it("copies a verified generated file into the current task's staged attachments", async () => {
    const fixture = await fileFixture();
    const data = Buffer.from("previous task result");
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce({
      id: FILE_ID, conversationId: SOURCE_CONVERSATION_ID,
      kind: "artifact", source: "agent_generated", status: "registered",
      downloadable: true, storageBackend: "minio", minioObjectKey: "artifacts/result.txt",
      workspaceRootRelPath: null, workspaceRelativePath: null,
      filename: "result.txt", mimeType: "text/plain", sizeBytes: BigInt(data.length),
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    });
    fixture.storage.getObjectSize.mockResolvedValueOnce(data.length);
    fixture.storage.getObjectStream.mockResolvedValueOnce(Readable.from([data]));
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx),
    );

    await expect(fixture.service.referenceFile(OWNER_ID, CONVERSATION_ID, FILE_ID, {}))
      .resolves.toMatchObject({ filename: "result.txt", status: "staged" });
    expect(tx.conversationFile.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      conversationId: CONVERSATION_ID, kind: "attachment", status: "staged",
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    }) });
    expect(fixture.conversations.assertOwner).toHaveBeenCalledWith(OWNER_ID, SOURCE_CONVERSATION_ID);
  });

  it("copies a verified historical upload without trusting a symlink or changed bytes", async () => {
    const fixture = await fileFixture();
    const data = Buffer.from("previous upload");
    await mkdir(join(fixture.conversationRoot, "attachments/source"), { recursive: true });
    await writeFile(join(fixture.conversationRoot, "attachments/source/notes.txt"), data);
    fixture.prisma.conversationFile.findFirst.mockResolvedValue({
      id: FILE_ID, conversationId: SOURCE_CONVERSATION_ID,
      kind: "attachment", source: "user_upload", status: "bound",
      downloadable: false, storageBackend: "workspace", minioObjectKey: null,
      workspaceRootRelPath: `${OWNER_ID}/home/workspace`,
      workspaceRelativePath: "attachments/source/notes.txt",
      filename: "notes.txt", mimeType: "text/plain", sizeBytes: BigInt(data.length),
      checksumSha256: createHash("sha256").update(data).digest("hex"),
    });
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx),
    );
    await expect(fixture.service.referenceFile(OWNER_ID, CONVERSATION_ID, FILE_ID, {}))
      .resolves.toMatchObject({ filename: "notes.txt", status: "staged" });

    await writeFile(join(fixture.conversationRoot, "attachments/source/notes.txt"), "changed bytes...");
    await expect(fixture.service.referenceFile(OWNER_ID, CONVERSATION_ID, FILE_ID, {}))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    await rm(join(fixture.conversationRoot, "attachments/source/notes.txt"));
    await symlink(join(fixture.root, "outside.txt"), join(fixture.conversationRoot, "attachments/source/notes.txt"));
    await expect(fixture.service.referenceFile(OWNER_ID, CONVERSATION_ID, FILE_ID, {}))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects another owner's file and a staged historical upload", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValue({
      id: FILE_ID, conversationId: SOURCE_CONVERSATION_ID,
      kind: "attachment", source: "user_upload", status: "staged", sizeBytes: 5n,
    });
    await expect(fixture.service.referenceFile(OWNER_ID, CONVERSATION_ID, FILE_ID, {}))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    fixture.conversations.assertOwner
      .mockResolvedValueOnce({ id: CONVERSATION_ID, ownerId: OWNER_ID, workspaceRelPath: `${OWNER_ID}/home/workspace` })
      .mockRejectedValueOnce(new AppError("FORBIDDEN"));
    await expect(fixture.service.referenceFile(OWNER_ID, CONVERSATION_ID, FILE_ID, {}))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
  });
  it("registers a complete website snapshot atomically with its HTML artifact", async () => {
    const fixture = await fileFixture();
    await mkdir(join(fixture.conversationRoot, "site"));
    await writeFile(join(fixture.conversationRoot, "site/index.html"), '<!doctype html><script src="app.js"></script>');
    await writeFile(join(fixture.conversationRoot, "site/app.js"), 'document.title="Published";');
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx));
    await fixture.service.registerArtifact({ ownerId: OWNER_ID, conversationId: CONVERSATION_ID, codexTurnId: "codex-turn-1", workspaceRelativePath: "site/index.html", displayName: "index.html", mimeType: "text/html", webRootRelativePath: "site" });
    expect(tx.webArtifactBundle.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: OWNER_ID, conversationId: CONVERSATION_ID, manifestJson: expect.objectContaining({ entry_path: "index.html", files: expect.arrayContaining([expect.objectContaining({ path: "app.js" }), expect.objectContaining({ path: "index.html" })]) }) }) });
    expect(fixture.storage.putObject).toHaveBeenCalledTimes(3);
    expect(fixture.storage.removeObject).not.toHaveBeenCalled();
  });
  it("lists only the authenticated owner's registered artifacts with a stable cursor", async () => {
    const fixture = await fileFixture();
    const firstCreatedAt = new Date("2026-08-10T08:30:00.000Z");
    const secondCreatedAt = new Date("2026-08-09T07:20:00.000Z");
    fixture.prisma.$queryRaw.mockResolvedValueOnce([
      taskArtifactRow({
        id: FILE_ID,
        createdAt: firstCreatedAt,
        filename: "季度总结.pptx",
      }),
      taskArtifactRow({
        id: "30000000-0000-4000-8000-000000000002",
        createdAt: secondCreatedAt,
        conversationTitle: "未命名对话",
        conversationTitleSource: "fallback",
        filename: "分析结果.pdf",
      }),
      taskArtifactRow({
        id: "30000000-0000-4000-8000-000000000003",
        createdAt: new Date("2026-08-08T06:10:00.000Z"),
      }),
    ]);

    await expect(
      fixture.service.listTaskArtifacts(OWNER_ID, {
        search: "总结",
        limit: 2,
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: FILE_ID,
          conversation_id: CONVERSATION_ID,
          filename: "季度总结.pptx",
          downloadable: true,
          task: {
            id: CONVERSATION_ID,
            title: "季度材料整理",
            archive_status: "active",
          },
        }),
        expect.objectContaining({
          id: "30000000-0000-4000-8000-000000000002",
          filename: "分析结果.pdf",
          task: expect.objectContaining({ title: "未命名任务" }),
        }),
      ],
      next_cursor: `${secondCreatedAt.toISOString()}|30000000-0000-4000-8000-000000000002`,
    });
    expect(fixture.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(fixture.prisma.$queryRaw.mock.calls[0]),
    ).toContain("总结");
  });

  it("rejects malformed task artifact cursors before querying storage", async () => {
    const fixture = await fileFixture();

    await expect(
      fixture.service.listTaskArtifacts(OWNER_ID, {
        cursor: "not-a-cursor",
        limit: 50,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fixture.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("applies file type, keyword, ownership and cursor filters before limiting the artifact page", async () => {
    const fixture = await fileFixture();
    const createdAt = new Date("2026-08-10T08:30:00.000Z");
    fixture.prisma.$queryRaw.mockResolvedValueOnce([
      taskArtifactRow({ filename: "report.DOCX", createdAt }),
      taskArtifactRow({
        filename: "next.doc",
        id: "30000000-0000-4000-8000-000000000002",
      }),
    ]);

    const page = await fixture.service.listTaskArtifacts(OWNER_ID, {
      fileType: "word",
      search: "report",
      cursor: `2026-08-11T00:00:00.000Z|${FILE_ID}`,
      limit: 1,
    });

    expect(page.items.map((item) => item.filename)).toEqual(["report.DOCX"]);
    expect(page.next_cursor).toBe(`${createdAt.toISOString()}|${FILE_ID}`);
    const query = fixture.prisma.$queryRaw.mock.calls[0]?.[0];
    expect(query).toBeDefined();
    expect(query?.text).toContain("c.owner_id = CAST(");
    expect(query?.text).toContain("f.status = 'registered'");
    expect(query?.text).toContain("f.downloadable = TRUE");
    expect(query?.text).toContain("f.created_at < ");
    expect(query?.text).toContain("strpos(lower(f.filename)");
    expect(query?.text).toContain("strpos(lower(c.title)");
    expect(query?.text).toMatch(
      /AND COALESCE\([\s\S]+ORDER BY f.created_at DESC, f.id DESC\s+LIMIT/u,
    );
    expect(query?.values).toContain(OWNER_ID);
    expect(query?.values).toContain("report");
    expect(query?.values.slice(-2)).toEqual(["word", 2]);
  });

  it("registers a valid workspace artifact and emits its capability and download-card events", async () => {
    const fixture = await fileFixture();
    await writeFile(join(fixture.conversationRoot, "report.txt"), "artifact");
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    const result = await fixture.service.registerArtifact({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      codexTurnId: "codex-turn-1",
      workspaceRelativePath: "report.txt",
      displayName: "report.txt",
      mimeType: "text/plain",
    });

    expect(result).toMatchObject({
      success: true,
      artifact_id: FILE_ID,
      file_id: FILE_ID,
      display_name: "report.txt",
      download_card_event_id: "50000000-0000-4000-8000-000000000002",
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
    expect(tx.conversationEvent.create).toHaveBeenCalledTimes(2);
    expect(
      tx.conversationEvent.create.mock.calls.map(
        ([input]) => input.data.eventType,
      ),
    ).toEqual([
      "conversation.system_capability.used",
      "conversation.artifact.created",
    ]);
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledTimes(2);
    expect(fixture.cleanup.enqueueObjectDelete).not.toHaveBeenCalled();
    expect(fixture.prisma.conversationTurn.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        submittedBy: OWNER_ID,
        status: "running",
      },
    });
  });

  it.each([
    ["MP3 audio", "welcome.mp3", "audio/mpeg", MP3],
    ["MP4 video", "welcome.mp4", "video/mp4", MP4],
  ])(
    "registers %s directly even when the attachment allowlist excludes media",
    async (_label, filename, mimeType, data) => {
      const fixture = await fileFixture({
        LINKSENSE_UPLOAD_ALLOWED_TYPES: "text/plain",
      });
      await writeFile(join(fixture.conversationRoot, filename), data);
      const tx = artifactTransactionFixture();
      fixture.prisma.$transaction.mockImplementationOnce(
        async (operation: (transaction: typeof tx) => Promise<unknown>) =>
          operation(tx),
      );

      await expect(
        fixture.service.registerArtifact({
          ownerId: OWNER_ID,
          conversationId: CONVERSATION_ID,
          codexTurnId: "codex-turn-1",
          workspaceRelativePath: filename,
          displayName: filename,
          mimeType,
        }),
      ).resolves.toMatchObject({ success: true });

      expect(fixture.storage.putObject).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/${filename}$`,
            "u",
          ),
        ),
        data,
        { "content-type": mimeType },
      );
      expect(tx.conversationFile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          filename,
          mimeType,
          downloadable: true,
          storageBackend: "minio",
        }),
      });
    },
  );

  it("registers an SVG artifact even when the legacy artifact allowlist excludes SVG", async () => {
    const fixture = await fileFixture({
      LINKSENSE_ARTIFACT_ALLOWED_TYPES: "application/pdf",
    });
    await writeFile(join(fixture.conversationRoot, "preview.svg"), SVG);
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "preview.svg",
        displayName: "preview.svg",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(fixture.storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/preview\\.svg$`,
          "u",
        ),
      ),
      SVG,
      { "content-type": "image/svg+xml" },
    );
    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "preview.svg",
        mimeType: "image/svg+xml",
        downloadable: true,
        storageBackend: "minio",
      }),
    });
  });

  it("registers an unknown artifact format as a generic downloadable file", async () => {
    const fixture = await fileFixture();
    const data = Buffer.from("custom binary payload");
    await writeFile(join(fixture.conversationRoot, "model.custom"), data);
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "model.custom",
        displayName: "model.custom",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(fixture.storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/model\\.custom$`,
          "u",
        ),
      ),
      data,
      { "content-type": "application/octet-stream" },
    );
    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "model.custom",
        mimeType: "application/octet-stream",
        downloadable: true,
        storageBackend: "minio",
      }),
    });
  });

  it("uses a reported MIME type for an unknown artifact format when it is structured", async () => {
    const fixture = await fileFixture();
    const data = Buffer.from("glb payload");
    await writeFile(join(fixture.conversationRoot, "scene.glb"), data);
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "scene.glb",
        displayName: "scene.glb",
        mimeType: "model/gltf-binary",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(fixture.storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/scene\\.glb$`,
          "u",
        ),
      ),
      data,
      { "content-type": "model/gltf-binary" },
    );
  });

  it("records inline image registrations without exposing a server path", async () => {
    const fixture = await fileFixture();
    await writeFile(join(fixture.conversationRoot, "preview.png"), PNG);
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await fixture.service.registerArtifact({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      codexTurnId: "codex-turn-1",
      workspaceRelativePath: "preview.png",
      displayName: "inline-image-1.png",
      mimeType: "image/png",
      artifactKind: "inline_image",
    });

    expect(tx.conversationEvent.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            safe_summary: "registered inline message image",
          }),
        }),
      }),
    );
    expect(
      JSON.stringify(tx.conversationEvent.create.mock.calls, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(fixture.conversationRoot);
  });

  it("rejects artifact registration when the active turn is not owned by the routed user", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationTurn.findFirst.mockResolvedValueOnce(null);

    await expect(
      fixture.service.registerArtifact({
        ownerId: OTHER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "report.txt",
        displayName: "report.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fixture.prisma.conversationTurn.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        submittedBy: OTHER_ID,
        status: "running",
      },
    });
    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("uploads application files through the existing workspace pipeline with a separate source", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx));
    await expect(fixture.service.uploadAttachment(OWNER_ID, CONVERSATION_ID, { filename: "notes.txt", data: Buffer.from("notes"), interactive: true }, {})).resolves.toMatchObject({ source: "interactive_application_upload", status: "staged" });
    expect(fixture.conversations.assertInteractiveFileAccess).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    expect(tx.conversationFile.create).toHaveBeenCalledWith({ data: expect.objectContaining({ source: "interactive_application_upload", status: "staged", createdBy: OWNER_ID }) });
  });

  it("returns only safe application file metadata and restores staged and bound files", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findMany.mockResolvedValue([{ id: FILE_ID, filename: "notes.txt", mimeType: "text/plain", sizeBytes: 5n, status: "bound", turnId: CONVERSATION_ID, workspaceRelativePath: "private/path", checksumSha256: "secret" }]);
    await expect(fixture.service.listInteractiveAttachments(OWNER_ID, CONVERSATION_ID)).resolves.toEqual({ items: [{ id: FILE_ID, filename: "notes.txt", mime_type: "text/plain", size_bytes: 5, status: "bound", turn_id: CONVERSATION_ID }] });
    expect(fixture.prisma.conversationFile.findMany).toHaveBeenCalledWith({ where: { conversationId: CONVERSATION_ID, kind: "attachment", source: "interactive_application_upload", status: { in: ["staged", "bound"] } }, orderBy: { createdAt: "asc" } });
  });

  it("denies application file upload, listing and removal without permission", async () => {
    const fixture = await fileFixture();
    fixture.conversations.assertInteractiveFileAccess.mockRejectedValue(new AppError("FORBIDDEN"));
    await expect(fixture.service.uploadAttachment(OWNER_ID, CONVERSATION_ID, { filename: "notes.txt", data: Buffer.from("notes"), interactive: true }, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fixture.service.listInteractiveAttachments(OWNER_ID, CONVERSATION_ID)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fixture.service.deleteStagedAttachments(OWNER_ID, CONVERSATION_ID, [FILE_ID], {}, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
    expect(fixture.prisma.conversationFile.findMany).not.toHaveBeenCalled();
  });

  it("rejects removal of already submitted application attachments", async () => {
    const fixture = await fileFixture();
    const tx = { $queryRaw: vi.fn(async () => []), conversationFile: { deleteMany: vi.fn() } };
    fixture.prisma.$transaction.mockImplementationOnce(async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx));
    await expect(fixture.service.deleteStagedAttachments(OWNER_ID, CONVERSATION_ID, [FILE_ID], {}, true)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.conversationFile.deleteMany).not.toHaveBeenCalled();
  });

  it("stores a detectable attachment by its actual MIME when its filename extension disagrees", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "looks-like-text.txt",
          reportedMimeType: "text/plain",
          data: PNG,
        },
        {},
      ),
    ).resolves.toMatchObject({
      filename: "looks-like-text.txt",
      mime_type: "image/png",
    });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "looks-like-text.txt",
        mimeType: "image/png",
      }),
    });
  });

  it("stages an upload directly on the task", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "new-task.txt",
          reportedMimeType: "text/plain",
          data: Buffer.from("new task attachment"),
        },
        {},
      ),
    ).resolves.toMatchObject({ filename: "new-task.txt" });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: CONVERSATION_ID,
        status: "staged",
      }),
    });
  });

  it("accepts an unknown attachment format even when the legacy allowlist is narrow", async () => {
    const fixture = await fileFixture({
      LINKSENSE_UPLOAD_ALLOWED_TYPES: "text/plain",
    });
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "model.weights",
          reportedMimeType: "application/octet-stream",
          data: Buffer.from("unknown binary payload"),
        },
        {},
      ),
    ).resolves.toMatchObject({
      filename: "model.weights",
      mime_type: "application/octet-stream",
    });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "model.weights",
        mimeType: "application/octet-stream",
      }),
    });
  });

  it("accepts a verified legacy XLS attachment when Finder reports a generic MIME type", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "医保审计模型库.xls",
          reportedMimeType: "application/octet-stream",
          data: LEGACY_XLS,
        },
        {},
      ),
    ).resolves.toMatchObject({
      filename: "医保审计模型库.xls",
      mime_type: "application/vnd.ms-excel",
    });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "医保审计模型库.xls",
        mimeType: "application/vnd.ms-excel",
      }),
    });
  });

  it.each([
    ["audio alias", "voice.wav", "audio/x-wav", "audio/wav"],
    ["audio webm", "meeting.weba", "audio/webm", "audio/webm"],
    ["matroska video", "clip.mkv", "video/x-matroska", "video/x-matroska"],
    [
      "7z archive",
      "materials.7z",
      "application/x-7z-compressed",
      "application/x-7z-compressed",
    ],
    [
      "RAR archive",
      "bundle.rar",
      "application/x-rar-compressed",
      "application/vnd.rar",
    ],
  ] as const)(
    "accepts %s attachments",
    async (_label, filename, reportedMimeType, expectedMimeType) => {
      const fixture = await fileFixture();
      const tx = attachmentUploadTransactionFixture();
      fixture.prisma.$transaction.mockImplementationOnce(
        async (operation: (transaction: typeof tx) => Promise<unknown>) =>
          operation(tx),
      );

      await expect(
        fixture.service.uploadAttachment(
          OWNER_ID,
          CONVERSATION_ID,
          {
            filename,
            reportedMimeType,
            data: Buffer.from("attachment bytes"),
          },
          {},
        ),
      ).resolves.toMatchObject({
        filename,
        mime_type: expectedMimeType,
      });

      expect(tx.conversationFile.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          filename,
          mimeType: expectedMimeType,
        }),
      });
    },
  );

  it("accepts an unclassified compound file renamed as legacy XLS by its actual MIME", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "not-an-excel-file.xls",
          reportedMimeType: "application/octet-stream",
          data: GENERIC_CFB,
        },
        {},
      ),
    ).resolves.toMatchObject({
      filename: "not-an-excel-file.xls",
      mime_type: "application/x-cfb",
    });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "not-an-excel-file.xls",
        mimeType: "application/x-cfb",
      }),
    });
  });

  it("accepts a compound file with an oversized directory reference by its actual MIME", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "unsafe.xls",
          reportedMimeType: "application/octet-stream",
          data: OVERSIZED_CFB,
        },
        {},
      ),
    ).resolves.toMatchObject({
      filename: "unsafe.xls",
      mime_type: "application/x-cfb",
    });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "unsafe.xls",
        mimeType: "application/x-cfb",
      }),
    });
  });

  it("stores a PNG renamed as legacy XLS by its actual MIME type", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: "not-an-excel-file.xls",
          reportedMimeType: "application/octet-stream",
          data: PNG,
        },
        {},
      ),
    ).resolves.toMatchObject({
      filename: "not-an-excel-file.xls",
      mime_type: "image/png",
    });

    expect(tx.conversationFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "not-an-excel-file.xls",
        mimeType: "image/png",
      }),
    });
  });

  it("rejects meaningless temporary attachment files before writing metadata", async () => {
    const fixture = await fileFixture();

    await expect(
      fixture.service.uploadAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        {
          filename: ".DS_Store",
          reportedMimeType: "application/octet-stream",
          data: Buffer.from("metadata"),
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "ATTACHMENT_TEMPORARY_FILE_SKIPPED" });

    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("registers a verified legacy XLS artifact when its reported MIME type is generic", async () => {
    const fixture = await fileFixture();
    await writeFile(join(fixture.conversationRoot, "legacy.xls"), LEGACY_XLS);
    const tx = artifactTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "legacy.xls",
        displayName: "legacy.xls",
        mimeType: "application/octet-stream",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(fixture.storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/legacy\\.xls$`,
          "u",
        ),
      ),
      LEGACY_XLS,
      { "content-type": "application/vnd.ms-excel" },
    );
  });

  it("creates uploaded attachments with owner and worker-group read permissions only", async () => {
    const fixture = await fileFixture();
    const tx = attachmentUploadTransactionFixture();
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await fixture.service.uploadAttachment(
      OWNER_ID,
      CONVERSATION_ID,
      {
        filename: "notes.txt",
        reportedMimeType: "text/plain",
        data: Buffer.from("attachment"),
      },
      {},
    );

    const attachmentIds = await readdir(
      join(fixture.conversationRoot, "attachments"),
    );
    expect(attachmentIds).toHaveLength(1);
    const uploaded = await stat(
      join(
        fixture.conversationRoot,
        "attachments",
        attachmentIds[0]!,
        "notes.txt",
      ),
    );
    expect(uploaded.mode & 0o777).toBe(0o640);
    expect(
      (
        await stat(
          join(
            fixture.conversationRoot,
            "attachments",
            attachmentIds[0]!,
          ),
        )
      ).mode & 0o7777,
    ).toBe(0o2770);
  });

  it("rejects parent traversal before reading or uploading an artifact", async () => {
    const fixture = await fileFixture();
    const outside = join(fixture.root, "outside.txt");
    await writeFile(outside, "outside");

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "../outside.txt",
        displayName: "outside.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("resolves symlinks and rejects an artifact that escapes the conversation workspace", async () => {
    const fixture = await fileFixture();
    const outside = join(fixture.root, "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, join(fixture.conversationRoot, "linked.txt"));

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "linked.txt",
        displayName: "linked.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(fixture.storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects an artifact when detected content conflicts with its extension and reported MIME", async () => {
    const fixture = await fileFixture();
    await writeFile(join(fixture.conversationRoot, "artifact.txt"), PNG);

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "artifact.txt",
        displayName: "artifact.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });

    expect(fixture.storage.putObject).not.toHaveBeenCalled();
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires a regular file and rejects directories before attempting to read or upload", async () => {
    const fixture = await fileFixture();
    await mkdir(join(fixture.conversationRoot, "artifact-directory"));

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "artifact-directory",
        displayName: "artifact.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });

    expect(fixture.storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects an artifact that changes between the bounded read checks", async () => {
    const fixture = await fileFixture();
    const artifact = join(fixture.conversationRoot, "changing.txt");
    await writeFile(artifact, "initial");
    const initialStats = await lstat(artifact);

    await expect(
      fileServiceTesting.readStableRegularFile(
        artifact,
        initialStats,
        {
          maximumBytes: 1_024,
          invalidFileError: () =>
            new AppError("ARTIFACT_REGISTRATION_INVALID"),
          fileTooLargeError: () => new AppError("FILE_LIMIT_EXCEEDED"),
          afterInitialStat: async () => appendFile(artifact, "-changed"),
        },
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });
  });

  it("rejects a known conflicting display extension even when the workspace file MIME is valid", async () => {
    const fixture = await fileFixture();
    await writeFile(
      join(fixture.conversationRoot, "artifact.pdf"),
      Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
    );

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "artifact.pdf",
        displayName: "report.txt",
        mimeType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });

    expect(fixture.storage.putObject).not.toHaveBeenCalled();
  });

  it("queues attachment-directory cleanup when the database delete commits but local removal fails", async () => {
    const fixture = await fileFixture();
    const relativePath = "attachments/file-1/notes.txt";
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce({
      id: FILE_ID,
      conversationId: CONVERSATION_ID,
      kind: "attachment",
      status: "staged",
      workspaceRelativePath: relativePath,
        workspaceRootRelPath: `${OWNER_ID}/home/workspace`,
    });
    fixture.prisma.$transaction.mockResolvedValueOnce({
      files: [{
        id: FILE_ID,
        conversationId: CONVERSATION_ID,
        kind: "attachment",
        status: "staged",
        workspaceRelativePath: relativePath,
        workspaceRootRelPath: `${OWNER_ID}/home/workspace`,
      }],
      events: [fileEvent()],
    });
    fixture.removeDirectory.mockRejectedValueOnce(new Error("filesystem busy"));

    await expect(
      fixture.service.deleteStagedAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        {},
      ),
    ).resolves.toBeUndefined();

    expect(
      fixture.cleanup.enqueueWorkspaceDirectoryRemoval,
    ).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      join(fixture.conversationRoot, "attachments", "file-1"),
    );
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledOnce();
  });

  it("treats removal of an attachment protected by a durable turn-start intent as an idempotent no-op", async () => {
    const fixture = await fileFixture();
    const tx = {
      $queryRaw: vi
        .fn<() => Promise<Array<Record<string, unknown>>>>()
        .mockResolvedValueOnce([{ id: FILE_ID }])
        .mockResolvedValueOnce([{ id: FILE_ID }]),
      conversationFile: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      conversationEvent: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.deleteStagedAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        {},
      ),
    ).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const protectedReferenceQuery = (
      tx.$queryRaw.mock.calls[1] as unknown as [readonly string[]]
    )[0].join("");
    expect(protectedReferenceQuery).toContain("attachments_json");
    expect(protectedReferenceQuery).toContain("message_display_json");
    expect(tx.conversationFile.findMany).not.toHaveBeenCalled();
    expect(tx.conversationFile.deleteMany).not.toHaveBeenCalled();
    expect(tx.conversationEvent.create).not.toHaveBeenCalled();
    expect(fixture.removeDirectory).not.toHaveBeenCalled();
    expect(fixture.redis.publishConversationEvent).not.toHaveBeenCalled();
  });

  it("deletes an exact attachment batch under one conversation lock and one transaction", async () => {
    const fixture = await fileFixture();
    const secondFileId = "30000000-0000-4000-8000-000000000002";
    const files = [
      {
        id: FILE_ID,
        conversationId: CONVERSATION_ID,
        kind: "attachment",
        status: "staged",
        workspaceRelativePath: null,
      },
      {
        id: secondFileId,
        conversationId: CONVERSATION_ID,
        kind: "attachment",
        status: "staged",
        workspaceRelativePath: null,
      },
    ];
    const tx = {
      $queryRaw: vi
        .fn<() => Promise<Array<Record<string, unknown>>>>()
        .mockResolvedValueOnce(files.map(({ id }) => ({ id })))
        .mockResolvedValueOnce([]),
      $executeRaw: vi.fn(async () => 1),
      conversationFile: {
        findMany: vi.fn(async () => files),
        deleteMany: vi.fn(async () => ({ count: files.length })),
      },
      conversationEvent: {
        findFirst: vi.fn().mockResolvedValueOnce(null),
        createManyAndReturn: vi.fn(
          async ({ data }: { data: Array<Record<string, unknown>> }) =>
            data.map((event, index) => ({
              ...fileEvent(),
              ...event,
              id: `50000000-0000-4000-8000-00000000000${index + 1}`,
            })),
        ),
      },
      auditLog: {
        createMany: vi.fn(
          async ({ data }: { data: Array<Record<string, unknown>> }) => ({
            count: data.length,
          }),
        ),
      },
    };
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await expect(
      fixture.service.deleteStagedAttachments(
        OWNER_ID,
        CONVERSATION_ID,
        [FILE_ID, secondFileId, FILE_ID],
        {},
      ),
    ).resolves.toBeUndefined();

    expect(fixture.redis.acquireConversationLock).toHaveBeenCalledOnce();
    expect(fixture.prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.conversationFile.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [FILE_ID, secondFileId] } },
    });
    expect(tx.conversationEvent.createManyAndReturn).toHaveBeenCalledOnce();
    expect(tx.auditLog.createMany).toHaveBeenCalledOnce();
    expect(
      tx.conversationEvent.createManyAndReturn.mock.calls[0]?.[0].data
    ).toHaveLength(2);
    expect(tx.auditLog.createMany.mock.calls[0]?.[0].data).toHaveLength(2);
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledTimes(2);
  });

  it("deletes only unprotected files when a batch contains a durable turn-start attachment", async () => {
    const fixture = await fileFixture();
    const secondFileId = "30000000-0000-4000-8000-000000000002";
    const deletableFile = {
      id: secondFileId,
      conversationId: CONVERSATION_ID,
      kind: "attachment",
      status: "staged",
      workspaceRelativePath: null,
    };
    const tx = {
      $queryRaw: vi
        .fn<() => Promise<Array<Record<string, unknown>>>>()
        .mockResolvedValueOnce([{ id: FILE_ID }, { id: secondFileId }])
        .mockResolvedValueOnce([{ id: FILE_ID }]),
      $executeRaw: vi.fn(async () => 1),
      conversationFile: {
        findMany: vi.fn(async () => [deletableFile]),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      conversationEvent: {
        findFirst: vi.fn(async () => null),
        createManyAndReturn: vi.fn(
          async ({ data }: { data: Array<Record<string, unknown>> }) =>
            data.map((event) => ({ ...fileEvent(), ...event })),
        ),
      },
      auditLog: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    fixture.prisma.$transaction.mockImplementationOnce(
      async (operation: (transaction: typeof tx) => Promise<unknown>) =>
        operation(tx),
    );

    await fixture.service.deleteStagedAttachments(
      OWNER_ID,
      CONVERSATION_ID,
      [FILE_ID, secondFileId],
      {},
    );

    expect(tx.conversationFile.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [secondFileId] },
        conversationId: CONVERSATION_ID,
        kind: "attachment",
        status: "staged",
      },
      orderBy: { id: "asc" },
    });
    expect(tx.conversationFile.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [secondFileId] } },
    });
    expect(tx.conversationEvent.createManyAndReturn).toHaveBeenCalledOnce();
    expect(tx.auditLog.createMany).toHaveBeenCalledOnce();
    expect(fixture.redis.publishConversationEvent).toHaveBeenCalledOnce();
  });

  it("waits for a busy conversation lock instead of exposing a technical conflict", async () => {
    vi.useFakeTimers();
    try {
      const fixture = await fileFixture();
      fixture.redis.acquireConversationLock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("retried-file-lock");
      fixture.prisma.$transaction.mockResolvedValueOnce({
        files: [],
        events: [],
      });

      const deletion = fixture.service.deleteStagedAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        {},
      );
      await vi.advanceTimersByTimeAsync(50);

      await expect(deletion).resolves.toBeUndefined();
      expect(fixture.redis.acquireConversationLock).toHaveBeenCalledTimes(2);
      expect(fixture.redis.releaseConversationLock).toHaveBeenCalledWith(
        CONVERSATION_ID,
        "retried-file-lock",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes concurrent attachment removals without returning a conflict", async () => {
    vi.useFakeTimers();
    try {
      const fixture = await fileFixture();
      let lockHeld = false;
      let lockSequence = 0;
      let releaseFirstTransaction!: () => void;
      let markFirstTransactionStarted!: () => void;
      const firstTransactionStarted = new Promise<void>((resolvePromise) => {
        markFirstTransactionStarted = resolvePromise;
      });
      const firstTransactionGate = new Promise<void>((resolvePromise) => {
        releaseFirstTransaction = resolvePromise;
      });

      fixture.redis.acquireConversationLock.mockImplementation(async () => {
        if (lockHeld) return null;
        lockHeld = true;
        lockSequence += 1;
        return `conversation-lock-${lockSequence}`;
      });
      fixture.redis.releaseConversationLock.mockImplementation(async () => {
        lockHeld = false;
      });
      fixture.prisma.$transaction
        .mockImplementationOnce(async () => {
          markFirstTransactionStarted();
          await firstTransactionGate;
          return { files: [], events: [] };
        })
        .mockResolvedValueOnce({ files: [], events: [] });

      const firstDeletion = fixture.service.deleteStagedAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        {},
      );
      await firstTransactionStarted;
      const secondDeletion = fixture.service.deleteStagedAttachment(
        OWNER_ID,
        CONVERSATION_ID,
        "30000000-0000-4000-8000-000000000002",
        {},
      );

      await vi.waitFor(() => {
        expect(fixture.redis.acquireConversationLock).toHaveBeenCalledTimes(2);
      });
      releaseFirstTransaction();
      await firstDeletion;
      await vi.advanceTimersByTimeAsync(50);

      await expect(secondDeletion).resolves.toBeUndefined();
      expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(fixture.redis.releaseConversationLock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues object cleanup when artifact persistence and immediate object removal both fail", async () => {
    const fixture = await fileFixture();
    await writeFile(join(fixture.conversationRoot, "report.txt"), "artifact");
    fixture.prisma.$transaction.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    fixture.storage.removeObject.mockRejectedValueOnce(
      new Error("object store unavailable"),
    );

    await expect(
      fixture.service.registerArtifact({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        codexTurnId: "codex-turn-1",
        workspaceRelativePath: "report.txt",
        displayName: "report.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toThrow("database unavailable");

    expect(fixture.cleanup.enqueueObjectDelete).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `^conversations/${CONVERSATION_ID}/artifacts/[0-9a-f-]+/report\\.txt$`,
          "u",
        ),
      ),
    );
  });
});

describe("FileService attachment previews", () => {
  it("returns original verified staged image bytes without acquiring a conversation write lock", async () => {
    const fixture = await fileFixture();
    await stageAttachmentImage(fixture);

    const result = await fixture.service.readAttachmentPreviewContent(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );

    expect(result).toEqual({
      data: PNG,
      filename: "preview.png",
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
    });
    expect(fixture.conversations.assertOwner).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
    );
    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
    expect(fixture.redis.releaseConversationLock).not.toHaveBeenCalled();
    expect(fixture.prisma.conversationFile.findFirst).toHaveBeenCalledWith({
      where: {
        id: FILE_ID,
        conversationId: CONVERSATION_ID,
        kind: "attachment",
        status: { in: ["staged", "bound"] },
        storageBackend: "workspace",
      },
      select: {
        filename: true,
        mimeType: true,
        status: true,
        sizeBytes: true,
        checksumSha256: true,
        workspaceRelativePath: true,
        workspaceRootRelPath: true,
      },
    });
  });

  it("returns original verified image bytes after the attachment is bound to a turn", async () => {
    const fixture = await fileFixture();
    await stageAttachmentImage(fixture, { status: "bound" });

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).resolves.toEqual({
      data: PNG,
      filename: "preview.png",
      mimeType: "image/png",
      sizeBytes: PNG.byteLength,
    });
  });

  it("returns a verified bound XLSX attachment for the shared document preview", async () => {
    const fixture = await fileFixture();
    const spreadsheet = Buffer.from("xlsx-content");
    await stageAttachmentImage(fixture, {
      data: spreadsheet,
      filename: "出差费用明细.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      status: "bound",
    });

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).resolves.toEqual({
      data: spreadsheet,
      filename: "出差费用明细.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: spreadsheet.byteLength,
    });
  });

  it("returns verified bound media for the shared read-only preview", async () => {
    const fixture = await fileFixture();
    await stageAttachmentImage(fixture, {
      data: MP3,
      filename: "会议录音.mp3",
      mimeType: "audio/mpeg",
      status: "bound",
    });

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).resolves.toEqual({
      data: MP3,
      filename: "会议录音.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: MP3.byteLength,
    });
  });

  it("rejects attachment statuses outside staged and bound even if the repository boundary is bypassed", async () => {
    const fixture = await fileFixture();
    await stageAttachmentImage(fixture, { status: "pending" });

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });

  it("rejects a non-owner before looking up attachment metadata", async () => {
    const fixture = await fileFixture();
    fixture.conversations.assertOwner.mockRejectedValueOnce(
      new AppError("CONVERSATION_NOT_FOUND"),
    );

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OTHER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect(fixture.prisma.conversationFile.findFirst).not.toHaveBeenCalled();
  });

  it("does not return an unsupported binary row even if the repository boundary is bypassed", async () => {
    const fixture = await fileFixture();
    await stageAttachmentImage(fixture, {
      filename: "payload.bin",
      mimeType: "application/octet-stream",
    });

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });

  it("rejects a stored path that escapes the conversation workspace without exposing it", async () => {
    const fixture = await fileFixture();
    const outside = join(fixture.root, "outside.png");
    await writeFile(outside, PNG);
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      attachmentImageRow({ workspaceRelativePath: "../outside.png" }),
    );

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });

  it("rejects symbolic links even when their target remains inside the conversation workspace", async () => {
    const fixture = await fileFixture();
    const target = join(fixture.conversationRoot, "original.png");
    const relativePath = "attachments/file-1/linked.png";
    const link = join(fixture.conversationRoot, relativePath);
    await writeFile(target, PNG);
    await mkdir(join(fixture.conversationRoot, "attachments", "file-1"), {
      recursive: true,
    });
    await symlink(target, link);
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      attachmentImageRow({ workspaceRelativePath: relativePath }),
    );

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });

  it("rejects directories instead of reading them as image content", async () => {
    const fixture = await fileFixture();
    const relativePath = "attachments/file-1/directory.png";
    await mkdir(join(fixture.conversationRoot, relativePath), {
      recursive: true,
    });
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      attachmentImageRow({ workspaceRelativePath: relativePath }),
    );

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });

  it.each([
    ["stored size", { sizeBytes: BigInt(PNG.byteLength + 1) }],
    ["stored checksum", { checksumSha256: "0".repeat(64) }],
  ])("rejects content that does not match its %s", async (_label, row) => {
    const fixture = await fileFixture();
    await stageAttachmentImage(fixture, row);

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });

  it("rejects bytes whose detected MIME no longer matches the stored image MIME", async () => {
    const fixture = await fileFixture();
    const replaced = Buffer.from("not an image");
    await stageAttachmentImage(fixture, {
      data: replaced,
      sizeBytes: BigInt(replaced.byteLength),
      checksumSha256: checksum(replaced),
    });

    await expect(
      fixture.service.readAttachmentPreviewContent(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "NOT_FOUND" });
  });
});

describe("FileService artifact direct previews", () => {
  it("issues an owner-only short-lived image link without taking a write lock or writing download audit", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow(),
    );
    fixture.storage.presignedGetObject.mockResolvedValueOnce(
      "https://signed.example/preview.png?signature=secret",
    );

    const result = await fixture.service.createArtifactPreviewLink(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );

    expect(result).toMatchObject({
      url: "https://signed.example/preview.png?signature=secret",
      filename: "preview.png",
    });
    expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now());
    expect(fixture.conversations.assertOwner).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
    );
    expect(fixture.prisma.conversationFile.findFirst).toHaveBeenCalledWith({
      where: {
        id: FILE_ID,
        conversationId: CONVERSATION_ID,
        kind: "artifact",
        downloadable: true,
        storageBackend: "minio",
        mimeType: {
          in: [
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/avif",
            "image/svg+xml",
            "audio/mpeg",
            "audio/mp4",
            "audio/wav",
            "audio/ogg",
            "audio/opus",
            "audio/aac",
            "audio/flac",
            "audio/webm",
            "audio/aiff",
            "audio/3gpp",
            "audio/3gpp2",
            "video/mp4",
            "video/webm",
            "video/ogg",
            "video/quicktime",
            "video/x-matroska",
            "video/x-msvideo",
            "video/mpeg",
            "video/3gpp",
            "video/3gpp2",
          ],
        },
      },
      select: {
        filename: true,
        kind: true,
        downloadable: true,
        storageBackend: true,
        mimeType: true,
        minioObjectKey: true,
        sizeBytes: true,
      },
    });
    expect(fixture.storage.getObjectSize).toHaveBeenCalledWith(
      "conversations/private/preview.png",
    );
    expect(fixture.storage.presignedGetObject).toHaveBeenCalledWith(
      "conversations/private/preview.png",
      7_200,
    );
    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
    expect(fixture.redis.releaseConversationLock).not.toHaveBeenCalled();
    expect(fixture.audit.write).not.toHaveBeenCalled();
  });

  it("issues a short-lived image preview link for a matching SVG artifact", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "chart.svg",
        mimeType: "image/svg+xml",
        minioObjectKey: "conversations/private/chart.svg",
        sizeBytes: 12n,
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(12);
    fixture.storage.presignedGetObject.mockResolvedValueOnce(
      "https://signed.example/chart.svg?signature=secret",
    );

    await expect(
      fixture.service.createArtifactPreviewLink(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).resolves.toMatchObject({
      url: "https://signed.example/chart.svg?signature=secret",
      filename: "chart.svg",
    });

    expect(fixture.storage.presignedGetObject).toHaveBeenCalledWith(
      "conversations/private/chart.svg",
      7_200,
    );
  });

  it("rejects a non-owner before looking up artifact metadata and does not write download rejection audit", async () => {
    const fixture = await fileFixture();
    fixture.conversations.assertOwner.mockRejectedValueOnce(
      new AppError("CONVERSATION_NOT_FOUND"),
    );

    await expect(
      fixture.service.createArtifactPreviewLink(
        OTHER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect(fixture.prisma.conversationFile.findFirst).not.toHaveBeenCalled();
    expect(fixture.storage.presignedGetObject).not.toHaveBeenCalled();
    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
    expect(fixture.audit.write).not.toHaveBeenCalled();
  });

  it("issues a short-lived direct URL for a browser-playable video after verifying its stored size", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "demo.mp4",
        mimeType: "video/mp4",
        minioObjectKey: "conversations/private/demo.mp4",
        sizeBytes: 24n,
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(24);
    fixture.storage.presignedGetObject.mockResolvedValueOnce(
      "https://signed.example/demo.mp4?signature=secret",
    );

    await expect(
      fixture.service.createArtifactPreviewLink(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).resolves.toMatchObject({
      url: "https://signed.example/demo.mp4?signature=secret",
      filename: "demo.mp4",
    });

    expect(fixture.storage.getObjectSize).toHaveBeenCalledWith(
      "conversations/private/demo.mp4",
    );
    expect(fixture.storage.presignedGetObject).toHaveBeenCalledWith(
      "conversations/private/demo.mp4",
      7_200,
    );
  });

  it.each([
    ["non-image artifact", artifactPreviewRow({ mimeType: "text/plain" })],
    ["image attachment", artifactPreviewRow({ kind: "attachment" })],
    [
      "non-downloadable image artifact",
      artifactPreviewRow({ downloadable: false }),
    ],
    [
      "workspace image artifact",
      artifactPreviewRow({ storageBackend: "workspace" }),
    ],
    [
      "image artifact without an object key",
      artifactPreviewRow({ minioObjectKey: null }),
    ],
    [
      "artifact whose filename does not match its preview MIME",
      artifactPreviewRow({ filename: "preview.txt" }),
    ],
    [
      "compressed SVG artifact",
      artifactPreviewRow({
        filename: "preview.svgz",
        mimeType: "image/svg+xml",
      }),
    ],
  ])(
    "rejects a %s even if the repository boundary is bypassed",
    async (_label, row) => {
      const fixture = await fileFixture();
      fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(row);

      await expect(
        fixture.service.createArtifactPreviewLink(
          OWNER_ID,
          CONVERSATION_ID,
          FILE_ID,
        ),
      ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

      expect(fixture.storage.presignedGetObject).not.toHaveBeenCalled();
      expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
      expect(fixture.audit.write).not.toHaveBeenCalled();
    },
  );

  it("does not issue a direct URL when the stored object size changed", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow(),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(11);

    await expect(
      fixture.service.createArtifactPreviewLink(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

    expect(fixture.storage.presignedGetObject).not.toHaveBeenCalled();
  });
});

describe("FileService artifact preview document content", () => {
  const presentationMimeType =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

  it("returns owner-only PPTX bytes without issuing a public link or taking a write lock", async () => {
    const fixture = await fileFixture();
    const presentation = Buffer.from("pptx-content");
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "季度复盘.pptx",
        mimeType: presentationMimeType,
        minioObjectKey: "conversations/private/review.pptx",
      }),
    );
    const presentationStream = Readable.from(presentation);
    fixture.storage.getObjectSize.mockResolvedValueOnce(
      presentation.byteLength,
    );
    fixture.storage.getObjectStream.mockResolvedValueOnce(presentationStream);

    const result = await fixture.service.readArtifactPreviewDocument(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );

    expect(result).toEqual({
      data: presentationStream,
      filename: "季度复盘.pptx",
      mimeType: presentationMimeType,
      sizeBytes: presentation.byteLength,
    });
    expect(fixture.prisma.conversationFile.findFirst).toHaveBeenCalledWith({
      where: {
        id: FILE_ID,
        conversationId: CONVERSATION_ID,
        kind: "artifact",
        downloadable: true,
        storageBackend: "minio",
      },
      select: {
        filename: true,
        kind: true,
        downloadable: true,
        storageBackend: true,
        mimeType: true,
        minioObjectKey: true,
        sizeBytes: true,
      },
    });
    expect(fixture.storage.getObjectStream).toHaveBeenCalledWith(
      "conversations/private/review.pptx",
    );
    expect(fixture.storage.getObjectSize).toHaveBeenCalledWith(
      "conversations/private/review.pptx",
    );
    expect(fixture.storage.presignedGetObject).not.toHaveBeenCalled();
    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
    expect(fixture.audit.write).not.toHaveBeenCalled();
  });

  it.each([
    [
      "DOCX",
      "服务端方案.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "conversations/private/plan.docx",
    ],
    [
      "XLSX",
      "服务端预算.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "conversations/private/budget.xlsx",
    ],
    ["HTML", "静态页面.html", "text/html", "conversations/private/page.html"],
    [
      "ZIP",
      "交付资料.zip",
      "application/zip",
      "conversations/private/deliverables.zip",
    ],
    [
      "PDF",
      "分析报告.pdf",
      "application/pdf",
      "conversations/private/report.pdf",
    ],
    [
      "TypeScript source",
      "preview.ts",
      "text/plain",
      "conversations/private/preview.ts",
    ],
    ["CSV", "records.csv", "text/csv", "conversations/private/records.csv"],
    [
      "JSON",
      "settings.json",
      "application/json",
      "conversations/private/settings.json",
    ],
  ] as const)(
    "returns owner-only %s bytes",
    async (_label, filename, mimeType, objectKey) => {
      const fixture = await fileFixture();
      const content = Buffer.from(filename);
      const stream = Readable.from(content);
      fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
        artifactPreviewRow({
          filename,
          mimeType,
          minioObjectKey: objectKey,
          sizeBytes: BigInt(content.byteLength),
        }),
      );
      fixture.storage.getObjectSize.mockResolvedValueOnce(content.byteLength);
      fixture.storage.getObjectStream.mockResolvedValueOnce(stream);

      const result = await fixture.service.readArtifactPreviewDocument(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      );

      expect(result).toEqual({
        data: stream,
        filename,
        mimeType,
        sizeBytes: content.byteLength,
      });
      expect(fixture.storage.getObjectStream).toHaveBeenCalledWith(objectKey);
    },
  );

  it.each([
    [
      ".env example",
      "firecrawl-.env.example",
      "application/octet-stream",
      "text/plain",
      "PORT=3002\nUSE_DB_AUTHENTICATION=false\n",
    ],
    [
      "extensionless config file",
      "Dockerfile",
      "application/octet-stream",
      "text/plain",
      "FROM node:22\n",
    ],
    [
      "unknown extension with explicit text MIME",
      "runtime.vars",
      "text/plain",
      "text/plain",
      "DATABASE_URL=postgres://example\n",
    ],
  ] as const)(
    "returns owner-only text bytes for %s",
    async (_label, filename, storedMimeType, responseMimeType, text) => {
      const fixture = await fileFixture();
      const content = Buffer.from(text);
      const stream = Readable.from(content);
      const objectKey = `conversations/private/${filename}`;
      fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
        artifactPreviewRow({
          filename,
          mimeType: storedMimeType,
          minioObjectKey: objectKey,
          sizeBytes: BigInt(content.byteLength),
        }),
      );
      fixture.storage.getObjectSize.mockResolvedValueOnce(content.byteLength);
      fixture.storage.getObjectStream.mockResolvedValueOnce(stream);

      const result = await fixture.service.readArtifactPreviewDocument(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      );

      expect(result).toEqual({
        data: stream,
        filename,
        mimeType: responseMimeType,
        sizeBytes: content.byteLength,
      });
      expect(fixture.storage.getObjectStream).toHaveBeenCalledWith(objectKey);
    },
  );

  it("allows a ZIP archive at the 50 MiB preview boundary", async () => {
    const fixture = await fileFixture();
    const archiveSize = 50 * 1024 * 1024;
    const stream = Readable.from([]);
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "deliverables.zip",
        mimeType: "application/zip",
        minioObjectKey: "conversations/private/deliverables.zip",
        sizeBytes: BigInt(archiveSize),
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(archiveSize);
    fixture.storage.getObjectStream.mockResolvedValueOnce(stream);

    const result = await fixture.service.readArtifactPreviewDocument(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
    );

    expect(result).toEqual({
      data: stream,
      filename: "deliverables.zip",
      mimeType: "application/zip",
      sizeBytes: archiveSize,
    });
  });

  it("allows a PDF at the 50 MiB preview boundary", async () => {
    const fixture = await fileFixture();
    const pdfSize = 50 * 1024 * 1024;
    const stream = Readable.from([]);
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "report.pdf",
        mimeType: "application/pdf",
        minioObjectKey: "conversations/private/report.pdf",
        sizeBytes: BigInt(pdfSize),
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(pdfSize);
    fixture.storage.getObjectStream.mockResolvedValueOnce(stream);

    await expect(
      fixture.service.readArtifactPreviewDocument(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).resolves.toEqual({
      data: stream,
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdfSize,
    });
  });

  it("rejects a non-owner before reading object storage", async () => {
    const fixture = await fileFixture();
    fixture.conversations.assertOwner.mockRejectedValueOnce(
      new AppError("CONVERSATION_NOT_FOUND"),
    );

    await expect(
      fixture.service.readArtifactPreviewDocument(
        OTHER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect(fixture.prisma.conversationFile.findFirst).not.toHaveBeenCalled();
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
    expect(fixture.storage.getObjectSize).not.toHaveBeenCalled();
  });

  it("rejects an object whose stored size no longer matches its database metadata", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "季度复盘.pptx",
        mimeType: presentationMimeType,
        minioObjectKey: "conversations/private/review.pptx",
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(11);

    await expect(
      fixture.service.readArtifactPreviewDocument(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-Office artifact", artifactPreviewRow()],
    [
      "an Office MIME whose extension disagrees",
      artifactPreviewRow({
        filename: "review.docx",
        mimeType: presentationMimeType,
      }),
    ],
    [
      "a ZIP MIME whose extension disagrees",
      artifactPreviewRow({
        filename: "archive.txt",
        mimeType: "application/zip",
      }),
    ],
    [
      "a non-standard ZIP MIME",
      artifactPreviewRow({
        filename: "archive.zip",
        mimeType: "application/x-zip-compressed",
      }),
    ],
    [
      "a PPTX attachment",
      artifactPreviewRow({
        kind: "attachment",
        mimeType: presentationMimeType,
      }),
    ],
    [
      "a non-downloadable PPTX artifact",
      artifactPreviewRow({
        downloadable: false,
        mimeType: presentationMimeType,
      }),
    ],
    [
      "a workspace PPTX artifact",
      artifactPreviewRow({
        storageBackend: "workspace",
        mimeType: presentationMimeType,
      }),
    ],
    [
      "a PPTX artifact without an object key",
      artifactPreviewRow({
        mimeType: presentationMimeType,
        minioObjectKey: null,
      }),
    ],
    [
      "an empty PPTX artifact",
      artifactPreviewRow({ mimeType: presentationMimeType, sizeBytes: 0n }),
    ],
    [
      "an oversized PPTX artifact",
      artifactPreviewRow({
        mimeType: presentationMimeType,
        sizeBytes: 100n * 1024n * 1024n + 1n,
      }),
    ],
    [
      "an HTML artifact above the bounded preview limit",
      artifactPreviewRow({
        filename: "large.html",
        mimeType: "text/html",
        sizeBytes: 10n * 1024n * 1024n + 1n,
      }),
    ],
    [
      "a ZIP artifact above the bounded preview limit",
      artifactPreviewRow({
        filename: "large.zip",
        mimeType: "application/zip",
        sizeBytes: 50n * 1024n * 1024n + 1n,
      }),
    ],
    [
      "a text artifact above the bounded preview limit",
      artifactPreviewRow({
        filename: "large.ts",
        mimeType: "text/plain",
        sizeBytes: 5n * 1024n * 1024n + 1n,
      }),
    ],
    [
      "a PDF artifact above the bounded preview limit",
      artifactPreviewRow({
        filename: "large.pdf",
        mimeType: "application/pdf",
        sizeBytes: 50n * 1024n * 1024n + 1n,
      }),
    ],
    [
      "an unknown binary-ish octet-stream artifact",
      artifactPreviewRow({
        filename: "archive.custom-binary",
        mimeType: "application/octet-stream",
      }),
    ],
    [
      "a binary extension mislabeled as text",
      artifactPreviewRow({
        filename: "image.png",
        mimeType: "text/plain",
      }),
    ],
  ])(
    "rejects %s even if the repository boundary is bypassed",
    async (_label, row) => {
      const fixture = await fileFixture();
      fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(row);

      await expect(
        fixture.service.readArtifactPreviewDocument(
          OWNER_ID,
          CONVERSATION_ID,
          FILE_ID,
        ),
      ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

      expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
      expect(fixture.storage.getObjectSize).not.toHaveBeenCalled();
    },
  );
});

describe("FileService artifact media streams", () => {
  it("streams one verified media range without buffering the full object", async () => {
    const fixture = await fileFixture();
    const stream = Readable.from(Buffer.from("media-range"));
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "demo.mp4",
        mimeType: "video/mp4",
        minioObjectKey: "conversations/private/demo.mp4",
        sizeBytes: 128n,
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(128);
    fixture.storage.getObjectRangeStream.mockResolvedValueOnce(stream);

    const result = await fixture.service.readArtifactPreviewMedia(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
      { type: "from", start: 10, end: 25 },
    );

    expect(result).toEqual({
      data: stream,
      filename: "demo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 128,
      range: { start: 10, end: 25 },
    });
    expect(fixture.storage.getObjectRangeStream).toHaveBeenCalledWith(
      "conversations/private/demo.mp4",
      10,
      16,
    );
    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
    expect(fixture.storage.presignedGetObject).not.toHaveBeenCalled();
    expect(fixture.redis.acquireConversationLock).not.toHaveBeenCalled();
  });

  it("streams the verified full media object when no Range is requested", async () => {
    const fixture = await fileFixture();
    const stream = Readable.from(Buffer.from("full-media"));
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "audio.mp3",
        mimeType: "audio/mpeg",
        minioObjectKey: "conversations/private/audio.mp3",
        sizeBytes: 96n,
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(96);
    fixture.storage.getObjectStream.mockResolvedValueOnce(stream);

    await expect(
      fixture.service.readArtifactPreviewMedia(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        { type: "full" },
      ),
    ).resolves.toEqual({
      data: stream,
      filename: "audio.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: 96,
      range: null,
    });

    expect(fixture.storage.getObjectStream).toHaveBeenCalledWith(
      "conversations/private/audio.mp3",
    );
    expect(fixture.storage.getObjectRangeStream).not.toHaveBeenCalled();
  });

  it("resolves a suffix byte range against the verified object size", async () => {
    const fixture = await fileFixture();
    const stream = Readable.from(Buffer.from("suffix"));
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "audio.mp3",
        mimeType: "audio/mpeg",
        minioObjectKey: "conversations/private/audio.mp3",
        sizeBytes: 100n,
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(100);
    fixture.storage.getObjectRangeStream.mockResolvedValueOnce(stream);

    await expect(
      fixture.service.readArtifactPreviewMedia(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        { type: "suffix", length: 15 },
      ),
    ).resolves.toMatchObject({ range: { start: 85, end: 99 } });

    expect(fixture.storage.getObjectRangeStream).toHaveBeenCalledWith(
      "conversations/private/audio.mp3",
      85,
      15,
    );
  });

  it.each([
    ["a start beyond the object", { type: "from", start: 100 }],
    ["an end before the start", { type: "from", start: 10, end: 9 }],
  ] as const)("returns 416 for %s", async (_label, requestedRange) => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({
        filename: "audio.mp3",
        mimeType: "audio/mpeg",
        minioObjectKey: "conversations/private/audio.mp3",
        sizeBytes: 100n,
      }),
    );
    fixture.storage.getObjectSize.mockResolvedValueOnce(100);

    await expect(
      fixture.service.readArtifactPreviewMedia(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        requestedRange,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusOverride: 416 });

    expect(fixture.storage.getObjectStream).not.toHaveBeenCalled();
    expect(fixture.storage.getObjectRangeStream).not.toHaveBeenCalled();
  });

  it("rejects a non-media artifact before reading object storage", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
      artifactPreviewRow({ mimeType: "text/plain", filename: "preview.ts" }),
    );

    await expect(
      fixture.service.readArtifactPreviewMedia(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        { type: "full" },
      ),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });

    expect(fixture.storage.getObjectSize).not.toHaveBeenCalled();
  });
});

describe("artifact preview media Range parsing", () => {
  it.each([
    [undefined, { type: "full" }],
    ["bytes=0-499", { type: "from", start: 0, end: 499 }],
    ["bytes=500-", { type: "from", start: 500 }],
    ["bytes=-128", { type: "suffix", length: 128 }],
  ] as const)("parses %j", (value, expected) => {
    expect(fileServiceTesting.parseArtifactPreviewMediaRange(value)).toEqual(
      expected,
    );
  });

  it.each(["bytes=0-1,2-3", "items=0-1", "bytes=-0", "bytes=8-4"])(
    "rejects unsupported single range syntax %s with 416",
    (value) => {
      expect(() =>
        fileServiceTesting.parseArtifactPreviewMediaRange(value),
      ).toThrow(
        expect.objectContaining({
          code: "VALIDATION_ERROR",
          statusOverride: 416,
        }),
      );
    },
  );
});

describe("FileService download authorization audit", () => {
  it("uses the same non-disclosing owner failure for administrators and records a safe rejection audit", async () => {
    const fixture = await fileFixture();
    fixture.conversations.assertOwner.mockRejectedValueOnce(
      new AppError("CONVERSATION_NOT_FOUND"),
    );

    await expect(
      fixture.service.createDownloadLink(OTHER_ID, CONVERSATION_ID, FILE_ID, {
        ipAddress: "192.0.2.1",
        userAgent: "Admin Browser",
      }),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });

    expect(fixture.prisma.conversationFile.findFirst).not.toHaveBeenCalled();
    expect(fixture.storage.presignedGetObject).not.toHaveBeenCalled();
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OTHER_ID,
        action: "artifact_download_link_rejected",
        targetId: FILE_ID,
        result: "rejected",
        metadata: {
          conversation_id: CONVERSATION_ID,
          reason_code: "CONVERSATION_NOT_FOUND",
        },
      }),
    );
  });

  it("issues an owner-only short-lived link and never places its URL or object key in audit metadata", async () => {
    const fixture = await fileFixture();
    fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce({
      id: FILE_ID,
      conversationId: CONVERSATION_ID,
      kind: "artifact",
      downloadable: true,
      minioObjectKey: "conversations/private/artifact.pdf",
      filename: "report.pdf",
    });
    fixture.storage.presignedGetObject.mockResolvedValueOnce(
      "https://signed.example/private?signature=secret",
    );

    const result = await fixture.service.createDownloadLink(
      OWNER_ID,
      CONVERSATION_ID,
      FILE_ID,
      { ipAddress: "192.0.2.2", userAgent: "Owner Browser" },
    );

    expect(result).toMatchObject({
      url: "https://signed.example/private?signature=secret",
      filename: "report.pdf",
    });
    expect(fixture.storage.presignedGetObject).toHaveBeenCalledWith(
      "conversations/private/artifact.pdf",
      7_200,
    );
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        action: "artifact_download_link_issued",
        targetId: FILE_ID,
        result: "success",
        metadata: {
          conversation_id: CONVERSATION_ID,
          expires_seconds: 7_200,
        },
      }),
    );
    const serializedAudit = JSON.stringify(fixture.audit.write.mock.calls);
    expect(serializedAudit).not.toContain("signed.example");
    expect(serializedAudit).not.toContain("artifact.pdf");
    expect(serializedAudit).not.toContain("signature");
  });

  it.each([
    ["audio/mpeg", "voice.mp3"],
    ["application/octet-stream", "archive.custom"],
  ])(
    "streams an owner-only %s artifact without exposing its object key",
    async (mimeType, filename) => {
      const fixture = await fileFixture();
      fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
        artifactPreviewRow({
          filename,
          mimeType,
          minioObjectKey: `conversations/private/${filename}`,
          sizeBytes: 12n,
        }),
      );
      fixture.storage.getObjectSize.mockResolvedValueOnce(12);
      const stream = Readable.from("file-content");
      fixture.storage.getObjectStream.mockResolvedValueOnce(stream);

      const result = await fixture.service.readArtifactDownload(
        OWNER_ID,
        CONVERSATION_ID,
        FILE_ID,
        { ipAddress: "192.0.2.3", userAgent: "Owner Browser" },
      );

      expect(result).toEqual({
        data: stream,
        filename,
        mimeType,
        sizeBytes: 12,
      });
      expect(fixture.storage.getObjectStream).toHaveBeenCalledWith(
        `conversations/private/${filename}`,
      );
      expect(fixture.audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: OWNER_ID,
          action: "artifact_download_started",
          targetId: FILE_ID,
          result: "success",
          metadata: {
            conversation_id: CONVERSATION_ID,
            size_bytes: 12,
            mime_type: mimeType,
          },
        }),
      );
      expect(JSON.stringify(fixture.audit.write.mock.calls)).not.toContain(
        `conversations/private/${filename}`,
      );
    },
  );
});

async function fileFixture(
  configOverrides: Record<string, string | undefined> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "linksense-files-test-"));
  temporaryDirectories.push(root);
  const conversationRoot = join(
    root,
    OWNER_ID,
    "home",
    "workspace",
  );
  await mkdir(conversationRoot, { recursive: true });
  const prisma = {
    conversationFile: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [] as Array<Record<string, unknown>>),
      findFirst: vi.fn(async () => null as Record<string, unknown> | null),
    },
    conversationTurn: {
      findFirst: vi.fn<
        (input: {
          where: Record<string, unknown>;
        }) => Promise<{ id: string; submittedBy: string } | null>
      >(async () => ({
        id: "40000000-0000-4000-8000-000000000001",
        submittedBy: OWNER_ID,
      })),
    },
    $queryRaw: vi.fn<
      (query: Prisma.Sql) => Promise<Record<string, unknown>[]>
    >(async () => []),
    $transaction: vi.fn(),
  };
  const conversations = {
    assertInteractiveFileAccess: vi.fn(async () => undefined),
    assertOwner: vi.fn(async () => ({
      id: CONVERSATION_ID,
      ownerId: OWNER_ID,
      workspaceRelPath: `${OWNER_ID}/home/workspace`,
    })),
  };
  const storage = {
    putObject: vi.fn(async () => undefined),
    getObjectSize: vi.fn(async () => 12),
    getObjectStream: vi.fn(async () => Readable.from([])),
    getObjectRangeStream: vi.fn(async () => Readable.from([])),
    removeObject: vi.fn(async () => undefined),
    presignedGetObject: vi.fn(async () => "https://signed.example"),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const redis = {
    acquireConversationLock: vi.fn(
      async (): Promise<string | null> => "file-lock",
    ),
    releaseConversationLock: vi.fn(async () => undefined),
    publishConversationEvent: vi.fn(async () => undefined),
  };
  const cleanup = {
    enqueueObjectDelete: vi.fn(async () => undefined),
    enqueueWorkspaceDirectoryRemoval: vi.fn(async () => undefined),
  };
  const removeDirectory = vi.fn((absolutePath: string) =>
    rm(absolutePath, { recursive: true, force: true }),
  );
  const service = new FileService(
    prisma as never,
    conversations as never,
    storage as never,
    audit as never,
    testConfig({
      LINKSENSE_USER_DATA_ROOT: root,
      ...configOverrides,
    }),
    redis as never,
    cleanup,
    removeDirectory,
  );
  return {
    root,
    conversationRoot,
    prisma,
    conversations,
    storage,
    audit,
    redis,
    cleanup,
    removeDirectory,
    service,
  };
}

function taskArtifactRow(
  overrides: Partial<{
    id: string;
    conversationId: string;
    conversationTitle: string;
    conversationTitleSource: string;
    conversationArchiveStatus: string;
    turnId: string | null;
    source: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: bigint;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: FILE_ID,
    conversationId: CONVERSATION_ID,
    conversationTitle: "季度材料整理",
    conversationTitleSource: "generated",
    conversationArchiveStatus: "active",
    turnId: "40000000-0000-4000-8000-000000000001",
    source: "agent_generated",
    filename: "result.txt",
    mimeType: "text/plain",
    sizeBytes: 12n,
    createdAt: new Date("2026-08-10T08:30:00.000Z"),
    updatedAt: new Date("2026-08-10T08:30:00.000Z"),
    ...overrides,
  };
}

function fileEvent() {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    conversationId: CONVERSATION_ID,
    turnId: null,
    sequenceNo: 1n,
    eventType: "conversation.file.updated",
    visibility: "user_visible",
    payloadJson: { schema_version: 1, file_id: FILE_ID, status: "removed" },
    sseEventId: `${CONVERSATION_ID}:1`,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
  };
}

function artifactPreviewRow(
  overrides: Partial<{
    filename: string;
    kind: string;
    downloadable: boolean;
    storageBackend: string;
    mimeType: string;
    minioObjectKey: string | null;
    sizeBytes: bigint;
  }> = {},
) {
  return {
    filename: "preview.png",
    kind: "artifact",
    downloadable: true,
    storageBackend: "minio",
    mimeType: "image/png",
    minioObjectKey: "conversations/private/preview.png",
    sizeBytes: 12n,
    ...overrides,
  };
}

function artifactTransactionFixture() {
  const artifact = {
    id: FILE_ID,
    conversationId: CONVERSATION_ID,
    turnId: "40000000-0000-4000-8000-000000000001",
    filename: "report.txt",
    mimeType: "text/plain",
    sizeBytes: 8n,
    downloadCardEventId: "50000000-0000-4000-8000-000000000002",
  };
  return {
    $executeRaw: vi.fn(async () => 1),
    conversationEvent: {
      findFirst: vi.fn(async () => ({ sequenceNo: 10n })),
      create: vi.fn(
        async (input: { data: Record<string, unknown> }) => input.data,
      ),
    },
    webArtifactBundle: { create: vi.fn(async () => ({})) },
    conversationFile: {
      create: vi.fn(async () => artifact),
    },
    auditLog: {
      create: vi.fn(
        async (input: { data: Record<string, unknown> }) => input.data,
      ),
    },
  };
}

function attachmentUploadTransactionFixture() {
  const createdAt = new Date("2026-07-11T00:00:00.000Z");
  return {
    $queryRaw: vi.fn(async () => [{ id: CONVERSATION_ID }]),
    $executeRaw: vi.fn(async () => 1),
    conversationFile: {
      create: vi.fn(async (input: { data: Record<string, unknown> }) => ({
        ...input.data,
        pendingRequestId: null,
        turnId: null,
        createdAt,
        updatedAt: createdAt,
      })),
    },
    conversationEvent: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (input: { data: Record<string, unknown> }) => ({
        id: "50000000-0000-4000-8000-000000000003",
        turnId: null,
        createdAt,
        ...input.data,
      })),
    },
    auditLog: {
      create: vi.fn(
        async (input: { data: Record<string, unknown> }) => input.data,
      ),
    },
  };
}

type FileFixture = Awaited<ReturnType<typeof fileFixture>>;

async function stageAttachmentImage(
  fixture: FileFixture,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { data: candidateData, ...rowOverrides } = overrides;
  const data = Buffer.isBuffer(candidateData) ? candidateData : PNG;
  const filename =
    typeof rowOverrides.filename === "string"
      ? rowOverrides.filename
      : "preview.png";
  const relativePath = `attachments/file-1/${filename}`;
  const target = join(fixture.conversationRoot, relativePath);
  await mkdir(join(fixture.conversationRoot, "attachments", "file-1"), {
    recursive: true,
  });
  await writeFile(target, data);
  fixture.prisma.conversationFile.findFirst.mockResolvedValueOnce(
    attachmentImageRow({
      workspaceRelativePath: relativePath,
      sizeBytes: BigInt(data.byteLength),
      checksumSha256: checksum(data),
      ...rowOverrides,
    }),
  );
}

function attachmentImageRow(overrides: Record<string, unknown> = {}) {
  return {
    filename: "preview.png",
    mimeType: "image/png",
    status: "staged",
    sizeBytes: BigInt(PNG.byteLength),
    checksumSha256: checksum(PNG),
    workspaceRelativePath: "attachments/file-1/preview.png",
    workspaceRootRelPath: `${OWNER_ID}/home/workspace`,
    ...overrides,
  };
}

function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function createLegacyXlsFixture(): Buffer {
  const data = createGenericCfbFixture();
  Buffer.from("2008020000000000c000000000000046", "hex").copy(data, 592);
  return data;
}

function createGenericCfbFixture(): Buffer {
  const data = Buffer.alloc(608);
  Buffer.from("d0cf11e0a1b11ae1", "hex").copy(data);
  data[30] = 9;
  data.writeUInt32LE(0, 48);
  return data;
}

function createOversizedCfbFixture(): Buffer {
  const data = createGenericCfbFixture();
  data.writeUInt32LE(0x00ff_ffff, 48);
  return data;
}
