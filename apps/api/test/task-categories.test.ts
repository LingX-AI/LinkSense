import { errorCatalog, taskCategoryListSchema } from "@linksense/shared";
import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Prisma, type PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { backendI18n, translateError } from "../src/lib/i18n.js";
import { lockOwnedTaskCategory, TaskCategoryRepository } from "../src/modules/task-categories/repository.js";
import { TaskCategoryService } from "../src/modules/task-categories/service.js";
import { taskCategoryRoutes } from "../src/modules/task-categories/routes.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const id = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-09T00:00:00.000Z");
const row = { id, ownerId, name: "Work", sortOrder: null, createdAt: now, updatedAt: now };
const category = { id, name: "Work", created_at: now.toISOString(), updated_at: now.toISOString() };

function serviceFixture() {
  const repository = {
    list: vi.fn(async () => [row]),
    create: vi.fn(async () => row),
    rename: vi.fn(async () => row),
    delete: vi.fn(async () => undefined),
    reorder: vi.fn(async () => [{ ...row, id: secondId }, row]),
  };
  return { repository, service: new TaskCategoryService(repository) };
}

describe("task category service", () => {
  it("preserves stored ordering while returning only public category fields", async () => {
    const { repository, service } = serviceFixture();
    const result = await service.reorder(ownerId, { category_ids: [secondId, id] });
    expect(repository.reorder).toHaveBeenCalledWith(ownerId, [secondId, id]);
    expect(result.map((item) => item.id)).toEqual([secondId, id]);
    expect(taskCategoryListSchema.parse(result)).toEqual(result);
    expect(result[0]).not.toHaveProperty("sortOrder");
  });
  it("rejects repeated category IDs before a sort is persisted", async () => {
    const { repository, service } = serviceFixture();
    await expect(service.reorder(ownerId, { category_ids: [id, id] })).rejects.toThrow();
    expect(repository.reorder).not.toHaveBeenCalled();
  });
  it("lists only the owner's categories and projects public fields", async () => {
    const { repository, service } = serviceFixture();
    expect(await service.list(ownerId)).toEqual([category]);
    expect(repository.list).toHaveBeenCalledWith(ownerId);
  });
  it("trims the name on create and rename", async () => {
    const { repository, service } = serviceFixture();
    await service.create(ownerId, { name: " Work " });
    await service.rename(ownerId, id, { name: " Work " });
    expect(repository.create).toHaveBeenCalledWith(ownerId, "Work");
    expect(repository.rename).toHaveBeenCalledWith(ownerId, id, "Work");
  });
  it.each(["", "  ", "x".repeat(81)])("rejects invalid name %s before persistence", async (name) => {
    const { repository, service } = serviceFixture();
    await expect(service.create(ownerId, { name })).rejects.toThrow();
    await expect(service.rename(ownerId, id, { name })).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.rename).not.toHaveBeenCalled();
  });
  it.each(["create", "rename"] as const)("maps concurrent duplicate-name errors from %s without exposing database details", async (method) => {
    const { repository, service } = serviceFixture();
    repository[method].mockRejectedValue(new Prisma.PrismaClientKnownRequestError("database details", { code: "P2002", clientVersion: "test" }));
    const action = method === "create" ? service.create(ownerId, { name: "Work" }) : service.rename(ownerId, id, { name: "Work" });
    await expect(action).rejects.toMatchObject({ code: "TASK_CATEGORY_NAME_EXISTS" });
  });
  it("returns an unavailable category error for a rename outside the owner's scope", async () => {
    const { repository, service } = serviceFixture();
    repository.rename.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("database details", { code: "P2025", clientVersion: "test" }));
    await expect(service.rename(ownerId, id, { name: "Work" })).rejects.toMatchObject({ code: "TASK_CATEGORY_NOT_FOUND" });
  });
  it("keeps storage failures visible to the error boundary", async () => {
    const { repository, service } = serviceFixture();
    repository.create.mockRejectedValue(new Error("offline"));
    await expect(service.create(ownerId, { name: "Work" })).rejects.toThrow("offline");
  });
  it.each(["TASK_CATEGORY_NOT_FOUND", "TASK_CATEGORY_NAME_EXISTS"] as const)("localizes %s in both languages and fallback", (code) => {
    expect(translateError(code, "zh-CN")).not.toBe(translateError(code, "en-US"));
    expect(backendI18n.t(errorCatalog[code].message_key, { lng: "fr-FR" })).toBe(translateError(code, "zh-CN"));
  });
});

function databaseFixture() {
  const tx = {
    $queryRaw: vi.fn<(query: Prisma.Sql) => Promise<Array<{ id: string }>>>().mockResolvedValue([{ id }]),
    $executeRaw: vi.fn<(query: Prisma.Sql) => Promise<number>>().mockResolvedValue(3),
    taskCategory: {
      findMany: vi.fn().mockResolvedValue([row]),
      create: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue(row),
      delete: vi.fn().mockResolvedValue(row),
    },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  const prisma = { ...tx, $transaction: transaction } as unknown as PrismaClient;
  return { tx, transaction, repository: new TaskCategoryRepository(prisma) };
}

describe("task category persistence and transaction integrity", () => {
  it("scopes reads and writes to the owner", async () => {
    const { repository, tx } = databaseFixture();
    await repository.list(ownerId);
    await repository.create(ownerId, "Work");
    await repository.rename(ownerId, id, "Work");
    expect(tx.taskCategory.findMany).toHaveBeenCalledWith({ where: { ownerId }, orderBy: [{ sortOrder: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }] });
    expect(tx.taskCategory.create).toHaveBeenCalledWith({ data: { ownerId, name: "Work" } });
    expect(tx.taskCategory.update).toHaveBeenCalledWith({ where: { ownerId, id }, data: { name: "Work" } });
  });
  it("locks owned categories, saves their order in one write, and reads it within the same transaction", async () => {
    const { repository, tx, transaction } = databaseFixture();
    tx.$queryRaw.mockResolvedValue([{ id }, { id: secondId }]);
    const ordered = [{ ...row, id: secondId, sortOrder: 0 }, { ...row, sortOrder: 1 }];
    tx.taskCategory.findMany.mockResolvedValue(ordered);
    expect(await repository.reorder(ownerId, [secondId, id])).toEqual(ordered);
    expect(transaction).toHaveBeenCalledOnce();
    const lock = tx.$queryRaw.mock.calls[0]![0];
    expect(lock.sql).toMatch(/ORDER BY id\s+FOR UPDATE/u);
    expect(lock.values).toEqual([ownerId]);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const write = tx.$executeRaw.mock.calls[0]![0];
    expect(write.sql).toContain("WITH ORDINALITY");
    expect(write.sql).toContain("category.owner_id =");
    expect(write.sql).not.toMatch(/updated_at|created_at|conversations/iu);
    expect(write.values).toEqual([secondId, id, ownerId]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$executeRaw.mock.invocationCallOrder[0]!);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.taskCategory.findMany.mock.invocationCallOrder[0]!);
  });
  it.each([
    { owned: [{ id }], requested: [secondId, id], code: "TASK_CATEGORY_NOT_FOUND" },
    { owned: [{ id }, { id: secondId }, { id: ownerId }], requested: [secondId, id], code: "CONFLICT" },
  ])("rejects missing, foreign, or stale category sets without partial writes: $code", async ({ owned, requested, code }) => {
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
    expect(tx.taskCategory.findMany).not.toHaveBeenCalled();
  });
  it("detaches active and archived tasks before removing a category in one transaction", async () => {
    const { repository, tx, transaction } = databaseFixture();
    await repository.delete(ownerId, id);
    expect(transaction).toHaveBeenCalledOnce();
    const lock = tx.$queryRaw.mock.calls[0]![0];
    expect(lock.sql).toContain("FOR UPDATE");
    expect(lock.values).toEqual([id, ownerId]);
    const detach = tx.$executeRaw.mock.calls[0]![0];
    expect(detach.sql).toContain("category_id = NULL");
    expect(detach.sql).toContain("WHEN pinned_at IS NULL THEN NULL ELSE sort_order END");
    expect(detach.sql).not.toMatch(/archive_status|updated_at|DELETE/);
    expect(detach.values).toEqual([ownerId, id]);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.taskCategory.delete.mock.invocationCallOrder[0]!);
    expect(tx.taskCategory.delete).toHaveBeenCalledWith({ where: { id, ownerId } });
  });
  it("does not touch tasks when a category is missing or belongs to another owner", async () => {
    const { repository, tx } = databaseFixture();
    tx.$queryRaw.mockResolvedValue([]);
    await expect(repository.delete(ownerId, id)).rejects.toMatchObject({ code: "TASK_CATEGORY_NOT_FOUND" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.taskCategory.delete).not.toHaveBeenCalled();
  });
  it("propagates detachment failures through the transaction without deleting the category", async () => {
    const { repository, tx } = databaseFixture();
    tx.$executeRaw.mockRejectedValue(new Error("write failed"));
    await expect(repository.delete(ownerId, id)).rejects.toThrow("write failed");
    expect(tx.taskCategory.delete).not.toHaveBeenCalled();
  });
  it("locks an owned assignment target against concurrent deletion", async () => {
    const { tx } = databaseFixture();
    await lockOwnedTaskCategory(tx as unknown as Prisma.TransactionClient, ownerId, id);
    expect(tx.$queryRaw.mock.calls[0]![0].sql).toContain("FOR SHARE");
    expect(tx.$queryRaw.mock.calls[0]![0].values).toEqual([id, ownerId]);
    tx.$queryRaw.mockResolvedValue([]);
    await expect(lockOwnedTaskCategory(tx as unknown as Prisma.TransactionClient, ownerId, id)).rejects.toMatchObject({ code: "TASK_CATEGORY_NOT_FOUND" });
  });
});

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
async function routeFixture(authenticated = true) {
  const app = Fastify();
  apps.push(app);
  const service = { list: vi.fn(async () => [category]), create: vi.fn(async () => category), rename: vi.fn(async () => category), delete: vi.fn(async () => undefined), reorder: vi.fn(async () => [{ ...category, id: secondId, name: "Personal" }, category]) };
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (!authenticated) throw new AppError("AUTH_REQUIRED");
    request.authUser = { id: ownerId, email: "owner@example.test", name: "Owner", role: "user", status: "active", preferredLocale: "zh-CN", avatarObjectKey: null, authValidAfter: new Date(0) };
  });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await app.register(taskCategoryRoutes, { prefix: "/categories", service });
  return { app, service };
}

describe("task category routes", () => {
  it("accepts the category drag request and returns the ordered list matching the frontend contract", async () => {
    const { app, service } = await routeFixture();
    const response = await app.inject({ method: "PUT", url: "/categories/order", payload: { category_ids: [secondId, id] } });
    expect(response.statusCode).toBe(200);
    expect(service.reorder).toHaveBeenCalledWith(ownerId, { category_ids: [secondId, id] });
    expect(taskCategoryListSchema.parse(response.json().data).map((item) => item.id)).toEqual([secondId, id]);
  });
  it("rejects unauthenticated category sorting", async () => {
    const { app, service } = await routeFixture(false);
    const response = await app.inject({ method: "PUT", url: "/categories/order", payload: { category_ids: [secondId, id] } });
    expect(response.statusCode).toBe(401);
    expect(service.reorder).not.toHaveBeenCalled();
  });
  it.each([
    { category_ids: [id, id] },
    { category_ids: [id, "invalid"] },
    { category_ids: [id] },
    { category_ids: [id, secondId], owner_id: secondId },
  ])("rejects invalid sorting input before persistence: %j", async (payload) => {
    const { app, service } = await routeFixture();
    const response = await app.inject({ method: "PUT", url: "/categories/order", payload });
    expect(response.statusCode).toBe(400);
    expect(service.reorder).not.toHaveBeenCalled();
  });

  it("supports listing, creating, renaming, and deleting with the authenticated identity", async () => {
    const { app, service } = await routeFixture();
    expect((await app.inject({ method: "GET", url: "/categories" })).json().data).toEqual([category]);
    expect((await app.inject({ method: "POST", url: "/categories", payload: { name: " Work " } })).statusCode).toBe(201);
    expect(service.create).toHaveBeenCalledWith(ownerId, { name: "Work" });
    expect((await app.inject({ method: "PATCH", url: `/categories/${id}`, payload: { name: "Personal" } })).statusCode).toBe(200);
    expect(service.rename).toHaveBeenCalledWith(ownerId, id, { name: "Personal" });
    expect((await app.inject({ method: "DELETE", url: `/categories/${id}` })).statusCode).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(ownerId, id);
  });
  it.each(["GET", "POST", "PATCH", "DELETE"] as const)("rejects unauthenticated %s requests", async (method) => {
    const { app, service } = await routeFixture(false);
    const response = await app.inject({ method, url: method === "PATCH" || method === "DELETE" ? `/categories/${id}` : "/categories", ...(method === "POST" || method === "PATCH" ? { payload: { name: "Work" } } : {}) });
    expect(response.statusCode).toBe(401);
    for (const action of Object.values(service)) expect(action).not.toHaveBeenCalled();
  });
  it.each([{ name: " " }, { name: "a".repeat(81) }, { name: "Work", owner_id: id }])("rejects invalid or ownership-injecting input %j", async (payload) => {
    const { app, service } = await routeFixture();
    expect((await app.inject({ method: "POST", url: "/categories", payload })).statusCode).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it("validates category IDs and returns a redacted authorization failure", async () => {
    const { app, service } = await routeFixture();
    expect((await app.inject({ method: "DELETE", url: "/categories/invalid" })).statusCode).toBe(400);
    expect(service.delete).not.toHaveBeenCalled();
    service.delete.mockRejectedValue(new AppError("TASK_CATEGORY_NOT_FOUND"));
    const response = await app.inject({ method: "DELETE", url: `/categories/${id}` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error_code: "TASK_CATEGORY_NOT_FOUND" });
    expect(response.json()).not.toHaveProperty("data");
  });
});
