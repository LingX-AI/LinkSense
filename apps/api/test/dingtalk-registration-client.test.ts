import { describe, expect, it, vi } from "vitest";
import { DingtalkRegistrationClient } from "../src/modules/bot-channels/dingtalk-registration-client.js";
const response = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });
describe("DingTalk device registration", () => {
  it("uses the official nonce flow and keeps the device code out of the QR URL", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ errcode: 0, nonce: "nonce" }))
      .mockResolvedValueOnce(
        response({
          errcode: 0,
          device_code: "private-device",
          verification_uri_complete:
            "https://www.dingtalk.com/oauth?code=public",
          expires_in: 120,
          interval: 3,
        }),
      );
    const result = await new DingtalkRegistrationClient(request).begin();
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://oapi.dingtalk.com/app/registration/init",
      "https://oapi.dingtalk.com/app/registration/begin",
    ]);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      source: "DING_DWS_CLAW",
    });
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      nonce: "nonce",
    });
    expect(result.deviceCode).toBe("private-device");
    expect(result.qrCodeUrl).not.toContain("private-device");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });
  it.each([
    "http://www.dingtalk.com/",
    "https://evil.example/",
    "https://www.dingtalk.com.evil.example/",
    "https://u:p@www.dingtalk.com/",
  ])("rejects an unsafe verification URL %s", async (url) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ errcode: 0, nonce: "nonce" }))
      .mockResolvedValueOnce(
        response({
          errcode: 0,
          device_code: "device",
          verification_uri_complete: url,
          expires_in: 120,
          interval: 3,
        }),
      );
    await expect(
      new DingtalkRegistrationClient(request).begin(),
    ).rejects.toThrow("BOT_CHANNEL_CONNECTION_FAILED");
  });
  it("requires both credentials on success and sanitizes vendor failures", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ errcode: 0, status: "SUCCESS", client_id: "app" }),
      )
      .mockResolvedValueOnce(
        response({ errcode: 400, errmsg: "private vendor data" }),
      );
    const client = new DingtalkRegistrationClient(request);
    await expect(client.poll("device")).rejects.toThrow(
      "BOT_CHANNEL_CONNECTION_FAILED",
    );
    await expect(client.poll("device")).rejects.toThrow(
      "BOT_CHANNEL_CONNECTION_FAILED",
    );
  });
  it.each(["WAITING", "FAIL", "EXPIRED"])(
    "handles terminal and pending status %s without retrying",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ errcode: 0, status }));
      expect(
        await new DingtalkRegistrationClient(request).poll("device"),
      ).toEqual({ status });
      expect(request).toHaveBeenCalledOnce();
    },
  );
});
