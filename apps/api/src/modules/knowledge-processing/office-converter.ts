import { execFile, spawn, type ChildProcess } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pipeline } from "node:stream/promises"

import type { DoclingInputFile } from "./docling.js"
import { KnowledgeProcessingError } from "./errors.js"

const DEFAULT_CONVERSION_TIMEOUT_MS = 300_000
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 512 * 1024 * 1024
const DEFAULT_UNOSERVER_HOST = "127.0.0.1"
const DEFAULT_UNOSERVER_PORT = 2003
const DEFAULT_UNO_PORT = 2002

const officeConversionTargets = {
  doc: {
    extension: "docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xls: {
    extension: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  ppt: {
    extension: "pptx",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  vsdx: {
    extension: "pdf",
    contentType: "application/pdf",
  },
} as const

export type OfficeConvertibleFormat = keyof typeof officeConversionTargets

export type PreparedDoclingInputFile = DoclingInputFile & {
  dispose(): Promise<void>
}

export interface OfficeConversionRuntime {
  start(): Promise<void>
  health(signal?: AbortSignal): Promise<void>
  convert(input: {
    sourcePath: string
    destinationPath: string
    targetExtension: string
    signal?: AbortSignal
  }): Promise<void>
  close(): Promise<void>
}

export interface KnowledgeOfficeDocumentConverter {
  start(): Promise<void>
  health(signal?: AbortSignal): Promise<void>
  prepare(input: {
    source: DoclingInputFile
    sourceFormat: string
    signal?: AbortSignal
  }): Promise<PreparedDoclingInputFile>
  close(): Promise<void>
}

/**
 * Keeps one LibreOffice listener local to the API container. Conversion calls
 * are serialized by Unoserver while BullMQ continues to own the durable queue.
 */
export class LocalUnoserverRuntime implements OfficeConversionRuntime {
  private child: ChildProcess | null = null
  private startPromise: Promise<void> | null = null
  private closing = false

  constructor(
    private readonly options: {
      serverCommand?: string
      pingCommand?: string
      convertCommand?: string
      host?: string
      port?: number
      unoPort?: number
      conversionTimeoutMs?: number
      startupTimeoutMs?: number
      stopAfter?: number
      temporaryRoot?: string
    } = {},
  ) {}

  async start(): Promise<void> {
    if (this.closing) {
      throw unavailableError()
    }
    if (this.startPromise) return this.startPromise
    if (this.child?.exitCode === null && !this.child.killed) return
    const inFlight = this.startProcess().finally(() => {
      if (this.startPromise === inFlight) this.startPromise = null
    })
    this.startPromise = inFlight
    return inFlight
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.start()
    try {
      await this.ping(5_000, signal)
    } catch (error) {
      await this.stopOwnedChild()
      if (signal?.aborted) throw cancelledError(error)
      throw unavailableError(error)
    }
  }

  async convert(input: {
    sourcePath: string
    destinationPath: string
    targetExtension: string
    signal?: AbortSignal
  }): Promise<void> {
    await this.start()
    const server = this.child
    try {
      await runCommand(
        this.options.convertCommand ?? "unoconvert",
        [
          "--host",
          this.options.host ?? DEFAULT_UNOSERVER_HOST,
          "--port",
          String(this.options.port ?? DEFAULT_UNOSERVER_PORT),
          "--host-location",
          "local",
          "--convert-to",
          input.targetExtension,
          input.sourcePath,
          input.destinationPath,
        ],
        {
          timeoutMs:
            (this.options.conversionTimeoutMs ??
              DEFAULT_CONVERSION_TIMEOUT_MS) + 5_000,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      )
    } catch (error) {
      if (input.signal?.aborted) throw cancelledError(error)
      if (server !== null && this.child !== server) {
        throw unavailableError(error)
      }
      try {
        await this.health(input.signal)
      } catch (healthError) {
        if (
          healthError instanceof KnowledgeProcessingError &&
          healthError.code === "KNOWLEDGE_PROCESSING_CANCELLED"
        ) {
          throw healthError
        }
        throw unavailableError(error)
      }
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_OFFICE_CONVERSION_FAILED",
        { cause: error },
      )
    }
  }

  async close(): Promise<void> {
    this.closing = true
    await this.startPromise?.catch(() => undefined)
    await this.stopOwnedChild()
  }

  private async stopOwnedChild(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return
    child.kill("SIGTERM")
    await waitForExit(child, 5_000)
    if (child.exitCode === null) {
      child.kill("SIGKILL")
      await waitForExit(child, 5_000)
    }
  }

  private async startProcess(): Promise<void> {
    try {
      await this.ping(1_000)
      return
    } catch {
      // No reusable listener exists in this container; start one below.
    }
    const temporaryRoot =
      this.options.temporaryRoot ?? join(tmpdir(), "linksense-unoserver")
    const cacheRoot = join(temporaryRoot, "cache")
    const configRoot = join(temporaryRoot, "config")
    await Promise.all([
      mkdir(cacheRoot, { recursive: true, mode: 0o700 }),
      mkdir(configRoot, { recursive: true, mode: 0o700 }),
    ])
    const child = spawn(
      this.options.serverCommand ?? "unoserver",
      [
        "--interface",
        this.options.host ?? DEFAULT_UNOSERVER_HOST,
        "--port",
        String(this.options.port ?? DEFAULT_UNOSERVER_PORT),
        "--uno-interface",
        this.options.host ?? DEFAULT_UNOSERVER_HOST,
        "--uno-port",
        String(this.options.unoPort ?? DEFAULT_UNO_PORT),
        "--conversion-timeout",
        String(
          Math.ceil(
            (this.options.conversionTimeoutMs ??
              DEFAULT_CONVERSION_TIMEOUT_MS) / 1_000,
          ),
        ),
        "--stop-after",
        String(this.options.stopAfter ?? 200),
        "--temp-dir",
        temporaryRoot,
        "--quiet",
      ],
      {
        env: {
          ...process.env,
          XDG_CACHE_HOME: cacheRoot,
          XDG_CONFIG_HOME: configRoot,
        },
        stdio: ["ignore", "inherit", "inherit"],
      },
    )
    this.child = child
    child.once("exit", () => {
      if (this.child === child) this.child = null
    })
    child.once("error", () => {
      if (this.child === child) this.child = null
    })

    const deadline =
      Date.now() +
      (this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS)
    while (Date.now() < deadline) {
      if (
        child.exitCode !== null ||
        child.killed ||
        this.child !== child ||
        this.closing
      ) {
        throw unavailableError()
      }
      try {
        await this.ping(1_000)
        return
      } catch {
        await delay(100)
      }
    }
    child.kill("SIGTERM")
    throw unavailableError()
  }

  private ping(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return runCommand(
      this.options.pingCommand ?? "unoping",
      [
        "--host",
        this.options.host ?? DEFAULT_UNOSERVER_HOST,
        "--port",
        String(this.options.port ?? DEFAULT_UNOSERVER_PORT),
        "--quiet",
      ],
      {
        timeoutMs,
        ...(signal ? { signal } : {}),
      },
    )
  }
}

export class UnoOfficeDocumentConverter
  implements KnowledgeOfficeDocumentConverter
{
  private conversionTail = Promise.resolve()

  constructor(
    private readonly runtime: OfficeConversionRuntime,
    private readonly options: {
      temporaryRoot?: string
      maximumOutputBytes?: number
    } = {},
  ) {}

  start(): Promise<void> {
    return this.runtime.start()
  }

  health(signal?: AbortSignal): Promise<void> {
    return this.runExclusive(() => this.runtime.health(signal), signal)
  }

  async prepare(input: {
    source: DoclingInputFile
    sourceFormat: string
    signal?: AbortSignal
  }): Promise<PreparedDoclingInputFile> {
    const target = officeConversionTarget(input.sourceFormat)
    if (!target) {
      return {
        ...input.source,
        dispose: async () => undefined,
      }
    }

    return this.runExclusive(async () => {
      assertNotAborted(input.signal)
      const directory = await mkdtemp(
        join(this.options.temporaryRoot ?? tmpdir(), "linksense-office-"),
      )
      const sourcePath = join(
        directory,
        `source.${input.sourceFormat.toLocaleLowerCase("en-US")}`,
      )
      const destinationPath = join(directory, `converted.${target.extension}`)
      try {
        await pipeline(
          await input.source.openStream(),
          createWriteStream(sourcePath, { flags: "wx", mode: 0o600 }),
          ...(input.signal ? [{ signal: input.signal }] : []),
        )
        await this.runtime.convert({
          sourcePath,
          destinationPath,
          targetExtension: target.extension,
          ...(input.signal ? { signal: input.signal } : {}),
        })
        const output = await stat(destinationPath)
        if (
          !output.isFile() ||
          output.size <= 0 ||
          output.size >
            (this.options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES)
        ) {
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_OFFICE_CONVERSION_FAILED",
          )
        }
        return {
          filename: convertedFilename(input.source.filename, target.extension),
          contentType: target.contentType,
          openStream: async () => createReadStream(destinationPath),
          dispose: () => rm(directory, { recursive: true, force: true }),
        }
      } catch (error) {
        await rm(directory, { recursive: true, force: true }).catch(
          () => undefined,
        )
        if (input.signal?.aborted) throw cancelledError(error)
        if (error instanceof KnowledgeProcessingError) throw error
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_OFFICE_CONVERSION_FAILED",
          { cause: error },
        )
      }
    }, input.signal)
  }

  async close(): Promise<void> {
    await this.conversionTail
    await this.runtime.close()
  }

  private async runExclusive<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.conversionTail
    let release = (): void => undefined
    this.conversionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await waitForTurn(previous, signal)
      return await operation()
    } finally {
      release()
    }
  }
}

export function officeConversionTarget(sourceFormat: string) {
  const normalized = sourceFormat.toLocaleLowerCase("en-US")
  return Object.hasOwn(officeConversionTargets, normalized)
    ? officeConversionTargets[normalized as OfficeConvertibleFormat]
    : null
}

function convertedFilename(filename: string, extension: string): string {
  const safeName = basename(filename)
  const separator = safeName.lastIndexOf(".")
  const stem = separator > 0 ? safeName.slice(0, separator) : safeName
  return `${stem}.${extension}`
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

function waitForTurn(previous: Promise<void>, signal?: AbortSignal) {
  if (!signal) return previous
  assertNotAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const handleAbort = () => reject(cancelledError(signal.reason))
    signal.addEventListener("abort", handleAbort, { once: true })
    previous.then(
      () => {
        signal.removeEventListener("abort", handleAbort)
        resolve()
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort)
        reject(error)
      },
    )
  })
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError(signal.reason)
}

function cancelledError(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED", {
    cause,
  })
}

function unavailableError(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_OFFICE_CONVERTER_UNAVAILABLE",
    { cause, retryable: true },
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref()
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs)
    timer.unref()
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
