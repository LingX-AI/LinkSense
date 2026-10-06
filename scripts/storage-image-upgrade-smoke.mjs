import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

const [serverImage, clientImage] = process.argv.slice(2);
const immutable = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;
assert.ok(immutable.test(serverImage) && immutable.test(clientImage));
const oldImage = "ghcr.io/coollabsio/minio@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9";
const id = randomUUID();
const network = `linksense-storage-smoke-${id}`;
const volume = network;
const rootPassword = randomBytes(24).toString("hex");
const userPassword = randomBytes(24).toString("hex");
const directory = mkdtempSync(join(tmpdir(), "linksense-storage-upgrade-"));
const payload = "Existing object: 中文 / retained bytes / security upgrade\n";
writeFileSync(join(directory, "object.txt"), payload);
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
const containers = new Set();
let networkCreated = false;
let volumeCreated = false;
async function start(image, name) {
  const container = docker("run", "--detach", "--rm", "--name", name, "--label", "org.linksense.release-smoke=storage", "--network", network, "--publish", "127.0.0.1::9000", "--volume", `${volume}:/data`, "--env", "MINIO_ROOT_USER=smokeroot", "--env", `MINIO_ROOT_PASSWORD=${rootPassword}`, image, "server", "/data", "--console-address", ":9001");
  containers.add(container);
  const port = docker("port", container, "9000/tcp").split(":").at(-1);
  assert.match(port, /^\d+$/u);
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/minio/health/ready`, { signal: AbortSignal.timeout(2_000) })).ok) return container;
    } catch { /* The server is still starting. */ }
    await setTimeout(1_000);
  }
  throw new Error("Storage service did not become ready");
}
function client(name, username, password, ...args) {
  return docker("run", "--rm", "--network", network, "--volume", `${directory}:/fixture:ro`, "--env", `MC_HOST_smoke=http://${username}:${password}@${name}:9000`, "--entrypoint", "mcli", clientImage, ...args);
}
function stop(container) {
  assert.equal(docker("inspect", container, "--format", '{{index .Config.Labels "org.linksense.release-smoke"}}'), "storage");
  docker("rm", "--force", "--volumes", container);
  containers.delete(container);
}
try {
  docker("network", "create", "--label", "org.linksense.release-smoke=storage", network);
  networkCreated = true;
  docker("volume", "create", "--label", "org.linksense.release-smoke=storage", volume);
  volumeCreated = true;
  const oldName = `legacy-${id}`;
  const currentName = `current-${id}`;
  const old = await start(oldImage, oldName);
  client(oldName, "smokeroot", rootPassword, "mb", "smoke/retained");
  client(oldName, "smokeroot", rootPassword, "cp", "/fixture/object.txt", "smoke/retained/object.txt");
  client(oldName, "smokeroot", rootPassword, "admin", "user", "add", "smoke", "smokeuser", userPassword);
  client(oldName, "smokeroot", rootPassword, "admin", "policy", "attach", "smoke", "readwrite", "--user", "smokeuser");
  stop(old);
  await start(serverImage, currentName);
  assert.equal(client(currentName, "smokeuser", userPassword, "cat", "smoke/retained/object.txt") + "\n", payload);
  console.log("Storage upgrade preserves existing object bytes and user/policy access.");
} finally {
  for (const container of containers) stop(container);
  if (volumeCreated) {
    assert.equal(docker("volume", "inspect", volume, "--format", '{{index .Labels "org.linksense.release-smoke"}}'), "storage");
    docker("volume", "rm", volume);
  }
  if (networkCreated) docker("network", "rm", network);
  rmSync(directory, { recursive: true, force: true });
}
