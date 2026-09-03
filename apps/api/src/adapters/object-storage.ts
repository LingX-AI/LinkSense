import { Client } from "minio";
import type { Readable } from "node:stream";

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

export class MinioObjectStorage implements ObjectStorage {
  readonly client: Client;
  readonly presignClient: Client;

  constructor(private readonly config: AppConfig) {
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
