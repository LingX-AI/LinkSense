import { describe, expect, it } from "vitest"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import lockfile from "proper-lockfile"

import { CapabilityRuntimeManager } from "../src/workspace/capability-runtime.js"

describe("CapabilityRuntimeManager user projection", () => {
  it("releases the publication lock after startup while keeping the prior task identity independent", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-start-fence-"));
    const control = join(root, "capabilities");
    const identity = { uid: process.getuid!(), gid: process.getgid!() };
    const manager = new CapabilityRuntimeManager({ apiIdentity: identity, taskIdentity: identity });
    await mkdir(control, { mode: 0o700 });
    await chmod(control, 0o700);
    await writeFile(join(control, "capability-generation"), "a".repeat(64));
    const first = await manager.acquireLease({ controlRoot: root, expectedGeneration: "a".repeat(64) });
    let second: Awaited<ReturnType<typeof manager.acquireLease>> | undefined;
    try {
      expect(await lockfile.check(control, { realpath: false, lockfilePath: join(control, "reconcile.lock") })).toBe(true);
      await first.releasePublicationLock();
      expect(await lockfile.check(control, { realpath: false, lockfilePath: join(control, "reconcile.lock") })).toBe(false);
      await writeFile(join(control, "capability-generation"), "b".repeat(64));
      second = await manager.acquireLease({ controlRoot: root, expectedGeneration: "b".repeat(64) });
      await first.release();
      expect(first.generation).toBe("a".repeat(64));
      expect(second.generation).toBe("b".repeat(64));
      expect(await lockfile.check(control, { realpath: false, lockfilePath: join(control, "reconcile.lock") })).toBe(true);
    } finally {
      await first.release();
      await second?.release();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("derives capability paths from the shared user home", () => {
    const manager = new CapabilityRuntimeManager()

    expect(
      manager.pathsFor(
        "/srv/linksense/users/owner/home",
        "/srv/linksense/users/owner/control",
      ),
    ).toEqual({
      skillsRoot:
        "/srv/linksense/users/owner/home/.agents/current/skills",
      pluginSourceRoot:
        "/srv/linksense/users/owner/home/.agents/current/plugin-sources",
      marketplacePath:
        "/srv/linksense/users/owner/home/.agents/current/plugins/marketplace.json",
      capabilityControl:
        "/srv/linksense/users/owner/control/capabilities",
    })
  })
})
