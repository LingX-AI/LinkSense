// Real, cgroup-confined OOM regression. No project services, credentials, ports,
// or persistent volumes are used. Run after building a development image.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const docker = async (args) => (await execute("docker", args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
const directory = await mkdtemp(join(tmpdir(), "linksense-lifecycle-"));
const names = [];
const image = process.argv[2] ?? "linksense-api-dev:local";
const inspect = async (name) => JSON.parse(await docker(["inspect", "--format", '{{json .State}}', name]));
const restartCount = async (name) => Number(await docker(["inspect", "--format", '{{.RestartCount}}', name]));
const until = async (predicate, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  do {
    if (await predicate()) return;
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`);
};

try {
  const config = JSON.parse(await docker(["compose", "--env-file", ".env.example", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml", "config", "--format", "json"]));
  const source = join(directory, "index.ts");
  await writeFile(source, `import { createServer } from "node:http";
const buffers: Buffer[] = [];
createServer((request, response) => {
  response.end(String(process.pid));
  if (request.url === "/oom") {
    // Touch real native memory, so this is a kernel OOM, not a V8 exception.
    setInterval(() => buffers.push(Buffer.alloc(16 * 1024 * 1024, 1)), 10);
  }
}).listen(3000, "0.0.0.0");
`);

  for (const mode of ["watch-parent", "api", "runner"]) {
    const service = mode === "runner" ? "runner" : "api";
    const { command, working_dir } = config.services[service];
    const argv = mode === "watch-parent" ? ["pnpm", "--filter", "@linksense/api", "dev"] : command;
    const name = `linksense-lifecycle-${process.pid}-${mode}`;
    names.push(name);
    await docker(["create", "--name", name, "--init", "--restart", "unless-stopped",
      "--memory", "192m", "--memory-swap", "192m", "--pids-limit", "100",
      "--publish", "127.0.0.1::3000", "--workdir", working_dir,
      "--entrypoint", argv[0], image, ...argv.slice(1)]);
    await docker(["cp", source, `${name}:${working_dir}/src/index.ts`]);
    await docker(["start", name]);
    let origin;
    const healthy = async () => {
      try {
        // An ephemeral published port may be reassigned on a Docker restart.
        const ports = JSON.parse(await docker(["inspect", "--format", '{{json .NetworkSettings.Ports}}', name]));
        origin = `http://127.0.0.1:${ports["3000/tcp"][0].HostPort}`;
        const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
        await response.body?.cancel();
        return response.ok;
      } catch { return false; }
    };
    await until(healthy, `${mode} initial readiness`);
    // Docker's native restart policy becomes active after a successful startup.
    await delay(10_100);
    const before = await inspect(name);
    await fetch(`${origin}/oom`, { signal: AbortSignal.timeout(2_000) });
    if (mode === "watch-parent") {
      await until(async () => (await inspect(name)).OOMKilled, "watch child OOM");
      assert.equal((await inspect(name)).Running, true);
      assert.equal(await restartCount(name), 0);
      assert.equal(await healthy(), false);
      console.log("reproduced: OOM kills the tsx child while its container stays running and HTTP stays unavailable");
    } else {
      await until(async () => (await restartCount(name)) > 0, `${mode} restarts after OOM`);
      await until(healthy, `${mode} HTTP recovers after OOM`);
      assert.notEqual((await inspect(name)).StartedAt, before.StartedAt);
      const events = await docker(["events", "--since", before.StartedAt, "--until", new Date().toISOString(),
        "--filter", `container=${name}`, "--filter", "event=oom", "--format", '{{json .}}']);
      assert.ok(events.includes('"Action":"oom"'), `${mode} must have a real Docker OOM event`);
      const restarts = await restartCount(name);
      const pid = Number(await (await fetch(origin)).text());
      // Kill the actual application, not `docker kill` (manual Docker stops
      // deliberately disable restart policies).
      await docker(["exec", name, "sh", "-c", `kill -KILL ${pid}`]);
      await until(async () => (await restartCount(name)) > restarts, `${mode} restarts after SIGKILL`);
      await until(healthy, `${mode} HTTP recovers after SIGKILL`);
      console.log(`${mode}: real OOM and application SIGKILL both restart the container and recover HTTP`);
    }
    await docker(["rm", "-f", name]);
  }
} finally {
  await Promise.allSettled(names.map((name) => docker(["rm", "-f", name])));
  await rm(directory, { recursive: true, force: true });
}
