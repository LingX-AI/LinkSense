import type { Redis } from "ioredis";
import { z } from "zod";

export const desktopNoticeChannel = "linksense:desktop-devices:connections";
const desktopNoticeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("replaced"), deviceId: z.uuid(), supersededConnectionId: z.uuid() }),
  z.strictObject({ type: z.literal("revoked"), deviceId: z.uuid() }),
  z.strictObject({ type: z.literal("disconnected"), deviceId: z.uuid(), connectionId: z.uuid() }),
  z.strictObject({ type: z.literal("run_revoked"), turnId: z.uuid() }),
]);
export type DesktopNotice = z.infer<typeof desktopNoticeSchema>;

export async function subscribeDesktopNotices(
  redis: Redis,
  listener: (notice: DesktopNotice) => void,
  onUnavailable: () => void,
): Promise<() => void> {
  const subscriber = redis.duplicate({
    lazyConnect: true, retryStrategy: () => null, connectTimeout: 2_000, commandTimeout: 2_000,
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
      const parsed = desktopNoticeSchema.safeParse(JSON.parse(value));
      if (parsed.success) listener(parsed.data);
    } catch { /* Pub/sub is an untrusted data boundary. */ }
  };
  subscriber.on("message", onMessage);
  subscriber.on("error", unavailable);
  subscriber.on("close", unavailable);
  try {
    await subscriber.connect();
    await subscriber.subscribe(desktopNoticeChannel);
    return stop;
  } catch (error) {
    stop();
    throw error;
  }
}
