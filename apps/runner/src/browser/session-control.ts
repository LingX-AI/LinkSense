import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import lockfile from "proper-lockfile";
import { browserPanelErrorCodes } from "@linksense/shared";

const leaseSchema = z.strictObject({
  token: z.uuid(),
  expiresAt: z.number().int(),
  retainUntil: z.number().int().optional(),
});
export const browserControlLeaseMs = 30_000;
export class BrowserPanelError extends Error {
  constructor(readonly code: (typeof browserPanelErrorCodes)[number]) {
    super(code);
  }
}

export async function withBrowserSessionLock<T>(
  directory: string,
  operation: () => Promise<T>,
  timeoutMs = 1_000,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(directory, {
      realpath: false,
      lockfilePath: `${directory}.command-lock`,
      stale: 150_000,
      retries: {
        retries: Math.ceil(timeoutMs / 25),
        factor: 1,
        minTimeout: 25,
        maxTimeout: 25,
      },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ELOCKED")
      throw new BrowserPanelError("BROWSER_CONTROL_BUSY");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function readBrowserControl(
  directory: string,
): Promise<z.infer<typeof leaseSchema> | null> {
  try {
    const file = path.join(directory, "human-control.json");
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 2_048)
      throw new Error("invalid browser control state");
    return leaseSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

export async function writeBrowserControl(
  directory: string,
  lease: z.infer<typeof leaseSchema>,
): Promise<void> {
  const temporary = path.join(directory, `human-control-${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(leaseSchema.parse(lease)), {
    mode: 0o600,
  });
  await rename(temporary, path.join(directory, "human-control.json"));
}
