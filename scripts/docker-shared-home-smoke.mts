import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseRunnerConfig } from "../apps/runner/src/config.ts";
import { buildWorkerContainerSpec } from "../apps/runner/src/controller/docker-worker-provider.ts";
import { ownerStorageKey, ownerWorkerSecret } from "../apps/runner/src/controller/storage-key.ts";
import { DockerEngineClient } from "../apps/runner/src/docker/engine-client.ts";
import { managedProjectionProbeContents, managedProjectionProbeFileName } from "../packages/shared/src/index.ts";

// Uses the production container specification and freshly compiled code. Only
// loopback port publishing is added so Docker Desktop is reachable by the test.
const execute = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "linksense-docker-home-"));
const repository = path.resolve(import.meta.dirname, "..");
const id = randomUUID(), image = `linksense-home-test:${id}`, controlNetwork = `linksense-home-control-${id}`, egressNetwork = `linksense-home-egress-${id}`;
const containers: string[] = [], networks: string[] = [];
const docker = async (...args: string[]) => { const result = await execute("docker", args, { timeout: 60_000, maxBuffer: 4_000_000 }); return (result.stdout + (args[0] === "logs" ? result.stderr : "")).trim(); };
const socket = (await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}")).replace(/^unix:\/\//u, "");
assert(path.isAbsolute(socket), "A local Docker socket is required");
const engine = new DockerEngineClient(socket, "1.45");
const owner = randomUUID(), project = randomUUID(), taskA = randomUUID(), taskB = randomUUID(), service = randomUUID();
const secret = randomUUID() + randomUUID();
const users = path.join(root, "users");
let imageBuilt = false;
const config = parseRunnerConfig({
  LINKSENSE_USER_DATA_ROOT: users, LINKSENSE_RUNNER_SHARED_SECRET: secret,
  LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:1/internal", LINKSENSE_WORKER_IMAGE: image,
  LINKSENSE_WORKER_CONTROL_NETWORK: controlNetwork, LINKSENSE_WORKER_EGRESS_NETWORK: egressNetwork,
  LINKSENSE_WORKER_MEMORY_MB: "2048", LINKSENSE_WORKER_CPUS: "2",
});
const healthSchema = z.object({ user_processes: z.number(), running_turns: z.number(), turn_start_contract_version: z.string() });
async function start(scope?: string) {
  const environment = scope ? path.join(users, owner, "services", scope) : path.join(users, owner);
  for (const directory of ["home/projects", "control", "managed/agents"]) await mkdir(path.join(environment, directory), { recursive: true, mode: 0o777 });
  await writeFile(path.join(environment, "managed/agents", managedProjectionProbeFileName), managedProjectionProbeContents);
  await docker("run", "--rm", "--user", "0:1000", "--volume", `${environment}:/fixture`, "--entrypoint", "/bin/sh", image, "-c", `chown -R 1001:1000 /fixture/home; chmod 770 /fixture/home; chmod 2770 /fixture/home/projects; chown -R 1000:1000 /fixture/control /fixture/managed; chmod 700 /fixture/control; chmod 750 /fixture/managed/agents; chmod 640 /fixture/managed/agents/${managedProjectionProbeFileName}`);
  const name = `linksense-home-worker-${randomUUID()}`;
  const spec = buildWorkerContainerSpec(config, owner, ownerStorageKey(owner, secret, scope), name, {}, false, scope);
  const container = await engine.createContainer(name, { ...spec, HostConfig: { ...spec.HostConfig, ...{ PortBindings: { "4010/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] } } } });
  containers.push(container);
  await engine.startContainer(container);
  const port = Number((await docker("port", container, "4010/tcp")).split(":").at(-1));
  assert(port);
  const headers = { authorization: `Bearer ${ownerWorkerSecret(owner, secret, scope)}`, "x-linksense-owner-id": owner };
  const request = (route: string, method = "GET", workspace = "workspace") => fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...headers, "x-linksense-workspace": workspace }, signal: AbortSignal.timeout(10_000) });
  for (let attempt = 0; ; attempt++) {
    try { const response = await request("/health/state"); if (response.ok) { healthSchema.parse(await response.json()); break; } }
    catch { /* The supervised process may still be starting. */ }
    if (attempt === 100) throw new Error(`Worker did not become ready: ${await docker("logs", "--tail", "40", container)}`);
    await delay(200);
  }
  const exec = async (code: string) => docker("exec", "--user", "1001:1000", container, "node", "--input-type=module", "-e", code);
  return { container, request, exec, environment };
}
try {
  await cp(path.join(repository, "apps/runner/dist"), path.join(root, "runner"), { recursive: true });
  await cp(path.join(repository, "packages/shared/dist"), path.join(root, "shared"), { recursive: true });
  const base = process.env.LINKSENSE_TEST_WORKER_BASE_IMAGE ?? "linksense-runner-worker:local";
  assert(/^[\w./:-]+$/u.test(base));
  await writeFile(path.join(root, "Dockerfile"), `FROM ${base}\nUSER 0:1000\nCOPY --chown=1000:1000 runner/ /app/dist/\nCOPY shared/ /tmp/shared-dist/\nRUN cp -R /tmp/shared-dist/. "$(readlink -f /app/node_modules/@linksense/shared)/dist/" && rm -rf /tmp/shared-dist\n`);
  await docker("build", "--quiet", "--tag", image, root); imageBuilt = true;
  for (const network of [controlNetwork, egressNetwork]) { await docker("network", "create", network); networks.push(network); }
  await mkdir(users, { recursive: true });
  // Measure storage preparation independently of worker boot, then verify the
  // real Linux supervisor adopts exactly the same durable generation.
  const opening = JSON.parse(await docker("run", "--rm", "--user", "0:1000", "--network", controlNetwork,
    "--volume", `${socket}:/var/run/docker.sock`, "--volume", `${users}:${users}`, "--entrypoint", "node", image,
    "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import {randomUUID} from 'node:crypto';
      import {mkdir,writeFile,chown,chmod,lstat,readFile} from 'node:fs/promises';
      import pino from 'pino';
      import {managedProjectionProbeContents,managedProjectionProbeFileName} from '/app/node_modules/@linksense/shared/dist/index.js';
      import {WorkerManager} from '/app/dist/controller/worker-manager.js';
      import {DockerWorkerProvider} from '/app/dist/controller/docker-worker-provider.js';
      import {FetchWorkerTransport} from '/app/dist/controller/worker-http-client.js';
      import {DockerEngineClient} from '/app/dist/docker/engine-client.js';
      const config=JSON.parse(process.argv[1]), owner=process.argv[2], logger=pino({level:'silent'});
      const provider=new DockerWorkerProvider(config,new DockerEngineClient('/var/run/docker.sock','1.45'),logger);
      const manager=new WorkerManager(config,provider,new FetchWorkerTransport(),logger,{probeWorkerRuntime:async()=>undefined});
      const samples=[];
      await manager.initialize();
      try {
        for(let n=0;n<3;n++) {
          const scope=randomUUID(), task=randomUUID();
          const environment=config.LINKSENSE_USER_DATA_ROOT+'/'+owner+'/services/'+scope;
          const agents=environment+'/managed/agents';
          await mkdir(agents,{recursive:true}); await chown(agents,1000,1000); await chmod(agents,0o750);
          const probe=agents+'/'+managedProjectionProbeFileName;
          await writeFile(probe,managedProjectionProbeContents); await chown(probe,1000,1000); await chmod(probe,0o640);
          const route='/conversations/'+task+'/runtime';
          const start=performance.now();
          const prepared=await manager.request(owner,route,'PUT',Buffer.from('{}'),undefined,'workspace',scope);
          const storageMs=performance.now()-start;
          assert.equal(prepared.statusCode,200);
          assert.equal(await provider.hasWorkerForEnvironment(owner,scope),false);
          const generation=JSON.parse(prepared.body.toString()).runtimeGeneration;
          const control=environment+'/control/workspaces/'+task;
          for(const name of ['workspace.json','runtime-generation']) {
            const info=await lstat(control+'/'+name); assert.equal(info.uid,1000); assert.equal(info.mode&0o777,0o600);
          }
          await writeFile(environment+'/home/workspace/keep.txt','persistent');
          const bootStart=performance.now();
          assert.equal((await manager.request(owner,'/health/state','GET',undefined,undefined,'workspace',scope)).statusCode,200);
          const native=await manager.request(owner,route,'PUT',Buffer.from('{}'),undefined,'workspace',scope);
          const workerBootMs=performance.now()-bootStart;
          assert.equal(native.statusCode,200); assert.equal(JSON.parse(native.body.toString()).runtimeGeneration,generation);
          assert.equal(await readFile(environment+'/home/workspace/keep.txt','utf8'),'persistent');
          const warmStart=performance.now();
          const next=await manager.request(owner,'/conversations/'+randomUUID()+'/runtime','PUT',Buffer.from('{}'),undefined,'workspace',scope);
          const warmStorageMs=performance.now()-warmStart;
          assert.equal(next.statusCode,200); assert.notEqual(JSON.parse(next.body.toString()).runtimeGeneration,generation);
          samples.push({storageMs:Math.round(storageMs),workerBootMs:Math.round(workerBootMs),warmStorageMs:Math.round(warmStorageMs)});
          assert.equal((await manager.cleanupConversation(owner,task,scope,true)).statusCode,200);
          await assert.rejects(lstat(environment),{code:'ENOENT'});
        }
        console.log(JSON.stringify({samples,storageDoesNotStartWorker:true,generationAndFilesPreserved:true,linuxOwnershipVerified:true,environmentReclaimed:true}));
      } finally { await manager.shutdown(true); }
    `, JSON.stringify(config), owner));
  const first = await start();
  // Execute the Linux/root permission regression that is conditional on macOS.
  await docker("run", "--rm", "--user", "0:1000", "--entrypoint", "node", image, "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {mkdir,mkdtemp,chmod,chown,lstat,rm} from 'node:fs/promises';
    import {widenDirectoryForSharedGroup} from '/app/dist/workspace/filesystem.js';
    const root=await mkdtemp('/tmp/linksense-permission-');
    try { await chmod(root,0o711); const directory=root+'/owned'; await mkdir(directory,{mode:0o700});
      await chown(directory,1001,1001); const info=await lstat(directory);
      await widenDirectoryForSharedGroup(directory,info.mode,{uid:info.uid,gid:info.gid});
      assert.equal((await lstat(directory)).mode&0o777,0o770);
    } finally { await rm(root,{recursive:true,force:true}); }
  `);
  for (const task of [taskA, taskB]) assert.equal((await first.request(`/conversations/${task}/runtime`, "PUT", `projects/${project}`)).status, 200);
  await first.exec(`import{writeFile,mkdir}from'node:fs/promises';await mkdir('/home/linksense/.local/bin',{recursive:true});await writeFile('/home/linksense/.local/bin/persisted-tool','retained-tool');await writeFile('/home/linksense/.codex/persisted-state','retained-state');await writeFile('/home/linksense/projects/${project}/shared.txt','retained-project');`);
  assert.equal(await first.exec(`import{readFile}from'node:fs/promises';console.log(await readFile('/home/linksense/projects/${project}/shared.txt','utf8'));`), "retained-project");
  assert.equal((await first.request(`/conversations/${taskA}/runtime`, "DELETE", `projects/${project}`)).status, 200);
  assert.equal(await first.exec(`import{readFile}from'node:fs/promises';console.log(await readFile('/home/linksense/projects/${project}/shared.txt','utf8'));`), "retained-project");
  await docker("exec", "--detach", "--user", "1001:1000", first.container, "node", "-e", "require('node:fs').writeFileSync('/home/linksense/background.pid',String(process.pid)); require('node:http').createServer((q,s)=>s.end('ok')).listen(18991,'0.0.0.0')");
  for (let attempt = 0; ; attempt++) {
    const health = healthSchema.parse(await (await first.request("/health/state")).json());
    if (health.user_processes >= 1) break;
    assert(attempt < 30); await delay(100);
  }
  await first.exec("import{readFile}from'node:fs/promises';process.kill(Number(await readFile('/home/linksense/background.pid','utf8')),'SIGTERM');");
  await engine.stopContainer(first.container); await engine.removeContainer(first.container); containers.splice(containers.indexOf(first.container), 1);
  const restarted = await start();
  assert.equal((await restarted.request(`/conversations/${taskB}/runtime`, "PUT", `projects/${project}`)).status, 200);
  const persisted = await restarted.exec(`import{readFile}from'node:fs/promises';console.log(JSON.stringify(await Promise.all(['/home/linksense/.local/bin/persisted-tool','/home/linksense/.codex/persisted-state','/home/linksense/projects/${project}/shared.txt'].map(p=>readFile(p,'utf8')))));`);
  assert.deepEqual(JSON.parse(persisted), ["retained-tool", "retained-state", "retained-project"]);
  const hosted = await start(service);
  assert.equal((await hosted.request(`/conversations/${service}/runtime`, "PUT")).status, 200);
  assert.equal(await hosted.exec("import{existsSync}from'node:fs';console.log(existsSync('/home/linksense/.codex/persisted-state'));"), "false");
  const denied = await fetch(`http://127.0.0.1:${Number((await docker('port', hosted.container, '4010/tcp')).split(':').at(-1))}/health/state`, { headers: { authorization: `Bearer ${ownerWorkerSecret(owner, secret)}` }, signal: AbortSignal.timeout(5_000) });
  assert.equal(denied.status, 401);
  assert.equal(await readFile(path.join(users, owner, "home/.codex/persisted-state"), "utf8"), "retained-state");
  await hosted.exec("import{writeFile}from'node:fs/promises';await writeFile('/home/linksense/delete-with-service','temporary-service-data');");
  // Run the actual controller inside Linux: host macOS cannot chown to the
  // container identities during discovery and must not replace that boundary.
  const cleanup = JSON.parse(await docker("run", "--rm", "--user", "0:1000", "--network", controlNetwork,
    "--volume", `${socket}:/var/run/docker.sock`, "--volume", `${users}:${users}`, "--entrypoint", "node", image,
    "--input-type=module", "-e", `
      import pino from 'pino';
      import {WorkerManager} from '/app/dist/controller/worker-manager.js';
      import {DockerWorkerProvider} from '/app/dist/controller/docker-worker-provider.js';
      import {FetchWorkerTransport} from '/app/dist/controller/worker-http-client.js';
      import {DockerEngineClient} from '/app/dist/docker/engine-client.js';
      const config=JSON.parse(process.argv[1]), logger=pino({level:'silent'});
      const manager=new WorkerManager(config,new DockerWorkerProvider(config,new DockerEngineClient('/var/run/docker.sock','1.45'),logger),new FetchWorkerTransport(),logger,{probeWorkerRuntime:async()=>undefined});
      await manager.initialize();
      const response=await manager.cleanupConversation(process.argv[2],process.argv[3],process.argv[3],true);
      console.log(JSON.stringify({status:response.statusCode,...JSON.parse(response.body.toString())}));
    `, JSON.stringify(config), owner, service));
  assert.equal(cleanup.status, 200);
  assert.equal(cleanup.environment, "deleted");
  containers.splice(containers.indexOf(hosted.container), 1);
  await assert.rejects(lstat(hosted.environment), { code: "ENOENT" });
  assert.equal(await readFile(path.join(users, owner, "home/.codex/persisted-state"), "utf8"), "retained-state");
  assert.equal((await restarted.request("/health/state")).status, 200);
  process.stdout.write(JSON.stringify({ status: "passed", opening, sharedProject: true, deletionKeepsFiles: true, restartKeepsHomeAndCodex: true, backgroundProcessDetected: true, serviceHomeAndAuthenticationSeparate: true, serviceEnvironmentReclaimed: true, personalWorkerUnaffected: true, linuxPermissionRegression: true }) + "\n");
} finally {
  for (const container of containers.reverse()) await docker("rm", "--force", container);
  for (const network of networks.reverse()) await docker("network", "rm", network);
  if (imageBuilt) await docker("image", "rm", image);
  await rm(root, { recursive: true, force: true });
}
