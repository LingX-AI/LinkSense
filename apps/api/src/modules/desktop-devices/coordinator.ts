import type { Redis } from "ioredis";
import { z } from "zod";
import { desktopNoticeChannel, subscribeDesktopNotices, type DesktopNotice } from "./notices.js";

const leaseMilliseconds = 45_000;
const presenceKey = (id: string) => `linksense:desktop-devices:${id}:connection`;
const executionKey = (id: string) => `linksense:desktop-devices:${id}:execution`;
const knowledgeExecutionKey = (id: string) => `linksense:desktop-devices:${id}:execution-knowledge`;
const attachmentExecutionKey = (id: string) => `linksense:desktop-devices:${id}:execution-attachments`;
const commandKey = (id: string) => `linksense:desktop-execution:command:${id}`;
export type DesktopConnectionNotice = Exclude<DesktopNotice, { type: "disconnected" }>;
export const desktopExecutionBindingSchema = z.strictObject({
  deviceId: z.uuid(),
  connectionId: z.uuid(),
  gatewayId: z.uuid(),
});
export type DesktopExecutionBinding = z.infer<typeof desktopExecutionBindingSchema>;
export type DesktopPublication = {
  expiresAt: number;
  command?: { id: string; kind: "dispatch" | "cancel" };
};

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

  async executionConnection(deviceId: string): Promise<DesktopExecutionBinding | null> {
    const [connectionId, execution] = await this.redis.mget(presenceKey(deviceId), executionKey(deviceId));
    const prefix = `${connectionId}:`;
    if (!connectionId || !execution?.startsWith(prefix)) return null;
    return desktopExecutionBindingSchema.parse({ deviceId, connectionId, gatewayId: execution.slice(prefix.length) });
  }

  async enableExecution(binding: DesktopExecutionBinding, knowledge: boolean, attachments: boolean): Promise<boolean> {
    const enabled = await this.redis.eval(
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       local ttl = redis.call('PTTL', KEYS[1])
       if ttl <= 0 then return 0 end
       redis.call('SET', KEYS[2], ARGV[2], 'PX', ttl)
       if ARGV[3] == '1' then redis.call('SET', KEYS[3], ARGV[2], 'PX', ttl)
       else redis.call('DEL', KEYS[3]) end
       if ARGV[4] == '1' then redis.call('SET', KEYS[4], ARGV[2], 'PX', ttl)
       else redis.call('DEL', KEYS[4]) end
       return 1`,
      4, presenceKey(binding.deviceId), executionKey(binding.deviceId), knowledgeExecutionKey(binding.deviceId), attachmentExecutionKey(binding.deviceId),
      binding.connectionId, executionValue(binding), knowledge ? "1" : "0", attachments ? "1" : "0",
    );
    return enabled === 1;
  }

  supportsKnowledge(binding: DesktopExecutionBinding): Promise<boolean> {
    return this.supportsExecution(binding, knowledgeExecutionKey(binding.deviceId));
  }

  supportsAttachments(binding: DesktopExecutionBinding): Promise<boolean> {
    return this.supportsExecution(binding, attachmentExecutionKey(binding.deviceId));
  }

  private async supportsExecution(binding: DesktopExecutionBinding, capabilityKey: string): Promise<boolean> {
    const [presence, execution, capability] = await this.redis.mget(
      presenceKey(binding.deviceId), executionKey(binding.deviceId), capabilityKey,
    );
    const expected = executionValue(binding);
    return presence === binding.connectionId && execution === expected && capability === expected;
  }

  async mayDispatch(binding: DesktopExecutionBinding, commandId: string): Promise<boolean> {
    const [presence, execution, command] = await this.redis.mget(
      presenceKey(binding.deviceId), executionKey(binding.deviceId), commandKey(commandId),
    );
    return presence === binding.connectionId && execution === executionValue(binding) && command === "dispatch";
  }

  async cancelAttachmentPreparation(commandId: string): Promise<void> {
    await this.redis.eval(`
      if redis.call('GET', KEYS[1]) == 'dispatch' then redis.call('SET', KEYS[1], 'cancel', 'KEEPTTL') end
      return 1
    `, 1, commandKey(commandId));
  }

  async publishExecution(
    binding: DesktopExecutionBinding,
    channel: string,
    message: string,
    publication: DesktopPublication,
  ): Promise<"sent" | "unavailable" | "duplicate"> {
    const { command, expiresAt } = publication;
    const sent = await this.redis.eval(
      `if ARGV[6] == 'dispatch' and redis.call('EXISTS', KEYS[3]) == 1 then return -1 end
       if redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[2] then return 0 end
       local time = redis.call('TIME')
       local ttl = tonumber(ARGV[5]) - (tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000))
       if ttl <= 0 then return 0 end
       if #KEYS == 3 then redis.call('SET', KEYS[3], ARGV[6], 'PX', ttl) end
       local count = redis.call('PUBLISH', ARGV[3], ARGV[4])
       if count == 0 and ARGV[6] == 'dispatch' then redis.call('DEL', KEYS[3]) end
       return count`,
      command ? 3 : 2, presenceKey(binding.deviceId), executionKey(binding.deviceId),
      ...(command ? [commandKey(command.id)] : []),
      binding.connectionId, executionValue(binding), channel, message, String(expiresAt), command?.kind ?? "",
    );
    if (sent === -1) return "duplicate";
    return typeof sent === "number" && sent > 0 ? "sent" : "unavailable";
  }

  async connect(deviceId: string, connectionId: string): Promise<void> {
    await this.redis.eval(
      `local previous = redis.call('GET', KEYS[1])
       redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
       redis.call('DEL', KEYS[3], KEYS[4], KEYS[5])
       if previous and previous ~= ARGV[1] then
         redis.call('PUBLISH', KEYS[2], cjson.encode({type='replaced', deviceId=ARGV[3], supersededConnectionId=previous}))
       end
       return 1`,
      5, presenceKey(deviceId), desktopNoticeChannel, executionKey(deviceId), knowledgeExecutionKey(deviceId), attachmentExecutionKey(deviceId),
      connectionId, String(leaseMilliseconds), deviceId,
    );
  }

  async maintain(deviceId: string, connectionId: string): Promise<"online" | "replaced" | "expired"> {
    const result = await this.redis.eval(
      `local current = redis.call('GET', KEYS[1])
       if not current then return 0 end
       if current ~= ARGV[1] then return 2 end
       redis.call('PEXPIRE', KEYS[2], ARGV[2])
       redis.call('PEXPIRE', KEYS[3], ARGV[2])
       redis.call('PEXPIRE', KEYS[4], ARGV[2])
       return redis.call('PEXPIRE', KEYS[1], ARGV[2])`,
      4, presenceKey(deviceId), executionKey(deviceId), knowledgeExecutionKey(deviceId), attachmentExecutionKey(deviceId),
      connectionId, String(leaseMilliseconds),
    );
    return result === 1 ? "online" : result === 2 ? "replaced" : "expired";
  }

  async disconnect(deviceId: string, connectionId: string): Promise<void> {
    await this.redis.eval(
      `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
       redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4])
       return redis.call('PUBLISH', ARGV[2], ARGV[3])`,
      4, presenceKey(deviceId), executionKey(deviceId), knowledgeExecutionKey(deviceId), attachmentExecutionKey(deviceId),
      connectionId, desktopNoticeChannel,
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
      "redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4]); return redis.call('PUBLISH', ARGV[1], ARGV[2])",
      4, presenceKey(deviceId), executionKey(deviceId), knowledgeExecutionKey(deviceId), attachmentExecutionKey(deviceId), desktopNoticeChannel,
      JSON.stringify({ type: "revoked", deviceId } satisfies DesktopNotice),
    );
  }

  subscribe(listener: (notice: DesktopConnectionNotice) => void, onUnavailable: () => void): Promise<() => void> {
    return subscribeDesktopNotices(this.redis, notice => {
      if (notice.type !== "disconnected") listener(notice);
    }, onUnavailable);
  }
}

function executionValue(binding: DesktopExecutionBinding): string {
  return `${binding.connectionId}:${binding.gatewayId}`;
}
