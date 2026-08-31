import { execFile } from "node:child_process"
import { constants } from "node:fs"
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import {
  DEFAULT_NODE_PACKAGE_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
} from "./config.js"
import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "./child-process-isolation.js"

const execFileAsync = promisify(execFile)
export const MANAGED_PACKAGE_SOURCE_CONFIG_ROOT =
  "/tmp/linksense-package-sources"
export const MANAGED_BASH_ENVIRONMENT_FILE =
  "/opt/linksense/runtime/shell/linksense-bash-env.sh"
export const MANAGED_PYTHON_PACKAGE_INDEX_FILE = "python-index-url"
export const MANAGED_NODE_PACKAGE_REGISTRY_FILE = "node-registry-url"
const USER_NODE_PACKAGE_SCRIPT = String.raw`
const fs = require("node:fs")
const [operation, destination, contents] = process.argv.slice(1)
if (operation !== "create" && operation !== "write") {
  throw new Error("invalid linksense-user-node-package operation")
}
try {
  fs.writeFileSync(destination, contents, {
    encoding: "utf8",
    flag: operation === "create" ? "wx" : "w",
    mode: 0o660,
  })
  if (operation === "create") fs.chmodSync(destination, 0o660)
} catch (error) {
  if (operation !== "create" || error?.code !== "EEXIST") throw error
}
`

export type UserRuntimePaths = {
  root: string
  pythonEnvironment: string
  uvCache: string
  nodeProject: string
  nodeModules: string
  nodeBin: string
  pnpmHome: string
  pnpmStore: string
  cacheRoot: string
  corepackHome: string
  temporaryRoot: string
  browserSessionRoot: string
}

export type RuntimeCommand = (command: string, args: string[]) => Promise<void>

export async function prepareManagedPackageSourceConfig(
  pythonPackageIndexUrl: string,
  nodePackageRegistryUrl: string,
  root = MANAGED_PACKAGE_SOURCE_CONFIG_ROOT,
): Promise<void> {
  await chmod(root, 0o755).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  })
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { mode: 0o755 })
  const files = [
    [MANAGED_PYTHON_PACKAGE_INDEX_FILE, pythonPackageIndexUrl],
    [MANAGED_NODE_PACKAGE_REGISTRY_FILE, nodePackageRegistryUrl],
  ] as const
  await Promise.all(
    files.map(([name, value]) =>
      writeFile(path.join(root, name), `${value}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o400,
      }),
    ),
  )
  await Promise.all(
    files.map(([name]) => chmod(path.join(root, name), 0o444)),
  )
  await chmod(root, 0o555)
}

export function userRuntimePaths(root: string): UserRuntimePaths {
  const nodeProject = path.join(root, "node")
  const nodeModules = path.join(nodeProject, "node_modules")
  const cacheRoot = path.join(root, "cache")
  return {
    root,
    pythonEnvironment: path.join(root, "python", ".venv"),
    uvCache: path.join(cacheRoot, "uv"),
    nodeProject,
    nodeModules,
    nodeBin: path.join(nodeModules, ".bin"),
    pnpmHome: path.join(root, "pnpm-home"),
    pnpmStore: path.join(cacheRoot, "pnpm", "store"),
    cacheRoot,
    corepackHome: path.join(cacheRoot, "corepack"),
    temporaryRoot: path.join(root, "tmp"),
    browserSessionRoot: path.join(root, "browser-sessions"),
  }
}

export function userRuntimeDirectories(paths: UserRuntimePaths): string[] {
  return [
    paths.root,
    path.dirname(paths.pythonEnvironment),
    paths.cacheRoot,
    paths.uvCache,
    paths.nodeProject,
    paths.nodeModules,
    paths.nodeBin,
    paths.pnpmHome,
    path.dirname(paths.pnpmStore),
    paths.pnpmStore,
    paths.corepackHome,
    paths.temporaryRoot,
    paths.browserSessionRoot,
  ]
}

export async function initializeUserRuntime(
  root: string,
  options: {
    pythonCommand?: string
    basePythonSitePackages?: string
    baseNodeProject?: string
    nodeRegisterHook?: string
    bashEnvironmentFile?: string
    runtimeToolBin?: string
    pnpmVersion?: string
    pythonPackageIndexUrl?: string
    nodePackageRegistryUrl?: string
    processIdentity?: ProcessIdentity
    resetBrowserSessions?: boolean
    runCommand?: RuntimeCommand
  } = {},
): Promise<{ paths: UserRuntimePaths; environment: Record<string, string> }> {
  const paths = userRuntimePaths(root)
  if (options.bashEnvironmentFile) {
    await assertManagedBashEnvironmentFile(options.bashEnvironmentFile)
  }
  const configuredRuntimeToolBin =
    options.runtimeToolBin ?? process.env.LINKSENSE_RUNTIME_TOOL_BIN?.trim()
  const runtimeToolBin = configuredRuntimeToolBin || "/opt/linksense/bin"
  const runCommand =
    options.runCommand ??
    ((command, args) =>
      defaultRunCommand(command, args, options.processIdentity))
  if (options.resetBrowserSessions) {
    await resetUserBrowserSessions(
      paths.browserSessionRoot,
      options.processIdentity,
      runCommand,
    )
  }
  await Promise.all(userRuntimeDirectories(paths).map(ensureRuntimeDirectory))

  if (configuredRuntimeToolBin) {
    await assertRuntimeTools(configuredRuntimeToolBin)
  }

  if (!(await exists(path.join(paths.pythonEnvironment, "pyvenv.cfg")))) {
    await runCommand(
      options.pythonCommand ??
        basePythonCommand(options.basePythonSitePackages) ??
        "python3",
      [
        "-m",
        "venv",
        paths.pythonEnvironment,
      ],
    )
  }

  if (options.basePythonSitePackages) {
    const userPython = path.join(paths.pythonEnvironment, "bin", "python")
    await runCommand(userPython, [
      "-c",
      "import pathlib,site,sys; target=pathlib.Path(site.getsitepackages()[0])/'linksense-public-runtime.pth'; target.write_text(sys.argv[1]+'\\n', encoding='utf-8'); target.chmod(0o660)",
      options.basePythonSitePackages,
    ])
    await runCommand(userPython, [
      "-c",
      "import pathlib,sys; target=str(pathlib.Path(sys.argv[1]).resolve()); assert target in [str(pathlib.Path(item).resolve()) for item in sys.path if item]",
      options.basePythonSitePackages,
    ])
  }

  await ensureUserNodePackage(
    path.join(paths.nodeProject, "package.json"),
    options.pnpmVersion ?? "10.6.4",
    runCommand,
    options.processIdentity?.uid,
  )
  return {
    paths,
    environment: userRuntimeEnvironment(
      paths,
      process.env.PATH ?? "/usr/bin:/bin",
      options.baseNodeProject,
      options.nodeRegisterHook,
      options.basePythonSitePackages,
      runtimeToolBin,
      options.pythonPackageIndexUrl,
      options.nodePackageRegistryUrl,
      options.bashEnvironmentFile,
    ),
  }
}

export async function resetUserBrowserSessions(
  browserSessionRoot: string,
  processIdentity: ProcessIdentity | undefined,
  runCommand: RuntimeCommand,
): Promise<void> {
  if (processIdentity === undefined) {
    await rm(browserSessionRoot, { recursive: true, force: true })
    return
  }
  await runCommand("/usr/bin/rm", ["-rf", "--", browserSessionRoot])
}

export function userRuntimeEnvironment(
  paths: UserRuntimePaths,
  basePath: string,
  baseNodeProject?: string,
  nodeRegisterHook?: string,
  basePythonSitePackages?: string,
  runtimeToolBin = "/opt/linksense/bin",
  pythonPackageIndexUrl = DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  nodePackageRegistryUrl = DEFAULT_NODE_PACKAGE_REGISTRY_URL,
  bashEnvironmentFile?: string,
): Record<string, string> {
  const basePythonEnvironment = basePythonSitePackages
    ? path.dirname(path.dirname(path.dirname(basePythonSitePackages)))
    : undefined
  return {
    PATH: [
      runtimeToolBin,
      path.join(paths.pythonEnvironment, "bin"),
      paths.nodeBin,
      paths.pnpmHome,
      ...(baseNodeProject
        ? [path.join(baseNodeProject, "node_modules", ".bin")]
        : []),
      basePath,
    ].join(path.delimiter),
    ...(bashEnvironmentFile ? { BASH_ENV: bashEnvironmentFile } : {}),
    VIRTUAL_ENV: paths.pythonEnvironment,
    UV_PROJECT_ENVIRONMENT: paths.pythonEnvironment,
    UV_CACHE_DIR: paths.uvCache,
    UV_DEFAULT_INDEX: pythonPackageIndexUrl,
    UV_INDEX_STRATEGY: "first-index",
    PIP_INDEX_URL: pythonPackageIndexUrl,
    PNPM_HOME: paths.pnpmHome,
    npm_config_store_dir: paths.pnpmStore,
    NPM_CONFIG_PREFIX: paths.pnpmHome,
    NPM_CONFIG_REGISTRY: nodePackageRegistryUrl,
    COREPACK_HOME: paths.corepackHome,
    XDG_CACHE_HOME: paths.cacheRoot,
    TMPDIR: paths.temporaryRoot,
    LINKSENSE_RUNTIME_TOOL_BIN: runtimeToolBin,
    LINKSENSE_PYTHON_PACKAGE_INDEX_URL: pythonPackageIndexUrl,
    LINKSENSE_NODE_PACKAGE_REGISTRY_URL: nodePackageRegistryUrl,
    LINKSENSE_USER_PYTHON_ROOT: path.dirname(paths.pythonEnvironment),
    LINKSENSE_USER_PYTHON_VENV: paths.pythonEnvironment,
    LINKSENSE_USER_NODE_PROJECT: paths.nodeProject,
    ...(basePythonSitePackages
      ? { LINKSENSE_PYTHON_BASE_SITE_PACKAGES: basePythonSitePackages }
      : {}),
    ...(basePythonEnvironment
      ? { PYTHON_BASE_VENV: basePythonEnvironment }
      : {}),
    ...(baseNodeProject
      ? {
          LINKSENSE_NODE_BASE_PROJECT: baseNodeProject,
          LINKSENSE_NODE_USER_PACKAGE_TEMPLATE: path.join(
            baseNodeProject,
            "user-package.json",
          ),
        }
      : {}),
    ...(nodeRegisterHook
      ? { NODE_OPTIONS: `--import=${nodeRegisterHook}` }
      : {}),
    NODE_PATH: [
      paths.nodeModules,
      ...(baseNodeProject
        ? [path.join(baseNodeProject, "node_modules")]
        : []),
    ].join(path.delimiter),
    PYTHONNOUSERSITE: "1",
  }
}

async function assertManagedBashEnvironmentFile(
  candidate: string,
): Promise<void> {
  if (!path.isAbsolute(candidate)) {
    throw new Error("managed Bash environment file must be absolute")
  }
  const info = await lstat(candidate).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error("managed Bash environment file is unavailable")
  }
  if ((info.mode & 0o022) !== 0) {
    throw new Error("managed Bash environment file must not be writable")
  }
  await access(candidate, constants.R_OK).catch(() => {
    throw new Error("managed Bash environment file is unreadable")
  })
}

function basePythonCommand(
  basePythonSitePackages: string | undefined,
): string | undefined {
  if (!basePythonSitePackages) return undefined
  return path.join(
    path.dirname(path.dirname(path.dirname(basePythonSitePackages))),
    "bin",
    "python",
  )
}

async function assertRuntimeTools(runtimeToolBin: string): Promise<void> {
  const directory = await lstat(runtimeToolBin).catch(() => null)
  if (!directory?.isDirectory() || directory.isSymbolicLink()) {
    throw new Error("managed runtime tool directory is unavailable")
  }
  await Promise.all(
    ["linksense-browser", "linksense-uv", "linksense-pnpm"].map(async (name) => {
      const candidate = path.join(runtimeToolBin, name)
      const info = await lstat(candidate).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink()) {
        throw new Error("managed runtime tool is unavailable")
      }
      await access(candidate, constants.X_OK).catch(() => {
        throw new Error("managed runtime tool is not executable")
      })
    }),
  )
}

async function defaultRunCommand(
  command: string,
  args: string[],
  processIdentity?: ProcessIdentity,
): Promise<void> {
  const invocation = isolatedChildInvocation(command, args, processIdentity)
  await execFileAsync(invocation.command, invocation.args, {
    timeout: 60_000,
    env: runtimeCommandEnvironment(process.env),
  })
}

function runtimeCommandEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ] as const
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]!]],
    ),
  )
}

export const runtimeCommandEnvironmentForTesting = runtimeCommandEnvironment

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureRuntimeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o770 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("user runtime path is not a directory")
  }
  try {
    await chmod(directory, 0o770)
  } catch (error) {
    if (
      !isNodeError(error) ||
      error.code !== "EPERM" ||
      (info.mode & 0o070) !== 0o070
    ) {
      throw error
    }
  }
}

async function ensureUserNodePackage(
  destination: string,
  pnpmVersion: string,
  runCommand: RuntimeCommand,
  commandUid?: number,
): Promise<void> {
  const initialPackage = {
    name: "linksense-user-runtime",
    private: true,
    type: "module",
    packageManager: `pnpm@${pnpmVersion}`,
  }
  await runCommand(process.execPath, [
    "-e",
    USER_NODE_PACKAGE_SCRIPT,
    "create",
    destination,
    `${JSON.stringify(initialPackage, null, 2)}\n`,
  ])

  const info = await lstat(destination)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("user runtime package.json is not a regular file")
  }
  try {
    await chmod(destination, 0o660)
  } catch (error) {
    if (
      !isNodeError(error) ||
      error.code !== "EPERM" ||
      commandUid === undefined ||
      info.uid !== commandUid ||
      (info.mode & 0o200) === 0
    ) {
      throw error
    }
  }
  const contents = await readFile(destination, "utf8")
  const parsed: unknown = JSON.parse(contents)
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("user runtime package.json must contain an object")
  }
  const packageJson = parsed as Record<string, unknown>
  if (packageJson.packageManager === initialPackage.packageManager) return
  await runCommand(process.execPath, [
    "-e",
    USER_NODE_PACKAGE_SCRIPT,
    "write",
    destination,
    `${JSON.stringify(
      { ...packageJson, packageManager: initialPackage.packageManager },
      null,
      2,
    )}\n`,
  ])
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

export function createUserRuntimeEnsurer(
  rootForOwner: (ownerId: string) => string,
  options: Parameters<typeof initializeUserRuntime>[1] = {},
): (ownerId: string) => ReturnType<typeof initializeUserRuntime> {
  const inFlight = new Map<
    string,
    ReturnType<typeof initializeUserRuntime>
  >()
  return (ownerId) => {
    const existing = inFlight.get(ownerId)
    if (existing) return existing
    const initialization = initializeUserRuntime(rootForOwner(ownerId), options)
    inFlight.set(ownerId, initialization)
    const clearFailedInitialization = () => {
      if (inFlight.get(ownerId) === initialization) inFlight.delete(ownerId)
    }
    void initialization.then(
      () => undefined,
      clearFailedInitialization,
    )
    return initialization
  }
}
