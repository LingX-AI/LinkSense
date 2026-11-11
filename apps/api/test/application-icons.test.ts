import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { ApplicationIconService } from "../src/modules/applications/icon-service.js";

function fixture() {
  const db = {
    applicationVersion: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => null) },
    application: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => null) },
  };
  const store = {
    put: vi.fn(), remove: vi.fn(), enqueueRemoval: vi.fn(),
    presignGet: vi.fn(async () => "https://objects.example.test/logo.png"),
  };
  const service = new ApplicationIconService(db as unknown as PrismaClient, store);
  return { service, db, store };
}

describe("shared application icon lifecycle", () => {
  it("prepares preset and default icons without requiring image storage", async () => {
    const service = new ApplicationIconService({} as PrismaClient);
    expect(await service.prepare("owner")).toEqual({ preset: "bot", objectKey: null, newObjectKey: null });
    expect(await service.prepare("owner", { type: "preset", preset: "globe-2" }))
      .toEqual({ preset: "globe-2", objectKey: null, newObjectKey: null });
  });

  it("projects a signed custom icon and uses its preset when storage cannot sign the image", async () => {
    const f = fixture();
    const row = { iconPreset: "book-open", iconObjectKey: "applications/owner/icons/logo.png" };
    expect(await f.service.project(row)).toEqual({ type: "custom", url: "https://objects.example.test/logo.png", fallback_preset: "book-open" });
    expect(f.store.presignGet).toHaveBeenCalledExactlyOnceWith(row.iconObjectKey, 300);
    f.store.presignGet.mockRejectedValueOnce(new Error("Unavailable"));
    expect(await f.service.project(row)).toEqual({ type: "preset", preset: "book-open" });
    expect(await f.service.project({ iconPreset: "unknown", iconObjectKey: null }))
      .toEqual({ type: "preset", preset: "bot" });
  });

  it("queues removal of an uncommitted image when immediate removal fails", async () => {
    const f = fixture();
    f.store.remove.mockRejectedValueOnce(new Error("Unavailable"));
    await f.service.removeAfterFailure("staged-logo");
    expect(f.store.enqueueRemoval).toHaveBeenCalledExactlyOnceWith("staged-logo");
  });

  it("does not hide the original mutation result when both cleanup methods fail", async () => {
    const f = fixture();
    f.store.remove.mockRejectedValue(new Error("Unavailable"));
    f.store.enqueueRemoval.mockRejectedValue(new Error("Unavailable"));
    await expect(f.service.removeAfterFailure("staged-logo")).resolves.toBeUndefined();
  });

  it.each(["publication", "application", "failed lookup"])("retains images after a %s reference check", async (reason) => {
    const f = fixture();
    if (reason === "publication") f.db.applicationVersion.findFirst.mockResolvedValueOnce({ id: "previous-version" });
    else if (reason === "application") f.db.application.findFirst.mockResolvedValueOnce({ id: "installed-copy" });
    else f.db.applicationVersion.findFirst.mockRejectedValueOnce(new Error("Unavailable"));
    await f.service.enqueueRemoval("released-logo");
    expect(f.store.remove).not.toHaveBeenCalled();
    expect(f.store.enqueueRemoval).not.toHaveBeenCalled();
  });

  it("queues an unreferenced icon for removal after checking both publications and applications", async () => {
    const f = fixture();
    await f.service.enqueueRemoval("unused-logo");
    expect(f.db.applicationVersion.findFirst).toHaveBeenCalledWith({
      where: { assetsReady: true, definitionJson: { path: ["iconObjectKey"], equals: "unused-logo" } }, select: { id: true },
    });
    expect(f.db.application.findFirst).toHaveBeenCalledWith({
      where: { iconObjectKey: "unused-logo", status: { not: "deleted" } }, select: { id: true },
    });
    expect(f.store.enqueueRemoval).toHaveBeenCalledExactlyOnceWith("unused-logo");
  });
});
