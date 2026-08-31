import { describe, expect, it, vi } from "vitest";

import {
  extractWeixinInboundText,
  normalizeWeixinApiBaseUrl,
  redirectHostToBaseUrl,
  splitWeixinText,
  WeixinIlinkClient,
  WeixinProtocolError,
} from "../src/modules/weixin/protocol.js";

describe("native Weixin iLink protocol", () => {
  it("starts bot_type=3 login with the required client headers", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        qrcode: "opaque-qr-id",
        qrcode_img_content: "https://weixin.qq.com/x/scan-me",
      }),
    );
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(client.startLogin([" token-a ", "token-b"])).resolves.toEqual({
      qrcode: "opaque-qr-id",
      qrcodeUrl: "https://weixin.qq.com/x/scan-me",
    });

    const [url, init] = (
      fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>
    )[0] ?? [new URL("https://invalid.test"), {}];
    expect(String(url)).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
    );
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toMatchObject({
      "iLink-App-Id": "bot",
      "iLink-App-ClientVersion": "132102",
      AuthorizationType: "ilink_bot_token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      local_token_list: ["token-a", "token-b"],
    });
    expect(JSON.stringify(init?.headers)).not.toContain("token-a");
  });

  it("long-polls with the cursor and recognizes expired credentials", async () => {
    const responses = [
      jsonResponse({
        ret: 0,
        get_updates_buf: "next-cursor",
        longpolling_timeout_ms: 0,
        msgs: [
          {
            seq: 1,
            message_id: Number.MAX_SAFE_INTEGER + 1,
            from_user_id: "wx-user",
            to_user_id: null,
            update_time_ms: null,
            message_state: 0,
            run_id: "run-id",
            item_list: [
              {
                type: 1,
                text_item: { text: "hello" },
                image_item: { media: { full_url: "ignored" } },
              },
            ],
            context_token: "context",
            root_id: 41,
            parent_id: 40,
          },
        ],
      }),
      jsonResponse({ ret: -14, errcode: -14, errmsg: "expired" }),
    ];
    const fetchMock = vi.fn(async () => responses.shift() ?? jsonResponse({}));
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(
      client.getUpdates({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        cursor: "current-cursor",
      }),
    ).resolves.toMatchObject({
      cursor: "next-cursor",
      messages: [
        expect.objectContaining({
          from_user_id: "wx-user",
          context_token: "context",
        }),
      ],
      suggestedTimeoutMs: 0,
    });
    const firstRequest = (
      fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>
    )[0]?.[1];
    expect(firstRequest?.headers).toMatchObject({
      Authorization: "Bearer bot-secret",
      AuthorizationType: "ilink_bot_token",
    });
    expect(JSON.parse(String(firstRequest?.body))).toEqual({
      get_updates_buf: "current-cursor",
      base_info: {
        channel_version: "2.4.6",
        bot_agent: "LinkSense/2.4.6",
      },
    });

    await expect(
      client.getUpdates({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        cursor: "next-cursor",
      }),
    ).rejects.toMatchObject({
      reasonCode: "WEIXIN_CREDENTIAL_EXPIRED",
    });
  });

  it("extracts direct text and transcribed voice while ignoring bots and groups", () => {
    const direct = {
      message_id: 42,
      seq: 7,
      from_user_id: "wx-user",
      message_type: 1,
      context_token: "context-secret",
      create_time_ms: Date.parse("2026-08-13T08:00:00.000Z"),
      item_list: [
        { type: 1, text_item: { text: " hello " } },
        { type: 3, voice_item: { text: "voice transcript" } },
      ],
    };
    const extracted = extractWeixinInboundText(direct);
    expect(extracted).toMatchObject({
      peerUserId: "wx-user",
      contextToken: "context-secret",
      text: "hello\nvoice transcript",
      sourceSequence: 7n,
    });
    expect(extracted?.messageKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(extractWeixinInboundText(direct)?.messageKey).toBe(
      extracted?.messageKey,
    );
    expect(
      extractWeixinInboundText({ ...direct, from_user_id: "other-user" })
        ?.messageKey,
    ).not.toBe(extracted?.messageKey);
    expect(
      extractWeixinInboundText({ ...direct, group_id: "group" }),
    ).toBeNull();
    expect(
      extractWeixinInboundText({ ...direct, message_type: 2 }),
    ).toBeNull();
    expect(
      extractWeixinInboundText({ ...direct, message_type: undefined }),
    ).toMatchObject({ text: "hello\nvoice transcript" });
    expect(
      extractWeixinInboundText({
        ...direct,
        item_list: [{ type: 2 }],
      }),
    ).toBeNull();
    expect(
      extractWeixinInboundText({
        ...direct,
        item_list: [
          { type: 1, text_item: { text: "a".repeat(600_000) } },
          { type: 1, text_item: { text: "b".repeat(600_000) } },
        ],
      }),
    ).toBeNull();
  });

  it("splits Unicode text without breaking code points and rejects unsafe hosts", () => {
    expect(splitWeixinText("甲乙\n丙丁", 3)).toEqual(["甲乙", "丙丁"]);
    expect(splitWeixinText("A😀BC", 2)).toEqual(["A😀", "BC"]);
    expect(
      normalizeWeixinApiBaseUrl("https://ilinkai.weixin.qq.com/"),
    ).toBe("https://ilinkai.weixin.qq.com");
    expect(redirectHostToBaseUrl("ilinkai-sg.weixin.qq.com")).toBe(
      "https://ilinkai-sg.weixin.qq.com",
    );
    expect(() =>
      normalizeWeixinApiBaseUrl("https://weixin.qq.com.attacker.test"),
    ).toThrow(WeixinProtocolError);
    expect(() => redirectHostToBaseUrl("127.0.0.1")).toThrow(
      WeixinProtocolError,
    );
    expect(() =>
      normalizeWeixinApiBaseUrl("https://ilinkai.weixin.qq.com:8443"),
    ).toThrow(WeixinProtocolError);
    expect(() =>
      normalizeWeixinApiBaseUrl("https://nested.ilinkai.weixin.qq.com"),
    ).toThrow(WeixinProtocolError);
  });

  it("rejects malformed JSON as an invalid protocol response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(client.startLogin([])).rejects.toMatchObject({
      reasonCode: "WEIXIN_PROTOCOL_INVALID",
    });
  });

  it("rejects an oversized upstream JSON response before reading it", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(32 * 1_024 * 1_024 + 1) },
      }),
    );
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(client.startLogin([])).rejects.toMatchObject({
      reasonCode: "WEIXIN_PROTOCOL_INVALID",
    });
  });

  it("accepts the empty send response used by the official implementation", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(
      client.sendText({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        toUserId: "wx-user",
        contextToken: "context",
        text: "hello",
        clientId: "client-id",
      }),
    ).resolves.toBeUndefined();
  });

  it("notifies Weixin when the channel starts and stops", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ret: 0 }));
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(
      client.notifyStart({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.notifyStop({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
      }),
    ).resolves.toBeUndefined();

    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(String(calls[0]?.[0])).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/msg/notifystart",
    );
    expect(String(calls[1]?.[0])).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/msg/notifystop",
    );
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
      base_info: {
        channel_version: "2.4.6",
        bot_agent: "LinkSense/2.4.6",
      },
    });
    expect(calls[0]?.[1].headers).toMatchObject({
      Authorization: "Bearer bot-secret",
      AuthorizationType: "ilink_bot_token",
    });
  });

  it("fetches config and sends native typing status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ret: 0, typing_ticket: " ticket " }))
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }))
      .mockResolvedValueOnce(jsonResponse({ ret: 0 }));
    const client = new WeixinIlinkClient(fetchMock as typeof fetch);

    await expect(
      client.getConfig({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        ilinkUserId: "wx-user",
        contextToken: "context-token",
      }),
    ).resolves.toEqual({ typingTicket: "ticket" });
    await expect(
      client.sendTyping({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        ilinkUserId: "wx-user",
        typingTicket: "ticket",
        status: "typing",
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.sendTyping({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        ilinkUserId: "wx-user",
        typingTicket: "ticket",
        status: "cancel",
      }),
    ).resolves.toBeUndefined();

    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(String(calls[0]?.[0])).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/getconfig",
    );
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
      ilink_user_id: "wx-user",
      context_token: "context-token",
      base_info: {
        channel_version: "2.4.6",
        bot_agent: "LinkSense/2.4.6",
      },
    });
    expect(String(calls[1]?.[0])).toBe(
      "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping",
    );
    expect(JSON.parse(String(calls[1]?.[1].body))).toMatchObject({
      ilink_user_id: "wx-user",
      typing_ticket: "ticket",
      status: 1,
    });
    expect(JSON.parse(String(calls[2]?.[1].body))).toMatchObject({
      ilink_user_id: "wx-user",
      typing_ticket: "ticket",
      status: 2,
    });
  });

  it("rejects either non-zero upstream result field", async () => {
    const responses = [
      jsonResponse({ ret: -14, errcode: 0 }),
      jsonResponse({ ret: 5, errcode: 0 }),
      jsonResponse({ ret: 0, errcode: 6 }),
    ];
    const client = new WeixinIlinkClient(
      vi.fn(async () => responses.shift() ?? jsonResponse({})) as typeof fetch,
    );

    await expect(
      client.getUpdates({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        cursor: "cursor",
      }),
    ).rejects.toMatchObject({ reasonCode: "WEIXIN_CREDENTIAL_EXPIRED" });
    await expect(
      client.getUpdates({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        cursor: "cursor",
      }),
    ).rejects.toMatchObject({ reasonCode: "WEIXIN_UPSTREAM_REJECTED" });
    await expect(
      client.sendText({
        baseUrl: "https://ilinkai.weixin.qq.com",
        token: "bot-secret",
        toUserId: "wx-user",
        contextToken: "context",
        text: "hello",
        clientId: "client-id",
      }),
    ).rejects.toMatchObject({ reasonCode: "WEIXIN_UPSTREAM_REJECTED" });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
