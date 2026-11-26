import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";

import { RedisDesktopCloudToolRelay } from "../src/modules/desktop-devices/cloud-tool-relay.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const instance = "30000000-0000-4000-8000-000000000001";
const otherInstance = "30000000-0000-4000-8000-000000000002";
const connection = "40000000-0000-4000-8000-000000000001";
const secondConnection = "40000000-0000-4000-8000-000000000002";

function fixture() {
  const scores = new Map<string, number>();
  const values = new Map<string, string>();
  const redis = {
    multi() {
      const commands: Array<() => void> = [];
      const chain = {
        zadd(_key: string, score: number, member: string) {
          commands.push(() => { scores.set(member, score); });
          return chain;
        },
        zrem(_key: string, member: string) {
          commands.push(() => { scores.delete(member); });
          return chain;
        },
        set(key: string, value: string) {
          commands.push(() => { values.set(key, value); });
          return chain;
        },
        del(key: string) {
          commands.push(() => { values.delete(key); });
          return chain;
        },
        async exec() {
          for (const command of commands) command();
          return [];
        },
      };
      return chain;
    },
    async zremrangebyscore(_key: string, _min: string, max: number) {
      for (const [member, score] of scores) {
        if (score <= max) scores.delete(member);
      }
    },
    async zrangebyscore(_key: string, min: number) {
      return [...scores].filter(([, score]) => score >= min)
        .sort((left, right) => left[1] - right[1]).map(([member]) => member);
    },
    async mget(keys: string[]) {
      return keys.map(key => values.get(key) ?? null);
    },
  };
  return {
    relay: new RedisDesktopCloudToolRelay(redis as unknown as Redis),
    scores,
  };
}

describe("desktop cloud tool Redis relay", () => {
  it("shares presence by owner, operation and instance without duplicating values", async () => {
    const { relay, scores } = fixture();
    await relay.announce({
      connectionId: connection, instanceId: instance, ownerId: owner,
      deviceId: "20000000-0000-4000-8000-000000000001",
      operations: ["local_tools.ping"],
    });
    await relay.announce({
      connectionId: secondConnection, instanceId: otherInstance, ownerId: other,
      deviceId: "20000000-0000-4000-8000-000000000002",
      operations: ["local_tools.ping"],
    });

    await expect(relay.candidates(owner, "local_tools.ping", otherInstance))
      .resolves.toMatchObject([{ connectionId: connection, instanceId: instance, ownerId: owner }]);
    await expect(relay.candidates(other, "local_tools.ping", instance))
      .resolves.toMatchObject([{ connectionId: secondConnection }]);
    await expect(relay.candidates(owner, "local_tools.ping", instance)).resolves.toEqual([]);

    await relay.withdraw(connection);
    await expect(relay.candidates(owner, "local_tools.ping", otherInstance)).resolves.toEqual([]);
    expect(scores.size).toBe(1);
  });

  it("drops expired presence instead of dispatching to a dead replica", async () => {
    const { relay, scores } = fixture();
    await relay.announce({
      connectionId: connection, instanceId: instance, ownerId: owner,
      deviceId: "20000000-0000-4000-8000-000000000001",
      operations: ["local_tools.ping"],
    });
    scores.set(connection, Date.now() - 1);
    await expect(relay.candidates(owner, "local_tools.ping", otherInstance)).resolves.toEqual([]);
    expect(scores.has(connection)).toBe(false);
  });
});
