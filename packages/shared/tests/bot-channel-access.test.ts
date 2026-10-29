import { describe, expect, it } from "vitest";
import {
  botChannelAdminCreateSchema,
  botChannelCredentialsSchema,
  botChannelRegistrationSchema,
} from "../src/bot-channels.js";

describe("channel ownership contracts", () => {
  it("accepts organization credentials without a member allowlist", () => {
    expect(
      botChannelAdminCreateSchema.parse({
        provider: "wecom",
        bot_id: "bot",
        secret: "secret",
      }),
    ).toEqual({
      provider: "wecom",
      bot_id: "bot",
      secret: "secret",
      allow_group_messages: true,
    });
  });
  it("rejects a manually configured personal DingTalk bot and the removed sender restriction", () => {
    expect(
      botChannelAdminCreateSchema.safeParse({
        provider: "dingtalk",
        client_id: "app",
        client_secret: "secret",
      }).success,
    ).toBe(false);
    expect(
      botChannelAdminCreateSchema.safeParse({
        provider: "wecom",
        bot_id: "bot",
        secret: "secret",
        allowed_sender_id: "member",
      }).success,
    ).toBe(false);
  });
  it("keeps stored credentials separate from access policy", () => {
    expect(
      botChannelCredentialsSchema.safeParse({
        provider: "dingtalk",
        client_id: "app",
        client_secret: "secret",
      }).success,
    ).toBe(true);
    expect(
      botChannelCredentialsSchema.safeParse({
        provider: "dingtalk",
        client_id: "app",
        client_secret: "secret",
        allow_group_messages: true,
      }).success,
    ).toBe(false);
  });
  it("does not expose device codes or credentials in registration responses", () => {
    expect(
      botChannelRegistrationSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        status: "waiting_scan",
        qr_code_url: "https://www.dingtalk.com/",
        expires_at: "2026-10-29T12:00:00.000Z",
        connection_id: null,
        device_code: "private",
      }).success,
    ).toBe(false);
  });
});
