import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtempDisposable } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { MinioObjectStorage } from "../../src/adapters/object-storage.js";
import { testConfig } from "../test-config.js";

export async function createDesktopMinioFixture(scratch: string): Promise<{
  storage: MinioObjectStorage;
  bucket: string;
  close(): Promise<void>;
} | null> {
  const binary = process.env.LINKSENSE_TEST_MINIO_BIN;
  if (!binary) return null;
  if (!isAbsolute(binary)) throw new Error("Set LINKSENSE_TEST_MINIO_BIN to a local executable's absolute path");
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("Missing localhost MinIO port");

  const root = await mkdtempDisposable(join(scratch, "minio-"));
  const accessKey = randomBytes(16).toString("hex");
  const secretKey = randomBytes(24).toString("hex");
  const child = spawn(binary, ["server", root.path, "--address", `127.0.0.1:${address.port}`, "--console-address", "127.0.0.1:0"], {
    cwd: root.path, stdio: "ignore",
    env: {
      HOME: root.path, TMPDIR: root.path, MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey,
      MINIO_BROWSER: "off", MINIO_UPDATE: "off",
    },
  });
  let spawnError: Error | undefined;
  child.once("error", error => { spawnError = error; });
  const exited = new Promise<void>(resolve => { child.once("close", () => resolve()); });
  const close = async () => {
    child.kill("SIGTERM");
    const force = setTimeout(() => { child.kill("SIGKILL"); }, 3_000).unref();
    try { await exited; } finally { clearTimeout(force); await root.remove(); }
  };
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const startup = AbortSignal.timeout(10_000);
    for (;;) {
      startup.throwIfAborted();
      if (spawnError || child.exitCode !== null) throw new Error("The MinIO fixture could not start", { cause: spawnError });
      const health = await fetch(`${origin}/minio/health/live`, { signal: AbortSignal.timeout(250) }).catch(() => null);
      await health?.body?.cancel();
      if (health?.ok) break;
      await delay(50, undefined, { signal: startup });
    }
    const bucket = `linksense-test-${randomUUID()}`;
    const storage = new MinioObjectStorage(testConfig({
      MINIO_ENDPOINT: "127.0.0.1", MINIO_PORT: String(address.port), MINIO_PUBLIC_URL: origin,
      MINIO_ACCESS_KEY: accessKey, MINIO_SECRET_KEY: secretKey, MINIO_BUCKET: bucket,
    }));
    await storage.client.makeBucket(bucket, "us-east-1");
    return { storage, bucket, close };
  } catch (error) {
    await close();
    throw error;
  }
}
