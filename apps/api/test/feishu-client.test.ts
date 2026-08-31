import { describe, expect, it, vi } from "vitest";
import { defaultHttpInstance } from "@larksuiteoapi/node-sdk";

import {
  FEISHU_HTTP_TIMEOUT_MS,
  FEISHU_MESSAGE_EVENT,
  FEISHU_PERSONAL_AGENT_SCOPES,
  FeishuOfficialClient,
  FeishuProtocolError,
  splitFeishuText,
} from "../src/modules/feishu/client.js";

describe("FeishuOfficialClient", () => {
  it("uses the official personal-Agent registration flow and returns credentials server-side", async () => {
    const register = vi.fn(async (options: Record<string, unknown>) => {
      const onQr = options.onQRCodeReady as (info: {
        url: string;
        expireIn: number;
      }) => void;
      onQr({ url: "https://open.feishu.cn/scan/create-bot", expireIn: 300 });
      return {
        client_id: "cli_0123456789abcdef",
        client_secret: "registered-secret",
        user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
      };
    });
    const client = new FeishuOfficialClient(
      register as never,
    );
    const qrReady = vi.fn();

    const result = await client.registerPersonalAgent({
      signal: new AbortController().signal,
      appName: "LinkSense 个人助手",
      appDescription: "Personal assistant",
      onQrCodeReady: qrReady,
    });

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "linksense",
        createOnly: true,
        addons: {
          preset: false,
          scopes: { tenant: [...FEISHU_PERSONAL_AGENT_SCOPES] },
          events: { items: { tenant: [FEISHU_MESSAGE_EVENT] } },
        },
        appPreset: {
          name: "LinkSense 个人助手",
          desc: "Personal assistant",
        },
      }),
    );
    expect(qrReady).toHaveBeenCalledWith({
      url: "https://open.feishu.cn/scan/create-bot",
      expireIn: 300,
    });
    expect(result).toEqual({
      appId: "cli_0123456789abcdef",
      appSecret: "registered-secret",
      ownerOpenId: "ou_owner",
      domain: "feishu",
    });
  });

  it("updates the existing official bot when reconnecting", async () => {
    const register = vi.fn(async (options: Record<string, unknown>) => {
      void options;
      return {
        client_id: "cli_0123456789abcdef",
        client_secret: "registered-secret",
        user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
      };
    });
    const client = new FeishuOfficialClient(
      register as never,
    );

    await client.registerPersonalAgent({
      signal: new AbortController().signal,
      appName: "Agent",
      appDescription: "Agent",
      existingAppId: "cli_0123456789abcdef",
      onQrCodeReady: vi.fn(),
    });

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "cli_0123456789abcdef",
      }),
    );
    expect(register.mock.calls[0]?.[0]).not.toHaveProperty("createOnly");
  });

  it("allows selecting an app created by an earlier failed attempt", async () => {
    const register = vi.fn(async (options: Record<string, unknown>) => {
      void options;
      return {
        client_id: "cli_0123456789abcdef",
        client_secret: "registered-secret",
        user_info: { open_id: "ou_owner", tenant_brand: "feishu" },
      };
    });
    const client = new FeishuOfficialClient(register as never);

    await client.registerPersonalAgent({
      signal: new AbortController().signal,
      appName: "Agent",
      appDescription: "Agent",
      allowExistingSelection: true,
      onQrCodeReady: vi.fn(),
    });

    expect(register.mock.calls[0]?.[0]).not.toHaveProperty("createOnly");
    expect(register.mock.calls[0]?.[0]).not.toHaveProperty("appId");
  });

  it("requires the granted direct-message scope before connecting", async () => {
    const application = applicationClient({
      scopes: ["im:message:send_as_bot"],
    });
    const createChannel = vi.fn();
    const client = new FeishuOfficialClient(
      undefined,
      createChannel as never,
      undefined,
      (() => application.client) as never,
    );

    await expect(
      client.connect({
        credentials: {
          appId: "cli_0123456789abcdef",
          appSecret: "registered-secret",
          domain: "feishu",
        },
        ownerOpenId: "ou_owner",
        onMessage: vi.fn(),
        onError: vi.fn(),
        onReconnecting: vi.fn(),
        onReconnected: vi.fn(),
      }),
    ).rejects.toMatchObject({
      reasonCode: "FEISHU_REAUTHORIZATION_REQUIRED",
    } satisfies Partial<FeishuProtocolError>);
    expect(application.patch).not.toHaveBeenCalled();
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("requires application configuration permission before connecting", async () => {
    const application = applicationClient({
      scopes: [
        "im:message.p2p_msg:readonly",
        "im:message:send_as_bot",
      ],
    });
    const createChannel = vi.fn();
    const client = new FeishuOfficialClient(
      undefined,
      createChannel as never,
      undefined,
      (() => application.client) as never,
    );

    await expect(
      client.connect({
        credentials: {
          appId: "cli_0123456789abcdef",
          appSecret: "registered-secret",
          domain: "feishu",
        },
        ownerOpenId: "ou_owner",
        onMessage: vi.fn(),
        onError: vi.fn(),
        onReconnecting: vi.fn(),
        onReconnected: vi.fn(),
      }),
    ).rejects.toMatchObject({
      reasonCode: "FEISHU_REAUTHORIZATION_REQUIRED",
    } satisfies Partial<FeishuProtocolError>);
    expect(application.patch).not.toHaveBeenCalled();
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("fails closed when the official response does not identify the owner", async () => {
    const client = new FeishuOfficialClient(
      vi.fn(async () => ({
        client_id: "cli_0123456789abcdef",
        client_secret: "registered-secret",
      })) as never,
    );

    await expect(
      client.registerPersonalAgent({
        signal: new AbortController().signal,
        appName: "Agent",
        appDescription: "Agent",
        onQrCodeReady: vi.fn(),
      }),
    ).rejects.toMatchObject({
      reasonCode: "FEISHU_PROTOCOL_INVALID",
    } satisfies Partial<FeishuProtocolError>);
  });

  it("accepts only direct text messages sent by the scanning owner", async () => {
    let handlers: Record<string, (...args: never[]) => unknown> = {};
    let channelOptions: Record<string, unknown> | null = null;
    const channel = {
      botIdentity: { name: "LinkSense 个人助手" },
      on: vi.fn((value) => {
        handlers = value;
      }),
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    };
    const createChannel = vi.fn((options) => {
      channelOptions = options;
      return channel;
    });
    const application = applicationClient();
    const client = new FeishuOfficialClient(
      undefined,
      createChannel as never,
      undefined,
      (() => application.client) as never,
    );
    const onMessage = vi.fn(async () => undefined);

    await client.connect({
      credentials: {
        appId: "cli_0123456789abcdef",
        appSecret: "registered-secret",
        domain: "feishu",
      },
      ownerOpenId: "ou_owner",
      onMessage,
      onError: vi.fn(),
      onReconnecting: vi.fn(),
      onReconnected: vi.fn(),
    });
    const deliver = handlers.message as (message: unknown) => Promise<void>;
    await deliver(message({ senderId: "ou_other" }));
    await deliver(message({ chatType: "group" }));
    await deliver(message({ rawContentType: "image" }));
    await deliver(message());

    expect(channelOptions).toMatchObject({
      source: "linksense",
      policy: {
        dmMode: "allowlist",
        dmAllowlist: ["ou_owner"],
        requireMention: true,
      },
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKey: "om_message",
        chatId: "oc_chat",
        senderOpenId: "ou_owner",
        text: "hello",
      }),
    );
  });

  it("splits long replies into bounded text chunks", () => {
    expect(splitFeishuText("abc\ndef", 5)).toEqual(["abc\n", "def"]);
    expect(splitFeishuText("   ")).toEqual([]);
  });

  it("applies a bounded timeout to official SDK HTTP requests", () => {
    expect(defaultHttpInstance.defaults.timeout).toBe(
      FEISHU_HTTP_TIMEOUT_MS,
    );
  });

  it("sends text with a stable idempotency key", async () => {
    const create = vi.fn(async () => ({ code: 0 }));
    const client = new FeishuOfficialClient(
      undefined,
      undefined,
      () => ({ im: { message: { create } } }),
    );

    await client.sendText({
      credentials: {
        appId: "cli_0123456789abcdef",
        appSecret: "registered-secret",
        domain: "feishu",
      },
      chatId: "oc_chat",
      text: "hello",
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
    });

    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: "oc_chat",
        msg_type: "text",
        content: JSON.stringify({ text: "hello" }),
        uuid: "40000000-0000-4000-8000-000000000001",
      },
    });
  });
});

function applicationClient(
  options: { scopes?: string[]; patchCode?: number } = {},
) {
  const list = vi.fn(async () => ({
    code: 0,
    data: {
      scopes: (options.scopes ?? [...FEISHU_PERSONAL_AGENT_SCOPES]).map(
        (scopeName) => ({
          scope_name: scopeName,
          grant_status: 1,
          scope_type: "tenant" as const,
        }),
      ),
    },
  }));
  const patch = vi.fn(async () => ({ code: options.patchCode ?? 0 }));
  return {
    list,
    patch,
    client: {
      application: {
        scope: { list },
        v7: { applicationConfig: { patch } },
      },
    },
  };
}

function message(
  overrides: Partial<{
    senderId: string;
    chatType: "p2p" | "group";
    rawContentType: string;
  }> = {},
) {
  return {
    messageId: "om_message",
    chatId: "oc_chat",
    chatType: "p2p",
    senderId: "ou_owner",
    content: " hello ",
    rawContentType: "text",
    createTime: Date.parse("2026-08-27T08:00:00.000Z"),
    ...overrides,
  };
}
