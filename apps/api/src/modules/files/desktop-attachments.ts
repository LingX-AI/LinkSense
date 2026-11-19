import { createHash, timingSafeEqual } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { Readable } from "node:stream";
import {
  desktopAttachmentGrantFieldsSchema,
  desktopAttachmentSchema,
  desktopAttachmentTransferLifetimeMs,
  type DesktopAttachment,
} from "@linksense/shared";
import { z } from "zod";

import type { AppConfig } from "../../config.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { hmacSha256, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { resolveConversationWorkspaceRoot } from "../../lib/user-runtime-paths.js";
import type { DesktopRunScope } from "../desktop-credentials/run-leases.js";

const snapshotSchema = z.object({
  id: desktopAttachmentSchema.shape.id,
  kind: z.literal("attachment"),
  source: z.literal("user_upload"),
  filename: z.string().min(1).max(520).refine(name => name !== "." && name !== ".." && !name.includes("\0") && !name.includes("/")),
  sizeBytes: z.string().regex(/^\d+$/u),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/iu).nullable(),
  storageBackend: z.literal("workspace"),
  workspaceRelativePath: z.string(),
  workspaceRootRelPath: z.string(),
  createdBy: z.uuid(),
});
type AttachmentSnapshot = z.infer<typeof snapshotSchema>;

type AttachmentStore = {
  [K in "conversation" | "conversationFile" | "conversationTurnStartIntent"]: Pick<PrismaClient[K], "findFirst">;
};
const unavailable = () => new AppError("ATTACHMENT_UPLOAD_INVALID");

export function parseDesktopAttachmentGrant(raw: unknown): DesktopAttachmentGrant {
  const parsed = desktopAttachmentGrantFieldsSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("AUTH_REQUIRED");
  assertGrantCurrent(parsed.data);
  return parsed.data;
}

type DesktopAttachmentGrant = z.infer<typeof desktopAttachmentGrantFieldsSchema>;

function assertGrantCurrent(grant: DesktopAttachmentGrant): void {
  const remaining = grant.expiresAt - Date.now();
  if (remaining <= 0 || remaining > desktopAttachmentTransferLifetimeMs) throw new AppError("FORBIDDEN");
}

export class DesktopAttachments {
  constructor(
    private readonly prisma: AttachmentStore,
    private readonly config: Pick<AppConfig, "workspaceRoot" | "credentialMasterKey"> & {
      upload: Pick<AppConfig["upload"], "maxFilesPerConversation" | "maxFileSizeBytes">;
    },
  ) {}

  async manifest(scope: DesktopRunScope, count: number, commandId: string, expiresAt: number): Promise<DesktopAttachment[]> {
    const { files, pendingRequestId } = await this.prepared(scope);
    if (files.length !== count || !files.length) throw unavailable();
    const manifest: DesktopAttachment[] = [];
    const signal = AbortSignal.timeout(Math.max(0, Math.min(expiresAt - Date.now(), desktopAttachmentTransferLifetimeMs)));
    for (const file of files) {
      let digest = file.checksumSha256?.toLowerCase();
      if (digest === undefined) {
        signal.throwIfAborted();
        await this.assertSelected(scope, file, pendingRequestId);
        signal.throwIfAborted();
        const { handle, initial } = await this.openVerifiedFile(scope.ownerId, file);
        try {
          digest = await hashAttachment(handle, initial, signal);
          await this.assertSelected(scope, file, pendingRequestId);
          signal.throwIfAborted();
        } finally {
          await handle.close();
        }
      }
      manifest.push({
        // Historical uploads can contain a literal backslash or C1 character on Unix.
        id: file.id, filename: file.filename.replace(/[\p{Cc}\\]/gu, "_"), size_bytes: Number(file.sizeBytes), sha256: digest,
        download_grant: `${expiresAt}.${commandId}.${this.sign(scope, file, digest, { expiresAt, commandId })}`,
      });
    }
    return manifest;
  }

  async read(
    scope: DesktopRunScope,
    fileId: string,
    grant: DesktopAttachmentGrant,
    signal: AbortSignal,
    checkRun: () => Promise<void>,
  ): Promise<{ stream: Readable; byteLength: number; close: () => Promise<void> }> {
    const checkDeadline = () => {
      signal.throwIfAborted();
      assertGrantCurrent(grant);
    };
    checkDeadline();
    const { files, pendingRequestId } = await this.prepared(scope);
    const source = files.find(file => file.id === fileId);
    if (!source) throw new AppError("FORBIDDEN");
    const expectedDigest = source.checksumSha256?.toLowerCase();
    const assertSignature = (digest: string) => {
      if (!timingSafeEqual(Buffer.from(grant.signature, "hex"), Buffer.from(this.sign(scope, source, digest, grant), "hex"))) {
        throw new AppError("FORBIDDEN");
      }
    };
    if (expectedDigest !== undefined) assertSignature(expectedDigest);
    await this.assertSelected(scope, source, pendingRequestId);
    checkDeadline();
    const { handle, initial } = await this.openVerifiedFile(scope.ownerId, source);
    try {
      const chunkHashes: string[] = [];
      const digest = await hashAttachment(handle, initial, signal, chunkHashes);
      if (expectedDigest === undefined) assertSignature(digest);
      else if (digest !== expectedDigest) throw unavailable();
      await this.assertSelected(scope, source, pendingRequestId);
      await checkRun();
      checkDeadline();
      // The descriptor is pinned, but data can still change in place. Verify
      // each chunk again before exposing it instead of retaining a full copy.
      const chunks = async function* () {
        let index = 0;
        for await (const chunk of attachmentChunks(handle, initial, signal)) {
          if (sha256(chunk) !== chunkHashes[index++]) throw unavailable();
          yield chunk;
        }
      };
      const stream = Readable.from(chunks(), { objectMode: false, highWaterMark: attachmentChunkBytes });
      return { stream, byteLength: initial.size, close: () => handle.close() };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async ready(scope: DesktopRunScope): Promise<void> {
    if (!(await this.prepared(scope)).files.length) throw unavailable();
  }

  private async prepared(scope: DesktopRunScope) {
    const { ownerId, deviceId, conversationId, turnId, runtimeGeneration } = scope;
    const [intent, conversation] = await Promise.all([
      this.prisma.conversationTurnStartIntent.findFirst({
        where: { projectionTurnId: turnId, ownerId, conversationId, runtimeGeneration, runnerStatus: "prepared" },
        select: { attachmentsJson: true, pendingRequestId: true },
      }),
      this.prisma.conversation.findFirst({
        where: { id: conversationId, ownerId, desktopDeviceId: deviceId, runtimeGeneration, executionTarget: "local", archiveStatus: "active" },
        select: { workspaceRelPath: true },
      }),
    ]);
    if (!intent || !conversation) throw new AppError("FORBIDDEN");
    const parsed = z.array(snapshotSchema).max(this.config.upload.maxFilesPerConversation).safeParse(intent.attachmentsJson);
    if (!parsed.success || new Set(parsed.data.map(file => file.id)).size !== parsed.data.length || parsed.data.some(file =>
      file.createdBy !== ownerId || file.workspaceRootRelPath !== conversation.workspaceRelPath ||
      file.workspaceRelativePath !== `attachments/${file.id}/${file.filename}` ||
      !Number.isSafeInteger(Number(file.sizeBytes)) || Number(file.sizeBytes) > this.config.upload.maxFileSizeBytes
    )) throw unavailable();
    return { files: parsed.data, pendingRequestId: intent.pendingRequestId };
  }

  private async assertSelected(scope: DesktopRunScope, file: AttachmentSnapshot, pendingRequestId: string | null): Promise<void> {
    const selected = await this.prisma.conversationFile.findFirst({
      where: {
        id: file.id, conversationId: scope.conversationId,
        kind: "attachment", source: "user_upload", createdBy: scope.ownerId,
        pendingRequestId, turnId: null, status: pendingRequestId ? "pending" : "staged",
        storageBackend: "workspace", filename: file.filename,
        sizeBytes: BigInt(file.sizeBytes), checksumSha256: file.checksumSha256,
        workspaceRelativePath: file.workspaceRelativePath, workspaceRootRelPath: file.workspaceRootRelPath,
      },
      select: { id: true },
    });
    if (!selected) throw unavailable();
  }

  private async openVerifiedFile(ownerId: string, file: AttachmentSnapshot): Promise<{ handle: FileHandle; initial: Stats }> {
    let handle: FileHandle | undefined;
    try {
      const base = resolve(this.config.workspaceRoot);
      const candidateRoot = resolveConversationWorkspaceRoot(base, ownerId, file.workspaceRootRelPath);
      const candidate = resolve(candidateRoot, file.workspaceRelativePath);
      handle = await openAttachmentFile(await realpath(base), relative(base, candidate));
      const initial = await handle.stat();
      if (!initial.isFile() || initial.size !== Number(file.sizeBytes) ||
          (file.checksumSha256 === null && initial.nlink !== 1)) throw unavailable();
      return { handle, initial };
    } catch {
      await handle?.close();
      throw unavailable();
    }
  }

  private sign(scope: DesktopRunScope, file: AttachmentSnapshot, digest: string, { commandId, expiresAt }: Omit<DesktopAttachmentGrant, "signature">): string {
    return hmacSha256(this.config.credentialMasterKey, "desktop-attachment-v1:", JSON.stringify([
      scope.ownerId, scope.deviceId, scope.connectionId, scope.conversationId, scope.turnId, scope.runtimeGeneration,
      file.id, file.filename, file.sizeBytes, digest, commandId, expiresAt,
    ]));
  }
}

const attachmentChunkBytes = 1024 * 1024;

async function hashAttachment(handle: FileHandle, initial: Stats, signal: AbortSignal, chunkHashes?: string[]): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of attachmentChunks(handle, initial, signal)) {
    hash.update(chunk);
    chunkHashes?.push(sha256(chunk));
  }
  return hash.digest("hex");
}

async function* attachmentChunks(handle: FileHandle, initial: Stats, signal: AbortSignal): AsyncGenerator<Buffer> {
  try {
    for (let offset = 0; offset < initial.size;) {
      signal.throwIfAborted();
      const data = Buffer.allocUnsafe(Math.min(initial.size - offset, attachmentChunkBytes));
      let filled = 0;
      while (filled < data.byteLength) {
        const { bytesRead } = await handle.read(data, filled, data.byteLength - filled, offset + filled);
        signal.throwIfAborted();
        if (!bytesRead) throw unavailable();
        filled += bytesRead;
      }
      offset += data.byteLength;
      // Check metadata before yielding the last byte: HTTP cannot retract
      // an already completed Content-Length response.
      if (offset === initial.size) {
        const current = await handle.stat();
        signal.throwIfAborted();
        if (current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs) throw unavailable();
      }
      yield data;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw unavailable();
  }
}

async function openAttachmentFile(root: string, relativePath: string): Promise<FileHandle> {
  const components = relativePath.split(sep);
  const filename = components.pop();
  if (!filename || filename === ".." || components.includes("..")) throw unavailable();
  const fileFlags = constants.O_RDONLY | constants.O_NONBLOCK;
  if (process.platform === "darwin") {
    // Darwin's O_NOFOLLOW_ANY cannot be combined with O_NOFOLLOW.
    return open(resolve(root, relativePath), fileFlags | 0x20000000);
  }
  if (process.platform !== "linux") throw unavailable();
  const directoryFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;
  let directory = await open(root, directoryFlags);
  try {
    for (const component of components) {
      const child = await open(`/proc/self/fd/${directory.fd}/${component}`, directoryFlags);
      const parent = directory;
      directory = child;
      await parent.close();
    }
    return await open(`/proc/self/fd/${directory.fd}/${filename}`, fileFlags | constants.O_NOFOLLOW);
  } finally {
    await directory.close();
  }
}
