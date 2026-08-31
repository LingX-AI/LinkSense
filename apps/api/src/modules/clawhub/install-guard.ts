import type { LinkSenseRedis } from "../../adapters/redis.js";
import { AppError } from "../../lib/errors.js";

type ClawHubPreviewAdmissionStore = Pick<
  LinkSenseRedis,
  "beginClawHubInstallPreview" | "finishClawHubInstallPreview"
>;

export interface ClawHubInstallPreviewGuard {
  run<T>(actorId: string, work: () => Promise<T>): Promise<T>;
}

export class RedisClawHubInstallPreviewGuard
  implements ClawHubInstallPreviewGuard
{
  constructor(private readonly redis: ClawHubPreviewAdmissionStore) {}

  async run<T>(actorId: string, work: () => Promise<T>): Promise<T> {
    let admission: Awaited<
      ReturnType<ClawHubPreviewAdmissionStore["beginClawHubInstallPreview"]>
    >;
    try {
      admission = await this.redis.beginClawHubInstallPreview(actorId);
    } catch {
      throw new AppError("CLAWHUB_SERVICE_UNAVAILABLE");
    }

    if (admission.status !== "acquired") {
      throw new AppError(admissionErrorCode(admission.status));
    }

    let workFailed = false;
    try {
      const result = await work();
      await this.#finish(actorId, admission.token, true);
      return result;
    } catch (error) {
      workFailed = true;
      throw error;
    } finally {
      if (workFailed) {
        await this.#finish(actorId, admission.token, false).catch(
          () => undefined,
        );
      }
    }
  }

  async #finish(
    actorId: string,
    token: string,
    keepActiveReservation: boolean,
  ): Promise<void> {
    try {
      await this.redis.finishClawHubInstallPreview(
        actorId,
        token,
        keepActiveReservation,
      );
    } catch {
      throw new AppError("CLAWHUB_SERVICE_UNAVAILABLE");
    }
  }
}

function admissionErrorCode(
  status: "busy" | "rate_limited" | "quota_exceeded",
):
  | "CLAWHUB_INSTALL_PREVIEW_BUSY"
  | "CLAWHUB_INSTALL_PREVIEW_RATE_LIMITED"
  | "CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED" {
  switch (status) {
    case "busy":
      return "CLAWHUB_INSTALL_PREVIEW_BUSY";
    case "rate_limited":
      return "CLAWHUB_INSTALL_PREVIEW_RATE_LIMITED";
    case "quota_exceeded":
      return "CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED";
  }
}
