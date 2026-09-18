import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { developmentObjectStorageCheckCommand, verifyDevelopmentObjectStorage } from "./dev.mjs";

const execute = promisify(execFile);

async function storageProbe(storageImplementation, { timeoutMs = 1_000, configuration = "{}" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "linksense-storage-probe-"));
  try {
    await mkdir(join(directory, "src/adapters"), { recursive: true });
    await writeFile(join(directory, "src/config.ts"), `export function parseConfig() { return ${configuration}; }`);
    await writeFile(join(directory, "src/adapters/object-storage.ts"), `export function createObjectStorage() { return { ensureBucket: async () => { ${storageImplementation} } }; }`);
    const command = developmentObjectStorageCheckCommand(timeoutMs);
    const result = await execute(process.execPath, ["--input-type=module", "-e", command.at(-1)], {
      cwd: directory, timeout: 5_000,
    });
    return result.stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("storage preflight checks from the API network without starting services or publishing ports", () => {
  assert.deepEqual(developmentObjectStorageCheckCommand().slice(0, -1), [
    "run", "--rm", "--no-deps", "--pull", "never", "--workdir", "/workspace/apps/api",
    "--entrypoint", "node", "api", "--import", "tsx", "--input-type=module", "-e",
  ]);
});

test("storage preflight verifies the configured adapter and accepts an accessible bucket", async () => {
  const output = await storageProbe("");
  assert.deepEqual(JSON.parse(output), { ready: true });
  await verifyDevelopmentObjectStorage(async () => output);
});

test("a refused storage connection stops startup with a useful error and redacts external details", async () => {
  const output = await storageProbe('throw Object.assign(new Error("password=private-value storage.internal:9000"), {code: "ECONNREFUSED"});');
  assert.deepEqual(JSON.parse(output), { ready: false, reason: "ECONNREFUSED" });
  await assert.rejects(verifyDevelopmentObjectStorage(async () => output), /Object storage.*ECONNREFUSED.*MinIO.*MINIO_.*pnpm dev/u);
  assert.ok(!output.includes("private-value"));
  assert.ok(!output.includes("storage.internal"));
});

test("missing buckets and invalid credentials stop startup without creating resources", async () => {
  for (const reason of ["MINIO_BUCKET_NOT_FOUND", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"]) {
    const output = await storageProbe(`throw Object.assign(new Error(${JSON.stringify(reason)}), {code: ${JSON.stringify(reason)}});`);
    assert.deepEqual(JSON.parse(output), { ready: false, reason });
    await assert.rejects(verifyDevelopmentObjectStorage(async () => output), new RegExp(reason));
  }
});

test("storage preflight bounds a hung dependency", async () => {
  const output = await storageProbe("await new Promise(() => {});", { timeoutMs: 50 });
  assert.deepEqual(JSON.parse(output), { ready: false, reason: "ETIMEDOUT" });
  await assert.rejects(verifyDevelopmentObjectStorage(async () => output), /ETIMEDOUT/u);
});

test("storage preflight never forwards arbitrary SDK or configuration error text", async () => {
  const output = await storageProbe('throw Object.assign(new Error("password=private-value"), {code: "PRIVATE_SECRET_VALUE"});');
  assert.deepEqual(JSON.parse(output), { ready: false, reason: "OBJECT_STORAGE_UNAVAILABLE" });
  await assert.rejects(verifyDevelopmentObjectStorage(async () => '{"ready":false,"reason":"password=private-value"}'), /Invalid option/u);
});
