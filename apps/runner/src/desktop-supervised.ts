import path from "node:path"
import pino from "pino"
import { z } from "zod"
import {
  desktopRuntimeInputSchema, desktopRuntimeOutputSchema, desktopExecutionMaxFrameBytes, desktopServerOriginSchema,
} from "@linksense/shared"

import { assertCodexRuntimeVersion } from "./codex/runtime-version.js"
import { DesktopWorkerProvider } from "./controller/desktop-worker-provider.js"
import { DesktopLink } from "./desktop/link.js"
import { DesktopTurns } from "./desktop/turns.js"
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
let callbacks: ReturnType<typeof desktopWorkerCallbacks> | undefined
let current: { link: DesktopLink; turns: DesktopTurns } | undefined
let heartbeat: NodeJS.Timeout | undefined
const fail = () => {
  // Go owns the OS process group, including grandchildren of a failed worker.
  process.stdin.destroy(new Error("desktop worker lost"))
}
try {
  const input = frames()
  const initial = await input.next()
  if (initial.done) throw new Error("desktop runtime startup frame missing")
  const config = startupSchema.parse(initial.value)
  const logger = pino(createLoggerOptions({ name: "desktop-runtime" }), process.stderr)
  let bridgeUrl: string | undefined
  if (config.server_origin) {
    callbacks = desktopWorkerCallbacks(config.control_token, () => current)
    bridgeUrl = new URL("/", await callbacks.listen({ host: "127.0.0.1", port: 0 })).href
  }
  const runtime = new DesktopWorkerProvider({
    dataRoot: config.data_root, runtimeRoot: config.runtime_root, controlToken: config.control_token,
    ...(bridgeUrl ? { bridgeUrl } : {}),
    ...(config.server_origin ? { serverOrigin: config.server_origin } : {}),
  }, logger, fail)
  provider = runtime
  await assertCodexRuntimeVersion({
    command: path.join(config.runtime_root, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
  })
  await runtime.initialize()
  await writeLine({ type: "ready", version: 1 })
  heartbeat = setInterval(() => {
    if (process.stdout.writableLength === 0) void writeLine({ type: "heartbeat", version: 1 }).catch(fail)
  }, 2_000)
  for await (const value of input) {
    const message = desktopRuntimeInputSchema.parse(value)
    const origin = config.server_origin
    if (message.type === "link.open") {
      if (current || !origin) throw new Error("desktop link is not available")
      const turns = new DesktopTurns(runtime, config.runtime_root, origin, fail, logger)
      current = {
        turns,
        link: new DesktopLink(message.link_id, message.owner_id, turns, frame =>
          writeLine(desktopRuntimeOutputSchema.parse(frame)), fail, message.tools_version !== undefined),
      }
    } else if (current?.link.id === message.link_id) {
      if (message.type === "link.close") {
        const state = current
        current = undefined
        await state.link.close()
      } else current.link.receive(message.frame)
    }
  }
} catch {
  process.exitCode = 1
} finally {
  clearInterval(heartbeat)
  await current?.link.close().catch(() => { process.exitCode = 1 })
  await provider?.shutdown().catch(() => { process.exitCode = 1 })
  await callbacks?.close().catch(() => { process.exitCode = 1 })
}
