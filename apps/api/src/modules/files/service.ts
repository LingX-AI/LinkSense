import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

import {
  conversationEventSchema,
  isMeaninglessTemporaryUploadFilename,
  workspacePermissionPolicy,
} from "@linksense/shared";
import { detectCfbf } from "@file-type/cfbf";
import { FileTypeParser } from "file-type";

import type { AppConfig } from "../../config.js";
import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { readStableRegularFile } from "../../lib/stable-regular-file.js";
import { ensureSharedWorkspaceDirectory } from "../../lib/shared-workspace-directory.js";
import {
  resolveConversationWorkspaceEntry,
  resolveConversationWorkspaceRoot,
} from "../../lib/user-runtime-paths.js";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import {
  sanitizeAuditMetadata,
  type AuditContext,
  type AuditService,
} from "../audit/service.js";
import {
  projectTaskTitle,
  type ConversationService,
} from "../conversations/service.js";
import { nextConversationEventSequence } from "../events/sequence.js";

export interface FileCleanupScheduler {
  enqueueObjectDelete(objectKey: string): Promise<void>;
  enqueueWorkspaceDirectoryRemoval(
    ownerId: string,
    conversationId: string,
    absolutePath: string,
  ): Promise<void>;
}

/**
 * Parsed from a single HTTP Range header by the route layer. Keeping the
 * syntactic parsing out of the storage adapter makes the service responsible
 * for resolving it against the verified object size.
 */
export type ArtifactPreviewMediaRangeRequest =
  | { type: "full" }
  | { type: "from"; start: number; end?: number }
  | { type: "suffix"; length: number };

type TaskArtifactCursor = {
  createdAt: Date;
  id: string;
};

type TaskArtifactRow = {
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
};

export function parseTaskArtifactCursor(
  value: string,
): TaskArtifactCursor | null {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !isUuid(id)) return null;
  return { createdAt, id };
}

export class FileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly conversations: ConversationService,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    private readonly redis: LinkSenseRedis,
    private readonly cleanup: FileCleanupScheduler,
    private readonly removeDirectory: (
      absolutePath: string,
    ) => Promise<void> = (absolutePath) =>
      rm(absolutePath, { recursive: true, force: true }),
  ) {}

  async listTaskArtifacts(
    ownerId: string,
    input: { search?: string; cursor?: string; limit: number },
  ) {
    const cursor = input.cursor
      ? parseTaskArtifactCursor(input.cursor)
      : null;
    if (input.cursor && !cursor) throw new AppError("VALIDATION_ERROR");
    const cursorFilter = cursor
      ? Prisma.sql`AND (
          f.created_at < ${cursor.createdAt}
          OR (f.created_at = ${cursor.createdAt} AND f.id < CAST(${cursor.id} AS uuid))
        )`
      : Prisma.empty;
    const searchFilter = input.search
      ? Prisma.sql`AND (
          strpos(lower(f.filename), lower(${input.search})) > 0
          OR strpos(lower(c.title), lower(${input.search})) > 0
        )`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<TaskArtifactRow[]>(Prisma.sql`
      SELECT
        f.id,
        f.conversation_id AS "conversationId",
        c.title AS "conversationTitle",
        c.title_source AS "conversationTitleSource",
        c.archive_status AS "conversationArchiveStatus",
        f.turn_id AS "turnId",
        f.source,
        f.filename,
        f.mime_type AS "mimeType",
        f.size_bytes AS "sizeBytes",
        f.created_at AS "createdAt",
        f.updated_at AS "updatedAt"
      FROM conversation_files AS f
      INNER JOIN conversations AS c ON c.id = f.conversation_id
      WHERE c.owner_id = CAST(${ownerId} AS uuid)
        AND f.kind = 'artifact'
        AND f.source IN ('agent_generated', 'system_generated')
        AND f.status = 'registered'
        AND f.downloadable = TRUE
        AND f.storage_backend = 'minio'
        AND f.minio_object_key IS NOT NULL
        ${cursorFilter}
        ${searchFilter}
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${input.limit + 1}
    `);
    const selected = rows.slice(0, input.limit);
    return {
      items: selected.map(projectTaskArtifact),
      next_cursor:
        rows.length > input.limit
          ? selected.at(-1)
            ? encodeTaskArtifactCursor(selected.at(-1)!)
            : null
          : null,
    };
  }

  async uploadAttachment(
    ownerId: string,
    conversationId: string,
    input: { filename: string; reportedMimeType?: string; data: Buffer },
    context: AuditContext,
  ) {
    return this.withConversationLock(conversationId, async () => {
      await this.conversations.assertOwner(ownerId, conversationId);
      const count = await this.prisma.conversationFile.count({
        where: { conversationId, kind: "attachment" },
      });
      if (
        count >= this.config.upload.maxFilesPerConversation ||
        input.data.byteLength > this.config.upload.maxFileSizeBytes
      ) {
        throw new AppError("FILE_LIMIT_EXCEEDED");
      }
      const filename = safeFilename(input.filename);
      if (isMeaninglessTemporaryUploadFilename(filename)) {
        throw new AppError("ATTACHMENT_TEMPORARY_FILE_SKIPPED");
      }
      const detectedMimeType = normalizeMime(
        (await detectFileType(input.data))?.mime,
      );
      const inferredMimeType =
        !detectedMimeType && hasCfbfSignature(input.data)
          ? undefined
          : mimeTypeFromFilename(filename);
      const reportedMimeType = normalizeMime(input.reportedMimeType);
      const mimeType = resolveAttachmentUploadMimeType(
        detectedMimeType,
        inferredMimeType,
        reportedMimeType,
      );
      const id = randomUUID();
      const relPath = `attachments/${id}/${filename}`;
      const destination = workspaceEntry(
        this.config.workspaceRoot,
        ownerId,
        conversationId,
        relPath,
      );
      await ensureSharedWorkspaceDirectory(
        workspaceRoot(
          this.config.workspaceRoot,
          ownerId,
          conversationId,
        ),
        dirname(destination),
      );
      await writeFile(destination, input.data, {
        flag: "wx",
        mode: workspacePermissionPolicy.sharedReadableFile,
      });

      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const lockedConversation = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id
            FROM conversations
            WHERE id = ${conversationId}::uuid
              AND owner_id = ${ownerId}::uuid
            FOR UPDATE
          `;
          if (lockedConversation.length !== 1) {
            throw new AppError("CONVERSATION_NOT_FOUND");
          }
          let draft = await tx.conversationDraft.findUnique({
            where: { conversationId },
          });
          draft ??= await tx.conversationDraft.create({
            data: {
              conversationId,
              ownerId,
              inputText: "",
              priorityCapabilityIdsJson: [],
              knowledgeBaseIdsJson: [],
            },
          });
          const file = await tx.conversationFile.create({
            data: {
              id,
              conversationId,
              draftId: draft.id,
              kind: "attachment",
              source: "user_upload",
              status: "draft",
              filename,
              mimeType,
              sizeBytes: BigInt(input.data.byteLength),
              checksumSha256: sha256(input.data),
              storageBackend: "workspace",
              workspaceRelativePath: relPath,
              downloadable: false,
              createdBy: ownerId,
            },
          });
          const sequenceNo = await nextConversationEventSequence(
            tx,
            conversationId,
          );
          const event = await tx.conversationEvent.create({
            data: {
              conversationId,
              sequenceNo,
              eventType: "conversation.file.created",
              visibility: "user_visible",
              payloadJson: {
                schema_version: 1,
                file_id: file.id,
                display_name: file.filename,
                mime_type: file.mimeType,
                size_bytes: Number(file.sizeBytes),
              },
              sseEventId: `${conversationId}:${sequenceNo}`,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: ownerId,
              action: "conversation_attachment_uploaded",
              targetType: "conversation_file",
              targetId: file.id,
              result: "success",
              metadataJson: sanitizeAuditMetadata(
                "conversation_attachment_uploaded",
                {
                  conversation_id: conversationId,
                  mime_type: file.mimeType,
                  size_bytes: Number(file.sizeBytes),
                },
              ),
              ipAddress: context.ipAddress ?? null,
              userAgent: context.userAgent ?? null,
            },
          });
          return { file, event };
        });
        await this.redis
          .publishConversationEvent(
            conversationId,
            projectFileEvent(result.event),
          )
          .catch(() => undefined);
        return projectFile(result.file);
      } catch (error) {
        await this.removeWorkspaceDirectoryOrEnqueue(
          ownerId,
          conversationId,
          dirname(destination),
        );
        throw error;
      }
    });
  }

  async deleteDraftAttachment(
    ownerId: string,
    conversationId: string,
    fileId: string,
    context: AuditContext,
  ): Promise<void> {
    await this.deleteDraftAttachments(
      ownerId,
      conversationId,
      [fileId],
      context,
    );
  }

  async deleteDraftAttachments(
    ownerId: string,
    conversationId: string,
    fileIds: readonly string[],
    context: AuditContext,
  ): Promise<void> {
    const requestedFileIds = [...new Set(fileIds)];
    if (requestedFileIds.length === 0) return;

    const result = await this.withConversationLock(conversationId, async () => {
      await this.conversations.assertOwner(ownerId, conversationId);
      return this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM conversation_files
          WHERE conversation_id = ${conversationId}::uuid
            AND kind = 'attachment'
            AND status = 'draft'
            AND id IN (${Prisma.join(
              requestedFileIds.map((id) => Prisma.sql`${id}::uuid`),
            )})
          ORDER BY id
          FOR UPDATE
        `;
        if (locked.length === 0) return { files: [], events: [] };

        const lockedIds = locked.map((file) => file.id);
        const protectedRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT DISTINCT referenced_file.id
          FROM (
            SELECT attachment.value->>'id' AS id
            FROM conversation_turn_start_intents AS intent
            CROSS JOIN LATERAL jsonb_array_elements(intent.attachments_json)
              AS attachment(value)
            WHERE intent.conversation_id = ${conversationId}::uuid
              AND attachment.value->>'id' IN (${Prisma.join(lockedIds)})

            UNION

            SELECT intent.message_display_json->>'file_id' AS id
            FROM conversation_turn_start_intents AS intent
            WHERE intent.conversation_id = ${conversationId}::uuid
              AND intent.message_display_json->>'file_id' IN (${Prisma.join(
                lockedIds,
              )})
          ) AS referenced_file
          WHERE referenced_file.id IS NOT NULL
        `;
        const protectedIds = new Set(protectedRows.map((row) => row.id));
        const deletableIds = lockedIds.filter((id) => !protectedIds.has(id));
        if (deletableIds.length === 0) return { files: [], events: [] };

        const files = await tx.conversationFile.findMany({
          where: {
            id: { in: deletableIds },
            conversationId,
            kind: "attachment",
            status: "draft",
          },
          orderBy: { id: "asc" },
        });
        if (files.length === 0) return { files: [], events: [] };
        await tx.conversationFile.deleteMany({
          where: { id: { in: files.map((file) => file.id) } },
        });

        const firstSequenceNo = await nextConversationEventSequence(
          tx,
          conversationId,
        );
        const events = await tx.conversationEvent.createManyAndReturn({
          data: files.map((file, index) => {
            const sequenceNo = firstSequenceNo + BigInt(index);
            return {
              conversationId,
              sequenceNo,
              eventType: "conversation.file.updated",
              visibility: "user_visible",
              payloadJson: {
                schema_version: 1,
                file_id: file.id,
                status: "removed",
              },
              sseEventId: `${conversationId}:${sequenceNo}`,
            };
          }),
        });
        await tx.auditLog.createMany({
          data: files.map((file) => ({
            actorId: ownerId,
            action: "conversation_draft_attachment_removed",
            targetType: "conversation_file",
            targetId: file.id,
            result: "success",
            metadataJson: sanitizeAuditMetadata(
              "conversation_draft_attachment_removed",
              { conversation_id: conversationId },
            ),
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
          })),
        });
        events.sort((left, right) =>
          left.sequenceNo < right.sequenceNo ? -1 : 1,
        );
        return { files, events };
      });
    });

    for (const file of result.files) {
      if (file.workspaceRelativePath) {
        const root = workspaceRoot(
          this.config.workspaceRoot,
          ownerId,
          conversationId,
        );
        const target = workspaceEntry(
          this.config.workspaceRoot,
          ownerId,
          conversationId,
          file.workspaceRelativePath,
        );
        const attachmentDirectory = dirname(target);
        assertDescendant(root, attachmentDirectory);
        await this.removeWorkspaceDirectoryOrEnqueue(
          ownerId,
          conversationId,
          attachmentDirectory,
        );
      }
    }
    for (const event of result.events) {
      await this.redis
        .publishConversationEvent(
          conversationId,
          projectFileEvent(event),
        )
        .catch(() => undefined);
    }
  }

  async readAttachmentPreviewContent(
    ownerId: string,
    conversationId: string,
    fileId: string,
  ): Promise<{
    data: Buffer;
    filename: string;
    mimeType: AttachmentPreviewMimeType;
    sizeBytes: number;
  }> {
    await this.conversations.assertOwner(ownerId, conversationId);
    const file = await this.prisma.conversationFile.findFirst({
      where: {
        id: fileId,
        conversationId,
        kind: "attachment",
        status: { in: ["draft", "bound"] },
        storageBackend: "workspace",
      },
      select: {
        filename: true,
        mimeType: true,
        status: true,
        sizeBytes: true,
        checksumSha256: true,
        workspaceRelativePath: true,
      },
    });
    const previewMimeType = resolveAttachmentPreviewMimeType(
      file?.filename ?? "",
      file?.mimeType ?? null,
    );
    const maximumPreviewSize = previewMimeType
      ? maximumAttachmentPreviewSize(previewMimeType, this.config)
      : 0;
    if (
      !file ||
      (file.status !== "draft" && file.status !== "bound") ||
      !previewMimeType ||
      !file.workspaceRelativePath ||
      !file.checksumSha256 ||
      file.sizeBytes <= 0n ||
      file.sizeBytes > BigInt(maximumPreviewSize)
    ) {
      throwAttachmentPreviewUnavailable();
    }

    const root = await realpath(
      workspaceRoot(this.config.workspaceRoot, ownerId, conversationId),
    ).catch(throwAttachmentPreviewUnavailable);
    const candidate = resolve(root, file.workspaceRelativePath);
    assertAttachmentPreviewDescendant(root, candidate);
    const actual = await realpath(candidate).catch(
      throwAttachmentPreviewUnavailable,
    );
    if (actual !== candidate) throwAttachmentPreviewUnavailable();
    assertAttachmentPreviewDescendant(root, actual);
    const pathStats = await lstat(actual).catch(
      throwAttachmentPreviewUnavailable,
    );
    if (!pathStats.isFile()) throwAttachmentPreviewUnavailable();

    const data = await readStableRegularFile(actual, pathStats, {
      maximumBytes: maximumPreviewSize,
      invalidFileError: () => new AppError("NOT_FOUND"),
      fileTooLargeError: () => new AppError("NOT_FOUND"),
    }).catch(throwAttachmentPreviewUnavailable);
    if (
      BigInt(data.byteLength) !== file.sizeBytes ||
      sha256(data) !== file.checksumSha256.toLowerCase()
    ) {
      throwAttachmentPreviewUnavailable();
    }
    const detectedMimeType = normalizeMime((await detectFileType(data))?.mime);
    const verifiedMimeType = resolveVerifiedMimeType(
      detectedMimeType,
      mimeTypeFromFilename(file.filename),
      normalizeMime(file.mimeType ?? undefined),
    );
    if (
      verifiedMimeType !== previewMimeType ||
      ((isPreviewImageMimeType(previewMimeType) ||
        isPreviewMediaMimeType(previewMimeType)) &&
        detectedMimeType !== previewMimeType)
    ) {
      throwAttachmentPreviewUnavailable();
    }

    return {
      data,
      filename: file.filename,
      mimeType: previewMimeType,
      sizeBytes: data.byteLength,
    };
  }

  async registerArtifact(input: {
    ownerId: string;
    conversationId: string;
    codexTurnId: string;
    workspaceRelativePath: string;
    displayName: string;
    mimeType?: string;
    artifactKind?: string;
  }) {
    return this.withConversationLock(input.conversationId, async () => {
      const turn = await this.prisma.conversationTurn.findFirst({
        where: {
          conversationId: input.conversationId,
          codexTurnId: input.codexTurnId,
          submittedBy: input.ownerId,
          status: "running",
        },
      });
      if (!turn) throw new AppError("FORBIDDEN");
      const root = await realpath(
        workspaceRoot(
          this.config.workspaceRoot,
          input.ownerId,
          input.conversationId,
        ),
      );
      const candidate = resolve(root, input.workspaceRelativePath);
      assertDescendant(root, candidate);
      const actual = await realpath(candidate).catch(() => {
        throw new AppError("ARTIFACT_NOT_FOUND");
      });
      assertDescendant(root, actual);
      const pathStats = await lstat(actual).catch(() => {
        throw new AppError("ARTIFACT_NOT_FOUND");
      });
      if (!pathStats.isFile()) {
        throw new AppError("ARTIFACT_REGISTRATION_INVALID");
      }
      const data = await readStableRegularFile(actual, pathStats, {
        maximumBytes: this.config.upload.maxFileSizeBytes,
        invalidFileError: () =>
          new AppError("ARTIFACT_REGISTRATION_INVALID"),
        fileTooLargeError: () => new AppError("FILE_LIMIT_EXCEEDED"),
      });
      const detectedMimeType = normalizeMime(
        (await detectFileType(data))?.mime,
      );
      const inferredMimeType = mimeTypeFromFilename(actual);
      const reportedMimeType = normalizeMime(input.mimeType);
      const mimeType = resolveArtifactMimeType(
        detectedMimeType,
        inferredMimeType,
        reportedMimeType,
      );
      const id = randomUUID();
      const inlineImage = input.artifactKind === "inline_image";
      const displayName = artifactDisplayName(
        input.displayName || basename(actual),
        mimeType,
      );
      const objectKey = `conversations/${input.conversationId}/artifacts/${id}/${displayName}`;
      await this.storage.putObject(objectKey, data, {
        "content-type": mimeType,
      });
      try {
        const file = await this.prisma.$transaction(async (tx) => {
          const eventSequence = await nextConversationEventSequence(
            tx,
            input.conversationId,
          );
          const downloadCardEventId = randomUUID();
          const systemCapabilityEventId = randomUUID();
          const created = await tx.conversationFile.create({
            data: {
              id,
              conversationId: input.conversationId,
              turnId: turn.id,
              kind: "artifact",
              source: "agent_generated",
              status: "registered",
              filename: displayName,
              mimeType,
              sizeBytes: BigInt(data.byteLength),
              checksumSha256: sha256(data),
              storageBackend: "minio",
              minioObjectKey: objectKey,
              downloadable: true,
              downloadCardEventId,
            },
          });
          await tx.conversationEvent.create({
            data: {
              id: systemCapabilityEventId,
              conversationId: input.conversationId,
              turnId: turn.id,
              sequenceNo: eventSequence,
              eventType: "conversation.system_capability.used",
              visibility: "user_collapsed",
              payloadJson: {
                schema_version: 1,
                system_capability_key: "linksense_file_service",
                usage_type: "system_file_service",
                name: "LinkSense File Service",
                safe_summary: inlineImage
                  ? "registered inline message image"
                  : "registered downloadable artifact",
              },
              sseEventId: `${input.conversationId}:${eventSequence}`,
            },
          });
          await tx.conversationEvent.create({
            data: {
              id: downloadCardEventId,
              conversationId: input.conversationId,
              turnId: turn.id,
              sequenceNo: eventSequence + 1n,
              eventType: "conversation.artifact.created",
              visibility: "user_visible",
              payloadJson: {
                schema_version: 1,
                file_id: created.id,
                display_name: created.filename,
                mime_type: created.mimeType,
                size_bytes: Number(created.sizeBytes),
              },
              sseEventId: `${input.conversationId}:${eventSequence + 1n}`,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: turn.submittedBy,
              action: "conversation_artifact_registered",
              targetType: "conversation_file",
              targetId: created.id,
              result: "success",
              metadataJson: sanitizeAuditMetadata(
                "conversation_artifact_registered",
                {
                  conversation_id: input.conversationId,
                  turn_id: turn.id,
                  size_bytes: Number(created.sizeBytes),
                  mime_type: created.mimeType,
                },
              ),
            },
          });
          return { created, eventSequence, systemCapabilityEventId };
        });
        const systemCapabilityEvent = {
          id: file.systemCapabilityEventId,
          conversation_id: input.conversationId,
          turn_id: turn.id,
          sequence_no: Number(file.eventSequence),
          event_type: "conversation.system_capability.used",
          visibility: "user_collapsed",
          payload: {
            schema_version: 1,
            system_capability_key: "linksense_file_service",
            usage_type: "system_file_service",
            name: "LinkSense File Service",
            safe_summary: inlineImage
              ? "registered inline message image"
              : "registered downloadable artifact",
          },
          sse_event_id: `${input.conversationId}:${file.eventSequence}`,
          created_at: new Date().toISOString(),
        };
        const artifactEvent = {
          id: file.created.downloadCardEventId,
          conversation_id: input.conversationId,
          turn_id: turn.id,
          sequence_no: Number(file.eventSequence + 1n),
          event_type: "conversation.artifact.created",
          visibility: "user_visible",
          payload: {
            schema_version: 1,
            file_id: file.created.id,
            display_name: file.created.filename,
            mime_type: file.created.mimeType,
            size_bytes: Number(file.created.sizeBytes),
          },
          sse_event_id: `${input.conversationId}:${file.eventSequence + 1n}`,
          created_at: new Date().toISOString(),
        };
        await this.redis
          .publishConversationEvent(input.conversationId, systemCapabilityEvent)
          .catch(() => undefined);
        await this.redis
          .publishConversationEvent(input.conversationId, artifactEvent)
          .catch(() => undefined);
        return {
          success: true,
          artifact_id: file.created.id,
          file_id: file.created.id,
          display_name: file.created.filename,
          download_card_event_id: file.created.downloadCardEventId,
        };
      } catch (error) {
        await this.removeObjectOrEnqueue(input.conversationId, objectKey);
        throw error;
      }
    });
  }

  async createDownloadLink(
    ownerId: string,
    conversationId: string,
    fileId: string,
    context: AuditContext,
  ) {
    return this.withConversationLock(conversationId, async () => {
      try {
        await this.conversations.assertOwner(ownerId, conversationId);
      } catch (error) {
        await this.audit
          .write({
            ...context,
            actorId: ownerId,
            action: "artifact_download_link_rejected",
            targetType: "conversation_file",
            targetId: fileId,
            result: "rejected",
            metadata: {
              conversation_id: conversationId,
              reason_code: "CONVERSATION_NOT_FOUND",
            },
          })
          .catch(() => undefined);
        throw error;
      }
      const file = await this.prisma.conversationFile.findFirst({
        where: {
          id: fileId,
          conversationId,
          kind: "artifact",
          downloadable: true,
        },
      });
      if (!file?.minioObjectKey) {
        await this.audit.write({
          ...context,
          actorId: ownerId,
          action: "artifact_download_link_rejected",
          targetType: "conversation_file",
          targetId: fileId,
          result: "rejected",
          metadata: { conversation_id: conversationId },
        });
        throw new AppError("ARTIFACT_NOT_FOUND");
      }
      const url = await this.storage.presignedGetObject(
        file.minioObjectKey,
        this.config.minio.downloadTtlSeconds,
      );
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "artifact_download_link_issued",
        targetType: "conversation_file",
        targetId: fileId,
        result: "success",
        metadata: {
          conversation_id: conversationId,
          expires_seconds: this.config.minio.downloadTtlSeconds,
        },
      });
      return {
        url,
        expires_at: new Date(
          Date.now() + this.config.minio.downloadTtlSeconds * 1_000,
        ).toISOString(),
        filename: file.filename,
      };
    });
  }

  async readArtifactDownload(
    ownerId: string,
    conversationId: string,
    fileId: string,
    context: AuditContext,
  ): Promise<{
    data: Readable;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    try {
      await this.conversations.assertOwner(ownerId, conversationId);
    } catch (error) {
      await this.audit
        .write({
          ...context,
          actorId: ownerId,
          action: "artifact_download_rejected",
          targetType: "conversation_file",
          targetId: fileId,
          result: "rejected",
          metadata: {
            conversation_id: conversationId,
            reason_code: "CONVERSATION_NOT_FOUND",
          },
        })
        .catch(() => undefined);
      throw error;
    }

    const file = await this.prisma.conversationFile.findFirst({
      where: {
        id: fileId,
        conversationId,
        kind: "artifact",
        downloadable: true,
        storageBackend: "minio",
      },
      select: {
        filename: true,
        mimeType: true,
        minioObjectKey: true,
        sizeBytes: true,
      },
    });
    if (
      !file?.minioObjectKey ||
      file.sizeBytes <= 0n ||
      file.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "artifact_download_rejected",
        targetType: "conversation_file",
        targetId: fileId,
        result: "rejected",
        metadata: { conversation_id: conversationId },
      });
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const sizeBytes = Number(file.sizeBytes);
    const storedSizeBytes = await this.storage.getObjectSize(
      file.minioObjectKey,
    );
    if (storedSizeBytes !== sizeBytes || storedSizeBytes <= 0) {
      await this.audit.write({
        ...context,
        actorId: ownerId,
        action: "artifact_download_rejected",
        targetType: "conversation_file",
        targetId: fileId,
        result: "rejected",
        metadata: {
          conversation_id: conversationId,
          reason_code: "OBJECT_SIZE_MISMATCH",
        },
      });
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    await this.audit.write({
      ...context,
      actorId: ownerId,
      action: "artifact_download_started",
      targetType: "conversation_file",
      targetId: fileId,
      result: "success",
      metadata: {
        conversation_id: conversationId,
        size_bytes: sizeBytes,
        mime_type: file.mimeType,
      },
    });
    return {
      data: await this.storage.getObjectStream(file.minioObjectKey),
      filename: file.filename,
      mimeType: file.mimeType || "application/octet-stream",
      sizeBytes,
    };
  }

  async createArtifactPreviewLink(
    ownerId: string,
    conversationId: string,
    fileId: string,
  ) {
    await this.conversations.assertOwner(ownerId, conversationId);
    const file = await this.prisma.conversationFile.findFirst({
      where: {
        id: fileId,
        conversationId,
        kind: "artifact",
        downloadable: true,
        storageBackend: "minio",
        mimeType: { in: [...PREVIEW_LINK_MIME_TYPES] },
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
    if (
      !file ||
      file.kind !== "artifact" ||
      !file.downloadable ||
      file.storageBackend !== "minio" ||
      !isPreviewLinkMimeType(file.mimeType) ||
      !matchesPreviewFilename(file.filename, file.mimeType) ||
      !file.minioObjectKey ||
      file.sizeBytes <= 0n ||
      file.sizeBytes >
        BigInt(maximumPreviewLinkSize(file.mimeType, this.config))
    ) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const storedSizeBytes = await this.storage.getObjectSize(
      file.minioObjectKey,
    );
    if (storedSizeBytes !== Number(file.sizeBytes)) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const url = await this.storage.presignedGetObject(
      file.minioObjectKey,
      this.config.minio.downloadTtlSeconds,
    );
    return {
      url,
      expires_at: new Date(
        Date.now() + this.config.minio.downloadTtlSeconds * 1_000,
      ).toISOString(),
      filename: file.filename,
    };
  }

  /**
   * Streams a verified media artifact without buffering it in the API process.
   * The route converts the resolved range into the corresponding HTTP 200/206
   * response. This route is an authenticated fallback; browser media elements
   * normally use the short-lived object URL from createArtifactPreviewLink.
   */
  async readArtifactPreviewMedia(
    ownerId: string,
    conversationId: string,
    fileId: string,
    requestedRange: ArtifactPreviewMediaRangeRequest,
  ): Promise<{
    data: Readable;
    filename: string;
    mimeType: PreviewMediaMimeType;
    sizeBytes: number;
    range: { start: number; end: number } | null;
  }> {
    await this.conversations.assertOwner(ownerId, conversationId);
    const file = await this.prisma.conversationFile.findFirst({
      where: {
        id: fileId,
        conversationId,
        kind: "artifact",
        downloadable: true,
        storageBackend: "minio",
        mimeType: { in: [...PREVIEW_MEDIA_MIME_TYPES] },
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
    if (
      !file ||
      file.kind !== "artifact" ||
      !file.downloadable ||
      file.storageBackend !== "minio" ||
      !isPreviewMediaMimeType(file.mimeType) ||
      !matchesPreviewFilename(file.filename, file.mimeType) ||
      !file.minioObjectKey ||
      file.sizeBytes <= 0n ||
      file.sizeBytes > BigInt(maximumPreviewMediaSize(this.config))
    ) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const sizeBytes = Number(file.sizeBytes);
    const storedSizeBytes = await this.storage.getObjectSize(
      file.minioObjectKey,
    );
    if (
      storedSizeBytes !== sizeBytes ||
      storedSizeBytes <= 0 ||
      storedSizeBytes > maximumPreviewMediaSize(this.config)
    ) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const range = resolveArtifactPreviewMediaRange(requestedRange, sizeBytes);
    return {
      data:
        range === null
          ? await this.storage.getObjectStream(file.minioObjectKey)
          : await this.storage.getObjectRangeStream(
              file.minioObjectKey,
              range.start,
              range.end - range.start + 1,
            ),
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes,
      range,
    };
  }

  async readArtifactPreviewDocument(
    ownerId: string,
    conversationId: string,
    fileId: string,
  ): Promise<{
    data: Readable;
    filename: string;
    mimeType: PreviewContentMimeType;
    sizeBytes: number;
  }> {
    await this.conversations.assertOwner(ownerId, conversationId);
    const file = await this.prisma.conversationFile.findFirst({
      where: {
        id: fileId,
        conversationId,
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
    const previewMimeType = resolvePreviewContentMimeType(
      file?.filename ?? "",
      file?.mimeType ?? null,
    );
    if (
      !file ||
      file.kind !== "artifact" ||
      !file.downloadable ||
      file.storageBackend !== "minio" ||
      !previewMimeType ||
      !file.minioObjectKey
    ) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const maximumPreviewSize = maximumPreviewContentSize(
      previewMimeType,
      this.config,
    );
    if (file.sizeBytes <= 0n || file.sizeBytes > BigInt(maximumPreviewSize)) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    const sizeBytes = Number(file.sizeBytes);
    const storedSizeBytes = await this.storage.getObjectSize(
      file.minioObjectKey,
    );
    if (
      storedSizeBytes !== sizeBytes ||
      storedSizeBytes <= 0 ||
      storedSizeBytes > maximumPreviewSize
    ) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }

    return {
      data: await this.storage.getObjectStream(file.minioObjectKey),
      filename: file.filename,
      mimeType: previewMimeType,
      sizeBytes,
    };
  }

  /** @deprecated Use readArtifactPreviewDocument for previewable documents. */
  async readArtifactOfficeDocument(
    ownerId: string,
    conversationId: string,
    fileId: string,
  ) {
    return this.readArtifactPreviewDocument(ownerId, conversationId, fileId);
  }

  /** @deprecated Use readArtifactPreviewDocument for previewable documents. */
  async readArtifactPresentation(
    ownerId: string,
    conversationId: string,
    fileId: string,
  ) {
    return this.readArtifactPreviewDocument(ownerId, conversationId, fileId);
  }

  private async withConversationLock<T>(
    conversationId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    let token: string | null = null;
    for (let attempt = 0; attempt < 400 && !token; attempt += 1) {
      token = await this.redis.acquireConversationLock(
        conversationId,
        120_000,
      );
      if (!token) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
    }
    if (!token) throw new AppError("CONFLICT");
    try {
      return await action();
    } finally {
      await this.redis
        .releaseConversationLock(conversationId, token)
        .catch(() => undefined);
    }
  }

  private async removeWorkspaceDirectoryOrEnqueue(
    ownerId: string,
    conversationId: string,
    absolutePath: string,
  ): Promise<void> {
    try {
      await this.removeDirectory(absolutePath);
    } catch {
      await this.cleanup
        .enqueueWorkspaceDirectoryRemoval(ownerId, conversationId, absolutePath)
        .catch(() =>
          this.writeCleanupEnqueueFailure(conversationId, "workspace"),
        );
    }
  }

  private async removeObjectOrEnqueue(
    conversationId: string,
    objectKey: string,
  ): Promise<void> {
    try {
      await this.storage.removeObject(objectKey);
    } catch {
      await this.cleanup
        .enqueueObjectDelete(objectKey)
        .catch(() =>
          this.writeCleanupEnqueueFailure(conversationId, "object_storage"),
        );
    }
  }

  private async writeCleanupEnqueueFailure(
    conversationId: string,
    resourceType: "workspace" | "object_storage",
  ): Promise<void> {
    await this.audit
      .write({
        actorId: null,
        action: "file_cleanup_enqueue_failed",
        targetType: "conversation",
        targetId: conversationId,
        result: "failed",
        metadata: {
          conversation_id: conversationId,
          resource_type: resourceType,
          reason_code: "CLEANUP_QUEUE_UNAVAILABLE",
        },
      })
      .catch(() => undefined);
  }
}

function safeFilename(input: string): string {
  const value = Array.from(basename(input).normalize("NFC"))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? "_" : character;
    })
    .join("");
  if (
    !value ||
    value === "." ||
    value === ".." ||
    Array.from(value).length > 260
  ) {
    throw new AppError("ATTACHMENT_UPLOAD_INVALID");
  }
  return value;
}

function assertDescendant(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    resolve(candidate) === resolve(root)
  ) {
    throw new AppError("FORBIDDEN");
  }
}

function workspaceRoot(
  configuredRoot: string,
  ownerId: string,
  conversationId: string,
): string {
  try {
    return resolveConversationWorkspaceRoot(
      configuredRoot,
      ownerId,
      conversationId,
    );
  } catch {
    throw new AppError("FORBIDDEN");
  }
}

function workspaceEntry(
  configuredRoot: string,
  ownerId: string,
  conversationId: string,
  workspaceRelativePath: string,
): string {
  try {
    return resolveConversationWorkspaceEntry(
      configuredRoot,
      ownerId,
      conversationId,
      workspaceRelativePath,
    );
  } catch {
    throw new AppError("FORBIDDEN");
  }
}

const CANONICAL_MIME_TYPES = new Map<string, string>([
  ["application/x-zip-compressed", "application/zip"],
  ["application/zip-compressed", "application/zip"],
  ["application/x-compressed", "application/zip"],
  ["application/rar", "application/vnd.rar"],
  ["application/x-rar-compressed", "application/vnd.rar"],
  ["application/x-gzip", "application/gzip"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/x-wav", "audio/wav"],
  ["audio/vnd.wave", "audio/wav"],
  ["audio/x-aac", "audio/aac"],
  ["audio/x-flac", "audio/flac"],
  ["video/x-m4v", "video/mp4"],
]);

const DEFAULT_ARTIFACT_MIME_TYPE = "application/octet-stream";

function normalizeMime(input?: string): string | undefined {
  const value = input?.split(";", 1)[0]?.trim().toLowerCase();
  return value ? (CANONICAL_MIME_TYPES.get(value) ?? value) : undefined;
}

function resolveVerifiedMimeType(
  detectedMimeType: string | undefined,
  inferredMimeType: string | undefined,
  reportedMimeType: string | undefined,
): string | undefined {
  const genericReportedMimeType =
    reportedMimeType === "application/octet-stream";
  const specificReportedMimeType = genericReportedMimeType
    ? undefined
    : reportedMimeType;

  if (
    (detectedMimeType &&
      specificReportedMimeType &&
      detectedMimeType !== specificReportedMimeType) ||
    (detectedMimeType &&
      inferredMimeType &&
      detectedMimeType !== inferredMimeType) ||
    (!detectedMimeType &&
      specificReportedMimeType &&
      inferredMimeType &&
      specificReportedMimeType !== inferredMimeType) ||
    (!detectedMimeType && genericReportedMimeType && inferredMimeType)
  ) {
    return undefined;
  }

  return detectedMimeType ?? inferredMimeType ?? specificReportedMimeType;
}

function resolveAttachmentUploadMimeType(
  detectedMimeType: string | undefined,
  inferredMimeType: string | undefined,
  reportedMimeType: string | undefined,
): string {
  if (detectedMimeType) return detectedMimeType;
  if (inferredMimeType) return inferredMimeType;
  if (isStructuredMimeType(reportedMimeType)) return reportedMimeType;
  return DEFAULT_ARTIFACT_MIME_TYPE;
}

function resolveArtifactMimeType(
  detectedMimeType: string | undefined,
  inferredMimeType: string | undefined,
  reportedMimeType: string | undefined,
): string {
  const genericReportedMimeType =
    reportedMimeType === DEFAULT_ARTIFACT_MIME_TYPE;
  const specificReportedMimeType =
    genericReportedMimeType || !isStructuredMimeType(reportedMimeType)
      ? undefined
      : reportedMimeType;

  if (
    (detectedMimeType &&
      specificReportedMimeType &&
      detectedMimeType !== specificReportedMimeType) ||
    (detectedMimeType &&
      inferredMimeType &&
      detectedMimeType !== inferredMimeType) ||
    (!detectedMimeType &&
      specificReportedMimeType &&
      inferredMimeType &&
      specificReportedMimeType !== inferredMimeType)
  ) {
    throw new AppError("ARTIFACT_REGISTRATION_INVALID");
  }

  return (
    detectedMimeType ??
    inferredMimeType ??
    specificReportedMimeType ??
    DEFAULT_ARTIFACT_MIME_TYPE
  );
}

function isStructuredMimeType(value: string | undefined): value is string {
  return value
    ? /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(value)
    : false;
}

function detectFileType(data: Buffer) {
  if (shouldUseCfbfDetector(data)) {
    return new FileTypeParser({
      customDetectors: [detectCfbf],
    }).fromBuffer(data);
  }
  return new FileTypeParser().fromBuffer(data);
}

const CFBF_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex");
const MAXIMUM_CFBF_CLSID_PROBE_BYTES = 64 * 1024;

function hasCfbfSignature(data: Buffer): boolean {
  return data.subarray(0, CFBF_SIGNATURE.byteLength).equals(CFBF_SIGNATURE);
}

function shouldUseCfbfDetector(data: Buffer): boolean {
  if (
    data.byteLength < 52 ||
    !hasCfbfSignature(data)
  ) {
    return false;
  }

  const sectorShift = data.readUInt16LE(30);
  if (sectorShift !== 9 && sectorShift !== 12) return false;

  const firstDirectorySector = data.readUInt32LE(48);
  if (firstDirectorySector >= 0xfffffffe) return false;

  const requiredLength =
    512 + firstDirectorySector * 2 ** sectorShift + 16 + 80;
  return (
    requiredLength <= data.byteLength &&
    requiredLength <= MAXIMUM_CFBF_CLSID_PROBE_BYTES
  );
}

function mimeTypeFromFilename(filename: string): string | undefined {
  const artifactFilename = normalizedArtifactFilename(filename);
  if (!artifactFilename) return undefined;
  if (isEnvironmentFilename(artifactFilename)) return "text/plain";
  const exactMimeType = ARTIFACT_MIME_BY_FILENAME.get(artifactFilename);
  if (exactMimeType) return exactMimeType;
  const separator = artifactFilename.lastIndexOf(".");
  const extension =
    separator > -1 ? artifactFilename.slice(separator + 1) : artifactFilename;
  return extension ? ARTIFACT_MIME_BY_EXTENSION.get(extension) : undefined;
}

function normalizedArtifactFilename(filename: string): string {
  return basename(filename).trim().toLocaleLowerCase("en-US");
}

function isEnvironmentFilename(filename: string): boolean {
  return (
    filename === ".env" ||
    filename.startsWith(".env.") ||
    filename.endsWith(".env") ||
    filename.includes(".env.")
  );
}

function artifactDisplayName(input: string, mimeType: string): string {
  const filename = safeFilename(input);
  const inferredMimeType = mimeTypeFromFilename(filename);
  if (inferredMimeType) {
    if (inferredMimeType !== mimeType) {
      throw new AppError("ARTIFACT_REGISTRATION_INVALID");
    }
    return filename;
  }
  if (filename.includes(".")) return filename;
  const extension = ARTIFACT_EXTENSION_BY_MIME.get(mimeType);
  return extension ? `${filename}.${extension}` : filename;
}

const ARTIFACT_MIME_BY_EXTENSION = new Map([
  ["pdf", "application/pdf"],
  ["txt", "text/plain"],
  ["log", "text/plain"],
  ["conf", "text/plain"],
  ["cfg", "text/plain"],
  ["ini", "text/plain"],
  ["env", "text/plain"],
  ["c", "text/plain"],
  ["cc", "text/plain"],
  ["cpp", "text/plain"],
  ["cxx", "text/plain"],
  ["h", "text/plain"],
  ["hpp", "text/plain"],
  ["cs", "text/plain"],
  ["go", "text/plain"],
  ["java", "text/plain"],
  ["js", "text/javascript"],
  ["jsx", "text/plain"],
  ["ts", "text/plain"],
  ["tsx", "text/plain"],
  ["php", "text/plain"],
  ["py", "text/plain"],
  ["rb", "text/plain"],
  ["rs", "text/plain"],
  ["scala", "text/plain"],
  ["sh", "text/plain"],
  ["bash", "text/plain"],
  ["zsh", "text/plain"],
  ["sql", "text/plain"],
  ["toml", "text/plain"],
  ["vue", "text/plain"],
  ["svelte", "text/plain"],
  ["cnf", "text/plain"],
  ["config", "text/plain"],
  ["diff", "text/plain"],
  ["example", "text/plain"],
  ["json5", "application/json"],
  ["jsonl", "application/json"],
  ["less", "text/css"],
  ["list", "text/plain"],
  ["lock", "text/plain"],
  ["patch", "text/plain"],
  ["pem", "text/plain"],
  ["plist", "application/xml"],
  ["prisma", "text/plain"],
  ["properties", "text/plain"],
  ["proto", "text/plain"],
  ["scss", "text/css"],
  ["service", "text/plain"],
  ["text", "text/plain"],
  ["timer", "text/plain"],
  ["csv", "text/csv"],
  ["md", "text/markdown"],
  ["json", "application/json"],
  ["yaml", "application/yaml"],
  ["yml", "application/yaml"],
  ["xml", "application/xml"],
  ["css", "text/css"],
  ["mjs", "text/javascript"],
  ["cjs", "text/javascript"],
  ["zip", "application/zip"],
  ["7z", "application/x-7z-compressed"],
  ["rar", "application/vnd.rar"],
  ["gz", "application/gzip"],
  ["tgz", "application/gzip"],
  ["tar", "application/x-tar"],
  ["bz2", "application/x-bzip2"],
  ["xz", "application/x-xz"],
  ["zst", "application/zstd"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["svgz", "image/svg+xml"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["wav", "audio/wav"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/opus"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["weba", "audio/webm"],
  ["aif", "audio/aiff"],
  ["aiff", "audio/aiff"],
  ["3ga", "audio/3gpp"],
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["webm", "video/webm"],
  ["ogv", "video/ogg"],
  ["mov", "video/quicktime"],
  ["mkv", "video/x-matroska"],
  ["avi", "video/x-msvideo"],
  ["mpeg", "video/mpeg"],
  ["mpg", "video/mpeg"],
  ["3gp", "video/3gpp"],
  ["3g2", "video/3gpp2"],
  ["htm", "text/html"],
  ["html", "text/html"],
  [
    "docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ["xls", "application/vnd.ms-excel"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
]);

const ARTIFACT_MIME_BY_FILENAME = new Map([
  ["authors", "text/plain"],
  ["changelog", "text/markdown"],
  ["codeowners", "text/plain"],
  ["contributing", "text/markdown"],
  ["copying", "text/plain"],
  ["credits", "text/plain"],
  ["dockerfile", "text/plain"],
  ["gemfile", "text/plain"],
  ["justfile", "text/plain"],
  ["license", "text/plain"],
  ["makefile", "text/plain"],
  ["notice", "text/plain"],
  ["procfile", "text/plain"],
  ["rakefile", "text/plain"],
  ["readme", "text/markdown"],
  ["security", "text/markdown"],
  ["vagrantfile", "text/plain"],
]);

const TEXT_PREVIEW_FALLBACK_EXTENSIONS = new Set([
  "cfg",
  "cnf",
  "conf",
  "config",
  "diff",
  "env",
  "example",
  "ini",
  "list",
  "log",
  "patch",
  "pem",
  "properties",
  "service",
  "text",
  "timer",
  "txt",
]);

const ARTIFACT_EXTENSION_BY_MIME = new Map([
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["text/csv", "csv"],
  ["text/markdown", "md"],
  ["application/json", "json"],
  ["application/yaml", "yaml"],
  ["application/xml", "xml"],
  ["text/css", "css"],
  ["text/javascript", "js"],
  ["application/zip", "zip"],
  ["application/x-7z-compressed", "7z"],
  ["application/vnd.rar", "rar"],
  ["application/gzip", "gz"],
  ["application/x-tar", "tar"],
  ["application/x-bzip2", "bz2"],
  ["application/x-xz", "xz"],
  ["application/zstd", "zst"],
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["audio/ogg", "ogg"],
  ["audio/opus", "opus"],
  ["audio/aac", "aac"],
  ["audio/flac", "flac"],
  ["audio/webm", "weba"],
  ["audio/aiff", "aiff"],
  ["audio/3gpp", "3ga"],
  ["audio/3gpp2", "3ga"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/ogg", "ogv"],
  ["video/quicktime", "mov"],
  ["video/x-matroska", "mkv"],
  ["video/x-msvideo", "avi"],
  ["video/mpeg", "mpeg"],
  ["video/3gpp", "3gp"],
  ["video/3gpp2", "3g2"],
  ["text/html", "html"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pptx",
  ],
]);

const PREVIEW_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

const PREVIEW_ARTIFACT_IMAGE_MIME_TYPES = [
  ...PREVIEW_IMAGE_MIME_TYPES,
  "image/svg+xml",
] as const;

const PREVIEW_MEDIA_MIME_TYPES = [
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
] as const;

const PREVIEW_TEXT_MIME_TYPES = [
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/yaml",
  "application/xml",
  "text/css",
  "text/javascript",
] as const;

const PREVIEW_DOCUMENT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "application/zip",
] as const;

const PREVIEW_CONTENT_MIME_TYPES = [
  ...PREVIEW_DOCUMENT_MIME_TYPES,
  "application/pdf",
  ...PREVIEW_TEXT_MIME_TYPES,
] as const;

const PREVIEW_LINK_MIME_TYPES = [
  ...PREVIEW_ARTIFACT_IMAGE_MIME_TYPES,
  ...PREVIEW_MEDIA_MIME_TYPES,
] as const;

const MAXIMUM_HTML_PREVIEW_SIZE_BYTES = 10 * 1024 * 1024;
const MAXIMUM_ZIP_PREVIEW_SIZE_BYTES = 50 * 1024 * 1024;
const MAXIMUM_PDF_PREVIEW_SIZE_BYTES = 50 * 1024 * 1024;
const MAXIMUM_TEXT_PREVIEW_SIZE_BYTES = 5 * 1024 * 1024;
const MAXIMUM_IMAGE_PREVIEW_SIZE_BYTES = 50 * 1024 * 1024;
const MAXIMUM_MEDIA_PREVIEW_SIZE_BYTES = 500 * 1024 * 1024;

type PreviewContentMimeType = (typeof PREVIEW_CONTENT_MIME_TYPES)[number];

type PreviewImageMimeType = (typeof PREVIEW_IMAGE_MIME_TYPES)[number];

type PreviewArtifactImageMimeType =
  (typeof PREVIEW_ARTIFACT_IMAGE_MIME_TYPES)[number];

type PreviewMediaMimeType = (typeof PREVIEW_MEDIA_MIME_TYPES)[number];

type PreviewLinkMimeType = (typeof PREVIEW_LINK_MIME_TYPES)[number];

type AttachmentPreviewMimeType =
  PreviewContentMimeType | PreviewImageMimeType | PreviewMediaMimeType;

function isPreviewImageMimeType(
  value: string | null,
): value is PreviewImageMimeType {
  return PREVIEW_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value);
}

function isPreviewArtifactImageMimeType(
  value: string | null,
): value is PreviewArtifactImageMimeType {
  return PREVIEW_ARTIFACT_IMAGE_MIME_TYPES.some(
    (mimeType) => mimeType === value,
  );
}

function isPreviewMediaMimeType(
  value: string | null,
): value is PreviewMediaMimeType {
  return PREVIEW_MEDIA_MIME_TYPES.some((mimeType) => mimeType === value);
}

function isPreviewContentMimeType(
  value: string | null,
): value is PreviewContentMimeType {
  return PREVIEW_CONTENT_MIME_TYPES.some((mimeType) => mimeType === value);
}

function isPreviewTextMimeType(value: string | null): boolean {
  return value
    ? value.startsWith("text/") ||
        PREVIEW_TEXT_MIME_TYPES.some((mimeType) => mimeType === value)
    : false;
}

function isGenericTextCompatibleMimeType(value: string | null): boolean {
  return (
    value === null ||
    value === DEFAULT_ARTIFACT_MIME_TYPE ||
    isPreviewTextMimeType(value)
  );
}

function resolvePreviewContentMimeType(
  filename: string,
  storedMimeType: string | null,
): PreviewContentMimeType | undefined {
  const mimeType =
    storedMimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
  const inferredMimeType = mimeTypeFromFilename(filename);
  if (
    mimeType &&
    isPreviewContentMimeType(mimeType) &&
    inferredMimeType === mimeType
  ) {
    return mimeType;
  }
  if (
    isKnownPreviewTextFilename(filename) &&
    isGenericTextCompatibleMimeType(mimeType)
  ) {
    return isPreviewContentMimeType(mimeType) && isPreviewTextMimeType(mimeType)
      ? mimeType
      : "text/plain";
  }
  if (
    mimeType &&
    isPreviewTextMimeType(mimeType) &&
    isPreviewTextFilenameCandidate(filename)
  ) {
    return isPreviewContentMimeType(mimeType) ? mimeType : "text/plain";
  }
  return undefined;
}

function resolveAttachmentPreviewMimeType(
  filename: string,
  storedMimeType: string | null,
): AttachmentPreviewMimeType | undefined {
  const mimeType = normalizeMime(storedMimeType ?? undefined);
  if (
    mimeType &&
    (isPreviewImageMimeType(mimeType) || isPreviewMediaMimeType(mimeType)) &&
    matchesPreviewFilename(filename, mimeType)
  ) {
    return mimeType;
  }
  return resolvePreviewContentMimeType(filename, storedMimeType);
}

function isPreviewLinkMimeType(
  value: string | null,
): value is PreviewLinkMimeType {
  return PREVIEW_LINK_MIME_TYPES.some((mimeType) => mimeType === value);
}

function matchesPreviewFilename(
  filename: string,
  mimeType: PreviewContentMimeType | PreviewLinkMimeType,
): boolean {
  if (mimeType === "image/svg+xml") {
    return normalizedArtifactFilename(filename).endsWith(".svg");
  }
  return mimeTypeFromFilename(filename) === mimeType;
}

function isKnownPreviewTextFilename(filename: string): boolean {
  const inferredMimeType = mimeTypeFromFilename(filename);
  if (inferredMimeType && !isPreviewTextMimeType(inferredMimeType)) {
    return false;
  }
  if (inferredMimeType && isPreviewTextMimeType(inferredMimeType)) {
    return true;
  }
  const artifactFilename = normalizedArtifactFilename(filename);
  if (!artifactFilename) return false;
  const separator = artifactFilename.lastIndexOf(".");
  if (separator < 0) {
    return ARTIFACT_MIME_BY_FILENAME.has(artifactFilename);
  }
  const extension = artifactFilename.slice(separator + 1);
  return TEXT_PREVIEW_FALLBACK_EXTENSIONS.has(extension);
}

function isPreviewTextFilenameCandidate(filename: string): boolean {
  const inferredMimeType = mimeTypeFromFilename(filename);
  if (inferredMimeType && !isPreviewTextMimeType(inferredMimeType)) {
    return false;
  }
  return Boolean(normalizedArtifactFilename(filename));
}

function maximumPreviewContentSize(
  mimeType: PreviewContentMimeType,
  config: AppConfig,
): number {
  if (mimeType === "text/html") {
    return Math.min(
      config.upload.maxFileSizeBytes,
      MAXIMUM_HTML_PREVIEW_SIZE_BYTES,
    );
  }
  if (mimeType === "application/zip" || mimeType === "application/pdf") {
    return Math.min(
      config.upload.maxFileSizeBytes,
      mimeType === "application/zip"
        ? MAXIMUM_ZIP_PREVIEW_SIZE_BYTES
        : MAXIMUM_PDF_PREVIEW_SIZE_BYTES,
    );
  }
  if (PREVIEW_TEXT_MIME_TYPES.some((value) => value === mimeType)) {
    return Math.min(
      config.upload.maxFileSizeBytes,
      MAXIMUM_TEXT_PREVIEW_SIZE_BYTES,
    );
  }
  return config.upload.maxFileSizeBytes;
}

function maximumPreviewMediaSize(config: AppConfig): number {
  return Math.min(
    config.upload.maxFileSizeBytes,
    MAXIMUM_MEDIA_PREVIEW_SIZE_BYTES,
  );
}

function maximumAttachmentPreviewSize(
  mimeType: AttachmentPreviewMimeType,
  config: AppConfig,
): number {
  if (isPreviewImageMimeType(mimeType)) {
    return Math.min(
      config.upload.maxFileSizeBytes,
      MAXIMUM_IMAGE_PREVIEW_SIZE_BYTES,
    );
  }
  if (isPreviewMediaMimeType(mimeType)) {
    return maximumPreviewMediaSize(config);
  }
  return maximumPreviewContentSize(mimeType, config);
}

function maximumPreviewLinkSize(
  mimeType: PreviewLinkMimeType,
  config: AppConfig,
): number {
  return isPreviewArtifactImageMimeType(mimeType)
    ? Math.min(config.upload.maxFileSizeBytes, MAXIMUM_IMAGE_PREVIEW_SIZE_BYTES)
    : maximumPreviewMediaSize(config);
}

export function parseArtifactPreviewMediaRange(
  value: unknown,
): ArtifactPreviewMediaRangeRequest {
  if (value === undefined) return { type: "full" };
  if (typeof value !== "string") throwRangeNotSatisfiable();

  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match) throwRangeNotSatisfiable();
  const [, startValue, endValue] = match;
  if (!startValue && !endValue) throwRangeNotSatisfiable();

  if (!startValue) {
    const length = parseRangeInteger(endValue);
    if (length <= 0) throwRangeNotSatisfiable();
    return { type: "suffix", length };
  }

  const start = parseRangeInteger(startValue);
  if (!endValue) return { type: "from", start };
  const end = parseRangeInteger(endValue);
  if (end < start) throwRangeNotSatisfiable();
  return { type: "from", start, end };
}

function resolveArtifactPreviewMediaRange(
  requestedRange: ArtifactPreviewMediaRangeRequest,
  sizeBytes: number,
): { start: number; end: number } | null {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throwRangeNotSatisfiable();
  }
  if (requestedRange.type === "full") return null;

  if (requestedRange.type === "suffix") {
    const length = Math.min(requestedRange.length, sizeBytes);
    return { start: sizeBytes - length, end: sizeBytes - 1 };
  }

  if (requestedRange.start >= sizeBytes) throwRangeNotSatisfiable();
  const end = Math.min(requestedRange.end ?? sizeBytes - 1, sizeBytes - 1);
  if (end < requestedRange.start) throwRangeNotSatisfiable();
  return { start: requestedRange.start, end };
}

function parseRangeInteger(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) throwRangeNotSatisfiable();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throwRangeNotSatisfiable();
  return parsed;
}

function throwRangeNotSatisfiable(): never {
  throw new AppError("VALIDATION_ERROR", undefined, 416);
}

function throwAttachmentPreviewUnavailable(): never {
  throw new AppError("NOT_FOUND");
}

function assertAttachmentPreviewDescendant(
  root: string,
  candidate: string,
): void {
  try {
    assertDescendant(root, candidate);
  } catch {
    throwAttachmentPreviewUnavailable();
  }
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function projectFileEvent(row: {
  id: string;
  conversationId: string;
  turnId: string | null;
  sequenceNo: bigint;
  eventType: string;
  visibility: string;
  payloadJson: unknown;
  sseEventId: string;
  createdAt: Date;
}) {
  return conversationEventSchema.parse({
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    sequence_no: Number(row.sequenceNo),
    event_type: row.eventType,
    visibility: row.visibility,
    payload:
      row.payloadJson &&
      typeof row.payloadJson === "object" &&
      !Array.isArray(row.payloadJson)
        ? row.payloadJson
        : {},
    sse_event_id: row.sseEventId,
    created_at: row.createdAt.toISOString(),
  });
}

function projectTaskArtifact(row: TaskArtifactRow) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    turn_id: row.turnId,
    kind: "artifact" as const,
    source: row.source,
    status: "registered" as const,
    filename: row.filename,
    mime_type: row.mimeType,
    size_bytes: Number(row.sizeBytes),
    storage_backend: "minio" as const,
    downloadable: true,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    task: {
      id: row.conversationId,
      title: projectTaskTitle(
        row.conversationTitle,
        row.conversationTitleSource,
      ),
      archive_status: row.conversationArchiveStatus,
    },
  };
}

function encodeTaskArtifactCursor(row: TaskArtifactRow): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

export const fileServiceTesting = {
  safeFilename,
  assertDescendant,
  normalizeMime,
  readStableRegularFile,
  parseArtifactPreviewMediaRange,
};

function projectFile(row: {
  id: string;
  conversationId: string;
  draftId: string | null;
  pendingRequestId: string | null;
  turnId: string | null;
  kind: string;
  source: string;
  status: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: bigint;
  checksumSha256: string | null;
  storageBackend: string;
  workspaceRelativePath: string | null;
  downloadable: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    draft_id: row.draftId,
    pending_request_id: row.pendingRequestId,
    turn_id: row.turnId,
    kind: row.kind,
    source: row.source,
    status: row.status,
    filename: row.filename,
    mime_type: row.mimeType,
    size_bytes: Number(row.sizeBytes),
    checksum_sha256: row.checksumSha256,
    storage_backend: row.storageBackend,
    workspace_relative_path: row.workspaceRelativePath,
    downloadable: row.downloadable,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
