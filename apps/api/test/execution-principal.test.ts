import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { executionPrincipalStatus } from "../src/lib/execution-principal.js";

afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));
  const id = randomUUID(), applicationId = randomUUID();
  const session = { runtimePrincipalId: id, applicationId, externalAccessId: randomUUID(), status: "active", credentialVersion: 4, absoluteExpiresAt: new Date("2026-09-16T00:00:00Z") };
  const access = { applicationId, enabled: true, credentialVersion: 4 };
  const application = { status: "active" };
  const store = {
    user: { findUnique: vi.fn(async () => null as { status: string } | null) },
    applicationExternalSession: { findUnique: vi.fn(async () => session) },
    applicationExternalAccess: { findUnique: vi.fn(async () => access) },
    application: { findUnique: vi.fn(async () => application) },
  };
  const status = () => executionPrincipalStatus(store as unknown as PrismaClient, id);
  return { id, session, access, application, store, status };
}

describe("execution principals", () => {
  it("uses account status for members without consulting external sessions", async () => {
    const f = fixture(); f.store.user.findUnique.mockResolvedValue({ status: "active" });
    expect(await f.status()).toBe("active");
    f.store.user.findUnique.mockResolvedValue({ status: "disabled" });
    expect(await f.status()).toBe("disabled");
    expect(f.store.applicationExternalSession.findUnique).not.toHaveBeenCalled();
  });
  it("accepts an active external session with no user account", async () => {
    const f = fixture(); expect(await f.status()).toBe("active");
    expect(f.store.applicationExternalSession.findUnique).toHaveBeenCalledWith({ where: { runtimePrincipalId: f.id } });
  });
  it.each(["expiry", "revocation", "credential rotation", "access disabled", "application disabled", "other application"])("denies external execution after %s", async reason => {
    const f = fixture();
    if (reason === "expiry") f.session.absoluteExpiresAt = new Date();
    if (reason === "revocation") f.session.status = "revoked";
    if (reason === "credential rotation") f.access.credentialVersion += 1;
    if (reason === "access disabled") f.access.enabled = false;
    if (reason === "application disabled") f.application.status = "disabled";
    if (reason === "other application") f.access.applicationId = randomUUID();
    expect(await f.status()).toBe("disabled");
  });
});
