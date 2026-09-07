import { spawn } from "node:child_process"
import { constants } from "node:fs"
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  readManagedBrowserPolicy,
  type ManagedBrowserPolicy,
} from "./policy.js"
import { readBrowserUserAgent } from "./user-agent.js"

const conversationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const OPEN_WORKSPACE_HTML_COMMAND = "open-workspace-html"
export const MAX_WORKSPACE_HTML_BYTES = 256 * 1024
const MAX_WORKSPACE_HTML_DATA_URL_CHARACTERS = 1_000_000
const MANAGED_BROWSER_HELP = [
  "",
  "LinkSense managed command:",
  "  linksense-browser <playwright-cli-command> [args...]",
  "    Run a broad managed Playwright CLI command in the current task session.",
  "  linksense-browser open-workspace-html <workspace-relative-html-path>",
  "    Open a bounded .html file from the current task workspace.",
  "",
].join("\n")
const positionalOutputCommands = new Set(["state-save", "video-start"])
const managedBoundaryOptions = [
  "-s",
  "--config",
  "--persistent",
  "--profile",
  "--session",
] as const

export const DEFAULT_BROWSER_RUNTIME_ROOT =
  "/opt/linksense/runtime/browser"
export const DEFAULT_BROWSER_SESSION_ROOT =
  "/home/linksense/.local/share/linksense/browser-session-leases"
export const DEFAULT_BROWSER_SESSION_LIMIT = 2

export class BrowserSessionLimitError extends Error {
  constructor() {
    super("browser session limit reached")
    this.name = "BrowserSessionLimitError"
  }
}

export type BrowserCliRunner = (input: {
  cliEntry: string
  args: string[]
  environment: NodeJS.ProcessEnv
  cwd: string
  timeoutMs: number
}) => Promise<number>

export class BrowserSessionLeaseStore {
  private readonly lockDirectory: string

  constructor(
    private readonly root: string,
    private readonly limit: number,
    private readonly options: {
      now?: () => number
      sleep?: (milliseconds: number) => Promise<void>
    } = {},
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("browser session limit must be a positive integer")
    }
    this.lockDirectory = path.join(root, ".lease-lock")
  }

  async acquire(conversationId: string): Promise<void> {
    await this.withLock(async () => {
      const leasePath = this.leasePath(conversationId)
      if (await exists(leasePath)) {
        await this.touchLease(leasePath)
        return
      }
      const activeLeases = (await readdir(this.root, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".lease"))
      if (activeLeases.length >= this.limit) {
        throw new BrowserSessionLimitError()
      }
      const file = await open(leasePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      try {
        await file.writeFile(
          `${JSON.stringify({
            conversation_id: conversationId,
            acquired_at: new Date(this.now()).toISOString(),
          })}\n`,
        )
      } finally {
        await file.close()
      }
    })
  }

  async touch(conversationId: string): Promise<void> {
    await this.withLock(async () => {
      const leasePath = this.leasePath(conversationId)
      if (!(await exists(leasePath))) {
        throw new Error("browser session lease is unavailable")
      }
      await this.touchLease(leasePath)
    })
  }

  async release(conversationId: string): Promise<void> {
    await this.withLock(async () => {
      await rm(this.leasePath(conversationId), { force: true })
    })
  }

  async has(conversationId: string): Promise<boolean> {
    return exists(this.leasePath(conversationId))
  }

  private leasePath(conversationId: string): string {
    if (!conversationIdPattern.test(conversationId)) {
      throw new Error("invalid browser session conversation id")
    }
    return path.join(this.root, `${conversationId}.lease`)
  }

  private async touchLease(leasePath: string): Promise<void> {
    const now = new Date(this.now())
    await utimes(leasePath, now, now)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.root, { recursive: true, mode: 0o770 })
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await mkdir(this.lockDirectory, { mode: 0o700 })
        try {
          return await operation()
        } finally {
          await rm(this.lockDirectory, { recursive: true, force: true })
        }
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error
        const lock = await stat(this.lockDirectory).catch(() => null)
        if (lock && lock.mtimeMs < this.now() - 10_000) {
          await rm(this.lockDirectory, { recursive: true, force: true })
          continue
        }
        await (this.options.sleep ?? delay)(25)
      }
    }
    throw new Error("browser session lease lock timed out")
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

export function validateBrowserCliArguments(args: string[]): string {
  if (args.length === 0) return "--help"
  const command = args[0]!
  if (command === "--help" || command === "--version" || command === "__cleanup") {
    return command
  }
  if (command === OPEN_WORKSPACE_HTML_COMMAND) {
    const relativePath = args[1]
    if (
      args.length < 2 ||
      !relativePath ||
      relativePath.startsWith("-") ||
      path.isAbsolute(relativePath) ||
      relativePath.includes("\0") ||
      ![".htm", ".html"].includes(path.extname(relativePath).toLowerCase())
    ) {
      throw new Error(
        "browser workspace HTML command requires one relative .html path",
      )
    }
    return command
  }
  if (command.startsWith("-")) {
    throw new Error("browser command is not allowed")
  }
  return command
}

export function normalizeBrowserCliArguments(
  args: string[],
  outputRoot: string,
): string[] {
  const normalized = omitManagedBoundaryOptions(args)
  for (let index = 1; index < normalized.length; index += 1) {
    const argument = normalized[index]!
    if (argument === "--filename") {
      const value = normalized[index + 1]
      if (!value || value.startsWith("-")) {
        throw new Error("browser output filename is required")
      }
      normalized[index + 1] = resolveBrowserOutputFilename(value, outputRoot)
      index += 1
      continue
    }
    if (argument.startsWith("--filename=")) {
      normalized[index] = `--filename=${resolveBrowserOutputFilename(
        argument.slice("--filename=".length),
        outputRoot,
      )}`
    }
  }
  if (
    positionalOutputCommands.has(normalized[0] ?? "") &&
    normalized[1] &&
    !normalized[1].startsWith("-")
  ) {
    normalized[1] = resolveBrowserOutputFilename(normalized[1], outputRoot)
  }
  return normalized
}

function omitManagedBoundaryOptions(args: string[]): string[] {
  const normalized: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    const option = managedBoundaryOptions.find(
      (candidate) =>
        argument === candidate || argument.startsWith(`${candidate}=`),
    )
    if (!option) {
      normalized.push(argument)
      continue
    }
    if (
      argument === option &&
      args[index + 1] &&
      !args[index + 1]!.startsWith("-")
    ) {
      index += 1
    }
  }
  return normalized
}

export async function browserCliMain(
  args: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  dependencies: {
    runtimeRoot?: string
    runCli?: BrowserCliRunner
    leaseStore?: BrowserSessionLeaseStore
    policy?: ManagedBrowserPolicy
    writeOutput?: (value: string) => void
  } = {},
): Promise<number> {
  const command = validateBrowserCliArguments(args)
  const userHome = environment.HOME?.trim()
  const codexHome = environment.CODEX_HOME?.trim()
  if (
    !userHome ||
    !path.isAbsolute(userHome) ||
    !codexHome ||
    !path.isAbsolute(codexHome)
  ) {
    throw new Error("browser requires a user HOME and CODEX_HOME")
  }
  const canonicalHome = await realpath(userHome)
  const canonicalCodexHome = await realpath(codexHome)
  if (canonicalCodexHome !== path.join(canonicalHome, ".codex")) {
    throw new Error("browser CODEX_HOME is outside the user HOME")
  }
  const workspace = await resolveTaskWorkspace(cwd, canonicalHome)
  const conversationId = path.basename(workspace)
  const runtimeRoot =
    dependencies.runtimeRoot ?? DEFAULT_BROWSER_RUNTIME_ROOT
  const stateRoot = path.join(
    canonicalHome,
    ".local",
    "share",
    "linksense",
    "browser",
    conversationId,
  )
  const cacheRoot = path.join(stateRoot, "cache")
  // Playwright creates nested Unix sockets below TMPDIR. Keep this prefix
  // short enough for Linux's 108-byte sockaddr_un limit.
  const temporaryRoot = path.join("/tmp/lb", conversationId)
  const outputRoot = path.join(workspace, "temp", "browser")
  const effectiveArgs =
    command === OPEN_WORKSPACE_HTML_COMMAND
      ? [
          "open",
          await workspaceHtmlDataUrl(workspace, args[1]!),
          ...args.slice(2),
        ]
      : args
  const effectiveCommand = effectiveArgs[0]!
  const managedArgs = normalizeBrowserCliArguments(effectiveArgs, outputRoot)
  const activeMarker = path.join(stateRoot, "session-active")
  const configPath = path.join(stateRoot, "cli.config.json")
  const sessionName = `linksense-${conversationId}`
  const cliEntry = path.join(
    runtimeRoot,
    "node_modules",
    "@playwright",
    "cli",
    "playwright-cli.js",
  )
  const runCli = dependencies.runCli ?? defaultRunBrowserCli
  const policy =
    dependencies.policy ?? (await readBrowserPolicyOrDefault())
  const leases =
    dependencies.leaseStore ??
    new BrowserSessionLeaseStore(policy.sessionRoot, policy.sessionLimit)
  await Promise.all([
    mkdir(stateRoot, { recursive: true, mode: 0o700 }),
    mkdir(cacheRoot, { recursive: true, mode: 0o700 }),
    mkdir(temporaryRoot, { recursive: true, mode: 0o700 }),
    mkdir(outputRoot, { recursive: true, mode: 0o770 }),
  ])
  const browserEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    HOME: canonicalHome,
    CODEX_HOME: canonicalCodexHome,
    XDG_CACHE_HOME: cacheRoot,
    TMPDIR: temporaryRoot,
    PLAYWRIGHT_BROWSERS_PATH: "/opt/linksense/runtime/browser-browsers",
    PLAYWRIGHT_CLI_SESSION: sessionName,
  }

  if (command === "--help" || command === "--version") {
    const code = await runCli({
      cliEntry,
      args: command === "--help" ? ["--help"] : ["--version"],
      environment: browserEnvironment,
      cwd: workspace,
      timeoutMs: 30_000,
    })
    if (command === "--help" && code === 0) {
      const writeOutput =
        dependencies.writeOutput ?? ((value) => process.stdout.write(value))
      writeOutput(MANAGED_BROWSER_HELP)
    }
    return code
  }

  if (command === "__cleanup") {
    return cleanupBrowserSession({
      cliEntry,
      sessionName,
      environment: browserEnvironment,
      runCli,
      leases,
      conversationId,
      workspace,
      stateRoot,
      activeMarker,
      temporaryRoot,
    })
  }

  await writeBrowserConfig(configPath, {
    runtimeRoot,
    outputRoot,
    readOnly: environment.LINKSENSE_BROWSER_READ_ONLY === "1",
  })

  if (effectiveCommand === "open") {
    await leases.acquire(conversationId)
    const code = await runCli({
      cliEntry,
      args: [`-s=${sessionName}`, ...managedArgs, "--config", configPath],
      environment: browserEnvironment,
      cwd: workspace,
      timeoutMs: 120_000,
    })
    if (code === 0) {
      await writeFile(activeMarker, `${sessionName}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      return 0
    }
    await forceCloseBrowser(sessionName)
    await leases.release(conversationId)
    return code
  }

  if (effectiveCommand === "close") {
    return cleanupBrowserSession({
      cliEntry,
      sessionName,
      environment: browserEnvironment,
      runCli,
      leases,
      conversationId,
      workspace,
      stateRoot,
      activeMarker,
      temporaryRoot,
    })
  }

  if (!(await exists(activeMarker)) || !(await leases.has(conversationId))) {
    throw new Error("browser session is not open; run linksense-browser open first")
  }
  await leases.touch(conversationId)
  return runCli({
    cliEntry,
    args: [`-s=${sessionName}`, ...managedArgs],
    environment: browserEnvironment,
    cwd: workspace,
    timeoutMs: 120_000,
  })
}

async function workspaceHtmlDataUrl(
  workspace: string,
  relativePath: string,
): Promise<string> {
  const candidate = path.resolve(workspace, relativePath)
  if (!isPathWithin(workspace, candidate)) {
    throw new Error(
      "browser workspace HTML path is outside the current task workspace",
    )
  }
  const entry = await lstat(candidate).catch(() => null)
  if (!entry?.isFile() || entry.isSymbolicLink()) {
    throw new Error("browser workspace HTML file is unavailable")
  }
  const canonicalCandidate = await realpath(candidate)
  if (!isPathWithin(workspace, canonicalCandidate)) {
    throw new Error(
      "browser workspace HTML path is outside the current task workspace",
    )
  }
  const metadata = await stat(canonicalCandidate)
  if (metadata.size > MAX_WORKSPACE_HTML_BYTES) {
    throw new Error("browser workspace HTML file exceeds the managed size limit")
  }
  const source = await readFile(canonicalCandidate, "utf8")
  const target = `data:text/html,${encodeURIComponent(source)}`
  if (target.length > MAX_WORKSPACE_HTML_DATA_URL_CHARACTERS) {
    throw new Error("browser workspace HTML file exceeds the managed size limit")
  }
  return target
}

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate)
  return (
    relativePath.length > 0 &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

function resolveBrowserOutputFilename(
  value: string,
  outputRoot: string,
): string {
  if (
    value.length === 0 ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    throw new Error("browser output filename must be a plain filename")
  }
  return path.join(outputRoot, value)
}

async function cleanupBrowserSession(input: {
  cliEntry: string
  sessionName: string
  environment: NodeJS.ProcessEnv
  runCli: BrowserCliRunner
  leases: BrowserSessionLeaseStore
  conversationId: string
  workspace: string
  stateRoot: string
  activeMarker: string
  temporaryRoot: string
}): Promise<number> {
  let code = 0
  const [active, leased] = await Promise.all([
    exists(input.activeMarker),
    input.leases.has(input.conversationId),
  ])
  if (active) {
    code = await input.runCli({
      cliEntry: input.cliEntry,
      args: [`-s=${input.sessionName}`, "close"],
      environment: input.environment,
      cwd: input.workspace,
      timeoutMs: 10_000,
    })
    if (code !== 0) {
      await forceCloseBrowser(input.sessionName)
    }
  } else if (leased) {
    await forceCloseBrowser(input.sessionName)
  }
  await input.leases.release(input.conversationId)
  await Promise.all([
    rm(input.stateRoot, { recursive: true, force: true }),
    rm(input.temporaryRoot, { recursive: true, force: true }),
  ])
  return code
}

async function forceCloseBrowser(sessionName: string): Promise<void> {
  const processes = await readLinuxProcessTable()
  const daemonPids = processes
    .filter((entry) =>
      isManagedBrowserDaemonArguments(entry.arguments, sessionName),
    )
    .map((entry) => entry.pid)
  const targetPids = collectProcessTree(processes, daemonPids)
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of [...targetPids].reverse()) {
      if (pid <= 1 || pid === process.pid) continue
      try {
        process.kill(pid, signal)
      } catch (error) {
        if (!isNodeError(error) || error.code !== "ESRCH") throw error
      }
    }
    if (signal === "SIGTERM" && targetPids.length > 0) await delay(250)
  }
}

export function isManagedBrowserDaemonArguments(
  arguments_: string[],
  sessionName: string,
): boolean {
  return (
    arguments_.some((argument) => argument.endsWith("/cliDaemon.js")) &&
    arguments_.includes(sessionName)
  )
}

type LinuxProcessEntry = {
  pid: number
  parentPid: number
  arguments: string[]
}

async function readLinuxProcessTable(): Promise<LinuxProcessEntry[]> {
  const entries = await readdir("/proc", { withFileTypes: true }).catch(
    () => [],
  )
  const processes = await Promise.all(
    entries.flatMap((entry) => {
      if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) return []
      const pid = Number(entry.name)
      return [
        Promise.all([
          readFile(path.join("/proc", entry.name, "cmdline")).catch(() => null),
          readFile(path.join("/proc", entry.name, "stat"), "utf8").catch(
            () => null,
          ),
        ]).then(([commandLine, processStat]) => {
          if (!commandLine || !processStat) return null
          const commandEnd = processStat.lastIndexOf(")")
          const fields =
            commandEnd === -1
              ? []
              : processStat.slice(commandEnd + 2).trim().split(/\s+/u)
          const parentPid = Number(fields[1])
          if (!Number.isInteger(parentPid)) return null
          return {
            pid,
            parentPid,
            arguments: commandLine
              .toString("utf8")
              .split("\0")
              .filter(Boolean),
          }
        }),
      ]
    }),
  )
  return processes.filter(
    (entry): entry is LinuxProcessEntry => entry !== null,
  )
}

function collectProcessTree(
  processes: LinuxProcessEntry[],
  rootPids: number[],
): number[] {
  const selected = new Set(rootPids)
  let changed = true
  while (changed) {
    changed = false
    for (const processEntry of processes) {
      if (
        selected.has(processEntry.parentPid) &&
        !selected.has(processEntry.pid)
      ) {
        selected.add(processEntry.pid)
        changed = true
      }
    }
  }
  return [...selected]
}

async function writeBrowserConfig(
  destination: string,
  input: { runtimeRoot: string; outputRoot: string; readOnly: boolean },
): Promise<void> {
  const temporaryPath = `${destination}.${process.pid}.tmp`
  const config = {
    browser: {
      browserName: "chromium",
      isolated: true,
      launchOptions: {
        // Use the complete Chromium binary and its new headless mode instead
        // of the reduced headless-shell runtime.
        channel: "chromium",
        headless: true,
        // Chromium's setuid/user-namespace sandbox is incompatible with the
        // worker's no-new-privileges boundary. The browser instead runs as the
        // unprivileged task uid inside the per-user locked-down container.
        chromiumSandbox: false,
        ignoreDefaultArgs: ["--disable-dev-shm-usage"],
      },
      contextOptions: {
        userAgent: await readBrowserUserAgent(input.runtimeRoot),
        acceptDownloads: !input.readOnly,
        // Request routing cannot intercept traffic initiated by service
        // workers. Disable them for the Plan-only read-only browser broker so
        // its init-page route remains the complete request path.
        serviceWorkers: input.readOnly ? "block" : "allow",
      },
      initPage: [path.join(input.runtimeRoot, "init-page.ts")],
    },
    outputDir: input.outputRoot,
    outputMode: "stdout",
    allowUnrestrictedFileAccess: false,
    codegen: "none",
    timeouts: {
      action: 10_000,
      navigation: 60_000,
    },
  }
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await rm(destination, { force: true })
  await rename(temporaryPath, destination)
}

async function resolveTaskWorkspace(
  cwd: string,
  canonicalHome: string,
): Promise<string> {
  const workspaceRoot = await realpath(
    path.join(canonicalHome, "workspaces"),
  )
  let candidate = await realpath(cwd)
  while (true) {
    if (
      conversationIdPattern.test(path.basename(candidate)) &&
      path.dirname(candidate) === workspaceRoot &&
      (await hasTaskWorkspaceDirectories(candidate))
    ) {
      return candidate
    }
    const parent = path.dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  throw new Error("browser command must run inside the current task workspace")
}

async function hasTaskWorkspaceDirectories(candidate: string): Promise<boolean> {
  const entries = await Promise.all(
    ["artifacts", "attachments", "temp"].map(async (name) => {
      const info = await lstat(path.join(candidate, name)).catch(() => null)
      return info?.isDirectory() === true && !info.isSymbolicLink()
    }),
  )
  return entries.every(Boolean)
}

async function defaultRunBrowserCli(input: {
  cliEntry: string
  args: string[]
  environment: NodeJS.ProcessEnv
  cwd: string
  timeoutMs: number
}): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [input.cliEntry, ...input.args], {
      cwd: input.cwd,
      env: input.environment,
      stdio: "inherit",
    })
    const timeout = setTimeout(() => child.kill("SIGKILL"), input.timeoutMs)
    timeout.unref()
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timeout)
      resolve(code ?? (signal ? 128 : 1))
    })
  })
}

async function readBrowserPolicyOrDefault(): Promise<ManagedBrowserPolicy> {
  try {
    return await readManagedBrowserPolicy()
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
    return {
      sessionRoot: DEFAULT_BROWSER_SESSION_ROOT,
      sessionLimit: DEFAULT_BROWSER_SESSION_LIMIT,
    }
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

export function isBrowserCliMain(
  moduleUrl: string,
  executablePath: string | undefined,
): boolean {
  if (!executablePath) return false
  return fileURLToPath(moduleUrl) === path.resolve(executablePath)
}

if (isBrowserCliMain(import.meta.url, process.argv[1])) {
  browserCliMain().then(
    (code) => {
      process.exitCode = code
    },
    (error: unknown) => {
      const message =
        error instanceof BrowserSessionLimitError
          ? "The browser session limit for this user is reached. Close an existing browser task and retry."
          : error instanceof Error
            ? error.message
            : "browser command failed"
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    },
  )
}
