import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const specificationProbe = `
  import { parseRunnerConfig } from './dist/config.js';
  import { buildWorkerContainerSpec } from './dist/controller/docker-worker-provider.js';
  const config = parseRunnerConfig({
    LINKSENSE_USER_DATA_ROOT: '/tmp/linksense-isolation-smoke/users',
    LINKSENSE_RUNNER_SHARED_SECRET: 'linksense-isolation-smoke-synthetic-secret-00000000',
    LINKSENSE_API_INTERNAL_URL: 'http://127.0.0.1:1/internal',
  });
  const { User, HostConfig } = buildWorkerContainerSpec(config,
    '01900000-0000-7000-8000-000000000201', 'isolation-smoke');
  console.log(JSON.stringify({ User, HostConfig }));
`;

export function workerIsolationArguments(image, imageConfig, specification) {
  assert.equal(imageConfig.User, specification.User);
  assert.equal(specification.User, "0:1000");
  assert.ok(Array.isArray(imageConfig.Cmd) && imageConfig.Cmd.every(value => typeof value === "string"));
  assert.equal(imageConfig.Cmd[0], "/usr/bin/setpriv");
  assert.deepEqual(imageConfig.Cmd.slice(-2), ["node", "dist/index.js"]);
  assert.ok(!imageConfig.Entrypoint?.length, "unexpected Worker image entrypoint");
  const host = specification.HostConfig;
  assert.equal(host.ReadonlyRootfs, true);
  assert.equal(host.Init, true);
  assert.notEqual(host.Privileged, true);
  assert.deepEqual(host.CapDrop, ["ALL"]);
  assert.ok(host.CapAdd.includes("SETPCAP"), "Worker supervisor is missing SETPCAP");
  assert.deepEqual(host.SecurityOpt, ["no-new-privileges:true"]);
  // Reuse the application's real security contract and image CMD. Only replace
  // the final server entrypoint, omit user mounts and disable all networking.
  const args = ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--init", "--user", specification.User];
  for (const cap of host.CapDrop) args.push("--cap-drop", cap);
  for (const cap of host.CapAdd) args.push("--cap-add", cap);
  for (const option of host.SecurityOpt) args.push("--security-opt", option);
  for (const [target, options] of Object.entries(host.Tmpfs)) args.push("--tmpfs", `${target}:${options}`);
  args.push("--entrypoint", imageConfig.Cmd[0], image,
    ...imageConfig.Cmd.slice(1, -1), "/opt/linksense/worker-isolation-smoke.mjs", "/app");
  return args;
}

async function runDocker(args) {
  return execute("docker", args, { encoding: "utf8", timeout: 60_000, maxBuffer: 1_048_576 });
}

export async function assertWorkerImageIsolation(image, run = runDocker) {
  assert.ok(typeof image === "string" && image.length > 0 && !image.startsWith("-"), "a local Worker image is required");
  const { stdout: config } = await run(["image", "inspect", "--format", "{{json .Config}}", image]);
  const { stdout: specification } = await run(["run", "--rm", "--pull", "never", "--network", "none",
    "--entrypoint", "node", image, "--input-type=module", "--eval", specificationProbe]);
  const result = await run(workerIsolationArguments(image, JSON.parse(config), JSON.parse(specification)));
  const proof = JSON.parse(result.stdout);
  assert.equal(proof.capabilitiesCleared, true);
  assert.equal(proof.privilegeEscalationDenied, true);
  assert.equal(proof.codexVersionVerified, true);
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await assertWorkerImageIsolation(process.argv[2])));
}
