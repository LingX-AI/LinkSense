import { randomUUID } from "node:crypto";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { expect, it, onTestFinished, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { sha256 } from "../src/lib/crypto.js";
import { desktopArtifactObjectKey, desktopArtifactStagingKey } from "../src/modules/files/desktop-artifact-storage.js";
import { DesktopArtifacts } from "../src/modules/files/desktop-artifacts.js";

const text = Buffer.from("An artifact from this task.\n");

async function fixture() {
  const scratch = await mkdtempDisposable(join(tmpdir(), "linksense-desktop-artifact-"));
  onTestFinished(() => scratch.remove());
  const scope = {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
  };
  const values = new Map<string, string>();
  const objects = new Map<string, Buffer>();
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _px: "PX", _ttl: number, nx?: "NX") => {
      if (nx && values.has(key)) return null;
      values.set(key, value);
      return "OK" as const;
    }),
    eval: vi.fn(async (_script: string, _count: number, key: string, value: string) => {
      if (values.get(key) === value) return Number(values.delete(key));
      return 0;
    }),
  };
  const storage = {
    putObjectStream: vi.fn(async (key: string, source: Readable) => { objects.set(key, await buffer(source)); }),
    getObjectStream: vi.fn(async (key: string) => {
      const data = objects.get(key);
      if (!data) throw new AppError("ARTIFACT_NOT_FOUND");
      return Readable.from([data]);
    }),
    presignedPostObject: vi.fn<NonNullable<ConstructorParameters<typeof DesktopArtifacts>[0]["storage"]["presignedPostObject"]>>()
      .mockRejectedValue(new Error("Direct storage not configured")),
  };
  const registered = new Map<string, string>();
  const register = vi.fn<ConstructorParameters<typeof DesktopArtifacts>[0]["register"]>().mockImplementation(async (input) => {
    const eventId = registered.get(input.artifactId) ?? randomUUID();
    registered.set(input.artifactId, eventId);
    return {
      success: true, artifact_id: input.artifactId, file_id: input.artifactId,
      display_name: input.displayName, download_card_event_id: eventId,
    };
  });
  const scheduleCleanup = vi.fn(async () => {});
  const running = vi.fn(async () => true);
  const service = new DesktopArtifacts({
    redis, storage, maximumBytes: 1024, scratchRoot: scratch.path, scheduleCleanup, running,
    exists: async (_conversationId, artifactId) => registered.has(artifactId), register,
  });
  const check = vi.fn(async () => {});
  const signal = AbortSignal.timeout(5_000);
  const metadata = { filename: "notes.txt", display_name: "Report.txt", size_bytes: text.length, sha256: sha256(text) };
  const prepare = () => service.prepare(scope, metadata, signal, check);
  return { scope, service, prepare, register, running, check, signal, storage, objects, scheduleCleanup };
}

it("publishes only after a temporary upload is verified and rechecked", async () => {
  const { scope, signal, service, prepare, check, storage, register, objects, scheduleCleanup } = await fixture();
  const grant = await prepare();
  expect(grant.destination).toEqual({ kind: "api" });
  expect(scheduleCleanup).toHaveBeenCalledOnce();
  await service.upload(scope, grant.artifact_id, text.length, Readable.from([text]), signal, check);
  expect(register).not.toHaveBeenCalled();
  const finalKey = desktopArtifactObjectKey(scope.conversationId, grant.artifact_id);
  expect(objects.get(finalKey)).toBeUndefined();
  const result = await service.confirm(scope, grant.artifact_id, signal, check, vi.fn());
  expect(result).toMatchObject({ artifact_id: grant.artifact_id, file_id: grant.artifact_id, display_name: "Report.txt" });
  expect(objects.get(finalKey)).toEqual(text);
  expect(storage.putObjectStream).toHaveBeenCalledTimes(2);
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ sizeBytes: text.length, sha256: sha256(text), mimeType: "text/plain" }), expect.any(Function));
});

it("refuses a different connection and a changed upload before registration or final storage", async () => {
  const { scope, signal, service, prepare, check, storage, register } = await fixture();
  const grant = await prepare();
  await expect(service.upload({ ...scope, connectionId: randomUUID() }, grant.artifact_id, text.length,
    Readable.from([text]), signal, check)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(storage.putObjectStream).not.toHaveBeenCalled();
  await service.upload(scope, grant.artifact_id, text.length, Readable.from([Buffer.alloc(text.length)]), signal, check);
  await expect(service.confirm(scope, grant.artifact_id, signal, check, vi.fn()))
    .rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });
  expect(storage.putObjectStream).toHaveBeenCalledOnce();
  expect(register).not.toHaveBeenCalled();
  await expect(service.confirm(scope, grant.artifact_id, signal, check, vi.fn()))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  const corrected = await prepare();
  expect(corrected.artifact_id).not.toBe(grant.artifact_id);
});

it("does not admit an artifact before the turn is running or return a grant when durable cleanup fails", async () => {
  const { prepare, running, scheduleCleanup } = await fixture();
  running.mockResolvedValueOnce(false);
  await expect(prepare()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(scheduleCleanup).not.toHaveBeenCalled();
  scheduleCleanup.mockRejectedValueOnce(new AppError("RUNNER_UNAVAILABLE"));
  await expect(prepare()).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
});

it("accepts a streamed fallback for a direct grant and replays the immutable receipt", async () => {
  const { scope, signal, service, prepare, check, storage, objects } = await fixture();
  storage.presignedPostObject.mockResolvedValueOnce({
    url: "https://objects.example.test/bucket", fields: { policy: "fixture" },
  });
  const { artifact_id: id, destination } = await prepare();
  expect(destination.kind).toBe("presigned_post");
  await service.upload(scope, id, text.length, Readable.from([text]), signal, check);
  const receipt = await service.confirm(scope, id, signal, check, vi.fn());
  // An already-issued form can still write staging; never let it overwrite the receipt bytes.
  objects.set(desktopArtifactStagingKey(id), Buffer.alloc(text.length));
  await expect(service.confirm(scope, id, signal, check, vi.fn())).resolves.toEqual(receipt);
  await expect(service.upload(scope, id, text.length, Readable.from([text]), signal, check))
    .rejects.toMatchObject({ code: "CONFLICT" });
  expect(storage.putObjectStream).toHaveBeenCalledTimes(2);
  expect(objects.get(desktopArtifactObjectKey(scope.conversationId, id))).toEqual(text);
});
