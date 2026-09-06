import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectWecom } from "../src/modules/bot-channels/clients/wecom.js";
import { connectDingtalk } from "../src/modules/bot-channels/clients/dingtalk.js";
import { connectTeams } from "../src/modules/bot-channels/clients/teams.js";
import type {
  ChannelConnectInput,
  ChannelSession,
} from "../src/modules/bot-channels/types.js";
import { platformPayload, testCredentials } from "./fixtures/bot-channels.js";

const sdk = vi.hoisted(() => ({ wecom: vi.fn(), ding: vi.fn() }));
vi.mock("@wecom/aibot-node-sdk", () => ({
  WSClient: class {
    constructor(options: unknown) {
      return sdk.wecom(options);
    }
  },
}));
vi.mock("dingtalk-stream", () => ({
  TOPIC_ROBOT: "/v1.0/im/bot/messages/get",
  DWClient: class {
    constructor(options: unknown) {
      return sdk.ding(options);
    }
  },
}));
const sessions: ChannelSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function input(provider: "wecom" | "dingtalk" | "teams"): ChannelConnectInput {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    credentials: testCredentials.find((item) => item.provider === provider)!,
    signal: new AbortController().signal,
    onMessage: vi.fn(async () => undefined),
    onError: vi.fn(),
  };
}

it("authenticates WeCom before becoming online, receives text and proactively replies", async () => {
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    isConnected: true,
    connect: vi.fn(() => emitter.emit("authenticated")),
    disconnect: vi.fn(),
    sendMessage: vi.fn(async () => undefined),
  });
  sdk.wecom.mockReturnValue(client);
  const args = input("wecom");
  const session = await connectWecom(args);
  sessions.push(session);
  expect(session.isConnected()).toBe(true);
  emitter.emit("message.text", { body: platformPayload("wecom", true) });
  await vi.waitFor(() => expect(args.onMessage).toHaveBeenCalledOnce());
  await session.send({ provider: "wecom", chatId: "group1" }, "reply");
  expect(client.sendMessage).toHaveBeenCalledWith("group1", {
    msgtype: "markdown",
    markdown: { content: "reply" },
  });
  emitter.emit("disconnected");
  expect(session.isConnected()).toBe(false);
  await expect(
    session.send({ provider: "wecom", chatId: "group1" }, "reply"),
  ).rejects.toThrow("BOT_CHANNEL_DELIVERY_FAILED");
});

it("closes an unauthenticated WeCom connection and returns a stable error", async () => {
  const emitter = new EventEmitter();
  const client = Object.assign(emitter, {
    connect: () => emitter.emit("error", new Error("sensitive raw response")),
    disconnect: vi.fn(),
  });
  sdk.wecom.mockReturnValue(client);
  await expect(connectWecom(input("wecom"))).rejects.toThrow(
    "BOT_CHANNEL_CONNECTION_FAILED",
  );
  expect(client.disconnect).toHaveBeenCalled();
});

function dingClient() {
  let callback:
    | ((frame: {
        data: string;
        headers: { messageId: string };
      }) => Promise<void>)
    | undefined;
  const client = {
    connected: true,
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    socketCallBackResponse: vi.fn(),
    registerCallbackListener: vi.fn(
      (_topic: string, listener: typeof callback) => {
        callback = listener;
      },
    ),
  };
  sdk.ding.mockReturnValue(client);
  return {
    client,
    receive: (payload: unknown) =>
      callback?.({
        data: JSON.stringify(payload),
        headers: { messageId: "frame-1" },
      }),
  };
}

it("cancels a stalled DingTalk WebSocket handshake within twenty seconds", async () => {
  vi.useFakeTimers();
  const { client } = dingClient();
  client.connected = false;
  let release: (() => void) | undefined;
  client.connect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  client.disconnect.mockImplementation(() => release?.());
  try {
    const attempt = connectDingtalk(input("dingtalk"));
    const failure = expect(attempt).rejects.toThrow(
      "BOT_CHANNEL_CONNECTION_FAILED",
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await failure;
    expect(client.disconnect).toHaveBeenCalled();
  } finally {
    release?.();
    vi.useRealTimers();
  }
});

it("acknowledges DingTalk only after durable persistence, leaving failures unacknowledged", async () => {
  const { client, receive } = dingClient();
  const args = input("dingtalk");
  let finish: (() => void) | undefined;
  vi.mocked(args.onMessage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  sessions.push(await connectDingtalk(args));
  const pending = receive(platformPayload("dingtalk"));
  expect(client.socketCallBackResponse).not.toHaveBeenCalled();
  finish?.();
  await pending;
  expect(client.socketCallBackResponse).toHaveBeenCalledOnce();
  vi.mocked(args.onMessage).mockRejectedValueOnce(
    new Error("database unavailable"),
  );
  await receive(platformPayload("dingtalk"));
  expect(client.socketCallBackResponse).toHaveBeenCalledOnce();
  expect(args.onError).toHaveBeenCalledWith(
    expect.objectContaining({ code: "BOT_CHANNEL_CONNECTION_FAILED" }),
  );
});

it.each([false, true])(
  "sends DingTalk text through its official %s group route and caches the token",
  async (group) => {
    dingClient();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ accessToken: "test-token", expireIn: 7200 }),
      )
      .mockImplementation(async () =>
        Response.json({ processQueryKey: "sent-1" }),
      );
    const session = await connectDingtalk(input("dingtalk"), request);
    sessions.push(session);
    const context = {
      provider: "dingtalk" as const,
      chatId: "group1",
      senderId: "member",
      group,
    };
    await session.send(context, "reply");
    await session.send(context, "second");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]?.[0]).toBe(
      `https://api.dingtalk.com/v1.0/robot/${group ? "groupMessages/send" : "oToMessages/batchSend"}`,
    );
    const options = request.mock.calls[1]?.[1];
    expect(JSON.parse(String(options?.body))).toMatchObject(
      group ? { openConversationId: "group1" } : { userIds: ["member"] },
    );
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  },
);

it("does not mark a rejected DingTalk recipient as sent", async () => {
  dingClient();
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ accessToken: "test-token", expireIn: 7200 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        processQueryKey: "sent-1",
        invalidStaffIdList: ["member"],
      }),
    );
  const session = await connectDingtalk(input("dingtalk"), request);
  sessions.push(session);
  await expect(
    session.send(
      {
        provider: "dingtalk",
        chatId: "chat",
        senderId: "member",
        group: false,
      },
      "reply",
    ),
  ).rejects.toThrow("BOT_CHANNEL_DELIVERY_FAILED");
});

describe("real Teams SDK authentication boundary", () => {
  it("rejects missing and malformed platform credentials even if an unsafe SDK environment flag is set", async () => {
    vi.stubEnv("SKIP_AUTH", "true");
    vi.stubEnv("DANGEROUSLY_ALLOW_UNAUTHENTICATED_REQUESTS", "true");
    const args = input("teams");
    const redis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    } as unknown as Redis;
    const session = await connectTeams(args, redis, {
      masterKey: Buffer.alloc(32, 2).toString("base64"),
      keyId: "test-key",
    });
    sessions.push(session);
    const body = platformPayload("teams");
    expect(await session.handleRequest?.({ body, headers: {} })).toMatchObject({
      status: 401,
    });
    expect(
      await session.handleRequest?.({
        body,
        headers: { authorization: "Bearer invalid-jwt" },
      }),
    ).toMatchObject({ status: 401 });
    expect(args.onMessage).not.toHaveBeenCalled();
    expect(args.onError).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(
      await session.handleRequest?.({ body: {}, headers: {} }),
    ).toMatchObject({ status: 400 });
  });
});
