import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { UserEnvironmentSettingsStore } from "../src/controller/user-environment-settings.js";
import { countUserProcesses } from "../src/user-process-activity.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "linksense-environment-test-"));
  roots.push(root);
  return root;
}

describe("persistent user environment settings", () => {
  it("defaults to idle reclamation and persists keep-running independently for each user", async () => {
    const root = await temporaryRoot();
    const store = new UserEnvironmentSettingsStore(root);
    expect(await store.get(ownerId)).toEqual({ keep_running: false });
    await expect(lstat(path.join(root, ownerId))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await store.set(ownerId, { keep_running: true })).toEqual({ keep_running: true });
    expect(await new UserEnvironmentSettingsStore(root).get(ownerId)).toEqual({ keep_running: true });
    expect(await store.get(otherId)).toEqual({ keep_running: false });
    await store.set(ownerId, { keep_running: false });
    const file = path.join(root, ownerId, "control", "environment.json");
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ keep_running: false });
  });

  it("rejects traversal, injected fields and a substituted owner directory", async () => {
    const root = await temporaryRoot();
    const store = new UserEnvironmentSettingsStore(root);
    await expect(store.get("../outside")).rejects.toThrow();
    await expect(store.set(ownerId, { keep_running: true, owner_id: otherId } as never)).rejects.toThrow();
    const outside = await temporaryRoot();
    await symlink(outside, path.join(root, ownerId));
    await expect(store.get(ownerId)).rejects.toThrow("boundary");
    await expect(store.set(ownerId, { keep_running: true })).rejects.toThrow("boundary");
    await expect(lstat(path.join(outside, "control"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for corrupt settings and symlinked settings files", async () => {
    const root = await temporaryRoot();
    const store = new UserEnvironmentSettingsStore(root);
    await store.set(ownerId, { keep_running: true });
    const file = path.join(root, ownerId, "control", "environment.json");
    await writeFile(file, "invalid");
    await expect(store.get(ownerId)).rejects.toThrow();
    await rm(file);
    await symlink(path.join(root, "outside"), file);
    await expect(store.get(ownerId)).rejects.toThrow("boundary");
  });
});

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
