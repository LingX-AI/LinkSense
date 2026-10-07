import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const capabilityFields = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"];

function statusField(status, name) {
  const value = status.match(new RegExp(`^${name}:\\s*(.+)$`, "mu"))?.[1];
  assert.ok(value, `missing Linux process field: ${name}`);
  return value.trim();
}

export function assertTaskProcessStatus(status, identity) {
  for (const [field, expected] of [["Uid", identity.uid], ["Gid", identity.gid]]) {
    assert.deepEqual(statusField(status, field).split(/\s+/u).map(Number),
      [expected, expected, expected, expected], `unexpected task ${field}`);
  }
  for (const field of capabilityFields) {
    assert.match(statusField(status, field), /^0{16}$/u, `task retained ${field}`);
  }
  assert.equal(statusField(status, "NoNewPrivs"), "1", "task must not gain privileges on exec");
}

export async function assertWorkerIsolation(runtimeRoot) {
  const load = (relative) => import(pathToFileURL(path.join(runtimeRoot, relative)).href);
  const { linksenseRuntimeIdentity } = await load("node_modules/@linksense/shared/dist/index.js");
  const { isolatedChildInvocation } = await load("dist/child-process-isolation.js");
  const { assertCodexRuntimeVersion } = await load("dist/codex/runtime-version.js");
  const identity = { uid: linksenseRuntimeIdentity.taskUid, gid: linksenseRuntimeIdentity.sharedGid };
  assert.equal(process.getuid(), linksenseRuntimeIdentity.apiUid, "smoke must start as the trusted supervisor");
  assert.equal(process.getgid(), identity.gid);
  const supervisorStatus = await readFile("/proc/self/status", "utf8");
  for (const field of capabilityFields) {
    // Linux CAP_SETPCAP is capability 8. It belongs only to the supervisor.
    assert.ok((BigInt(`0x${statusField(supervisorStatus, field)}`) & 0x100n) !== 0n,
      `supervisor needs SETPCAP in ${field} to clear task capabilities`);
  }
  const invocation = isolatedChildInvocation(process.execPath, ["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    import { readFile } from 'node:fs/promises';
    assert.throws(() => process.setuid(0), { code: 'EPERM' });
    assert.throws(() => process.setgid(0), { code: 'EPERM' });
    console.log(await readFile('/proc/self/status', 'utf8'));
  `], identity);
  const { stdout } = await execute(invocation.command, invocation.args, {
    encoding: "utf8", timeout: 10_000, maxBuffer: 16_384,
  });
  assertTaskProcessStatus(stdout, identity);
  await assertCodexRuntimeVersion({ command: "codex", processIdentity: identity });
  console.log(JSON.stringify({ taskUid: identity.uid, taskGid: identity.gid,
    capabilitiesCleared: true, privilegeEscalationDenied: true, codexVersionVerified: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await assertWorkerIsolation(path.resolve(process.argv[2] ?? process.cwd()));
}
