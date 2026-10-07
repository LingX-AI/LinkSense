import assert from "node:assert/strict";
import { test } from "node:test";
import { assertTaskProcessStatus } from "../deploy/docker/worker-isolation-smoke.mjs";
import { assertWorkerImageIsolation, workerIsolationArguments } from "./worker-isolation-smoke.mjs";

const identity = { uid: 1001, gid: 1000 };
const capabilityFields = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"];
const status = ["Uid:\t1001\t1001\t1001\t1001", "Gid:\t1000\t1000\t1000\t1000",
  ...capabilityFields.map(field => `${field}:\t0000000000000000`), "NoNewPrivs:\t1"].join("\n");
const caps = ["SETUID", "KILL", "DAC_OVERRIDE", "FOWNER", "CHOWN", "SETPCAP"];
const imageConfig = { User: "0:1000", Cmd: ["/usr/bin/setpriv", "--reuid=1000", "--regid=1000", "--keep-groups",
  "--inh-caps=+setuid,+kill,+dac_override,+fowner,+chown,+setpcap",
  "--ambient-caps=+setuid,+kill,+dac_override,+fowner,+chown,+setpcap", "node", "dist/index.js"] };
const specification = { User: "0:1000", HostConfig: { ReadonlyRootfs: true, Init: true,
  CapDrop: ["ALL"], CapAdd: caps, SecurityOpt: ["no-new-privileges:true"],
  Tmpfs: { "/tmp": "rw,nosuid,nodev,mode=1777" }, Mounts: [{ Source: "/private/user-data" }], NetworkMode: "private-control" } };

test("the Linux task proof accepts only the expected identity with all five capability sets cleared", () => {
  assertTaskProcessStatus(status, identity);
});
for (const field of capabilityFields) {
  test(`the Linux task proof rejects a retained ${field}, including a silently uncleared bounding set`, () => {
    assert.throws(() => assertTaskProcessStatus(status.replace(`${field}:\t0000000000000000`, `${field}:\t00000000000000ab`), identity), new RegExp(`task retained ${field}`, "u"));
    assert.throws(() => assertTaskProcessStatus(status.replace(`${field}:\t0000000000000000`, ""), identity), /missing Linux process field/u);
  });
}
test("the Linux task proof rejects supervisor or root identities and a disabled no-new-privileges flag", () => {
  for (const replacement of ["Uid:\t1000\t1000\t1000\t1000", "Uid:\t1001\t1001\t0\t1001"]) {
    assert.throws(() => assertTaskProcessStatus(status.replace(/^Uid:.+$/mu, replacement), identity), /unexpected task Uid/u);
  }
  assert.throws(() => assertTaskProcessStatus(status.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"), identity), /must not gain privileges/u);
});
test("the Docker check retains the exact image supervisor command and production capability policy without user mounts or networking", () => {
  const args = workerIsolationArguments("worker:local", imageConfig, specification);
  assert.deepEqual(args.slice(-10), ["--entrypoint", ...imageConfig.Cmd.slice(0, 1), "worker:local",
    ...imageConfig.Cmd.slice(1, -1), "/opt/linksense/worker-isolation-smoke.mjs", "/app"].slice(-10));
  assert.equal(args[args.indexOf("--user") + 1], "0:1000");
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.deepEqual(args.filter((_, index) => args[index - 1] === "--cap-add"), caps);
  assert.ok(args.includes("--read-only") && args.includes("--init") && args.includes("no-new-privileges:true"));
  assert.ok(!args.includes("--volume") && !args.includes("--mount") && !args.includes("--privileged"));
});
test("the Docker check rejects a missing supervisor SETPCAP, changed image entrypoint or weakened privilege policy", () => {
  for (const host of [{ CapAdd: caps.filter(cap => cap !== "SETPCAP") }, { CapDrop: [] }, { Privileged: true }, { SecurityOpt: [] }]) {
    assert.throws(() => workerIsolationArguments("worker:local", imageConfig, { ...specification, HostConfig: { ...specification.HostConfig, ...host } }));
  }
  assert.throws(() => workerIsolationArguments("worker:local", { ...imageConfig, Entrypoint: ["unexpected"] }, specification));
});
test("the image check fails closed on Docker, task-isolation or Codex version errors", async () => {
  const proof = { capabilitiesCleared: true, privilegeEscalationDenied: true, codexVersionVerified: true };
  const calls = [];
  const run = async args => {
    calls.push(args);
    return { stdout: JSON.stringify(calls.length === 1 ? imageConfig : calls.length === 2 ? specification : proof) };
  };
  assert.deepEqual(await assertWorkerImageIsolation("worker:local", run), proof);
  assert.ok(calls[1].at(-1).includes("buildWorkerContainerSpec"));
  for (const property of Object.keys(proof)) {
    let invocation = 0;
    await assert.rejects(assertWorkerImageIsolation("worker:local", async () => ({ stdout: JSON.stringify(++invocation === 1 ? imageConfig : invocation === 2 ? specification : { ...proof, [property]: false }) })));
  }
  await assert.rejects(assertWorkerImageIsolation("worker:local", async () => { throw new Error("Docker failed"); }), /Docker failed/u);
});
