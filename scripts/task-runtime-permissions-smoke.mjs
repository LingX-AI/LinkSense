// Run in the Worker image as the production 1000:1000 supervisor with its
// normal capabilities. Only synthetic files under a fresh /tmp directory.
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, mkdtemp, writeFile, readFile, lstat, symlink, rm, chown } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const api = process.env.PROBE_API_DIST ?? "/app/probe-api"
const runner = process.env.PROBE_RUNNER_DIST ?? "/app/probe-runner"
const { UserHomeCapabilityMaterializer } = await import(pathToFileURL(path.join(api, "modules/capabilities/user-home-materializer.js")))
const { migrateTaskCodexHomes } = await import(pathToFileURL(path.join(api, "operations/task-home-migration.js")))
const { WorkspaceManager } = await import(pathToFileURL(path.join(runner, "workspace/workspace-manager.js")))
const { CapabilityRuntimeManager } = await import(pathToFileURL(path.join(runner, "workspace/capability-runtime.js")))
const { NativePluginManager } = await import(pathToFileURL(path.join(runner, "codex/native-plugin-manager.js")))
const { CodexJsonRpcClient } = await import(pathToFileURL(path.join(runner, "codex/json-rpc-client.js")))
const { isolatedChildInvocation } = await import(pathToFileURL(path.join(runner, "child-process-isolation.js")))
const { default: pino } = await import("/app/node_modules/pino/pino.js")
const exec = promisify(execFile)
const identity = { uid: 1001, gid: 1000 }
const ownerId = "01900000-0000-7000-8000-000000000201"
const taskA = "01900000-0000-7000-8000-000000000202"
const taskB = "01900000-0000-7000-8000-000000000203"
assert.equal(process.getuid(), 1000)
assert.equal(process.getgid(), 1000)
const root = await mkdtemp("/tmp/linksense-task-permissions-")
// Task processes must be able to traverse the synthetic test root.
const { chmod } = await import("node:fs/promises")
await chmod(root, 0o770)
const clients = []
const checks = []
function checked(name) { checks.push(name); process.stdout.write(`${JSON.stringify({ check: name, passed: true })}\n`) }
async function taskNode(code, ...args) {
  const invocation = isolatedChildInvocation(process.execPath, ["-e", code, ...args], identity)
  return exec(invocation.command, invocation.args, { timeout: 20_000, env: {} })
}
const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: path.join(root, "users") })
const workspace = new WorkspaceManager(path.join(root, "users"), undefined, { directoryCleanupIdentity: identity, managedCodexFileIdentity: identity })
const runtime = new CapabilityRuntimeManager({ apiIdentity: { uid: 1000, gid: 1000 }, taskIdentity: identity })
const native = new NativePluginManager()
const logger = pino({ enabled: false })
try {
  const source = path.join(root, "source")
  await mkdir(path.join(source, ".codex-plugin"), { recursive: true })
  await mkdir(path.join(source, "skills", "probe"), { recursive: true })
  await writeFile(path.join(source, ".codex-plugin/plugin.json"), JSON.stringify({ name: "isolation-probe", version: "1.0.0", skills: "./skills" }))
  const skillFile = path.join(source, "skills/probe/SKILL.md")
  await writeFile(skillFile, "---\nname: probe\ndescription: Synthetic isolation probe\n---\nVERSION_ONE\n")
  const capability = { id: "01900000-0000-7000-8000-000000000204", name: "isolation-probe", type: "plugin", revision: "one", sourcePath: source }
  await materializer.ensureOwner(ownerId)
  const owner = await workspace.ensureOwner(ownerId)
  const migratedId = "01900000-0000-7000-8000-000000000205"
  const rollout = "rollout-permission-migration.jsonl"
  const oldSessions = path.join(owner.home, ".codex/sessions/2026/09/08")
  await mkdir(oldSessions, { recursive: true })
  await writeFile(path.join(oldSessions, rollout), `${JSON.stringify({ type: "session_meta", payload: { id: "permission-migration", cwd: `/home/linksense/workspaces/${migratedId}` } })}\n`)
  await migrateTaskCodexHomes({ userDataRoot: path.join(root, "users"), tasks: [{ ownerId, conversationId: migratedId, nativeThreadIds: ["permission-migration"] }], dryRun: false, ownership: identity, controlOwnership: { uid: 1000, gid: 1000 } })
  workspace.bindOwner(migratedId, ownerId)
  const migrated = await workspace.ensureConversation(migratedId, "permissions-smoke")
  const migratedFile = path.join(migrated.codexHome, "sessions/2026/09/08", rollout)
  await chown(migratedFile, 0, 0)
  await migrateTaskCodexHomes({ userDataRoot: path.join(root, "users"), tasks: [{ ownerId, conversationId: migratedId, nativeThreadIds: ["permission-migration"] }], dryRun: false, ownership: identity, controlOwnership: { uid: 1000, gid: 1000 } })
  const migratedInfo = await lstat(migratedFile)
  assert.equal(migratedInfo.uid, 1001); assert.equal(migratedInfo.gid, 1000); assert.equal(migratedInfo.mode & 0o777, 0o600)
  await taskNode("require('node:fs').appendFileSync(process.argv[1], '\\n')", migratedFile)
  checked("migrated history remains readable and writable by the real task UID")
  await symlink(path.join(root, "users", ownerId, "managed/agents"), path.join(owner.home, ".agents"))
  for (const id of [taskA, taskB]) workspace.bindOwner(id, ownerId)
  const a = await materializer.reconcile({ ownerId, conversationId: taskA, capabilities: [capability] })
  const pathsA = await workspace.ensureConversation(taskA, "permissions-smoke")
  const pathsB = await workspace.ensureConversation(taskB, "permissions-smoke")
  assert.notEqual(pathsA.home, pathsB.home)
  assert(!pathsA.home.startsWith(`${pathsA.workspace}/`))
  for (const directory of [pathsA.home, pathsA.codexHome, pathsB.home, pathsB.codexHome]) {
    const info = await lstat(directory)
    assert.equal(info.uid, 1001); assert.equal(info.gid, 1000); assert.equal(info.mode & 0o777, 0o770)
  }
  checked("task homes have production UID/GID and stay outside downloadable workspaces")
  await taskNode("import(process.argv[1]).then(({browserCliMain}) => browserCliMain(['__cleanup'], {HOME:process.argv[2], CODEX_HOME:process.argv[3]}, process.argv[4], {policy:{sessionRoot:process.argv[5],sessionLimit:2}})).then(code=>{process.exitCode=code})", path.join(runner, "browser/cli-wrapper.js"), pathsA.home, pathsA.codexHome, pathsA.workspace, path.join(root, "browser-sessions"))
  checked("browser cleanup resolves the isolated task HOME as the real task UID")
  await taskNode("require('node:fs').writeFileSync(process.argv[1], 'task-write')", path.join(pathsA.codexHome, "task-write"))
  await assert.rejects(taskNode("require('node:fs').writeFileSync(process.argv[1], 'tampered')", path.join(pathsA.home, ".agents/plugins/marketplace.json")), /EACCES|EPERM|EROFS/)
  await assert.rejects(taskNode("require('node:fs').writeFileSync(process.argv[1], 'tampered')", a.generationPath), /EACCES|EPERM/)
  checked("task can write native state but cannot write API capabilities or control markers")
  const held = await runtime.acquireLease({ controlRoot: pathsA.control, expectedGeneration: a.generation })
  const preparedA = await runtime.resolvePublished({ userHome: pathsA.home, controlRoot: pathsA.control, expectedGeneration: a.generation, capabilities: [capability], lockHeld: true })
  async function install(paths, publication, prepared) {
    await native.reconcileBeforeStart({ command: "codex", userHome: paths.home, codexHome: paths.codexHome, workspace: paths.workspace, capabilityControl: prepared.capabilityControl, expectedGeneration: publication.generation, pluginContentDigest: prepared.pluginContentDigest, pluginNames: [capability.name], lockHeld: true, processIdentity: identity })
    const client = new CodexJsonRpcClient({ command: "codex", userHome: paths.home, codexHome: paths.codexHome, logger, processIdentity: identity, configOverrides: ["features.plugins=true", "features.remote_plugin=false", "features.plugin_sharing=false", "features.memories=false", "features.apps=false", "features.hooks=false", "check_for_update_on_startup=false"] })
    clients.push(client); await client.initialize()
    return native.verifyAfterStart({ client, userHome: paths.home, codexHome: paths.codexHome, workspace: paths.workspace, pluginNames: [capability.name] })
  }
  const nativeA = await install(pathsA, a, preparedA)
  await writeFile(skillFile, "---\nname: probe\ndescription: Synthetic isolation probe\n---\nVERSION_TWO\n")
  const b = await materializer.reconcile({ ownerId, conversationId: taskB, capabilities: [{ ...capability, revision: "two" }] })
  const leaseB = await runtime.acquireLease({ controlRoot: pathsB.control, expectedGeneration: b.generation })
  try {
    const preparedB = await runtime.resolvePublished({ userHome: pathsB.home, controlRoot: pathsB.control, expectedGeneration: b.generation, capabilities: [{ ...capability, revision: "two" }], lockHeld: true })
    const nativeB = await install(pathsB, b, preparedB)
    assert.notEqual(nativeA[0].cacheRoot, nativeB[0].cacheRoot)
    assert.match(await readFile(path.join(nativeA[0].cacheRoot, "skills/probe/SKILL.md"), "utf8"), /VERSION_ONE/)
    assert.match(await readFile(path.join(nativeB[0].cacheRoot, "skills/probe/SKILL.md"), "utf8"), /VERSION_TWO/)
    checked("real Codex native plugin updates keep another task's leased version and cache intact")
  } finally { await leaseB.release() }
  await held.release()
  for (const client of clients.splice(0)) await client.close()
  await taskNode("const fs=require('node:fs');fs.mkdirSync(process.argv[1],{recursive:true,mode:0o700});fs.chmodSync(process.argv[1],0o700);fs.writeFileSync(process.argv[1]+'/private','state',{mode:0o600})", path.join(pathsA.codexHome, "private-directory"))
  await workspace.removeConversation(taskA)
  await materializer.removeConversation(ownerId, taskA)
  await assert.rejects(lstat(pathsA.home), { code: "ENOENT" })
  await assert.rejects(lstat(a.managedAgentsRoot), { code: "ENOENT" })
  assert((await lstat(pathsB.codexHome)).isDirectory())
  checked("supervisor removes task-owned 0700/0600 state without deleting another task")
  process.stdout.write(`${JSON.stringify({ passed: checks.length })}\n`)
} finally {
  for (const client of clients) await client.close()
  await rm(root, { recursive: true, force: true })
}
