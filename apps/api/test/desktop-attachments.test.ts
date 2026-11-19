import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { get, type IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import Fastify from "fastify";
import { DESKTOP_ATTACHMENT_GRANT_HEADER, desktopAttachmentDownloadPath } from "@linksense/shared";
import { expect, it, vi } from "vitest";
import { sha256 } from "../src/lib/crypto.js";
import { AppError, errorDetails } from "../src/lib/errors.js";
import { registerDesktopAttachmentRoute } from "../src/modules/files/desktop-attachment-route.js";
import { reserveDesktopAttachmentSlot } from "../src/modules/files/desktop-attachment-slots.js";
import { DesktopAttachments, parseDesktopAttachmentGrant } from "../src/modules/files/desktop-attachments.js";

async function fixture(
  onTestFinished: (cleanup: () => Promise<void>) => void,
  filename = "Résumé 进度.txt",
  legacyChecksum?: "uppercase" | "missing",
) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "linksense-attachment-api-"));
  onTestFinished(() => rm(workspaceRoot, { recursive: true, force: true }));
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), runtimeGeneration: randomUUID(), turnId: randomUUID(),
  };
  const id = randomUUID(), commandId = randomUUID();
  const data = Buffer.from("fixture attachment");
  const file = {
    id, filename, sizeBytes: String(data.byteLength),
    checksumSha256: legacyChecksum === "missing" ? null
      : legacyChecksum === "uppercase" ? sha256(data).toUpperCase() : sha256(data),
    kind: "attachment", source: "user_upload", storageBackend: "workspace", createdBy: scope.ownerId,
    workspaceRelativePath: `attachments/${id}/${filename}`,
    workspaceRootRelPath: `${scope.ownerId}/services/${scope.conversationId}/home/workspace`,
  };
  const absolute = join(workspaceRoot, file.workspaceRootRelPath, file.workspaceRelativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, data);
  const intent = { attachmentsJson: [file], pendingRequestId: null };
  const store = {
    conversationTurnStartIntent: { findFirst: vi.fn().mockResolvedValue(intent) },
    conversation: { findFirst: vi.fn().mockResolvedValue({ workspaceRelPath: file.workspaceRootRelPath }) },
    conversationFile: { findFirst: vi.fn().mockResolvedValue({ id }) },
  };
  const service = new DesktopAttachments(store, {
    workspaceRoot, upload: { maxFileSizeBytes: 1024, maxFilesPerConversation: 10 }, credentialMasterKey: randomUUID(),
  });
  const [manifest] = await service.manifest(scope, 1, commandId, Date.now() + 30_000);
  if (!manifest) throw new Error("Missing attachment manifest");
  const checkRun = vi.fn(async () => {});
  const openDownload = async (requestedScope = scope, fileId = id, grant = manifest.download_grant) =>
    service.read(requestedScope, fileId, parseDesktopAttachmentGrant(grant), AbortSignal.timeout(10_000), checkRun);
  const read = async (...args: Parameters<typeof openDownload>) => {
    const { stream, close } = await openDownload(...args);
    try { return await buffer(stream); } finally { await close(); }
  };
  return { checkRun, store, scope, service, manifest, file, data, read, openDownload, absolute, workspaceRoot, intent, commandId };
}

it("only delivers the selected unchanged attachment under its exact prepared run scope", async ({ onTestFinished }) => {
  const { checkRun, store, scope, manifest, file, data, read, service, commandId } = await fixture(onTestFinished);
  expect(manifest).toEqual({ id: file.id, filename: file.filename, size_bytes: data.byteLength, sha256: sha256(data), download_grant: expect.any(String) });
  await expect(read()).resolves.toEqual(data);
  expect(store.conversationTurnStartIntent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    ownerId: scope.ownerId, conversationId: scope.conversationId, projectionTurnId: scope.turnId, runtimeGeneration: scope.runtimeGeneration, runnerStatus: "prepared",
  }) }));
  expect(store.conversationFile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    id: file.id, turnId: null, pendingRequestId: null, status: "staged", checksumSha256: sha256(data),
  }) }));
  for (const field of ["turnId", "connectionId", "deviceId", "conversationId", "runtimeGeneration"] as const) {
    await expect(read({ ...scope, [field]: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(read(scope, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(read(scope, file.id, manifest.download_grant.replace(commandId, randomUUID()))).rejects.toMatchObject({ code: "FORBIDDEN" });
  const [expired] = await service.manifest(scope, 1, commandId, Date.now() - 1);
  await expect(read(scope, file.id, expired?.download_grant)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(checkRun).toHaveBeenCalledOnce();
});

it("preserves an older Unix upload with a backslash by using a portable name on the Mac", async ({ onTestFinished }) => {
  const { read, manifest, data } = await fixture(onTestFinished, "invoice\\jul.txt");
  expect(manifest.filename).toBe("invoice_jul.txt");
  await expect(read()).resolves.toEqual(data);
});

for (const legacyChecksum of ["uppercase", "missing"] as const) {
  it(`delivers a verified historical attachment with ${legacyChecksum} checksum`, async ({ onTestFinished }) => {
    const { absolute, commandId, data, file, manifest, read, scope, service, store, workspaceRoot } =
      await fixture(onTestFinished, undefined, legacyChecksum);
    expect(manifest.sha256).toBe(sha256(data));
    await expect(read()).resolves.toEqual(data);
    expect(store.conversationFile.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ checksumSha256: file.checksumSha256 }),
    }));

    await writeFile(absolute, Buffer.alloc(data.byteLength));
    await expect(read()).rejects.toMatchObject({
      code: legacyChecksum === "missing" ? "FORBIDDEN" : "ATTACHMENT_UPLOAD_INVALID",
    });

    if (legacyChecksum === "missing") {
      await rm(absolute);
      const outside = join(workspaceRoot, "unselected-file.txt");
      await writeFile(outside, data);
      await symlink(outside, absolute);
      await expect(service.manifest(scope, 1, commandId, Date.now() + 30_000))
        .rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_INVALID" });
    }
  });
}

it("withholds changed bytes, aliased files, detached rows and canceled grants", async ({ onTestFinished }) => {
  const { checkRun, store, scope, file, data, read, absolute, workspaceRoot, intent } = await fixture(onTestFinished);
  const pendingRequestId = randomUUID();
  store.conversationTurnStartIntent.findFirst.mockResolvedValue({ ...intent, pendingRequestId });
  await expect(read()).resolves.toEqual(data);
  expect(store.conversationFile.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
    where: expect.objectContaining({ status: "pending", pendingRequestId }),
  }));
  await writeFile(absolute, Buffer.alloc(data.byteLength));
  await expect(read()).rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_INVALID" });
  await rm(absolute);
  const outside = join(workspaceRoot, "not-an-attachment.txt");
  await writeFile(outside, data);
  await symlink(outside, absolute);
  await expect(read()).rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_INVALID" });
  await rm(absolute);
  await writeFile(absolute, data);
  store.conversationFile.findFirst.mockResolvedValueOnce({ id: file.id }).mockResolvedValueOnce(null);
  await expect(read()).rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_INVALID" });
  checkRun.mockRejectedValueOnce(new AppError("AUTH_REQUIRED"));
  await expect(read()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  store.conversationTurnStartIntent.findFirst.mockResolvedValueOnce(null);
  await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(read({ ...scope, ownerId: randomUUID() })).rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_INVALID" });
});

it("withholds bytes changed in place after preverification", async ({ onTestFinished }) => {
  const { absolute, data, openDownload } = await fixture(onTestFinished);
  const { stream, close } = await openDownload();
  try {
    await writeFile(absolute, Buffer.alloc(data.byteLength));
    await expect(buffer(stream)).rejects.toMatchObject({ code: "ATTACHMENT_UPLOAD_INVALID" });
  } finally {
    stream.destroy();
    await close();
  }
});

it("streams no-store bytes to the run bearer and refuses a model token, range or query", async ({ onTestFinished }) => {
  const { scope, data, manifest, service } = await fixture(onTestFinished);
  const app = Fastify();
  onTestFinished(() => app.close());
  app.setErrorHandler((error, _request, reply) => reply.code(
    error instanceof AppError ? error.statusOverride ?? errorDetails(error.code, "en-US").status : 500,
  ).send());
  const leases = { authorizeToolResult: vi.fn(async () => scope), verifyRunBinding: vi.fn(async () => {}) };
  const redis = { eval: vi.fn().mockResolvedValue(1), zrem: vi.fn().mockResolvedValue(1) };
  registerDesktopAttachmentRoute(app, service, leases, () => reserveDesktopAttachmentSlot(redis), async () => {});
  const url = `${desktopAttachmentDownloadPath}/${scope.turnId}/${manifest.id}`;
  const headers = { authorization: `Bearer lsdr_${"a".repeat(43)}`, [DESKTOP_ATTACHMENT_GRANT_HEADER]: manifest.download_grant };
  expect((await app.inject({ url, headers: { ...headers, authorization: `Bearer lsdm_${"b".repeat(43)}` } })).statusCode).toBe(401);
  expect((await app.inject({ url: `${url}?file=other`, headers })).statusCode).toBe(400);
  expect((await app.inject({ url, headers: { ...headers, range: "bytes=1-2" } })).statusCode).toBe(400);
  expect((await app.inject({ url, headers, method: "HEAD" })).statusCode).toBe(404);
  expect(leases.authorizeToolResult).not.toHaveBeenCalled();
  const result = await app.inject({ url, headers });
  expect(result.statusCode).toBe(200);
  expect(result.headers).toMatchObject({
    "content-length": String(data.length), "cache-control": "private, no-store",
    "content-type": "application/octet-stream",
  });
  expect(result.rawPayload).toEqual(data);
  await vi.waitFor(() => expect(redis.zrem).toHaveBeenCalledOnce());
  redis.eval.mockResolvedValueOnce(0);
  expect((await app.inject({ url, headers })).statusCode).toBe(429);
});

it("holds the download slot until a paused HTTP receiver disconnects, and cancels on loss of authority", async ({
  onTestFinished,
}) => {
  const { scope, manifest } = await fixture(onTestFinished);
  const app = Fastify({ forceCloseConnections: true });
  onTestFinished(() => app.close());
  let authorized = true;
  const leases = { authorizeToolResult: vi.fn(async () => scope), verifyRunBinding: vi.fn(async () => {}) };
  const redis = { eval: vi.fn().mockResolvedValue(1), zrem: vi.fn().mockResolvedValue(1) };
  const byteLength = 16 * 1024 * 1024;
  const read = async () => ({
    stream: Readable.from([Buffer.alloc(byteLength)], { objectMode: false }), byteLength, close: async () => {},
  });
  registerDesktopAttachmentRoute(app, { read }, leases,
    () => reserveDesktopAttachmentSlot(redis), async () => { if (!authorized) throw new AppError("FORBIDDEN"); });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `${origin}${desktopAttachmentDownloadPath}/${scope.turnId}/${manifest.id}`;
  const headers = { authorization: `Bearer lsdr_${"a".repeat(43)}`, [DESKTOP_ATTACHMENT_GRANT_HEADER]: manifest.download_grant };
  const connect = () => new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(url, { headers }, response => { response.pause(); resolve(response); });
    request.on("error", reject);
    onTestFinished(() => { request.destroy(); });
  });
  const disconnected = await connect();
  expect(disconnected.statusCode).toBe(200);
  expect(redis.zrem).not.toHaveBeenCalled();
  disconnected.destroy();
  await vi.waitFor(() => expect(redis.zrem).toHaveBeenCalledTimes(1));

  const revoked = await connect();
  authorized = false;
  await vi.waitFor(() => expect(redis.zrem).toHaveBeenCalledTimes(2), { timeout: 3_000 });
  revoked.resume();
  await vi.waitFor(() => {
    expect(revoked.destroyed).toBe(true);
    expect(revoked.complete).toBe(false);
  });
});

it("holds download capacity until an in-progress file read exits after disconnect", async ({ onTestFinished }) => {
  const { scope, manifest } = await fixture(onTestFinished);
  const app = Fastify({ forceCloseConnections: true });
  onTestFinished(() => app.close());
  let resumeRead = () => {};
  const pendingRead = new Promise<void>(resolve => { resumeRead = resolve; });
  onTestFinished(async () => { resumeRead(); });
  const read = vi.fn(async (...args: Parameters<DesktopAttachments["read"]>) => {
    await pendingRead;
    args[3].throwIfAborted();
    return { stream: Readable.from(["fixture"]), byteLength: 7, close: async () => {} };
  });
  const release = vi.fn(async () => {});
  const leases = { authorizeToolResult: vi.fn(async () => scope), verifyRunBinding: vi.fn(async () => {}) };
  registerDesktopAttachmentRoute(app, { read }, leases, async () => release, async () => {});
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const request = get(`${origin}${desktopAttachmentDownloadPath}/${scope.turnId}/${manifest.id}`, {
    headers: { authorization: `Bearer lsdr_${"a".repeat(43)}`, [DESKTOP_ATTACHMENT_GRANT_HEADER]: manifest.download_grant },
  });
  request.on("error", () => {}); // Destroying the receiver deliberately closes the HTTP request.
  onTestFinished(async () => { request.destroy(); });
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  request.destroy();
  await vi.waitFor(() => expect(read.mock.calls[0]?.[3].aborted).toBe(true));
  expect(release).not.toHaveBeenCalled();
  resumeRead();
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
});
