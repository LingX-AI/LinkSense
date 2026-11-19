import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtempDisposable } from "node:fs/promises";
import { join } from "node:path";
import { addAbortSignal, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  desktopArtifactPrepareSchema, desktopArtifactReceiptSchema, desktopArtifactUploadGrantSchema,
  desktopArtifactUploadLifetimeMs, type DesktopArtifactPrepare, type DesktopArtifactReceipt, type DesktopArtifactUploadGrant,
} from "@linksense/shared";
import { z } from "zod";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { desktopRunScopeSchema, type DesktopRunScope } from "../desktop-credentials/run-leases.js";
import {
  resolveVerifiedArtifactMetadata, type FileService,
} from "./service.js";
import { desktopArtifactObjectKey, desktopArtifactScratchPath, desktopArtifactStagingKey } from "./desktop-artifact-storage.js";

const storedGrantSchema = z.strictObject({
  scope: desktopRunScopeSchema, metadata: desktopArtifactPrepareSchema,
  artifactId: z.uuid(), expiresAt: z.number().int().positive(),
});
type StoredGrant = z.infer<typeof storedGrantSchema>;
type Check = () => Promise<void>;
type Fence = (tx: Prisma.TransactionClient) => Promise<void>;
type DesktopArtifactOptions = {
  redis: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: "PX", ttl: number): Promise<"OK" | null>;
    set(key: string, value: string, mode: "PX", ttl: number, when: "NX"): Promise<"OK" | null>;
    eval(script: string, count: 1, key: string, value: string): Promise<unknown>;
  };
  storage: Pick<ObjectStorage, "getObjectStream" | "putObjectStream" | "presignedPostObject">;
  maximumBytes: number;
  scratchRoot: string;
  scheduleCleanup: (conversationId: string, artifactId: string, expiresAt: number) => Promise<void>;
  reserveTransfer?: () => Promise<() => Promise<void>>;
  running: (scope: DesktopRunScope) => Promise<boolean>;
  exists: (conversationId: string, artifactId: string) => Promise<boolean>;
  register: FileService["registerVerifiedDesktopArtifact"];
};

const grantKey = (id: string) => `linksense:desktop-artifact:${id}`;
const pendingKey = (turnId: string) => `linksense:desktop-artifact-pending:${turnId}`;
const invalid = () => new AppError("ARTIFACT_REGISTRATION_INVALID");
const unavailable = () => new AppError("RUNNER_UNAVAILABLE");

export class DesktopArtifacts {
  constructor(private readonly options: DesktopArtifactOptions) {}

  async prepare(scope: DesktopRunScope, input: DesktopArtifactPrepare, signal: AbortSignal, check: Check): Promise<DesktopArtifactUploadGrant> {
    const metadata = desktopArtifactPrepareSchema.parse(input);
    if (metadata.size_bytes > this.options.maximumBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
    await this.checkRunning(scope, signal, check);
    const artifactId = randomUUID();
    const expiresAt = Date.now() + desktopArtifactUploadLifetimeMs;
    const pending = pendingKey(scope.turnId);
    if (await this.options.redis.set(pending, artifactId, "PX", desktopArtifactUploadLifetimeMs, "NX") !== "OK") {
      throw new AppError("CONFLICT");
    }
    try {
      const post = await this.options.storage.presignedPostObject?.(
        desktopArtifactStagingKey(artifactId), metadata.size_bytes, new Date(expiresAt), signal,
      ).catch(() => undefined);
      const base = { artifact_id: artifactId, expires_at: new Date(expiresAt).toISOString() };
      const direct = post && desktopArtifactUploadGrantSchema.safeParse({
        ...base, destination: { kind: "presigned_post", ...post },
      });
      const grant: DesktopArtifactUploadGrant = direct?.success ? direct.data : { ...base, destination: { kind: "api" } };
      // Persist cleanup before exposing a credential that can write storage.
      await this.options.scheduleCleanup(scope.conversationId, artifactId, expiresAt);
      await this.checkRunning(scope, signal, check);
      const stored = storedGrantSchema.parse({ scope, metadata, artifactId, expiresAt });
      if (await this.options.redis.set(grantKey(artifactId), JSON.stringify(stored), "PX", Math.max(1, expiresAt - Date.now())) !== "OK") {
        throw unavailable();
      }
      return grant;
    } catch (error) {
      await this.unlock(pending, artifactId);
      throw error instanceof AppError ? error : unavailable();
    }
  }

  async upload(scope: DesktopRunScope, artifactId: string, contentLength: number, stream: Readable, signal: AbortSignal, check: Check): Promise<void> {
    await this.withGrant(scope, artifactId, signal, check, async (stored, lifetime, authorize) => {
      if (contentLength !== stored.metadata.size_bytes) throw invalid();
      if (await this.options.exists(scope.conversationId, artifactId)) throw new AppError("CONFLICT");
      await authorize();
      await this.writeObject(desktopArtifactStagingKey(artifactId), stream, contentLength, "application/octet-stream", lifetime);
      await authorize();
    });
  }

  async confirm(scope: DesktopRunScope, artifactId: string, signal: AbortSignal, check: Check, fence: Fence): Promise<DesktopArtifactReceipt> {
    return this.withGrant(scope, artifactId, signal, check, async ({ metadata }, lifetime, authorize) => {
      const objectKey = desktopArtifactObjectKey(scope.conversationId, artifactId);
      const committed = await this.options.exists(scope.conversationId, artifactId);
      // Verify the immutable final object on replay; a presigned form can still replace staging before it expires.
      const sourceKey = committed ? objectKey : desktopArtifactStagingKey(artifactId);
      const scratch = desktopArtifactScratchPath(this.options.scratchRoot, artifactId);
      await mkdir(scratch, { recursive: true, mode: 0o700 });
      await using directory = await mkdtempDisposable(join(scratch, "verify-"));
      const filename = join(directory.path, "content");
      await this.verifyObject(sourceKey, filename, metadata, lifetime);
      const media = await resolveVerifiedArtifactMetadata({
        verifiedPath: filename, filename: metadata.filename, displayName: metadata.display_name,
        ...(metadata.mime_type && { reportedMimeType: metadata.mime_type }), signal: lifetime,
      }).catch(() => { throw invalid(); });
      await authorize();
      if (!committed) {
        await this.writeObject(objectKey, createReadStream(filename), metadata.size_bytes, media.mimeType, lifetime);
      }
      await authorize();
      const receipt = desktopArtifactReceiptSchema.parse(await this.options.register({
        ownerId: scope.ownerId, conversationId: scope.conversationId, projectionTurnId: scope.turnId,
        artifactId, displayName: media.filename, mimeType: media.mimeType, sizeBytes: metadata.size_bytes, sha256: metadata.sha256,
      }, async tx => {
        await fence(tx);
        lifetime.throwIfAborted();
      }));
      await this.unlock(pendingKey(scope.turnId), artifactId);
      return receipt;
    });
  }

  private async withGrant<T>(
    scope: DesktopRunScope, identifier: string, signal: AbortSignal, check: Check,
    work: (stored: StoredGrant, lifetime: AbortSignal, authorize: Check) => Promise<T>,
  ): Promise<T> {
    const artifactId = z.uuid().parse(identifier).toLowerCase();
    const key = grantKey(artifactId);
    const raw = await this.options.redis.get(key);
    if (raw === null) throw new AppError("FORBIDDEN");
    const parsed = storedGrantSchema.safeParse(JSON.parse(raw));
    const canonical = desktopRunScopeSchema.parse(scope);
    if (!parsed.success || parsed.data.artifactId !== artifactId ||
        JSON.stringify(parsed.data.scope) !== JSON.stringify(canonical)) {
      throw new AppError("FORBIDDEN");
    }
    const remaining = parsed.data.expiresAt - Date.now();
    if (remaining <= 0 || remaining > desktopArtifactUploadLifetimeMs) throw new AppError("FORBIDDEN");
    const lock = `${key}:operation`;
    const ticket = randomUUID();
    const controller = new AbortController();
    const lifetime = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(remaining)]);
    const authorize = () => this.checkRunning(scope, lifetime, check);
    await authorize();
    if (await this.options.redis.set(lock, ticket, "PX", remaining + 30_000, "NX") !== "OK") {
      throw new AppError("CONFLICT");
    }
    let releaseTransfer: (() => Promise<void>) | undefined;
    let monitor: NodeJS.Timeout | undefined;
    try {
      if (await this.options.redis.get(key) !== raw) throw new AppError("FORBIDDEN");
      releaseTransfer = await this.options.reserveTransfer?.();
      let checking = false;
      monitor = setInterval(() => {
        if (checking || lifetime.aborted) return;
        checking = true;
        void authorize().catch(() => controller.abort()).finally(() => { checking = false; });
      }, 1_000);
      monitor.unref();
      await authorize();
      return await work(parsed.data, lifetime, authorize);
    } catch (error) {
      if (error instanceof AppError && error.code === "ARTIFACT_REGISTRATION_INVALID" && await this.unlock(key, raw)) {
        await this.unlock(pendingKey(scope.turnId), artifactId);
      }
      throw error instanceof AppError ? error : unavailable();
    } finally {
      clearInterval(monitor);
      controller.abort();
      await releaseTransfer?.().catch(() => undefined);
      await this.unlock(lock, ticket);
    }
  }

  private async checkRunning(scope: DesktopRunScope, signal: AbortSignal, check: Check): Promise<void> {
    signal.throwIfAborted();
    await check();
    if (!await this.options.running(scope)) throw new AppError("FORBIDDEN");
    signal.throwIfAborted();
  }

  private async verifyObject(key: string, filename: string, metadata: DesktopArtifactPrepare, signal: AbortSignal): Promise<void> {
    const hash = createHash("sha256");
    let size = 0;
    const verify = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.byteLength;
        if (size > metadata.size_bytes) return done(invalid());
        hash.update(chunk);
        done(null, chunk);
      },
      flush(done) {
        done(size === metadata.size_bytes && hash.digest("hex") === metadata.sha256 ? null : invalid());
      },
    });
    const stream = await this.options.storage.getObjectStream(key, signal);
    await pipeline(stream, verify, createWriteStream(filename, { flags: "wx", mode: 0o600 }), { signal });
  }

  private async writeObject(key: string, stream: Readable, size: number, contentType: string, signal: AbortSignal): Promise<void> {
    if (!this.options.storage.putObjectStream) throw unavailable();
    try {
      await this.options.storage.putObjectStream(key, addAbortSignal(signal, stream), size, { "content-type": contentType }, signal);
    } finally {
      stream.destroy();
    }
  }

  private async unlock(key: string, value: string): Promise<boolean> {
    return await this.options.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0", 1, key, value,
    ).catch(() => 0) === 1;
  }
}
