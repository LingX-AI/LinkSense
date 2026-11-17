import path from "node:path"
import pino from "pino"
import { z } from "zod"

import { assertCodexRuntimeVersion } from "./codex/runtime-version.js"
import { DesktopWorkerProvider } from "./controller/desktop-worker-provider.js"
import { createLoggerOptions } from "./lib/logger.js"

const startupSchema = z.strictObject({
  data_root: z.string().max(32_768).refine(path.isAbsolute),
  runtime_root: z.string().max(32_768).refine(path.isAbsolute),
  control_token: z.string().regex(/^[a-f0-9]{64}$/u),
})

// The private supervisor pipe is held open for the life of the desktop app.
let provider: DesktopWorkerProvider | undefined
let startup = Buffer.alloc(0)
let heartbeat: NodeJS.Timeout | undefined
try {
  for await (const chunk of process.stdin) {
    if (provider || !Buffer.isBuffer(chunk) || startup.length + chunk.length > 128 * 1024) {
      throw new Error("invalid desktop runtime startup frame")
    }
    startup = Buffer.concat([startup, chunk])
    if (startup.at(-1) !== 10) continue
    const config = startupSchema.parse(JSON.parse(startup.toString("utf8")))
    startup.fill(0)
    provider = new DesktopWorkerProvider({
      dataRoot: config.data_root,
      runtimeRoot: config.runtime_root,
      controlToken: config.control_token,
    }, pino(createLoggerOptions({ name: "desktop-runtime" }), process.stderr), () => {
      // Go owns the OS process group/job, including grandchildren of a failed worker.
      process.stdin.destroy(new Error("desktop worker lost"))
    })
    await assertCodexRuntimeVersion({
      command: path.join(config.runtime_root, "bin", process.platform === "win32" ? "codex.exe" : "codex"),
    })
    await provider.initialize()
    await new Promise<void>((resolve, reject) => {
      process.stdout.write('{"type":"ready","version":1}\n', error => error ? reject(error) : resolve())
    })
    heartbeat = setInterval(() => {
      if (process.stdout.writableLength === 0) process.stdout.write('{"type":"heartbeat","version":1}\n')
    }, 2_000)
  }
  if (!provider) throw new Error("desktop runtime startup frame missing")
} catch {
  process.exitCode = 1
} finally {
  clearInterval(heartbeat)
  startup.fill(0)
  await provider?.shutdown().catch(() => { process.exitCode = 1 })
}
