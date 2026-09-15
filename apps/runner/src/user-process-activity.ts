import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Linux /proc reflects this container's process namespace, including detached tools. */
export async function countUserProcesses(uid: number, procRoot = "/proc"): Promise<number> {
  const entries = (await readdir(procRoot)).filter((entry) => /^\d+$/u.test(entry));
  let count = 0;
  // Bound reads rather than issuing thousands of simultaneous file operations.
  for (let offset = 0; offset < entries.length; offset += 32) {
    const active = await Promise.all(entries.slice(offset, offset + 32).map(async (entry) => {
      try {
        const status = await readFile(path.join(procRoot, entry, "status"), "utf8");
        const processUid = /^Uid:\s+(\d+)/mu.exec(status)?.[1];
        const state = /^State:\s+(\S)/mu.exec(status)?.[1];
        return Number(processUid) === uid && state !== "Z" && state !== "X";
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
        throw error;
      }
    }));
    count += active.filter(Boolean).length;
  }
  return count;
}
