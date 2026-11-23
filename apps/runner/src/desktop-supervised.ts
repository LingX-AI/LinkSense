import path from "node:path"
import pino from "pino"
import { z } from "zod"
import { desktopExecutionMaxFrameBytes, desktopServerOriginSchema } from "@linksense/shared"

import { assertCodexRuntimeVersion } from "./codex/runtime-version.js"
import { DesktopWorkerProvider } from "./controller/desktop-worker-provider.js"
import { shouldReclaimOwnedGroup, launcherOwnerEnv, parseLauncherOwnerPid } from "./desktop/owned-group.js"
import { DesktopSupervisor } from "./desktop/supervisor.js"
import { desktopWorkerCallbacks } from "./desktop/worker-callbacks.js"
import { createLoggerOptions } from "./lib/logger.js"

const startupSchema = z.strictObject({
  data_root: z.string().max(32_768).refine(path.isAbsolute),
  runtime_root: z.string().max(32_768).refine(path.isAbsolute),
  control_token: z.string().regex(/^[a-f0-9]{64}$/u),
  server_origin: desktopServerOriginSchema.optional(),
})

const pipeLimit = desktopExecutionMaxFrameBytes + 1024

async function* frames(): AsyncGenerator<unknown> {
  let pending: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    if (!Buffer.isBuffer(chunk)) throw new Error("invalid desktop pipe")
    for (let start = 0; start < chunk.length;) {
      const newline = chunk.indexOf(10, start)
      const end = newline === -1 ? chunk.length : newline
      size += end - start
      if (size > pipeLimit) throw new Error("desktop pipe frame exceeds limit")
      pending.push(chunk.subarray(start, end))
      if (newline === -1) break
      const line = Buffer.concat(pending, size)
      pending = []
      size = 0
      let value: unknown
      try { value = JSON.parse(line.toString("utf8")) } finally { line.fill(0) }
      yield value
      start = end + 1
    }
  }
  if (size !== 0) throw new Error("incomplete desktop pipe frame")
}

function writeLine(value: unknown): Promise<void> {
  const frame = `${JSON.stringify(value)}\n`
  if (Buffer.byteLength(frame) > pipeLimit) return Promise.reject(new Error("desktop pipe frame exceeds limit"))
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(frame, error => error ? reject(error) : resolve())
  })
}

// The private supervisor pipe is held open for the life of the desktop app.
let provider: DesktopWorkerProvider | undefined
let supervisor: DesktopSupervisor | undefined
let callbacks: ReturnType<typeof desktopWorkerCallbacks> | undefined
let heartbeat: NodeJS.Timeout | undefined

// Go starts this process with Setpgid, so process.pid is the ID of the only
// process group this supervisor may reclaim. Go also supplies its exact PID in
// a private child-only env marker (it strips inherited values and appends its
// own; the worker env allowlist never forwards it). The kernel group check
// proves leadership, the closed pipe proves the owner channel was lost, and
// ppid 1 proves reparenting to launchd. process.ppid itself is not the owner
// identity: the Go owner may already be gone before this line runs.
const launcherOwnerPid = parseLauncherOwnerPid(process.env[launcherOwnerEnv])
delete process.env[launcherOwnerEnv]
const groupId = process.pid
const ownsGroup = (() => {
  try { process.kill(-groupId, 0); return true } catch { return false }
})()
let pipeLost = process.stdin.readableEnded || process.stdin.destroyed
let frameAccepted = false
let failSafe: NodeJS.Timeout | undefined

// Codex exec sessions and sibling runtimes have their own process groups; this
// target can only contain this supervisor's own descendants. An ordinary Go
// close keeps the owner alive (ppid != 1), so the group is left to Go.
const reclaimOwnedGroup = () => {
  if (!shouldReclaimOwnedGroup({
    platform: process.platform, frameAccepted,
    pipeLost: pipeLost || process.stdin.readableEnded || process.stdin.destroyed,
    launcherOwnerPid, currentPpid: process.ppid, groupId, groupExists: ownsGroup,
  })) return
  try { process.kill(-groupId, "SIGKILL") } catch { /* the group is already gone */ }
}

const armFailSafe = () => {
  if (failSafe) return
  failSafe = setTimeout(() => {
    reclaimOwnedGroup()
    if (process.ppid === 1) process.exitCode = 1
  }, 10_000)
  // Keep the bounded deadline alive only after the owner already departed, so
  // it runs even when the async iterator is suspended without other handles.
  // An ordinary parent-alive shutdown stays unreferenced and never kills.
  if (process.ppid === 1) failSafe.ref()
  else failSafe.unref()
}

const markPipeLost = () => {
  pipeLost = true
  armFailSafe()
}

process.stdin.once("end", markPipeLost)
process.stdin.once("close", markPipeLost)
if (pipeLost) armFailSafe()

const fail = () => {
  // Go owns the OS process group, including grandchildren of a failed worker.
  process.stdin.destroy(new Error("desktop worker lost"))
}
// A write to a pipe the owner already closed surfaces twice: once in the
// write callback that rejects writeLine, and once as a stream error that has no
// listener and would otherwise kill this process before fail runs. Register the
// listener once, before the first write; fail then reaches the same stdin
// destroy and orderly shutdown path whether or not a write is pending.
process.stdout.on("error", fail)
try {
  const input = frames()
  const initial = await input.next()
  if (initial.done) throw new Error("desktop runtime startup frame missing")
  const config = startupSchema.parse(initial.value)
  // The startup frame's control token stays the worker control secret; the
  // launcher boundary is the Go-supplied owner PID env marker, not token shape.
  frameAccepted = true
  const logger = pino(createLoggerOptions({ name: "desktop-runtime" }), process.stderr)
  let bridgeUrl: string | undefined
  if (config.server_origin) {
    callbacks = desktopWorkerCallbacks(config.control_token, () => supervisor?.currentForCallbacks(), config.server_origin)
    bridgeUrl = new URL("/", await callbacks.listen({ host: "127.0.0.1", port: 0 })).href
  }
  provider = new DesktopWorkerProvider({
    dataRoot: config.data_root, runtimeRoot: config.runtime_root, controlToken: config.control_token,
    ...(bridgeUrl ? { bridgeUrl } : {}),
    ...(config.server_origin ? { serverOrigin: config.server_origin } : {}),
  }, logger, fail)
  await assertCodexRuntimeVersion({
    command: path.join(config.runtime_root, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
  })
  await provider.initialize()
  await writeLine({ type: "ready", version: 1 })
  heartbeat = setInterval(() => {
    if (process.stdout.writableLength === 0) void writeLine({ type: "heartbeat", version: 1 }).catch(fail)
  }, 2_000)
  supervisor = new DesktopSupervisor({
    provider, runtimeRoot: config.runtime_root, origin: config.server_origin, logger,
    write: writeLine, fail,
  })
  await supervisor.run(input)
} catch {
  process.exitCode = 1
} finally {
  clearInterval(heartbeat)
  if (!supervisor) await provider?.shutdown().catch(() => { process.exitCode = 1 })
  await callbacks?.close().catch(() => { process.exitCode = 1 })
  if (failSafe) clearTimeout(failSafe)
  reclaimOwnedGroup()
}
