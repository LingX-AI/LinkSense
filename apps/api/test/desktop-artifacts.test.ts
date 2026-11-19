import { randomUUID } from "node:crypto";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { desktopArtifactPartBytes } from "@linksense/shared";
import JSZip from "jszip";
import { expect, it, onTestFinished, vi } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { sha256 } from "../src/lib/crypto.js";
import { desktopArtifactObjectKey, desktopArtifactPartKey, desktopArtifactStagingKey } from "../src/modules/files/desktop-artifact-storage.js";
import { DesktopArtifacts } from "../src/modules/files/desktop-artifacts.js";
import { webBundleObjectKey } from "../src/modules/web-sites/bundle.js";

const text = Buffer.from("An artifact from this task.\n");

async function fixture(maximumBytes = 1024) {
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
    hasPrefixExpiry: vi.fn<NonNullable<ConstructorParameters<typeof DesktopArtifacts>[0]["storage"]["hasPrefixExpiry"]>>()
      .mockResolvedValue(true),
    putObjectStream: vi.fn(async (key: string, source: Readable) => { objects.set(key, await buffer(source)); }),
    putObject: vi.fn(async (key: string, data: Buffer) => { objects.set(key, data); }),
    getObjectStream: vi.fn(async (key: string) => {
      const data = objects.get(key);
      if (!data) throw new AppError("ARTIFACT_NOT_FOUND");
      return Readable.from([data]);
    }),
    presignedPostObject: vi.fn<NonNullable<ConstructorParameters<typeof DesktopArtifacts>[0]["storage"]["presignedPostObject"]>>()
      .mockRejectedValue(new Error("Direct storage not configured")),
    composeObject: vi.fn(async (key: string, parts: readonly string[]) => {
      const bytes = parts.map(part => {
        const value = objects.get(part);
        if (!value) throw new AppError("ARTIFACT_NOT_FOUND");
        return value;
      });
      objects.set(key, Buffer.concat(bytes));
    }),
  };
  const registered = new Map<string, {
    eventId: string; value: Parameters<ConstructorParameters<typeof DesktopArtifacts>[0]["register"]>[0];
  }>();
  const register = vi.fn<ConstructorParameters<typeof DesktopArtifacts>[0]["register"]>().mockImplementation(async (input) => {
    const eventId = registered.get(input.artifactId)?.eventId ?? randomUUID();
    registered.set(input.artifactId, { eventId, value: input });
    return {
      success: true, artifact_id: input.artifactId, file_id: input.artifactId,
      display_name: input.displayName, download_card_event_id: eventId,
    };
  });
  const scheduleCleanup = vi.fn<ConstructorParameters<typeof DesktopArtifacts>[0]["scheduleCleanup"]>(async () => {});
  const scheduleWebsiteCleanup = vi.fn<ConstructorParameters<typeof DesktopArtifacts>[0]["scheduleWebsiteCleanup"]>(async () => {});
  const running = vi.fn(async () => true);
  const committed = vi.fn<ConstructorParameters<typeof DesktopArtifacts>[0]["committed"]>(async (_scope, artifactId, website) => {
    const row = registered.get(artifactId)?.value;
    return row ? { size_bytes: row.sizeBytes, sha256: row.sha256, ...(website && row.webBundle && { webBundle: row.webBundle }) } : null;
  });
  const service = new DesktopArtifacts({
    redis, storage, maximumBytes, scratchRoot: scratch.path, scheduleCleanup, scheduleWebsiteCleanup, running,
    committed, register,
  });
  const check = vi.fn(async () => {});
  const signal = AbortSignal.timeout(5_000);
  const metadata = { filename: "notes.txt", display_name: "Report.txt", size_bytes: text.length, sha256: sha256(text) };
  const prepare = () => service.prepare(scope, metadata, signal, check);
  return { scope, service, prepare, register, running, check, signal, storage, objects, scheduleCleanup, scheduleWebsiteCleanup, committed, metadata };
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

it("does not issue presigned forms without expiration for late writes", async () => {
  const { scope, signal, service, prepare, check, storage, metadata } = await fixture();
  storage.hasPrefixExpiry.mockResolvedValue(false);
  storage.presignedPostObject.mockResolvedValue({ url: "https://objects.example.test/bucket", fields: { policy: "fixture" } });
  await expect(service.prepare(scope, { ...metadata, size_bytes: 1025 }, signal, check, true))
    .rejects.toMatchObject({ code: "FILE_LIMIT_EXCEEDED" });
  await expect(prepare()).resolves.toMatchObject({ destination: { kind: "api" } });
  expect(storage.presignedPostObject).not.toHaveBeenCalled();
});

it("rechecks the run after looking up a receipt and before writing the composed object", async () => {
  const { scope, signal, service, check, storage, objects, running, committed, metadata } = await fixture(text.length - 1);
  storage.presignedPostObject.mockResolvedValue({ url: "https://objects.example.test/bucket", fields: { policy: "fixture" } });
  const { artifact_id: id } = await service.prepare(scope, metadata, signal, check, true);
  objects.set(desktopArtifactPartKey(id, 0), text);
  committed.mockImplementationOnce(async () => {
    running.mockResolvedValue(false);
    return null;
  });
  await expect(service.confirm(scope, id, signal, check, vi.fn())).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(storage.composeObject).not.toHaveBeenCalled();
});

it.each(["valid", "changed"] as const)("registers only verified multipart bytes (%s)", async variant => {
  const { scope, signal, service, check, storage, objects, scheduleCleanup, register } = await fixture(desktopArtifactPartBytes);
  const first = Buffer.alloc(desktopArtifactPartBytes, "x");
  const tail = Buffer.from("last part");
  const size = first.length + tail.length;
  const metadata = {
    filename: "report.txt", display_name: "Report.txt", size_bytes: size, sha256: sha256(Buffer.concat([first, tail])),
  };
  storage.presignedPostObject.mockImplementation(async key => ({ url: "https://objects.example.test/bucket", fields: { key } }));
  await expect(service.prepare(scope, metadata, signal, check)).rejects.toMatchObject({ code: "FILE_LIMIT_EXCEEDED" });
  expect(storage.presignedPostObject).not.toHaveBeenCalled();
  const grant = await service.prepare(scope, metadata, signal, check, true);
  const id = grant.artifact_id;
  const keys = [desktopArtifactPartKey(id, 0), desktopArtifactPartKey(id, 1)];
  expect(grant.destination).toMatchObject({ kind: "presigned_parts", parts: keys.map(key => ({ fields: { key } })) });
  expect(storage.presignedPostObject.mock.calls.map(([key, bytes]) => [key, bytes]))
    .toEqual([[keys[0], first.length], [keys[1], tail.length]]);
  expect(scheduleCleanup).toHaveBeenCalledExactlyOnceWith(scope.conversationId, id, Date.parse(grant.expires_at), 2);
  await expect(service.upload(scope, id, size, Readable.from([]), signal, check))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  objects.set(keys[0]!, first);
  objects.set(keys[1]!, variant === "valid" ? tail : Buffer.alloc(tail.length));
  const confirm = () => service.confirm(scope, id, signal, check, vi.fn());
  if (variant === "changed") {
    await expect(confirm()).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" });
    expect(register).not.toHaveBeenCalled();
    expect(storage.putObjectStream).not.toHaveBeenCalled();
  } else {
    const receipt = await confirm();
    expect(receipt.file_id).toBe(id);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ sizeBytes: size, multipart: true }), expect.any(Function));
    objects.delete(keys[1]!);
    await expect(confirm()).resolves.toEqual(receipt);
  }
  expect(storage.composeObject).toHaveBeenCalledExactlyOnceWith(desktopArtifactStagingKey(id), keys, expect.any(AbortSignal));
});

it.each(["ready", "missing resource", "cleanup unavailable"] as const)(
  "only publishes the verified website once its resources and durable cleanup are ready (%s)",
  async scenario => {
    const { scope, signal, service, check, storage, objects, register, prepare, scheduleWebsiteCleanup } = await fixture();
    const entry = Buffer.from('<!doctype html><link rel="stylesheet" href="/assets/theme.css"><h1>Report</h1>');
    const zip = new JSZip().file("index.html", entry);
    if (scenario !== "missing resource") zip.file("assets/theme.css", "h1{color:red}", { createFolders: false });
    const archive = await zip.generateAsync({ type: "nodebuffer" });
    const grant = await service.prepare(scope, {
      filename: "index.html", display_name: "Report.html", entry_path: "index.html",
      size_bytes: archive.length, sha256: sha256(archive), mime_type: "application/zip",
    }, signal, check, true);
    const artifactId = grant.artifact_id;
    const finalKey = desktopArtifactObjectKey(scope.conversationId, artifactId);
    await service.upload(scope, artifactId, archive.length, Readable.from([archive]), signal, check);
    if (scenario === "cleanup unavailable") scheduleWebsiteCleanup.mockRejectedValueOnce(new Error("queue unavailable"));
    const confirm = () => service.confirm(scope, artifactId, signal, check, vi.fn());
    if (scenario !== "ready") {
      await expect(confirm()).rejects.toMatchObject({
        code: scenario === "missing resource" ? "WEB_SITE_RESOURCES_MISSING" : "RUNNER_UNAVAILABLE",
      });
      expect(storage.putObject).not.toHaveBeenCalled();
      expect(objects.has(finalKey)).toBe(false);
      expect(register).not.toHaveBeenCalled();
      if (scenario === "missing resource") await expect(prepare()).resolves.toMatchObject({ destination: { kind: "api" } });
      return;
    }
    const receipt = await confirm();
    expect(scheduleWebsiteCleanup).toHaveBeenCalledExactlyOnceWith(
      scope.conversationId, artifactId, ["assets/theme.css", "index.html"], Date.parse(grant.expires_at),
    );
    expect(storage.putObject.mock.invocationCallOrder[0]).toBeGreaterThan(scheduleWebsiteCleanup.mock.invocationCallOrder[0]!);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      sizeBytes: entry.length, sha256: sha256(entry), webBundle: expect.objectContaining({ entry_path: "index.html" }),
    }), expect.any(Function));
    expect(objects.get(finalKey)).toEqual(entry);
    expect(objects.get(webBundleObjectKey(artifactId, "index.html"))?.toString()).toContain('href="./assets/theme.css"');
    objects.delete(desktopArtifactStagingKey(artifactId));
    await expect(confirm()).resolves.toEqual(receipt);
    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(storage.putObjectStream).toHaveBeenCalledTimes(2);
  },
);
