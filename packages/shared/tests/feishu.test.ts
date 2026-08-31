import { describe, expect, it } from "vitest";

import {
  feishuConnectionSchema,
  feishuRegistrationSessionSchema,
  feishuRegistrationStartInputSchema,
} from "../src/feishu.js";

const connection = {
  id: "10000000-0000-4000-8000-000000000001",
  account_hint: "****1234",
  bot_name: "LinkSense 个人助手",
  status: "active",
  runtime_status: "online",
  last_connected_at: "2026-08-27T08:00:00.000Z",
  last_inbound_at: null,
  last_error_code: null,
  created_at: "2026-08-27T08:00:00.000Z",
  updated_at: "2026-08-27T08:00:00.000Z",
};

describe("Feishu contracts", () => {
  it("projects a connection without protocol credentials", () => {
    expect(feishuConnectionSchema.parse(connection)).toEqual(connection);
    expect(
      feishuConnectionSchema.safeParse({
        ...connection,
        app_secret: "must-not-be-exposed",
      }).success,
    ).toBe(false);
  });

  it("accepts public registration state and rejects embedded credentials", () => {
    const session = {
      id: "20000000-0000-4000-8000-000000000001",
      operation: "create",
      status: "waiting_scan",
      qrcode_url: "https://open.feishu.cn/scan/create-bot",
      expires_at: "2026-08-27T08:10:00.000Z",
      connection: null,
    };
    expect(feishuRegistrationSessionSchema.parse(session)).toEqual(session);
    expect(
      feishuRegistrationSessionSchema.safeParse({
        ...session,
        client_secret: "must-not-be-exposed",
      }).success,
    ).toBe(false);
  });

  it("represents an app waiting for tenant administrator approval", () => {
    expect(
      feishuRegistrationSessionSchema.parse({
        id: "20000000-0000-4000-8000-000000000001",
        operation: "update",
        status: "pending_approval",
        qrcode_url: null,
        expires_at: "2026-08-27T08:10:00.000Z",
        connection: {
          ...connection,
          status: "reauthorization_required",
          runtime_status: "pending_approval",
          last_connected_at: null,
          last_error_code: "FEISHU_REAUTHORIZATION_REQUIRED",
        },
      }).status,
    ).toBe("pending_approval");
  });

  it("does not accept user-supplied app credentials when registration starts", () => {
    expect(feishuRegistrationStartInputSchema.parse({})).toEqual({
      reuse_existing: false,
      force_create: false,
    });
    expect(
      feishuRegistrationStartInputSchema.parse({ reuse_existing: true }),
    ).toEqual({ reuse_existing: true, force_create: false });
    expect(
      feishuRegistrationStartInputSchema.parse({ force_create: true }),
    ).toEqual({ reuse_existing: false, force_create: true });
    expect(
      feishuRegistrationStartInputSchema.safeParse({
        reuse_existing: true,
        force_create: true,
      }).success,
    ).toBe(false);
    expect(
      feishuRegistrationStartInputSchema.safeParse({
        app_id: "cli_0123456789abcdef",
      }).success,
    ).toBe(false);
  });
});
