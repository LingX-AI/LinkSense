import { expect, it } from "vitest";
import { ComputerUseService } from "../src/modules/computer-use/service.js";
import { RedisBrowserStore } from "../src/modules/browser-use/store.js";
import { createRedisFixture } from "./fixtures/redis.js";

it("keeps an authorized lease and sticky pause under real Redis atomic heartbeat races", async () => {
  const redis = await createRedisFixture();
  try {
    const store = new RedisBrowserStore(redis.client);
    const owner = "10000000-0000-4000-8000-000000000001";
    const service = new ComputerUseService(store, "http://127.0.0.1/api/v1/computer-use");
    const pairing = await service.pairing(owner, "date");
    const pair = await service.pair(pairing.code, "Atomic computer", "darwin");
    const credential = await service.authenticate(pair.token);
    if (!credential) throw new Error("credential missing");
    const connection = await service.connect(credential, pair.token);
    const update = { control: "running", permissions: { accessibility: "granted", screen_recording: "granted" } } as const;
    for (let index = 0; index < 20; index++) {
      expect(await Promise.all([
        service.maintain(owner, connection, update), service.maintain(owner, connection),
      ])).toEqual([true, true]);
    }
    await Promise.all([service.pause(owner, connection), service.maintain(owner, connection, update)]);
    expect(await service.paused(owner, connection)).toBe(true);
    await service.maintain(owner, connection, { ...update, control: "ready" });
    expect(await service.paused(owner, connection)).toBe(true);
    await service.resume(owner, connection);
    expect(await service.paused(owner, connection)).toBe(false);
  } finally { await redis.close(); }
});
