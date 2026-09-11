import { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinkSenseRedis } from "../src/adapters/redis.js";
import { testConfig } from "./test-config.js";

const clients: Redis[] = [];
const incompleteResults: Array<Array<[Error | null, unknown]> | null> = [
  null, [], [[null, 1]], [[null, 1], [new Error("internal connection details"), null]],
];
afterEach(() => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.disconnect();
});

function fixture() {
  const client = new Redis({ lazyConnect: true, enableOfflineQueue: false });
  clients.push(client);
  const pipeline = client.pipeline();
  vi.spyOn(client, "pipeline").mockReturnValue(pipeline);
  const publish = vi.spyOn(pipeline, "publish");
  const exec = vi.spyOn(pipeline, "exec").mockResolvedValue([[null, 1], [null, 0]]);
  return { client, publish, exec, service: new LinkSenseRedis(testConfig(), client) };
}

describe("ordered conversation event notifications", () => {
  it("publishes unchanged individual events in order using one pipeline", async () => {
    const { service, publish, exec } = fixture();
    const events = [{ id: "first", text: "甲🙂" }, { id: "second", text: "乙" }];
    await service.publishConversationEvents("conversation", events);
    expect(publish.mock.calls).toEqual(events.map(event => ["linksense:conversation-events:conversation", JSON.stringify(event)]));
    expect(exec).toHaveBeenCalledOnce();
  });

  it.each(incompleteResults.map(result => ({ result })))("rejects failed or incomplete pipeline result %# without exposing its cause", async ({ result }) => {
    const { service, exec } = fixture();
    exec.mockResolvedValue(result);
    await expect(service.publishConversationEvents("conversation", [{ id: 1 }, { id: 2 }])).rejects.toMatchObject({ name: "RedisUnavailableError", stage: "event_publish", message: "Redis operation unavailable" });
  });

  it("propagates connection failure and does not issue commands for an empty batch", async () => {
    const { service, client, exec } = fixture();
    await service.publishConversationEvents("conversation", []);
    expect(client.pipeline).not.toHaveBeenCalled();
    exec.mockRejectedValue(new Error("connection unavailable"));
    await expect(service.publishConversationEvents("conversation", [{ id: 1 }])).rejects.toMatchObject({ name: "RedisUnavailableError" });
  });
});
