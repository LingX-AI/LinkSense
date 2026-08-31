import { describe, expect, it } from "vitest";

import {
  weixinConnectionListSchema,
  weixinConnectionSchema,
  weixinLoginSessionSchema,
  weixinVerificationInputSchema,
} from "../src/weixin.js";

const CONNECTION_ID = "10000000-0000-4000-8000-000000000001";
const NOW = "2026-08-13T08:00:00.000Z";

const connection = {
  id: CONNECTION_ID,
  account_hint: "****1234",
  application: null,
  status: "active",
  runtime_status: "online",
  last_poll_at: NOW,
  last_inbound_at: null,
  last_error_code: null,
  created_at: NOW,
  updated_at: NOW,
};

describe("Weixin public contracts", () => {
  it("projects connection health without exposing protocol credentials", () => {
    expect(weixinConnectionSchema.parse(connection)).toEqual(connection);
    expect(
      weixinConnectionSchema.safeParse({
        ...connection,
        bot_token: "must-not-cross-the-api-boundary",
      }).success,
    ).toBe(false);
    expect(
      weixinConnectionListSchema.safeParse({
        items: [connection, { ...connection, id: crypto.randomUUID() }],
      }).success,
    ).toBe(false);
  });

  it("accepts a QR login projection without the opaque QR identifier", () => {
    const login = {
      id: "20000000-0000-4000-8000-000000000001",
      status: "waiting_scan",
      qrcode_url: "https://weixin.qq.com/x/example",
      expires_at: NOW,
      connection: null,
    };
    expect(weixinLoginSessionSchema.parse(login)).toEqual(login);
    expect(
      weixinLoginSessionSchema.safeParse({ ...login, qrcode: "secret" })
        .success,
    ).toBe(false);
  });

  it("requires a numeric pairing code with a bounded length", () => {
    expect(
      weixinVerificationInputSchema.parse({ verify_code: " 123456 " }),
    ).toEqual({ verify_code: "123456" });
    expect(
      weixinVerificationInputSchema.safeParse({ verify_code: "12ab" })
        .success,
    ).toBe(false);
  });
});
