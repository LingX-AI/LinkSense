import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtempDisposable,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { addAbortSignal, Transform } from "node:stream";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Client } from "minio";
import dayjs from "dayjs";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { createMinioTransport } from "./minio-transport.js";

const localObjectMetadataSchema = z.record(z.string(), z.string());
const OBJECT_STORAGE_STREAM_SIZE_MISMATCH =
  "OBJECT_STORAGE_STREAM_SIZE_MISMATCH";

export interface ObjectStorage {
  ensureBucket(): Promise<void>;
  putObject(
    key: string,
    data: Buffer,
    metadata?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<void>;
  putObjectStream?(
    key: string,
    data: Readable,
    sizeBytes: number,
    metadata?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<void>;
  getObjectSize(key: string): Promise<number>;
  getObjectStream(key: string, signal?: AbortSignal): Promise<Readable>;
  getObjectRangeStream(
    key: string,
    start: number,
    length: number,
  ): Promise<Readable>;
  removeObject(key: string, signal?: AbortSignal): Promise<void>;
  removeIncompleteUpload?(key: string, signal: AbortSignal): Promise<void>;
  presignedGetObject(key: string, expiresSeconds: number): Promise<string>;
  presignedPostObject?(
    key: string,
    sizeBytes: number,
    expiresAt: Date,
    signal?: AbortSignal,
  ): Promise<{ url: string; fields: Record<string, string> }>;
  health(): Promise<void>;
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  return config.objectStorage.provider === "local-filesystem"
    ? new LocalFilesystemObjectStorage(config)
    : new MinioObjectStorage(config);
}

export class MinioObjectStorage implements ObjectStorage {
  readonly client: Client;
  readonly presignClient: Client;
  private readonly transport: ReturnType<typeof createMinioTransport>;

  constructor(private readonly config: AppConfig) {
    if (config.objectStorage.provider !== "minio") {
      throw new Error("MINIO_OBJECT_STORAGE_NOT_CONFIGURED");
    }
    const credentials = {
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      region: config.minio.region,
    };
    this.transport = createMinioTransport(config.minio.useSsl);
    this.client = new Client({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSsl,
      transport: this.transport.transport,
      ...credentials,
    });
    this.presignClient = new Client({
      endPoint: config.minio.publicEndpoint,
      port: config.minio.publicPort,
      useSSL: config.minio.publicUseSsl,
      ...credentials,
    });
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.config.minio.bucket);
    if (!exists) throw new Error("MINIO_BUCKET_NOT_FOUND");
  }

  async putObject(
    key: string,
    data: Buffer,
    metadata: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    await this.transport.run(signal, () => this.client.putObject(
      this.config.minio.bucket,
      key,
      data,
      data.byteLength,
      encodeMetadataHeaderValues(metadata),
    ));
  }

  async putObjectStream(
    key: string,
    data: Readable,
    sizeBytes: number,
    metadata: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    assertPositiveByteSize(sizeBytes, "OBJECT_STORAGE_STREAM_SIZE_INVALID");
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener("abort", abort, { once: true });
    const bounded = createExactSizeStream(sizeBytes);
    const transfer = pipeline(data, bounded, { signal: controller.signal });
    try {
      await Promise.all([
        transfer,
        this.transport.run(controller.signal, () => this.client.putObject(
          this.config.minio.bucket,
          key,
          bounded,
          sizeBytes,
          encodeMetadataHeaderValues(metadata),
        )),
      ]);
    } catch (error) {
      // Stop the HTTP request and source stream as soon as either side fails.
      controller.abort();
      await transfer.catch(() => undefined);
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      bounded.destroy();
    }
  }

  async removeObject(key: string, signal?: AbortSignal): Promise<void> {
    await this.transport.run(signal, () => this.client.removeObject(this.config.minio.bucket, key));
  }

  async removeIncompleteUpload(key: string, signal: AbortSignal): Promise<void> {
    await this.transport.run(signal, async () => {
      const bucket = this.config.minio.bucket;
      const id = await this.client.findUploadId(bucket, key);
      if (id) await this.client.abortMultipartUpload(bucket, key, id);
    });
  }

  async getObjectStream(key: string, signal?: AbortSignal): Promise<Readable> {
    if (!signal) return this.client.getObject(this.config.minio.bucket, key);
    signal.throwIfAborted();
    const stream = await this.transport.run(signal, () =>
      this.client.getObject(this.config.minio.bucket, key),
    );
    return addAbortSignal(signal, stream);
  }

  getObjectRangeStream(
    key: string,
    start: number,
    length: number,
  ): Promise<Readable> {
    return this.client.getPartialObject(
      this.config.minio.bucket,
      key,
      start,
      length,
    );
  }

  async getObjectSize(key: string): Promise<number> {
    const object = await this.client.statObject(this.config.minio.bucket, key);
    return object.size;
  }

  presignedGetObject(key: string, expiresSeconds: number): Promise<string> {
    return this.presignClient.presignedGetObject(
      this.config.minio.bucket,
      key,
      expiresSeconds,
    );
  }

  async presignedPostObject(
    key: string,
    sizeBytes: number,
    expiresAt: Date,
    signal?: AbortSignal,
  ): Promise<{ url: string; fields: Record<string, string> }> {
    assertPositiveByteSize(sizeBytes, "MINIO_POST_POLICY_INVALID");
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error("MINIO_POST_POLICY_INVALID");
    }
    signal?.throwIfAborted();
    const policy = this.presignClient.newPostPolicy();
    policy.setBucket(this.config.minio.bucket);
    policy.setKey(key);
    policy.setContentLengthRange(sizeBytes, sizeBytes);
    policy.setContentType("application/octet-stream");
    policy.setExpires(expiresAt);
    const post = await this.presignClient.presignedPostPolicy(policy);
    signal?.throwIfAborted();
    return { url: post.postURL, fields: post.formData };
  }

  async health(): Promise<void> {
    if (!(await this.client.bucketExists(this.config.minio.bucket))) {
      throw new Error("MINIO_BUCKET_NOT_FOUND");
    }
  }
}

export type LocalPresignedObject = {
  key: string;
  expires: number;
  signature: string;
};

export class LocalFilesystemObjectStorage implements ObjectStorage {
  readonly objectRoot: string;
  readonly metadataRoot: string;

  constructor(private readonly config: AppConfig) {
    if (config.objectStorage.provider !== "local-filesystem") {
      throw new Error("LOCAL_OBJECT_STORAGE_NOT_CONFIGURED");
    }
    this.objectRoot = resolve(config.objectStorage.localRoot, "objects");
    this.metadataRoot = resolve(config.objectStorage.localRoot, "metadata");
  }

  async ensureBucket(): Promise<void> {
    await Promise.all([
      mkdir(this.objectRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.metadataRoot, { recursive: true, mode: 0o700 }),
    ]);
  }

  async putObject(
    key: string,
    data: Buffer,
    metadata: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const objectPath = this.resolveObjectPath(key);
    const metadataPath = this.resolveMetadataPath(key);
    await Promise.all([
      mkdir(dirname(objectPath), { recursive: true, mode: 0o700 }),
      mkdir(dirname(metadataPath), { recursive: true, mode: 0o700 }),
    ]);
    const files = [
      { destination: objectPath, data },
      { destination: metadataPath, data: Buffer.from(JSON.stringify(metadata), "utf8") },
    ].map(file => ({ ...file, temporary: `${file.destination}.${randomUUID()}.tmp` }));
    try {
      await settleFileOperations(files.map(file =>
        writeFile(file.temporary, file.data, { mode: 0o600, signal }),
      ));
      signal?.throwIfAborted();
      await settleFileOperations(files.map(file => rename(file.temporary, file.destination)));
    } finally {
      await settleFileOperations(files.map(file => rm(file.temporary, { force: true })));
    }
  }

  async putObjectStream(
    key: string,
    data: Readable,
    sizeBytes: number,
    metadata: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    assertPositiveByteSize(
      sizeBytes,
      "LOCAL_OBJECT_STORAGE_STREAM_SIZE_INVALID",
    );
    signal?.throwIfAborted();
    const objectPath = this.resolveObjectPath(key);
    const metadataPath = this.resolveMetadataPath(key);
    const uploadRoot = this.streamUploadRoot(key);
    await settleFileOperations([dirname(objectPath), dirname(metadataPath), uploadRoot]
      .map(directory => mkdir(directory, { recursive: true, mode: 0o700 }).then(() => undefined)));
    await using upload = await mkdtempDisposable(resolve(uploadRoot, "write-"));
    const content = resolve(upload.path, "content");
    const metadataFile = resolve(upload.path, "metadata");
    await pipeline(data, createExactSizeStream(sizeBytes), createWriteStream(content, { mode: 0o600 }), { signal });
    await writeFile(metadataFile, JSON.stringify(metadata), { mode: 0o600, signal });
    signal?.throwIfAborted();
    await settleFileOperations([rename(content, objectPath), rename(metadataFile, metadataPath)]);
  }

  async removeIncompleteUpload(key: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await rm(this.streamUploadRoot(key), { recursive: true, force: true });
  }

  async getObjectSize(key: string): Promise<number> {
    return (await stat(this.resolveObjectPath(key))).size;
  }

  async getObjectStream(key: string, signal?: AbortSignal): Promise<Readable> {
    signal?.throwIfAborted();
    const objectPath = this.resolveObjectPath(key);
    await stat(objectPath);
    signal?.throwIfAborted();
    return signal
      ? createReadStream(objectPath, { signal })
      : createReadStream(objectPath);
  }

  async getObjectRangeStream(
    key: string,
    start: number,
    length: number,
  ): Promise<Readable> {
    if (!Number.isSafeInteger(start) || start < 0) {
      throw new Error("LOCAL_OBJECT_STORAGE_RANGE_INVALID");
    }
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new Error("LOCAL_OBJECT_STORAGE_RANGE_INVALID");
    }
    const objectPath = this.resolveObjectPath(key);
    await stat(objectPath);
    return createReadStream(objectPath, { start, end: start + length - 1 });
  }

  async removeObject(key: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await Promise.all([
      rm(this.resolveObjectPath(key), { force: true }),
      rm(this.resolveMetadataPath(key), { force: true }),
    ]);
  }

  async presignedGetObject(
    key: string,
    expiresSeconds: number,
  ): Promise<string> {
    this.resolveObjectPath(key);
    const expires = dayjs().unix() + expiresSeconds;
    const url = new URL(
      "/api/v1/development/object-storage",
      this.config.objectStorage.publicBaseUrl,
    );
    url.searchParams.set("key", key);
    url.searchParams.set("expires", String(expires));
    url.searchParams.set("signature", this.sign(key, expires));
    return url.toString();
  }

  authorizePresignedGet(input: LocalPresignedObject): void {
    if (!Number.isSafeInteger(input.expires)) {
      throw new Error("LOCAL_OBJECT_STORAGE_SIGNATURE_INVALID");
    }
    if (input.expires < dayjs().unix()) {
      throw new Error("LOCAL_OBJECT_STORAGE_SIGNATURE_EXPIRED");
    }
    const expected = Buffer.from(this.sign(input.key, input.expires), "hex");
    const actual = Buffer.from(input.signature, "hex");
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
      throw new Error("LOCAL_OBJECT_STORAGE_SIGNATURE_INVALID");
    }
    this.resolveObjectPath(input.key);
  }

  async getObjectContentType(key: string): Promise<string> {
    try {
      const metadata = localObjectMetadataSchema.parse(
        JSON.parse(await readFile(this.resolveMetadataPath(key), "utf8")),
      );
      return metadata["content-type"] ?? "application/octet-stream";
    } catch {
      // Missing or malformed local metadata falls back to a safe binary type.
    }
    return "application/octet-stream";
  }

  async health(): Promise<void> {
    await this.ensureBucket();
    await Promise.all([
      access(this.objectRoot, constants.R_OK | constants.W_OK),
      access(this.metadataRoot, constants.R_OK | constants.W_OK),
    ]);
  }

  private sign(key: string, expires: number): string {
    return createHmac("sha256", this.config.objectStorage.signingSecret)
      .update(`v1\n${expires}\n${key}`)
      .digest("hex");
  }

  private resolveObjectPath(key: string): string {
    return resolveStoragePath(this.objectRoot, key);
  }

  private resolveMetadataPath(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex");
    return resolve(this.metadataRoot, `${digest}.json`);
  }

  private streamUploadRoot(key: string): string {
    return resolve(this.config.objectStorage.localRoot, ".stream-uploads", createHash("sha256").update(key).digest("hex"));
  }
}

async function settleFileOperations(operations: Promise<void>[]): Promise<void> {
  for (const result of await Promise.allSettled(operations)) {
    if (result.status === "rejected") throw result.reason;
  }
}

function assertPositiveByteSize(sizeBytes: number, errorCode: string): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error(errorCode);
  }
}

function createExactSizeStream(sizeBytes: number): Transform {
  let receivedBytes = 0;
  const mismatch = () => new Error(OBJECT_STORAGE_STREAM_SIZE_MISMATCH);
  return new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      receivedBytes += bytes.byteLength;
      if (receivedBytes > sizeBytes) {
        callback(mismatch());
        return;
      }
      callback(null, bytes);
    },
    flush(callback) {
      callback(receivedBytes === sizeBytes ? null : mismatch());
    },
  });
}

function resolveStoragePath(root: string, key: string): string {
  if (
    key.length === 0 ||
    key.includes("\0") ||
    key.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("LOCAL_OBJECT_STORAGE_KEY_INVALID");
  }
  const absolutePath = resolve(root, key);
  const relativePath = relative(root, absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error("LOCAL_OBJECT_STORAGE_KEY_INVALID");
  }
  return absolutePath;
}

function encodeMetadataHeaderValues(
  metadata: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      [...value]
        .map((character) =>
          /^[\x20-\x7E]$/u.test(character)
            ? character
            : [...Buffer.from(character, "utf8")]
                .map(
                  (byte) =>
                    `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
                )
                .join(""),
        )
        .join(""),
    ]),
  );
}
