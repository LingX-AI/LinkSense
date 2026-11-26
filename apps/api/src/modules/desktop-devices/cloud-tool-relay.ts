import type { Redis } from "ioredis";
import { z } from "zod";
import {
  desktopCloudToolErrorCodeSchema,
  desktopCloudToolOperationSchema,
  desktopCloudToolPingInputSchema,
  desktopCloudToolPingResultSchema,
  type DesktopCloudToolOperation,
} from "@linksense/shared";

/**
 * Cross-replica relay for the cloud tool lane. The Mac WebSocket lives on one
 * API replica while a runner request may land on any other, so the owning
 * replica address must be shared through Redis rather than process memory.
 */
const connectionTtlMs = 45_000;
const connectionsKey = "linksense:desktop-cloud-tools:connections";
const connectionKey = (connectionId: string) =>
  `linksense:desktop-cloud-tools:connection:${connectionId}`;
const requestChannel = (instanceId: string) =>
  `linksense:desktop-cloud-tools:requests:${instanceId}`;
const replyChannel = "linksense:desktop-cloud-tools:replies";

const presenceSchema = z.strictObject({
  instanceId: z.uuid(),
  ownerId: z.uuid(),
  deviceId: z.uuid(),
  operations: z.array(desktopCloudToolOperationSchema),
});

export const cloudToolRemoteRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("execute"),
    request_id: z.uuid(),
    connection_id: z.uuid(),
    owner_id: z.uuid(),
    operation: desktopCloudToolOperationSchema,
    input: desktopCloudToolPingInputSchema,
  }),
  z.strictObject({
    type: z.literal("cancel"),
    request_id: z.uuid(),
    connection_id: z.uuid(),
    operation: desktopCloudToolOperationSchema,
  }),
]);
export type CloudToolRemoteRequest = z.infer<
  typeof cloudToolRemoteRequestSchema
>;

export const cloudToolRemoteReplySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("result"),
    request_id: z.uuid(),
    ok: z.literal(true),
    data: desktopCloudToolPingResultSchema,
  }),
  z.strictObject({
    type: z.literal("result"),
    request_id: z.uuid(),
    ok: z.literal(false),
    error_code: desktopCloudToolErrorCodeSchema,
  }),
]);
export type CloudToolRemoteReply = z.infer<
  typeof cloudToolRemoteReplySchema
>;

export type CloudToolPresence = {
  connectionId: string;
  instanceId: string;
  ownerId: string;
  deviceId: string;
  operations: readonly string[];
};

export type CloudToolRemoteCandidate = {
  connectionId: string;
  instanceId: string;
  ownerId: string;
  deviceId: string;
};

export interface DesktopCloudToolRelay {
  announce(presence: CloudToolPresence): Promise<void>;
  withdraw(connectionId: string): Promise<void>;
  candidates(
    ownerId: string,
    operation: DesktopCloudToolOperation,
    excludeInstanceId: string,
  ): Promise<CloudToolRemoteCandidate[]>;
  publishRequest(
    instanceId: string,
    request: CloudToolRemoteRequest,
  ): Promise<number>;
  subscribeRequests(
    instanceId: string,
    listener: (request: CloudToolRemoteRequest) => void,
    onUnavailable: () => void,
  ): Promise<() => void>;
  publishReply(reply: CloudToolRemoteReply): Promise<number>;
  subscribeReplies(
    listener: (reply: CloudToolRemoteReply) => void,
    onUnavailable: () => void,
  ): Promise<() => void>;
}

export class RedisDesktopCloudToolRelay implements DesktopCloudToolRelay {
  constructor(private readonly redis: Redis) {}

  async announce(presence: CloudToolPresence): Promise<void> {
    const expiresAt = Date.now() + connectionTtlMs;
    await this.redis
      .multi()
      .zadd(connectionsKey, expiresAt, presence.connectionId)
      .set(
        connectionKey(presence.connectionId),
        JSON.stringify(presenceSchema.parse({
          instanceId: presence.instanceId,
          ownerId: presence.ownerId,
          deviceId: presence.deviceId,
          operations: presence.operations,
        })),
        "PX",
        connectionTtlMs,
      )
      .exec();
  }

  async withdraw(connectionId: string): Promise<void> {
    await this.redis
      .multi()
      .zrem(connectionsKey, connectionId)
      .del(connectionKey(connectionId))
      .exec();
  }

  async candidates(
    ownerId: string,
    operation: DesktopCloudToolOperation,
    excludeInstanceId: string,
  ): Promise<CloudToolRemoteCandidate[]> {
    const now = Date.now();
    await this.redis.zremrangebyscore(connectionsKey, "-inf", now);
    const connectionIds = await this.redis.zrangebyscore(
      connectionsKey,
      now,
      "+inf",
    );
    if (connectionIds.length === 0) return [];
    const values = await this.redis.mget(
      connectionIds.map((connectionId) => connectionKey(connectionId)),
    );
    const candidates: CloudToolRemoteCandidate[] = [];
    for (const [index, value] of values.entries()) {
      const connectionId = connectionIds[index];
      if (!value || !connectionId) continue;
      let parsed: z.infer<typeof presenceSchema>;
      try {
        parsed = presenceSchema.parse(JSON.parse(value));
      } catch {
        continue;
      }
      if (
        parsed.ownerId !== ownerId ||
        parsed.instanceId === excludeInstanceId ||
        !parsed.operations.includes(operation)
      ) {
        continue;
      }
      candidates.push({
        connectionId,
        instanceId: parsed.instanceId,
        ownerId: parsed.ownerId,
        deviceId: parsed.deviceId,
      });
    }
    return candidates;
  }

  async publishRequest(
    instanceId: string,
    request: CloudToolRemoteRequest,
  ): Promise<number> {
    return await this.redis.publish(
      requestChannel(instanceId),
      JSON.stringify(cloudToolRemoteRequestSchema.parse(request)),
    );
  }

  subscribeRequests(
    instanceId: string,
    listener: (request: CloudToolRemoteRequest) => void,
    onUnavailable: () => void,
  ): Promise<() => void> {
    return this.subscribe(
      requestChannel(instanceId),
      cloudToolRemoteRequestSchema,
      listener,
      onUnavailable,
    );
  }

  async publishReply(reply: CloudToolRemoteReply): Promise<number> {
    return await this.redis.publish(
      replyChannel,
      JSON.stringify(cloudToolRemoteReplySchema.parse(reply)),
    );
  }

  subscribeReplies(
    listener: (reply: CloudToolRemoteReply) => void,
    onUnavailable: () => void,
  ): Promise<() => void> {
    return this.subscribe(
      replyChannel,
      cloudToolRemoteReplySchema,
      listener,
      onUnavailable,
    );
  }

  private async subscribe<T>(
    channel: string,
    schema: z.ZodType<T>,
    listener: (value: T) => void,
    onUnavailable: () => void,
  ): Promise<() => void> {
    const subscriber = this.redis.duplicate({
      lazyConnect: true,
      retryStrategy: () => null,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
    });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      subscriber.off("error", unavailable);
      subscriber.off("close", unavailable);
      subscriber.off("message", onMessage);
      subscriber.disconnect();
    };
    const unavailable = () => {
      if (stopped) return;
      stop();
      onUnavailable();
    };
    const onMessage = (_channel: string, value: string) => {
      try {
        const parsed = schema.safeParse(JSON.parse(value));
        if (parsed.success) listener(parsed.data);
      } catch {
        // Pub/sub is an untrusted data boundary.
      }
    };
    subscriber.on("message", onMessage);
    subscriber.on("error", unavailable);
    subscriber.on("close", unavailable);
    try {
      await subscriber.connect();
      await subscriber.subscribe(channel);
      return stop;
    } catch (error) {
      stop();
      throw error;
    }
  }
}
