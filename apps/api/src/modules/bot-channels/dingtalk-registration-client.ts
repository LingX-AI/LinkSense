import { z } from "zod";
import { AppError } from "../../lib/errors.js";
const nonempty = z.string().trim().min(1).max(4096);
const initSchema = z.object({ errcode: z.literal(0), nonce: nonempty });
const beginSchema = z.object({
  errcode: z.literal(0),
  device_code: nonempty,
  verification_uri_complete: z.url().max(4096),
  expires_in: z.number().int().positive().max(7200),
  interval: z.number().int().min(1).max(60),
});
const pollSchema = z.discriminatedUnion("status", [
  z.object({
    errcode: z.literal(0),
    status: z.literal("SUCCESS"),
    client_id: z.string().trim().min(1).max(128),
    client_secret: nonempty,
  }),
  z.object({
    errcode: z.literal(0),
    status: z.enum(["WAITING", "FAIL", "EXPIRED"]),
  }),
]);
export type DingtalkRegistrationStart = {
  deviceCode: string;
  qrCodeUrl: string;
  expiresIn: number;
  interval: number;
};
export type DingtalkRegistrationPoll =
  | { status: "SUCCESS"; clientId: string; clientSecret: string }
  | { status: "WAITING" | "FAIL" | "EXPIRED" };
export class DingtalkRegistrationClient {
  constructor(private readonly request: typeof fetch = fetch) {}
  async begin(): Promise<DingtalkRegistrationStart> {
    try {
      const init = initSchema.parse(
        await this.#post("init", { source: "DING_DWS_CLAW" }),
      );
      const data = beginSchema.parse(
        await this.#post("begin", { nonce: init.nonce }),
      );
      const url = new URL(data.verification_uri_complete);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.port && url.port !== "443") ||
        !(
          url.hostname === "dingtalk.com" ||
          url.hostname.endsWith(".dingtalk.com")
        )
      )
        throw new Error("Unsafe verification URL");
      return {
        deviceCode: data.device_code,
        qrCodeUrl: url.href,
        expiresIn: data.expires_in,
        interval: data.interval,
      };
    } catch {
      throw new AppError("BOT_CHANNEL_CONNECTION_FAILED");
    }
  }
  async poll(deviceCode: string): Promise<DingtalkRegistrationPoll> {
    try {
      const data = pollSchema.parse(
        await this.#post("poll", { device_code: deviceCode }),
      );
      return data.status === "SUCCESS"
        ? {
            status: data.status,
            clientId: data.client_id,
            clientSecret: data.client_secret,
          }
        : { status: data.status };
    } catch {
      throw new AppError("BOT_CHANNEL_CONNECTION_FAILED");
    }
  }
  async #post(
    action: "init" | "begin" | "poll",
    body: object,
  ): Promise<unknown> {
    const response = await this.request(
      `https://oapi.dingtalk.com/app/registration/${action}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw new Error("Registration request failed");
    return response.json();
  }
}
