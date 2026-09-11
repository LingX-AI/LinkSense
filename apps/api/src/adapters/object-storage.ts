import { constants, createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

import { Client } from "minio";

import type { AppConfig } from "../config.js";

export interface ObjectStorage {
  ensureBucket(): Promise<void>;
  putObject(
    key: string,
    data: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void>;
  getObjectSize(key: string): Promise<number>;
  getObjectStream(key: string): Promise<Readable>;
  getObjectRangeStream(
    key: string,
    start: number,
    length: number,
  ): Promise<Readable>;
  removeObject(key: string): Promise<void>;
  presignedGetObject(key: string, expiresSeconds: number): Promise<string>;
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

  constructor(private readonly config: AppConfig) {
    if (config.objectStorage.provider !== "minio") {
      throw new Error("MINIO_OBJECT_STORAGE_NOT_CONFIGURED");
    }
    const credentials = {
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      region: config.minio.region,
    };
    this.client = new Client({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSsl,
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
  ): Promise<void> {
    await this.client.putObject(
      this.config.minio.bucket,
      key,
      data,
      data.byteLength,
      encodeMetadataHeaderValues(metadata),
    );
  }

  async removeObject(key: string): Promise<void> {
    await this.client.removeObject(this.config.minio.bucket, key);
  }

  getObjectStream(key: string): Promise<Readable> {
    return this.client.getObject(this.config.minio.bucket, key);
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
  ): Promise<void> {
    const objectPath = this.resolveObjectPath(key);
    const metadataPath = this.resolveMetadataPath(key);
    await Promise.all([
      mkdir(dirname(objectPath), { recursive: true, mode: 0o700 }),
      mkdir(dirname(metadataPath), { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      writeAtomic(objectPath, data),
      writeAtomic(metadataPath, Buffer.from(JSON.stringify(metadata), "utf8")),
    ]);
  }

  async getObjectSize(key: string): Promise<number> {
    return (await stat(this.resolveObjectPath(key))).size;
  }

  async getObjectStream(key: string): Promise<Readable> {
    const objectPath = this.resolveObjectPath(key);
    await stat(objectPath);
    return createReadStream(objectPath);
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

  async removeObject(key: string): Promise<void> {
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
    const expires = Math.floor(Date.now() / 1_000) + expiresSeconds;
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
    if (input.expires < Math.floor(Date.now() / 1_000)) {
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
      const metadata = JSON.parse(
        await readFile(this.resolveMetadataPath(key), "utf8"),
      ) as unknown;
      if (isStringRecord(metadata)) {
        return metadata["content-type"] ?? "application/octet-stream";
      }
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
}

async function writeAtomic(destination: string, data: Buffer): Promise<void> {
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, { mode: 0o600 });
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => typeof item === "string")
  );
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
