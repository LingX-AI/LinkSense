import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendAppError } from "../src/lib/http.js";
import { DesktopFileRootService, type PrismaDesktopFileRootRepository } from "../src/modules/desktop-devices/file-roots.js";
import { desktopFileRootRoutes } from "../src/modules/desktop-devices/file-root-routes.js";

const owner = "10000000-0000-4000-8000-000000000001";
const device = "20000000-0000-4000-8000-000000000001";
const otherDevice = "20000000-0000-4000-8000-000000000002";
const rootId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-26T10:00:00.000Z");
const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

type RootRow = {
  id: string; ownerId: string; deviceId: string; name: string; mode: string;
  createdAt: Date; updatedAt: Date; revokedAt: Date | null;
};

function record(overrides: Record<string, unknown> = {}): RootRow {
  return {
    id: rootId, ownerId: owner, deviceId: device,
    name: "Documents", mode: "read", createdAt: now, updatedAt: now,
    revokedAt: null, ...overrides,
  };
}

function fixture() {
  const rows = new Map<string, RootRow>([[rootId, record()]]);
  const repository = {
    deviceOwned: vi.fn(async (_ownerId: string, deviceId: string) => deviceId === device),
    list: vi.fn(async () => [...rows.values()].filter(row => row.revokedAt === null)),
    find: vi.fn(async (_ownerId: string, id: string) => {
      const row = rows.get(id);
      return row && row.revokedAt === null ? row : null;
    }),
    create: vi.fn(async (_ownerId: string, input: { device_id: string; name: string; mode: string }) => {
      const row = record({
        id: "50000000-0000-4000-8000-000000000002",
        deviceId: input.device_id, name: input.name, mode: input.mode,
      });
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async (_ownerId: string, id: string, patch: { name?: string; mode?: string }) => {
      const row = rows.get(id);
      if (!row || row.revokedAt !== null) return null;
      const updated = { ...row, ...patch };
      rows.set(id, updated);
      return updated;
    }),
    revoke: vi.fn(async (_ownerId: string, id: string) => {
      const row = rows.get(id);
      if (!row || row.revokedAt !== null) return null;
      rows.set(id, { ...row, revokedAt: now });
      return id;
    }),
  } as unknown as PrismaDesktopFileRootRepository;
  const audit = { write: vi.fn(async () => undefined) };
  return {
    service: new DesktopFileRootService(repository, audit),
    repository: repository as unknown as {
      deviceOwned: ReturnType<typeof vi.fn>;
    },
    audit,
  };
}

describe("desktop file roots", () => {
  it("projects aliases and modes without ever storing a path", async () => {
    const { service } = fixture();
    await expect(service.list(owner)).resolves.toEqual([{
      id: rootId, device_id: device, name: "Documents", mode: "read",
      created_at: now.toISOString(), updated_at: now.toISOString(),
    }]);
    const created = await service.create(owner, { device_id: device, name: "Project", mode: "write" });
    expect(created).toMatchObject({ device_id: device, name: "Project", mode: "write" });
    expect(JSON.stringify(created)).not.toContain("/Users/");
  });

  it("rejects a device that is not the owner's and audits grant changes", async () => {
    const { service, audit } = fixture();
    await expect(service.create(owner, { device_id: otherDevice, name: "Other", mode: "read" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.create(owner, { device_id: device, name: "Project", mode: "write" });
    const updated = await service.update(owner, rootId, { mode: "write" });
    expect(updated.mode).toBe("write");
    await service.revoke(owner, rootId);
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_file_root_added", targetType: "desktop_file_root",
    }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_file_root_updated",
    }));
    expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({
      action: "desktop_file_root_removed",
    }));
  });

  it("returns only the active root a tool may use", async () => {
    const { service } = fixture();
    await expect(service.resolve(owner, rootId)).resolves.toEqual({
      id: rootId, deviceId: device, name: "Documents", mode: "read",
    });
    await service.revoke(owner, rootId);
    await expect(service.resolve(owner, rootId))
      .rejects.toMatchObject({ code: "DESKTOP_FILE_ROOT_NOT_FOUND" });
  });

  it("serves authenticated root management routes", async () => {
    const { service } = fixture();
    const app = Fastify();
    apps.push(app);
    app.decorateRequest("authUser", undefined);
    app.decorate("authenticate", async (request: { authUser?: unknown }) => {
      request.authUser = { id: owner };
    });
    app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
    await app.register(desktopFileRootRoutes, { prefix: "/api/v1/desktop/file-roots", service });
    await app.ready();

    const list = await app.inject({ method: "GET", url: "/api/v1/desktop/file-roots" });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items[0]).toMatchObject({ id: rootId, name: "Documents" });

    const created = await app.inject({
      method: "POST", url: "/api/v1/desktop/file-roots",
      payload: { device_id: device, name: "Project", mode: "write" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({ name: "Project", mode: "write" });

    const patched = await app.inject({
      method: "PATCH", url: `/api/v1/desktop/file-roots/${rootId}`,
      payload: { mode: "write" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.mode).toBe("write");

    const removed = await app.inject({
      method: "DELETE", url: `/api/v1/desktop/file-roots/${rootId}`,
    });
    expect(removed.statusCode).toBe(200);
    const missing = await app.inject({
      method: "PATCH", url: `/api/v1/desktop/file-roots/${rootId}`,
      payload: { mode: "read" },
    });
    expect(missing.statusCode).toBe(404);
  });
});
