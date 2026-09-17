import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { countUserProcesses } from "../src/user-process-activity.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "linksense-environment-test-"));
  roots.push(root);
  return root;
}

describe("container user activity", () => {
  it("counts live user processes including detached servers and excludes supervisor and zombies", async () => {
    const proc = await temporaryRoot();
    for (const [pid, uid, state] of [[1, 1000, "S"], [12, 1001, "R"], [25, 1001, "S"], [30, 1001, "Z"], [33, 1001, "X"]] as const) {
      await mkdir(path.join(proc, String(pid)));
      await writeFile(path.join(proc, String(pid), "status"), `Name:\tfixture\nState:\t${state}\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nPPid:\t1\n`);
    }
    await mkdir(path.join(proc, "99")); // A process exited between listing and reading.
    await mkdir(path.join(proc, "self"));
    expect(await countUserProcesses(1001, proc)).toBe(2);
  });

  it("does not report idle when the process namespace cannot be inspected", async () => {
    await expect(countUserProcesses(1001, path.join(await temporaryRoot(), "missing"))).rejects.toThrow();
  });
});
