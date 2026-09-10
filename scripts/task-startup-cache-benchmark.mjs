// Run in the Worker image as the production supervisor. /sources is a
// read-only capability publication; /bench is a dedicated disposable volume.
// No model turns or external plugin tools are invoked. See task-codex-home.md.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, chmod, readdir, lstat, symlink, rm, realpath } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { UserHomeCapabilityMaterializer } from "/app/probe-api/modules/capabilities/user-home-materializer.js";
import { WorkspaceManager } from "/app/probe-runner/workspace/workspace-manager.js";
import { CapabilityRuntimeManager } from "/app/probe-runner/workspace/capability-runtime.js";
import { NativePluginManager } from "/app/probe-runner/codex/native-plugin-manager.js";
import { CodexJsonRpcClient } from "/app/probe-runner/codex/json-rpc-client.js";
import { builtInSkillNames } from "/app/node_modules/@linksense/shared/dist/index.js";
import pino from "/app/node_modules/pino/pino.js";

assert.equal(process.getuid(), 1000);
assert.equal(process.getgid(), 1000);
const root = path.join("/bench", `startup-${randomUUID()}`);
await mkdir(root, { mode: 0o770 }); await chmod(root, 0o770);
const ownerId = randomUUID();
const identity = { uid: 1001, gid: 1000 };
const report = { capabilities: 0, files: 0, bytes: 0, stages: 0, full_verifications: 0, samples: [] };
const clients = [];
const workspace = new WorkspaceManager(path.join(root, "users"), undefined, { directoryCleanupIdentity: identity, managedCodexFileIdentity: identity });
const runtime = new CapabilityRuntimeManager({ onFullVerification: () => { report.full_verifications++; } });
const native = new NativePluginManager();
const logger = pino({ enabled: false });
async function count(target) {
  const info = await lstat(target);
  assert(!info.isSymbolicLink());
  if (info.isFile()) { report.files++; report.bytes += info.size; }
  else for (const entry of await readdir(target)) await count(path.join(target, entry));
}
async function measure(output, name, action) {
  const start = performance.now(); const result = await action();
  output[name] = Math.round((performance.now() - start) * 10) / 10; return result;
}
try {
  const capabilities = [];
  for (const [type, directory] of [["plugin", "plugin-sources"], ["skill", "skills"]]) {
    for (const name of (await readdir(path.join("/sources", directory))).sort()) {
      if (type === "skill" && builtInSkillNames.includes(name)) continue;
      const sourcePath = path.join("/sources", directory, name);
      await count(sourcePath);
      capabilities.push({ id: randomUUID(), name, type, revision: "benchmark", sourcePath });
    }
  }
  report.capabilities = capabilities.length;
  for (let i = 0; i < 4; i++) {
    const sample = { sample: i + 1 }; report.samples.push(sample);
    // New API instance each time: the cache must survive process restarts.
    const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: path.join(root, "users"), instrumentation: { onStage: () => { report.stages++; } } });
    const conversationId = randomUUID();
    const input = { ownerId, conversationId, capabilities };
    const publication = await measure(sample, "publication_ms", () => materializer.withPublicationStartFence(input, () => materializer.resolvePublishedRuntimeWithinPublicationStartFence(input)));
    const owner = await workspace.ensureOwner(ownerId);
    if (i === 0) await symlink(path.join(publication.ownerRoot, "managed", "agents"), path.join(owner.home, ".agents"));
    workspace.bindOwner(conversationId, ownerId);
    const paths = await measure(sample, "task_home_ms", () => workspace.ensureConversation(conversationId, "startup-cache-benchmark"));
    const lease = await runtime.acquireLease({ controlRoot: paths.control, expectedGeneration: publication.generation });
    try {
      const prepared = await measure(sample, "verification_ms", () => runtime.resolvePublished({ taskHome: paths.taskHome, controlRoot: paths.control, expectedGeneration: publication.generation, capabilities, lockHeld: true, reuseImmutableSnapshot: true }));
      const pluginNames = capabilities.filter((c) => c.type === "plugin").map((c) => c.name);
      await measure(sample, "native_install_ms", () => native.reconcileBeforeStart({ command: "codex", userHome: paths.home, codexHome: paths.codexHome, workspace: paths.workspace, capabilityControl: prepared.capabilityControl, expectedGeneration: publication.generation, pluginContentDigest: prepared.pluginContentDigest, pluginNames, lockHeld: true, processIdentity: identity }));
      const client = new CodexJsonRpcClient({ command: "codex", userHome: paths.home, codexHome: paths.codexHome, logger, processIdentity: identity, configOverrides: ["features.plugins=true", "features.remote_plugin=false", "features.plugin_sharing=false", "features.memories=false", "features.apps=false", "features.hooks=false", "check_for_update_on_startup=false"] });
      clients.push(client);
      await measure(sample, "initialize_ms", () => client.initialize());
      await measure(sample, "native_verify_ms", () => native.verifyAfterStart({ client, userHome: paths.home, codexHome: paths.codexHome, workspace: paths.workspace, pluginNames }));
      await measure(sample, "skills_list_ms", () => client.request("skills/list", { cwds: [paths.workspace], forceReload: false }));
      await client.close(); clients.pop();
    } finally { await lease.release(); }
    sample.snapshot = path.basename(await realpath(publication.managedAgentsRoot));
  }
  if (process.env.PROBE_LEGACY === "1") {
    assert.equal(report.stages, report.samples.length);
    assert.equal(new Set(report.samples.map((s) => s.snapshot)).size, report.samples.length);
  } else {
    assert.equal(report.stages, 1);
    assert.equal(report.full_verifications, 1);
    assert.equal(new Set(report.samples.map((s) => s.snapshot)).size, 1);
  }
  for (const sample of report.samples) delete sample.snapshot;
  console.log(JSON.stringify(report));
} finally {
  for (const client of clients) await client.close();
  await rm(root, { recursive: true, force: true });
}
