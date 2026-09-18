import { errorCatalog, projectListSchema } from "@linksense/shared";
import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Prisma, type PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { backendI18n, translateError } from "../src/lib/i18n.js";
import { lockOwnedProject, ProjectRepository } from "../src/modules/projects/repository.js";
import { ProjectService } from "../src/modules/projects/service.js";
import { projectRoutes } from "../src/modules/projects/routes.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-09T00:00:00.000Z");
const row = { id, ownerId, icon: "folder", color: "default", name: "Work", sortOrder: null, createdAt: now, updatedAt: now };
const project = { icon: "folder" as const, color: "default" as const, id, name: "Work", created_at: now.toISOString(), updated_at: now.toISOString() };

function serviceFixture() {
  const repository = {
    list: vi.fn(async () => [row]),
    create: vi.fn(async () => row),
    update: vi.fn(async () => row),
    delete: vi.fn(async () => undefined),
    reorder: vi.fn(async () => [{ ...row, id: secondId }, row]),
  };
  return { repository, service: new ProjectService(repository) };
}

describe("task project service", () => {
  it("validates and persists appearance together with the edited name", async () => {
    const { repository, service } = serviceFixture();
    await service.update(ownerId, id, { name: " Work ", icon: "flower", color: "blue" });
    expect(repository.update).toHaveBeenCalledWith(ownerId, id, { name: "Work", icon: "flower", color: "blue" });
  });
  it("preserves stored ordering while returning only public project fields", async () => {
    const { repository, service } = serviceFixture();
    const result = await service.reorder(ownerId, { project_ids: [secondId, id] });
    expect(repository.reorder).toHaveBeenCalledWith(ownerId, [secondId, id]);
    expect(result.map((item) => item.id)).toEqual([secondId, id]);
    expect(projectListSchema.parse(result)).toEqual(result);
    expect(result[0]).not.toHaveProperty("sortOrder");
  });
  it("rejects repeated project IDs before a sort is persisted", async () => {
    const { repository, service } = serviceFixture();
    await expect(service.reorder(ownerId, { project_ids: [id, id] })).rejects.toThrow();
    expect(repository.reorder).not.toHaveBeenCalled();
  });
  it("lists only the owner's projects and projects public fields", async () => {
    const { repository, service } = serviceFixture();
    expect(await service.list(ownerId)).toEqual([project]);
    expect(repository.list).toHaveBeenCalledWith(ownerId);
  });
  it("trims the name on create and update", async () => {
    const { repository, service } = serviceFixture();
    await service.create(ownerId, { name: " Work " });
    await service.update(ownerId, id, { name: " Work " });
    expect(repository.create).toHaveBeenCalledWith(ownerId, { name: "Work" });
    expect(repository.update).toHaveBeenCalledWith(ownerId, id, { name: "Work" });
  });
  it.each(["", "  ", "x".repeat(81)])("rejects invalid name %s before persistence", async (name) => {
    const { repository, service } = serviceFixture();
    await expect(service.create(ownerId, { name })).rejects.toThrow();
    await expect(service.update(ownerId, id, { name })).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
  it.each(["create", "update"] as const)("maps concurrent duplicate-name errors from %s without exposing database details", async (method) => {
    const { repository, service } = serviceFixture();
    repository[method].mockRejectedValue(new Prisma.PrismaClientKnownRequestError("database details", { code: "P2002", clientVersion: "test" }));
    const action = method === "create" ? service.create(ownerId, { name: "Work" }) : service.update(ownerId, id, { name: "Work" });
    await expect(action).rejects.toMatchObject({ code: "PROJECT_NAME_EXISTS" });
  });
  it("returns an unavailable project error for a update outside the owner's scope", async () => {
    const { repository, service } = serviceFixture();
    repository.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("database details", { code: "P2025", clientVersion: "test" }));
    await expect(service.update(ownerId, id, { name: "Work" })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
  it("keeps storage failures visible to the error boundary", async () => {
    const { repository, service } = serviceFixture();
    repository.create.mockRejectedValue(new Error("offline"));
    await expect(service.create(ownerId, { name: "Work" })).rejects.toThrow("offline");
  });
  it.each(["PROJECT_NOT_FOUND", "PROJECT_NAME_EXISTS"] as const)("localizes %s in both languages and fallback", (code) => {
    expect(translateError(code, "zh-CN")).not.toBe(translateError(code, "en-US"));
    expect(backendI18n.t(errorCatalog[code].message_key, { lng: "fr-FR" })).toBe(translateError(code, "zh-CN"));
  });
});

function databaseFixture() {
  const tx = {
    $queryRaw: vi.fn<(query: Prisma.Sql) => Promise<Array<{ id: string } | { busy: boolean }>>>().mockImplementation(async query => query.sql.includes("AS busy") ? [{ busy: false }] : query.sql.includes("application_developments") ? [] : [{ id }]),
    $executeRaw: vi.fn<(query: Prisma.Sql) => Promise<number>>().mockResolvedValue(3),
    project: {
      findMany: vi.fn().mockResolvedValue([row]),
      create: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(row),
      delete: vi.fn().mockResolvedValue(row),
    },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  const prisma = { ...tx, $transaction: transaction } as unknown as PrismaClient;
  return { tx, transaction, repository: new ProjectRepository(prisma) };
}

describe("task project persistence and transaction integrity", () => {
  it("writes appearance only for the owning project and preserves omitted fields", async () => {
    const { repository, tx } = databaseFixture();
    await repository.update(ownerId, id, { name: "Work", icon: "flower", color: "blue" });
    expect(tx.project.update).toHaveBeenLastCalledWith({ where: { ownerId, id }, data: { name: "Work", icon: "flower", color: "blue" } });
    await repository.update(ownerId, id, { name: "Personal" });
    expect(tx.project.update).toHaveBeenLastCalledWith({ where: { ownerId, id }, data: { name: "Personal" } });
  });
  it("scopes reads and writes to the owner", async () => {
    const { repository, tx } = databaseFixture();
    await repository.list(ownerId);
    await repository.create(ownerId, { name: "Work" });
    await repository.update(ownerId, id, { name: "Work" });
    expect(tx.project.findMany).toHaveBeenCalledWith({ where: { ownerId }, orderBy: [{ sortOrder: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] });
    expect(tx.project.create).toHaveBeenCalledWith({ data: { ownerId, name: "Work" } });
    expect(tx.project.update).toHaveBeenCalledWith({ where: { ownerId, id }, data: { name: "Work" } });
  });
  it("locks owned projects, saves their order in one write, and reads it within the same transaction", async () => {
    const { repository, tx, transaction } = databaseFixture();
    tx.$queryRaw.mockResolvedValue([{ id }, { id: secondId }]);
    const ordered = [{ ...row, id: secondId, sortOrder: 0 }, { ...row, sortOrder: 1 }];
    tx.project.findMany.mockResolvedValue(ordered);
    expect(await repository.reorder(ownerId, [secondId, id])).toEqual(ordered);
    expect(transaction).toHaveBeenCalledOnce();
    const lock = tx.$queryRaw.mock.calls[0]![0];
    expect(lock.sql).toMatch(/ORDER BY id\s+FOR UPDATE/u);
    expect(lock.values).toEqual([ownerId]);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const write = tx.$executeRaw.mock.calls[0]![0];
    expect(write.sql).toContain("WITH ORDINALITY");
    expect(write.sql).toContain("project.owner_id =");
    expect(write.sql).not.toMatch(/updated_at|created_at|conversations/iu);
    expect(write.values).toEqual([secondId, id, ownerId]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$executeRaw.mock.invocationCallOrder[0]!);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.project.findMany.mock.invocationCallOrder[0]!);
  });
  it.each([
    { owned: [{ id }], requested: [secondId, id], code: "PROJECT_NOT_FOUND" },
    { owned: [{ id }, { id: secondId }, { id: ownerId }], requested: [secondId, id], code: "CONFLICT" },
  ])("rejects missing, foreign, or stale project sets without partial writes: $code", async ({ owned, requested, code }) => {
    const { repository, tx } = databaseFixture();
    tx.$queryRaw.mockResolvedValue(owned);
    await expect(repository.reorder(ownerId, requested)).rejects.toMatchObject({ code });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("propagates a failed order write and does not return a successful list", async () => {
    const { repository, tx } = databaseFixture();
    tx.$queryRaw.mockResolvedValue([{ id }, { id: secondId }]);
    tx.$executeRaw.mockRejectedValue(new Error("write failed"));
    await expect(repository.reorder(ownerId, [secondId, id])).rejects.toThrow("write failed");
    expect(tx.project.findMany).not.toHaveBeenCalled();
  });
  it("detaches active and archived tasks before removing a project in one transaction", async () => {
    const { repository, tx, transaction } = databaseFixture();
    await repository.delete(ownerId, id);
    expect(transaction).toHaveBeenCalledOnce();
    const lock = tx.$queryRaw.mock.calls[0]![0];
    expect(lock.sql).toContain("FOR UPDATE");
    expect(lock.values).toEqual([id, ownerId]);
    const detach = tx.$executeRaw.mock.calls[0]![0];
    expect(detach.sql).toContain("project_id = NULL");
    expect(detach.sql).toContain("WHEN pinned_at IS NULL THEN NULL ELSE sort_order END");
    expect(detach.sql).not.toMatch(/archive_status|updated_at|DELETE/);
    expect(detach.sql).toContain("THEN workspace_rel_path ELSE");
    expect(detach.values).toEqual([`${ownerId}/services/%`, `${ownerId}/home/workspace`, ownerId, id]);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.project.delete.mock.invocationCallOrder[0]!);
    expect(tx.project.delete).toHaveBeenCalledWith({ where: { id, ownerId } });
  });
  it("does not touch tasks when a project is missing or belongs to another owner", async () => {
    const { repository, tx } = databaseFixture();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(repository.delete(ownerId, id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.project.delete).not.toHaveBeenCalled();
  });
  it("propagates detachment failures through the transaction without deleting the project", async () => {
    const { repository, tx } = databaseFixture();
    tx.$executeRaw.mockRejectedValue(new Error("write failed"));
    await expect(repository.delete(ownerId, id)).rejects.toThrow("write failed");
    expect(tx.project.delete).not.toHaveBeenCalled();
  });
  it("locks an owned assignment target against concurrent deletion", async () => {
    const { tx } = databaseFixture();
    await lockOwnedProject(tx as unknown as Prisma.TransactionClient, ownerId, id);
    expect(tx.$queryRaw.mock.calls[0]![0].sql).toContain("FOR SHARE");
    expect(tx.$queryRaw.mock.calls[0]![0].values).toEqual([id, ownerId]);
    tx.$queryRaw.mockResolvedValue([]);
    await expect(lockOwnedProject(tx as unknown as Prisma.TransactionClient, ownerId, id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function routeFixture(authenticated = true) {
  const app = Fastify();
  apps.push(app);
  const service = { list: vi.fn(async () => [project]), create: vi.fn(async () => project), update: vi.fn(async () => project), delete: vi.fn(async () => undefined), reorder: vi.fn(async () => [{ ...project, id: secondId, name: "Personal" }, project]) };
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (!authenticated) throw new AppError("AUTH_REQUIRED");
    request.authUser = { id: ownerId, email: "owner@example.test", name: "Owner", role: "user", status: "active", preferredLocale: "zh-CN", avatarObjectKey: null, authValidAfter: new Date(0) };
  });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(projectRoutes, { prefix: "/projects", service });
  return { app, service };
}

describe("task project routes", () => {
  it("updates icon and color using the authenticated owner", async () => {
    const { app, service } = await routeFixture();
    const input = { name: "Work", icon: "flower", color: "blue" };
    const response = await app.inject({ method: "PATCH", url: `/projects/${id}`, payload: input });
    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledExactlyOnceWith(ownerId, id, input);
  });
  it.each([{ icon: "unknown" }, { color: "#000" }, { icon: null }, { owner_id: secondId }])("rejects invalid project edits before persistence: %j", async fields => {
    const { app, service } = await routeFixture();
    const response = await app.inject({ method: "PATCH", url: `/projects/${id}`, payload: { name: "Work", ...fields } });
    expect(response.statusCode).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });
  it("accepts the project drag request and returns the ordered list matching the frontend contract", async () => {
    const { app, service } = await routeFixture();
    const response = await app.inject({ method: "PUT", url: "/projects/order", payload: { project_ids: [secondId, id] } });
    expect(response.statusCode).toBe(200);
    expect(service.reorder).toHaveBeenCalledWith(ownerId, { project_ids: [secondId, id] });
    expect(projectListSchema.parse(response.json().data).map((item) => item.id)).toEqual([secondId, id]);
  });
  it("rejects unauthenticated project sorting", async () => {
    const { app, service } = await routeFixture(false);
    const response = await app.inject({ method: "PUT", url: "/projects/order", payload: { project_ids: [secondId, id] } });
    expect(response.statusCode).toBe(401);
    expect(service.reorder).not.toHaveBeenCalled();
  });
  it.each([
    { project_ids: [id, id] },
    { project_ids: [id, "invalid"] },
    { project_ids: [id] },
    { project_ids: [id, secondId], owner_id: secondId },
  ])("rejects invalid sorting input before persistence: %j", async (payload) => {
    const { app, service } = await routeFixture();
    const response = await app.inject({ method: "PUT", url: "/projects/order", payload });
    expect(response.statusCode).toBe(400);
    expect(service.reorder).not.toHaveBeenCalled();
  });

  it("supports listing, creating, renaming, and deleting with the authenticated identity", async () => {
    const { app, service } = await routeFixture();
    expect((await app.inject({ method: "GET", url: "/projects" })).json().data).toEqual([project]);
    expect((await app.inject({ method: "POST", url: "/projects", payload: { name: " Work " } })).statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(ownerId, { name: "Work" });
    expect((await app.inject({ method: "PATCH", url: `/projects/${id}`, payload: { name: "Personal" } })).statusCode).toBe(200);
    expect(service.update).toHaveBeenCalledWith(ownerId, id, { name: "Personal" });
    expect((await app.inject({ method: "DELETE", url: `/projects/${id}` })).statusCode).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(ownerId, id);
  });
  it.each(["GET", "POST", "PATCH", "DELETE"] as const)("rejects unauthenticated %s requests", async (method) => {
    const { app, service } = await routeFixture(false);
    const response = await app.inject({ method, url: method === "PATCH" || method === "DELETE" ? `/projects/${id}` : "/projects", ...(method === "POST" || method === "PATCH" ? { payload: { name: "Work" } } : {}) });
    expect(response.statusCode).toBe(401);
    for (const action of Object.values(service)) expect(action).not.toHaveBeenCalled();
  });
  it.each([{ name: " " }, { name: "a".repeat(81) }, { name: "Work", owner_id: id }])("rejects invalid or ownership-injecting input %j", async (payload) => {
    const { app, service } = await routeFixture();
    expect((await app.inject({ method: "POST", url: "/projects", payload })).statusCode).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("validates project IDs and returns a redacted authorization failure", async () => {
    const { app, service } = await routeFixture();
    expect((await app.inject({ method: "DELETE", url: "/projects/invalid" })).statusCode).toBe(400);
    expect(service.delete).not.toHaveBeenCalled();
    service.delete.mockRejectedValue(new AppError("PROJECT_NOT_FOUND"));
    const response = await app.inject({ method: "DELETE", url: `/projects/${id}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "PROJECT_NOT_FOUND" });
    expect(response.json()).not.toHaveProperty("data");
  });
});
