import type { Redis } from "ioredis";
import { z } from "zod";

const leaseMilliseconds = 45_000;
const channel = "linksense:desktop-devices:connections";
const presenceKey = (id: string) => `linksense:desktop-devices:${id}:connection`;
export const desktopConnectionNoticeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("replaced"), deviceId: z.uuid(), supersededConnectionId: z.uuid() }),
  z.strictObject({ type: z.literal("revoked"), deviceId: z.uuid() }),
]);
export type DesktopConnectionNotice = z.infer<typeof desktopConnectionNoticeSchema>;

export interface DesktopDeviceCoordinator {
  connect(deviceId: string, connectionId: string): Promise<void>;
  maintain(deviceId: string, connectionId: string): Promise<"online" | "replaced" | "expired">;
  disconnect(deviceId: string, connectionId: string): Promise<void>;
  online(deviceIds: readonly string[]): Promise<Set<string>>;
  revoke(deviceId: string): Promise<void>;
  subscribe(listener: (notice: DesktopConnectionNotice) => void, onUnavailable: () => void): Promise<() => Promise<void>>;
}

export class RedisDesktopDeviceCoordinator implements DesktopDeviceCoordinator {
  constructor(private readonly redis: Redis) {}

  async connect(deviceId: string, connectionId: string): Promise<void> {
    await this.redis.eval(
      `local previous = redis.call('GET', KEYS[1])
       redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
       if previous and previous ~= ARGV[1] then
         redis.call('PUBLISH', KEYS[2], cjson.encode({type='replaced', deviceId=ARGV[3], supersededConnectionId=previous}))
       end
       return 1`,
      2, presenceKey(deviceId), channel, connectionId, String(leaseMilliseconds), deviceId,
    );
  }

  async maintain(deviceId: string, connectionId: string): Promise<"online" | "replaced" | "expired"> {
    const result = await this.redis.eval(
      "local current = redis.call('GET', KEYS[1]); if not current then return 0 end; if current ~= ARGV[1] then return 2 end; return redis.call('PEXPIRE', KEYS[1], ARGV[2])",
      1, presenceKey(deviceId), connectionId, String(leaseMilliseconds),
    );
    return result === 1 ? "online" : result === 2 ? "replaced" : "expired";
  }

  async disconnect(deviceId: string, connectionId: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1, presenceKey(deviceId), connectionId,
    );
  }

  async online(deviceIds: readonly string[]): Promise<Set<string>> {
    if (!deviceIds.length) return new Set();
    const values = await this.redis.mget(...deviceIds.map(presenceKey));
    return new Set(deviceIds.filter((_id, index) => values[index] != null));
  }

  async revoke(deviceId: string): Promise<void> {
    await this.redis.del(presenceKey(deviceId));
    await this.redis.publish(channel, JSON.stringify({ type: "revoked", deviceId }));
  }

  async subscribe(listener: (notice: DesktopConnectionNotice) => void, onUnavailable: () => void): Promise<() => Promise<void>> {
    const subscriber = this.redis.duplicate();
    let stopped = false;
    const unavailable = () => {
      if (stopped) return;
      stopped = true;
      subscriber.off("error", unavailable);
      subscriber.off("close", unavailable);
      subscriber.off("message", onMessage);
      subscriber.disconnect();
      onUnavailable();
    };
    const onMessage = (_channel: string, value: string) => {
      try {
        const parsed = desktopConnectionNoticeSchema.safeParse(JSON.parse(value));
        if (parsed.success) listener(parsed.data);
      } catch { /* Pub/sub is an untrusted data boundary. */ }
    };
    subscriber.on("message", onMessage);
    subscriber.on("error", unavailable);
    subscriber.on("close", unavailable);
    try {
      if (subscriber.status === "wait") await subscriber.connect();
      await subscriber.subscribe(channel);
    } catch (error) {
      subscriber.disconnect();
      throw error;
    }
    return async () => {
      if (stopped) return;
      stopped = true;
      subscriber.off("message", onMessage);
      subscriber.off("error", unavailable);
      subscriber.off("close", unavailable);
      await subscriber.quit();
    };
  }
}
