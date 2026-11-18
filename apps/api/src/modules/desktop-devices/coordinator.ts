import type { Redis } from "ioredis";
import { desktopNoticeChannel, subscribeDesktopNotices, type DesktopNotice } from "./notices.js";

const leaseMilliseconds = 45_000;
const presenceKey = (id: string) => `linksense:desktop-devices:${id}:connection`;
export type DesktopConnectionNotice = Extract<DesktopNotice, { type: "revoked" | "replaced" }>;

export interface DesktopDeviceCoordinator {
  connect(deviceId: string, connectionId: string): Promise<void>;
  maintain(deviceId: string, connectionId: string): Promise<"online" | "replaced" | "expired">;
  disconnect(deviceId: string, connectionId: string): Promise<void>;
  online(deviceIds: readonly string[]): Promise<Set<string>>;
  revoke(deviceId: string): Promise<void>;
  subscribe(listener: (notice: DesktopConnectionNotice) => void, onUnavailable: () => void): Promise<() => void>;
}

export class RedisDesktopDeviceCoordinator implements DesktopDeviceCoordinator {
  constructor(private readonly redis: Redis) {}

  async isCurrentConnection(deviceId: string, connectionId: string): Promise<boolean> {
    return await this.redis.get(presenceKey(deviceId)) === connectionId;
  }

  async connect(deviceId: string, connectionId: string): Promise<void> {
    await this.redis.eval(
      `local previous = redis.call('GET', KEYS[1])
       redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
       if previous and previous ~= ARGV[1] then
         redis.call('PUBLISH', KEYS[2], cjson.encode({type='replaced', deviceId=ARGV[3], supersededConnectionId=previous}))
       end
       return 1`,
      2, presenceKey(deviceId), desktopNoticeChannel, connectionId, String(leaseMilliseconds), deviceId,
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
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       redis.call('DEL', KEYS[1])
       return redis.call('PUBLISH', ARGV[2], ARGV[3])`,
      1, presenceKey(deviceId), connectionId, desktopNoticeChannel,
      JSON.stringify({ type: "disconnected", deviceId, connectionId } satisfies DesktopNotice),
    );
  }

  async online(deviceIds: readonly string[]): Promise<Set<string>> {
    if (!deviceIds.length) return new Set();
    const values = await this.redis.mget(...deviceIds.map(presenceKey));
    return new Set(deviceIds.filter((_id, index) => values[index] != null));
  }

  async revoke(deviceId: string): Promise<void> {
    await this.redis.eval(
      "redis.call('DEL', KEYS[1]); return redis.call('PUBLISH', ARGV[1], ARGV[2])",
      1, presenceKey(deviceId), desktopNoticeChannel, JSON.stringify({ type: "revoked", deviceId } satisfies DesktopNotice),
    );
  }

  subscribe(listener: (notice: DesktopConnectionNotice) => void, onUnavailable: () => void): Promise<() => void> {
    return subscribeDesktopNotices(this.redis, notice => {
      if (notice.type === "revoked" || notice.type === "replaced") listener(notice);
    }, onUnavailable);
  }
}
