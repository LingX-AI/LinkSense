import { describe, expect, it, vi } from "vitest";

import { RedisClawHubInstallPreviewGuard } from "../src/modules/clawhub/install-guard.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN = "10000000-0000-4000-8000-000000000002";

describe("RedisClawHubInstallPreviewGuard", () => {
  it.each([
    ["busy", "CLAWHUB_INSTALL_PREVIEW_BUSY"],
    ["rate_limited", "CLAWHUB_INSTALL_PREVIEW_RATE_LIMITED"],
    ["quota_exceeded", "CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED"],
  ] as const)("maps %s admission failures", async (status, code) => {
    const fixture = guardFixture({ status });
    const work = vi.fn(async () => "preview");

    await expect(fixture.guard.run(USER_ID, work)).rejects.toMatchObject({
      code,
    });
    expect(work).not.toHaveBeenCalled();
    expect(fixture.redis.finishClawHubInstallPreview).not.toHaveBeenCalled();
  });

  it("keeps an active reservation only after a preview is staged", async () => {
    const fixture = guardFixture({ status: "acquired", token: TOKEN });

    await expect(
      fixture.guard.run(USER_ID, async () => ({ preview_token: "preview" })),
    ).resolves.toEqual({ preview_token: "preview" });
    expect(fixture.redis.finishClawHubInstallPreview).toHaveBeenCalledWith(
      USER_ID,
      TOKEN,
      true,
    );
  });

  it("releases the active reservation when preview preparation fails", async () => {
    const fixture = guardFixture({ status: "acquired", token: TOKEN });
    const failure = new Error("download failed");

    await expect(
      fixture.guard.run(USER_ID, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(fixture.redis.finishClawHubInstallPreview).toHaveBeenCalledWith(
      USER_ID,
      TOKEN,
      false,
    );
  });

  it("fails closed when Redis admission or release is unavailable", async () => {
    const unavailable = guardFixture({ status: "acquired", token: TOKEN });
    unavailable.redis.beginClawHubInstallPreview.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );
    await expect(
      unavailable.guard.run(USER_ID, async () => "preview"),
    ).rejects.toMatchObject({ code: "CLAWHUB_SERVICE_UNAVAILABLE" });

    const releaseFailure = guardFixture({ status: "acquired", token: TOKEN });
    releaseFailure.redis.finishClawHubInstallPreview.mockRejectedValueOnce(
      new Error("redis unavailable"),
    );
    await expect(
      releaseFailure.guard.run(USER_ID, async () => "preview"),
    ).rejects.toMatchObject({ code: "CLAWHUB_SERVICE_UNAVAILABLE" });
  });
});

function guardFixture(
  admission:
    | { status: "acquired"; token: string }
    | { status: "busy" | "rate_limited" | "quota_exceeded" },
) {
  const redis = {
    beginClawHubInstallPreview: vi.fn(async () => admission),
    finishClawHubInstallPreview: vi.fn(async () => undefined),
  };
  return {
    redis,
    guard: new RedisClawHubInstallPreviewGuard(redis),
  };
}
