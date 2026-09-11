import { execFile, type ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter, once } from "node:events"
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

import pino from "pino"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CodexJsonRpcClient,
  type ChildProcessFactory,
} from "../src/codex/json-rpc-client.js"
import {
  createUserRuntimeEnsurer,
  initializeUserRuntime,
  prepareManagedPackageSourceConfig,
  resetUserBrowserSessions,
  runtimeCommandEnvironmentForTesting,
  userRuntimeDirectories,
  userRuntimePaths,
} from "../src/user-runtime.js"

const roots: string[] = []
const execFileAsync = promisify(execFile)
// Wrapper tests need only the active Node/pnpm executables and system tools.
// Nested pnpm PATH entries otherwise multiply command lookup filesystem work.
const runtimeTestPath = [
  ...new Set([
    path.dirname(process.execPath),
    process.env.PNPM_HOME ?? path.dirname(process.execPath),
    "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
  ]),
].join(path.delimiter)
const pythonWrapper = fileURLToPath(
  new URL("../../../deploy/runtime/python/linksense-uv", import.meta.url),
)
const nodeWrapper = fileURLToPath(
  new URL("../../../deploy/runtime/node/linksense-pnpm", import.meta.url),
)
const nodeUserPackageTemplate = fileURLToPath(
  new URL("../../../deploy/runtime/node/user-package.json", import.meta.url),
)
const environmentReportingPackage = fileURLToPath(
  new URL("./fixtures/env-reporting-package", import.meta.url),
)

afterEach(async () => {
  await Promise.all(
    roots.flatMap((root) =>
      ["package-sources", "managed-package-sources"].map((name) =>
        chmod(path.join(root, name), 0o755).catch(() => undefined),
      ),
    ),
  )
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("persistent user runtime", () => {
  it("clears legacy browser sessions with the task identity command", async () => {
    const runCommand = vi.fn(async () => undefined)
    const sessionRoot =
      "/home/linksense/.local/share/linksense/browser-sessions"

    await resetUserBrowserSessions(
      sessionRoot,
      { uid: 1001, gid: 1000 },
      runCommand,
    )

    expect(runCommand).toHaveBeenCalledExactlyOnceWith(
      "/usr/bin/rm",
      ["-rf", "--", sessionRoot],
    )
  })

  it("exposes every persistent runtime directory for controller startup repair", () => {
    const root = "/home/linksense/.local/share/linksense"
    const paths = userRuntimePaths(root)

    expect(userRuntimeDirectories(paths)).toEqual([
      root,
      `${root}/python`,
      `${root}/cache`,
      `${root}/cache/uv`,
      `${root}/node`,
      `${root}/node/node_modules`,
      `${root}/node/node_modules/.bin`,
      `${root}/pnpm-home`,
      `${root}/cache/pnpm`,
      `${root}/cache/pnpm/store`,
      `${root}/cache/corepack`,
      `${root}/tmp`,
      `${root}/browser-sessions`,
    ])
  })

  it("writes managed package sources as read-only worker files", async () => {
    const root = await temporaryRoot()
    const configRoot = path.join(root, "package-sources")
    await prepareManagedPackageSourceConfig(
      "https://python-packages.example.test/simple/",
      "https://node-packages.example.test/",
      configRoot,
    )

    expect(await readFile(path.join(configRoot, "python-index-url"), "utf8")).toBe(
      "https://python-packages.example.test/simple/\n",
    )
    expect(await readFile(path.join(configRoot, "node-registry-url"), "utf8")).toBe(
      "https://node-packages.example.test/\n",
    )
    expect((await stat(configRoot)).mode & 0o777).toBe(0o555)
    expect((await stat(path.join(configRoot, "python-index-url"))).mode & 0o777).toBe(
      0o444,
    )
    expect((await stat(path.join(configRoot, "node-registry-url"))).mode & 0o777).toBe(
      0o444,
    )
    await chmod(configRoot, 0o755)
  })

  it("links the public Python site, exposes configured protected wrappers first, and creates no user wrapper", async () => {
    const root = await temporaryRoot()
    const publicSite = "/opt/linksense/runtime/python/lib/python3.12/site-packages"
    const runtimeToolBin = path.join(root, "managed-bin")
    const bashEnvironmentFile = path.join(root, "linksense-bash-env.sh")
    await createRuntimeToolBin(runtimeToolBin)
    await writeFile(bashEnvironmentFile, "PATH=/opt/linksense/bin:/usr/bin\n")
    await chmod(bashEnvironmentFile, 0o444)
    const commands: Array<{ command: string; args: string[] }> = []
    const result = await initializeUserRuntime(root, {
      basePythonSitePackages: publicSite,
      baseNodeProject: "/opt/linksense/runtime/node",
      nodeRegisterHook: "/opt/linksense/runtime/node/register-hooks.mjs",
      bashEnvironmentFile,
      runtimeToolBin,
      pnpmVersion: "10.6.4",
      pythonPackageIndexUrl: "https://packages.example/pypi/simple/",
      nodePackageRegistryUrl: "https://packages.example/npm/",
      runCommand: async (command, args) => {
        commands.push({ command, args })
        if (await emulateUserNodePackageCommand(args)) return
        if (args[0] === "-m" && args[1] === "venv") {
          const environment = args.at(-1)!
          await mkdir(path.join(environment, "bin"), { recursive: true })
          await mkdir(path.join(environment, "lib", "python3.12", "site-packages"), {
            recursive: true,
          })
          await writeFile(path.join(environment, "pyvenv.cfg"), "home = /usr/bin\n")
        }
        if (args[0] === "-c" && args[1]?.includes("target.write_text")) {
          const destination = path.join(
            resultPathFromCommand(command),
            "lib",
            "python3.12",
            "site-packages",
            "linksense-public-runtime.pth",
          )
          await writeFile(destination, `${args[2]}\n`, { mode: 0o660 })
          await chmod(destination, 0o660)
        }
      },
    })

    const publicRuntimePath = path.join(
      result.paths.pythonEnvironment,
      "lib",
      "python3.12",
      "site-packages",
      "linksense-public-runtime.pth",
    )
    expect(await readFile(publicRuntimePath, "utf8")).toBe(`${publicSite}\n`)
    expect((await stat(publicRuntimePath)).mode & 0o777).toBe(0o660)
    expect(commands[0]).toMatchObject({
      command: "/opt/linksense/runtime/python/bin/python",
      args: ["-m", "venv", result.paths.pythonEnvironment],
    })
    expect(commands[0]?.args).not.toContain("--system-site-packages")
    const userPythonCommands = commands.filter(
      ({ command }) => command === path.join(result.paths.pythonEnvironment, "bin", "python"),
    )
    expect(userPythonCommands).toHaveLength(2)
    expect(userPythonCommands[0]?.args[1]).toContain("target.write_text")
    expect(userPythonCommands[1]?.args[1]).toContain("assert target")
    expect(userPythonCommands.every(({ args }) => args.includes(publicSite))).toBe(
      true,
    )
    const pathEntries = result.environment.PATH!.split(path.delimiter)
    expect(pathEntries.slice(0, 3)).toEqual([
      runtimeToolBin,
      path.join(result.paths.pythonEnvironment, "bin"),
      path.join(result.paths.nodeModules, ".bin"),
    ])
    expect(result.environment).toMatchObject({
      BASH_ENV: bashEnvironmentFile,
      LINKSENSE_RUNTIME_TOOL_BIN: runtimeToolBin,
      LINKSENSE_USER_PYTHON_ROOT: path.join(root, "python"),
      LINKSENSE_USER_PYTHON_VENV: result.paths.pythonEnvironment,
      LINKSENSE_PYTHON_BASE_SITE_PACKAGES: publicSite,
      PYTHON_BASE_VENV: "/opt/linksense/runtime/python",
      LINKSENSE_USER_NODE_PROJECT: result.paths.nodeProject,
      LINKSENSE_NODE_BASE_PROJECT: "/opt/linksense/runtime/node",
      LINKSENSE_NODE_USER_PACKAGE_TEMPLATE:
        "/opt/linksense/runtime/node/user-package.json",
      NODE_OPTIONS: "--import=/opt/linksense/runtime/node/register-hooks.mjs",
      TMPDIR: result.paths.temporaryRoot,
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
        "https://packages.example/pypi/simple/",
      UV_DEFAULT_INDEX: "https://packages.example/pypi/simple/",
      UV_INDEX_STRATEGY: "first-index",
      PIP_INDEX_URL: "https://packages.example/pypi/simple/",
      LINKSENSE_NODE_PACKAGE_REGISTRY_URL:
        "https://packages.example/npm/",
      NPM_CONFIG_REGISTRY: "https://packages.example/npm/",
    })
    expect(
      JSON.parse(
        await readFile(path.join(result.paths.nodeProject, "package.json"), "utf8"),
      ),
    ).toMatchObject({ packageManager: "pnpm@10.6.4" })
    await expect(
      access(path.join(result.paths.nodeBin, "linksense-uv")),
    ).rejects.toThrow()
    await expect(
      access(path.join(result.paths.nodeBin, "linksense-pnpm")),
    ).rejects.toThrow()
  })

  it("fails before creating a user runtime when a configured standalone tool bin is incomplete", async () => {
    const root = await temporaryRoot()
    const runtimeToolBin = path.join(root, "managed-bin")
    await mkdir(runtimeToolBin, { recursive: true })
    await writeFile(path.join(runtimeToolBin, "linksense-uv"), "#!/bin/sh\n")
    await chmod(path.join(runtimeToolBin, "linksense-uv"), 0o755)

    await expect(
      initializeUserRuntime(root, {
        runtimeToolBin,
        runCommand: async () => undefined,
      }),
    ).rejects.toThrow("managed runtime tool is unavailable")
  })

  it("rejects writable and symbolic-link managed Bash bootstrap files", async () => {
    const root = await temporaryRoot()
    const runtimeRoot = path.join(root, "runtime")
    const writableBootstrap = path.join(root, "writable-bash-env.sh")
    await writeFile(writableBootstrap, "PATH=/usr/bin:/bin\n")
    await chmod(writableBootstrap, 0o660)

    await expect(
      initializeUserRuntime(runtimeRoot, {
        bashEnvironmentFile: writableBootstrap,
        runCommand: async () => undefined,
      }),
    ).rejects.toThrow("managed Bash environment file must not be writable")

    const protectedBootstrap = path.join(root, "protected-bash-env.sh")
    const linkedBootstrap = path.join(root, "linked-bash-env.sh")
    await writeFile(protectedBootstrap, "PATH=/usr/bin:/bin\n")
    await chmod(protectedBootstrap, 0o444)
    await symlink(protectedBootstrap, linkedBootstrap)

    await expect(
      initializeUserRuntime(runtimeRoot, {
        bashEnvironmentFile: linkedBootstrap,
        runCommand: async () => undefined,
      }),
    ).rejects.toThrow("managed Bash environment file is unavailable")
    await expect(access(runtimeRoot)).rejects.toThrow()
  })

  it("forces the platform Python index for installs and rejects runtime and index overrides", async () => {
    const root = await temporaryRoot()
    const pythonRoot = path.join(root, "python")
    const venv = path.join(pythonRoot, ".venv")
    const userSite = path.join(venv, "lib", "python3.12", "site-packages")
    const publicSite = path.join(root, "public-python", "site-packages")
    const temporaryDirectory = path.join(root, "tmp")
    const fakeUv = path.join(root, "fake-uv")
    const uvLog = path.join(root, "uv.log")
    const uvEnvironmentLog = path.join(root, "uv-environment.log")
    const managedSourceRoot = path.join(root, "managed-package-sources")
    const packageIndex = "https://python-packages.example.test/simple/"
    await Promise.all([
      mkdir(path.join(venv, "bin"), { recursive: true }),
      mkdir(userSite, { recursive: true }),
      mkdir(publicSite, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }),
    ])
    await writeExecutable(
      path.join(venv, "bin", "python"),
      '#!/bin/sh\nprintf \'%s\\n\' "$LINKSENSE_TEST_USER_SITE"\n',
    )
    await writeExecutable(
      fakeUv,
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$LINKSENSE_TEST_UV_LOG"\nprintf \'%s|%s|%s|%s|%s|%s|%s\\n\' "${UV_DEFAULT_INDEX:-}" "${UV_INDEX_STRATEGY:-}" "${UV_INDEX:-}" "${UV_EXTRA_INDEX_URL:-}" "${UV_NO_CONFIG:-}" "${UV_CONSTRAINT:-}" "${UV_TORCH_BACKEND:-}" >> "$LINKSENSE_TEST_UV_ENVIRONMENT_LOG"\n',
    )
    await prepareManagedPackageSourceConfig(
      packageIndex,
      "https://node-packages.example.test/",
      managedSourceRoot,
    )
    const environment = {
      PATH: runtimeTestPath,
      HOME: root,
      LANG: "C.UTF-8",
      LINKSENSE_USER_PYTHON_ROOT: pythonRoot,
      LINKSENSE_USER_PYTHON_VENV: venv,
      LINKSENSE_PYTHON_BASE_SITE_PACKAGES: publicSite,
      LINKSENSE_UV_COMMAND: fakeUv,
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL:
        "https://command-override.example.test/simple/",
      LINKSENSE_TEST_PACKAGE_SOURCE_CONFIG_ROOT: managedSourceRoot,
      LINKSENSE_TEST_USER_SITE: userSite,
      LINKSENSE_TEST_UV_LOG: uvLog,
      LINKSENSE_TEST_UV_ENVIRONMENT_LOG: uvEnvironmentLog,
      UV_DEFAULT_INDEX: "https://fallback-python.example.test/simple/",
      UV_INDEX: "https://blocked-index.example.test/simple/",
      UV_EXTRA_INDEX_URL: "https://blocked-extra.example.test/simple/",
      UV_CONSTRAINT: path.join(root, "blocked-constraints.txt"),
      UV_TORCH_BACKEND: "cu128",
      TMPDIR: temporaryDirectory,
    }

    await execFileAsync("/bin/sh", [pythonWrapper, "pip", "install", "demo-package"], {
      env: environment,
    })

    expect(await readFile(uvLog, "utf8")).toBe(
      `pip install --python ${path.join(venv, "bin", "python")} --default-index ${packageIndex} --index-strategy first-index demo-package\n`,
    )
    expect(await readFile(uvEnvironmentLog, "utf8")).toBe(
      `${packageIndex}|first-index|||1||\n`,
    )
    expect(
      await readFile(path.join(userSite, "linksense-public-runtime.pth"), "utf8"),
    ).toBe(`${publicSite}\n`)
    await Promise.all(
      [
        ["--system"],
        ["-i", "https://blocked.example.test/simple/"],
        ["--index-url=https://blocked.example.test/simple/"],
        ["--default-index", "https://blocked.example.test/simple/"],
        ["--extra-index-url=https://blocked.example.test/simple/"],
        ["--index", "https://blocked.example.test/simple/"],
        ["--index-strategy", "unsafe-best-match"],
        ["--find-links", "https://blocked.example.test/wheels/"],
        ["--no-index"],
        ["--torch-backend", "cu128"],
        ["--torch-backend=cu128"],
        ["-r", path.join(root, "requirements.txt")],
        ["--requirements", path.join(root, "requirements.txt")],
        ["-c", path.join(root, "constraints.txt")],
        ["--overrides", path.join(root, "overrides.txt")],
      ].map(async (override) => {
        await expect(
          execFileAsync(
            "/bin/sh",
            [pythonWrapper, "pip", "install", ...override, "blocked-package"],
            { env: environment },
          ),
        ).rejects.toMatchObject({ code: 2 })
      }),
    )
    expect(await readFile(uvLog, "utf8")).not.toContain("blocked-package")

    await chmod(managedSourceRoot, 0o755)
    await rm(managedSourceRoot, { recursive: true, force: true })

    const fallbackEnvironment = {
      ...environment,
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL: undefined,
      UV_DEFAULT_INDEX: "https://fallback-python.example.test/simple/",
    }
    await execFileAsync(
      "/bin/sh",
      [pythonWrapper, "pip", "install", "fallback-package"],
      { env: fallbackEnvironment },
    )
    expect(await readFile(uvLog, "utf8")).toContain(
      `--default-index https://fallback-python.example.test/simple/ --index-strategy first-index fallback-package\n`,
    )

    const offlineEnvironment = {
      ...environment,
      LINKSENSE_PYTHON_PACKAGE_INDEX_URL: undefined,
      UV_DEFAULT_INDEX: undefined,
    }
    await execFileAsync("/bin/sh", [pythonWrapper, "pip", "check"], {
      env: offlineEnvironment,
    })
    expect(await readFile(uvLog, "utf8")).toContain(
      `pip check --python ${path.join(venv, "bin", "python")}\n`,
    )
    await expect(
      execFileAsync(
        "/bin/sh",
        [pythonWrapper, "pip", "install", "missing-index-package"],
        { env: offlineEnvironment },
      ),
    ).rejects.toMatchObject({ code: 78 })
    expect(await readFile(uvLog, "utf8")).not.toContain("missing-index-package")
  }, 15_000)

  it("forces the platform Node.js registry for downloads and leaves offline commands registry-free", async () => {
    const root = await temporaryRoot()
    const project = path.join(root, "node")
    const template = path.join(root, "user-package.json")
    const temporaryDirectory = path.join(root, "tmp")
    const store = path.join(root, "cache", "pnpm", "store")
    const fakePnpm = path.join(root, "fake-pnpm")
    const pnpmLog = path.join(root, "pnpm.log")
    const pnpmEnvironmentLog = path.join(root, "pnpm-environment.log")
    const managedSourceRoot = path.join(root, "managed-package-sources")
    const packageRegistry = "https://node-packages.example.test/"
    await Promise.all([
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(store, { recursive: true }),
    ])
    await writeFile(template, '{"name":"linksense-user-runtime","private":true}\n')
    await writeExecutable(
      fakePnpm,
      '#!/bin/sh\nif /usr/bin/env | /usr/bin/grep -q scoped-bypass.example.invalid; then exit 91; fi\nprintf \'%s\\n\' "$*" >> "$LINKSENSE_TEST_PNPM_LOG"\nprintf \'%s|%s|%s|%s|%s|%s|%s\\n\' "${NPM_CONFIG_REGISTRY:-}" "${NPM_CONFIG_USERCONFIG:-}" "${NPM_CONFIG_GLOBALCONFIG:-}" "${CC_ID:-}" "${CC_PASSWORD:-}" "${UNRELATED_SUPERVISOR_SECRET:-}" "${LINKSENSE_PNPM_PASSTHROUGH_ENV_NAMES:-}" >> "$LINKSENSE_TEST_PNPM_ENVIRONMENT_LOG"\n',
    )
    await prepareManagedPackageSourceConfig(
      "https://python-packages.example.test/simple/",
      packageRegistry,
      managedSourceRoot,
    )
    const environment = {
      PATH: runtimeTestPath,
      HOME: root,
      LANG: "C.UTF-8",
      LINKSENSE_USER_NODE_PROJECT: project,
      LINKSENSE_NODE_USER_PACKAGE_TEMPLATE: template,
      LINKSENSE_PNPM_COMMAND: fakePnpm,
      LINKSENSE_NODE_PACKAGE_REGISTRY_URL:
        "https://command-override.example.test/",
      LINKSENSE_TEST_PACKAGE_SOURCE_CONFIG_ROOT: managedSourceRoot,
      LINKSENSE_TEST_PNPM_LOG: pnpmLog,
      LINKSENSE_TEST_PNPM_ENVIRONMENT_LOG: pnpmEnvironmentLog,
      NPM_CONFIG_REGISTRY: "https://fallback-node.example.test/",
      "npm_config_@demo:registry": "https://scoped-bypass.example.invalid/",
      npm_config_store_dir: store,
      TMPDIR: temporaryDirectory,
    }

    await execFileAsync("/bin/sh", [nodeWrapper, "add", "demo-package"], {
      env: environment,
    })

    expect(await readFile(pnpmLog, "utf8")).toBe(
      `--dir ${project} --ignore-workspace --registry ${packageRegistry} add demo-package\n`,
    )
    expect(await readFile(pnpmEnvironmentLog, "utf8")).toBe(
      `${packageRegistry}|/dev/null|/dev/null||||\n`,
    )
    const dlxEnvironment = {
      ...environment,
      CC_ID: "reader-id",
      CC_PASSWORD: "reader-password",
      UNRELATED_SUPERVISOR_SECRET: "must-not-leak",
      LINKSENSE_PNPM_PASSTHROUGH_ENV_NAMES: "CC_ID,CC_PASSWORD",
    }
    await execFileAsync(
      "/bin/sh",
      [nodeWrapper, "dlx", "@modelcontextprotocol/server-everything"],
      { env: dlxEnvironment },
    )
    const invocationLines = (await readFile(pnpmLog, "utf8"))
      .trim()
      .split("\n")
    expect(invocationLines[1]).toBe(
      `--dir ${project} --ignore-workspace dlx @modelcontextprotocol/server-everything`,
    )
    expect(invocationLines[1]).not.toContain("--registry")
    expect((await readFile(pnpmEnvironmentLog, "utf8")).trim().split("\n")[1]).toBe(
      `${packageRegistry}|/dev/null|/dev/null|reader-id|reader-password||`,
    )
    await expect(
      execFileAsync(
        "/bin/sh",
        [nodeWrapper, "dlx", "blocked-environment-package"],
        {
          env: {
            ...environment,
            LINKSENSE_PNPM_PASSTHROUGH_ENV_NAMES: "PATH",
          },
        },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(await readFile(pnpmLog, "utf8")).not.toContain(
      "blocked-environment-package",
    )
    expect(JSON.parse(await readFile(path.join(project, "package.json"), "utf8"))).toEqual({
      name: "linksense-user-runtime",
      private: true,
    })
    await expect(
      execFileAsync(
        "/bin/sh",
        [nodeWrapper, "--dir", path.join(root, "outside"), "add", "blocked-package"],
        { env: environment },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(await readFile(pnpmLog, "utf8")).not.toContain("blocked-package")

    await Promise.all(
      [
        ["--registry", "https://blocked.example.test/"],
        ["--registry=https://blocked.example.test/"],
        ["--config.registry=https://blocked.example.test/"],
        ["--config.@demo:registry=https://blocked.example.test/"],
        ["--config.userconfig", path.join(root, "blocked-user.npmrc")],
        ["--config.globalconfig=blocked-global.npmrc"],
      ].map(async (override) => {
        await expect(
          execFileAsync(
            "/bin/sh",
            [nodeWrapper, "add", ...override, "blocked-registry-package"],
            { env: environment },
          ),
        ).rejects.toMatchObject({ code: 2 })
      }),
    )
    expect(await readFile(pnpmLog, "utf8")).not.toContain(
      "blocked-registry-package",
    )
    await expect(
      execFileAsync(
        "/bin/sh",
        [nodeWrapper, "--reporter=silent", "add", "blocked-option-package"],
        { env: environment },
      ),
    ).rejects.toMatchObject({ code: 2 })
    expect(await readFile(pnpmLog, "utf8")).not.toContain(
      "blocked-option-package",
    )

    await writeFile(
      path.join(project, ".npmrc"),
      "@demo:registry=https://scoped-bypass.example.invalid/\n",
    )
    await expect(
      execFileAsync(
        "/bin/sh",
        [nodeWrapper, "add", "@demo/blocked-package"],
        { env: environment },
      ),
    ).rejects.toMatchObject({ code: 2 })
    await rm(path.join(project, ".npmrc"), { force: true })
    await expect(
      execFileAsync("/bin/sh", [nodeWrapper, "config", "set", "registry", "x"], {
        env: environment,
      }),
    ).rejects.toMatchObject({ code: 2 })

    await chmod(managedSourceRoot, 0o755)
    await rm(managedSourceRoot, { recursive: true, force: true })

    const fallbackEnvironment = {
      ...environment,
      LINKSENSE_NODE_PACKAGE_REGISTRY_URL: undefined,
      NPM_CONFIG_REGISTRY: "https://fallback-node.example.test/",
    }
    await execFileAsync(
      "/bin/sh",
      [nodeWrapper, "add", "fallback-package"],
      { env: fallbackEnvironment },
    )
    expect(await readFile(pnpmLog, "utf8")).toContain(
      `--registry https://fallback-node.example.test/ add fallback-package\n`,
    )

    const offlineEnvironment = {
      ...environment,
      LINKSENSE_NODE_PACKAGE_REGISTRY_URL: undefined,
      NPM_CONFIG_REGISTRY: undefined,
    }
    await execFileAsync("/bin/sh", [nodeWrapper, "list"], {
      env: offlineEnvironment,
    })
    expect(await readFile(pnpmLog, "utf8")).toContain(
      `--dir ${project} --ignore-workspace list\n`,
    )
    await expect(
      execFileAsync(
        "/bin/sh",
        [nodeWrapper, "add", "missing-registry-package"],
        { env: offlineEnvironment },
      ),
    ).rejects.toMatchObject({ code: 78 })
    expect(await readFile(pnpmLog, "utf8")).not.toContain(
      "missing-registry-package",
    )
  })

  it("forwards only declared MCP variables through a real local pnpm dlx package", async () => {
    const root = await temporaryRoot()
    const project = path.join(root, "node")
    const temporaryDirectory = path.join(root, "tmp")
    const store = path.join(root, "cache", "pnpm", "store")
    const cache = path.join(root, "cache")
    const managedSourceRoot = path.join(root, "managed-package-sources")
    await Promise.all([
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(store, { recursive: true }),
    ])
    await prepareManagedPackageSourceConfig(
      "https://python-packages.example.test/simple/",
      "https://node-packages.example.test/",
      managedSourceRoot,
    )

    const result = await execFileAsync(
      "/bin/sh",
      [nodeWrapper, "dlx", environmentReportingPackage],
      {
        env: {
          PATH: runtimeTestPath,
          HOME: root,
          LANG: "C.UTF-8",
          XDG_CACHE_HOME: cache,
          LINKSENSE_USER_NODE_PROJECT: project,
          LINKSENSE_NODE_USER_PACKAGE_TEMPLATE: nodeUserPackageTemplate,
          LINKSENSE_TEST_PACKAGE_SOURCE_CONFIG_ROOT: managedSourceRoot,
          LINKSENSE_PNPM_PASSTHROUGH_ENV_NAMES: "CC_ID,CC_PASSWORD",
          CC_ID: "reader-id",
          CC_PASSWORD: "reader-password",
          UNRELATED_SUPERVISOR_SECRET: "must-not-leak",
          npm_config_store_dir: store,
          TMPDIR: temporaryDirectory,
        },
      },
    )

    expect(JSON.parse(result.stdout.trim())).toEqual({
      ccId: "reader-id",
      ccPassword: "reader-password",
      unrelatedSupervisorSecret: null,
      forwardingMetadata: null,
    })
  }, 15_000)

  it("does not hold the user runtime lock for the lifetime of a dlx process", async () => {
    const root = await temporaryRoot()
    const project = path.join(root, "node")
    const template = path.join(root, "user-package.json")
    const temporaryDirectory = path.join(root, "tmp")
    const store = path.join(root, "cache", "pnpm", "store")
    const fakePnpm = path.join(root, "fake-pnpm")
    const eventLog = path.join(root, "pnpm-events.log")
    const releaseFirst = path.join(root, "release-first")
    const managedSourceRoot = path.join(root, "managed-package-sources")
    await Promise.all([
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(store, { recursive: true }),
    ])
    await writeFile(template, '{"name":"linksense-user-runtime","private":true}\n')
    await writeExecutable(
      fakePnpm,
      '#!/bin/sh\ncase "$*" in\n  *long-running-mcp*)\n    printf \'first\\n\' >> "$LINKSENSE_TEST_PNPM_LOG"\n    printf \'ready\\n\'\n    while [ ! -f "$LINKSENSE_TEST_PNPM_ENVIRONMENT_LOG" ]; do sleep 0.05; done\n    ;;\n  *connection-probe*)\n    printf \'second\\n\' >> "$LINKSENSE_TEST_PNPM_LOG"\n    ;;\nesac\n',
    )
    await prepareManagedPackageSourceConfig(
      "https://python-packages.example.test/simple/",
      "https://node-packages.example.test/",
      managedSourceRoot,
    )
    const environment = {
      PATH: runtimeTestPath,
      HOME: root,
      LANG: "C.UTF-8",
      LINKSENSE_USER_NODE_PROJECT: project,
      LINKSENSE_NODE_USER_PACKAGE_TEMPLATE: template,
      LINKSENSE_PNPM_COMMAND: fakePnpm,
      LINKSENSE_TEST_PACKAGE_SOURCE_CONFIG_ROOT: managedSourceRoot,
      LINKSENSE_TEST_PNPM_LOG: eventLog,
      LINKSENSE_TEST_PNPM_ENVIRONMENT_LOG: releaseFirst,
      npm_config_store_dir: store,
      TMPDIR: temporaryDirectory,
    }
    const first = execFile(
      "/bin/sh",
      [nodeWrapper, "dlx", "long-running-mcp"],
      { env: environment },
    )
    if (!first.stdout) throw new Error("Expected piped child output")
    try {
      await Promise.race([
        once(first.stdout, "data"),
        once(first, "exit").then(() => {
          throw new Error("The first dlx process exited before becoming ready")
        }),
      ])
      await execFileAsync(
        "/bin/sh",
        [nodeWrapper, "dlx", "connection-probe"],
        { env: environment, timeout: 2_000 },
      )
      expect(await readFile(eventLog, "utf8")).toBe("first\nsecond\n")
      expect(first.exitCode).toBeNull()
    } finally {
      await writeFile(releaseFirst, "release\n")
      if (first.exitCode === null) await once(first, "exit")
    }
  }, 15_000)

  it("runs bootstrap subprocesses with no supervisor token or provider credentials", () => {
    expect(
      runtimeCommandEnvironmentForTesting({
        PATH: "/opt/linksense/bin:/usr/bin",
        LANG: "C.UTF-8",
        LINKSENSE_RUNNER_SHARED_SECRET: "worker-scoped-secret",
        LINK_SENSE_API_KEY: "provider-secret",
        OPENAI_API_KEY: "provider-secret",
        DATABASE_URL: "database-secret",
      }),
    ).toEqual({
      PATH: "/opt/linksense/bin:/usr/bin",
      LANG: "C.UTF-8",
    })
  })

  it("singleflights concurrent initialization and memoizes the successful runtime", async () => {
    const root = await temporaryRoot()
    let venvCreates = 0
    const ensure = createUserRuntimeEnsurer(() => root, {
      runCommand: async (_command, args) => {
        if (await emulateUserNodePackageCommand(args)) return
        if (args[0] !== "-m") return
        venvCreates += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        const environment = args.at(-1)!
        await mkdir(path.join(environment, "bin"), { recursive: true })
        await writeFile(path.join(environment, "pyvenv.cfg"), "home = /usr/bin\n")
      },
    })

    const [first, second] = await Promise.all([ensure("owner"), ensure("owner")])
    expect(first.paths.root).toBe(second.paths.root)
    expect(venvCreates).toBe(1)
    const third = await ensure("owner")
    expect(third).toBe(first)
    expect(venvCreates).toBe(1)
  })

  it("repairs group-writable directories even under umask 022 and omits a missing Node hook", async () => {
    const root = await temporaryRoot()
    const previousUmask = process.umask(0o022)
    try {
      const result = await initializeUserRuntime(root, {
        runCommand: async (_command, args) => {
          if (await emulateUserNodePackageCommand(args)) return
          if (args[0] !== "-m") return
          const environment = args.at(-1)!
          await mkdir(path.join(environment, "bin"), { recursive: true })
          await writeFile(path.join(environment, "pyvenv.cfg"), "home = /usr/bin\n")
        },
      })
      for (const directory of [
        result.paths.root,
        result.paths.nodeProject,
        result.paths.nodeModules,
        result.paths.pnpmHome,
        result.paths.cacheRoot,
        path.dirname(result.paths.pnpmStore),
        result.paths.corepackHome,
        result.paths.uvCache,
        result.paths.temporaryRoot,
      ]) {
        expect((await stat(directory)).mode & 0o777).toBe(0o770)
      }
      expect(result.environment).not.toHaveProperty("NODE_OPTIONS")
      expect(result.environment.NODE_PATH).toBe(result.paths.nodeModules)
      expect(
        (await stat(path.join(result.paths.nodeProject, "package.json"))).mode &
          0o777,
      ).toBe(0o660)
    } finally {
      process.umask(previousUmask)
    }
  })

  it("clears a failed singleflight so the next request can retry without an unhandled rejection", async () => {
    const root = await temporaryRoot()
    let attempts = 0
    const unhandled: unknown[] = []
    const listener = (error: unknown) => unhandled.push(error)
    process.on("unhandledRejection", listener)
    const ensure = createUserRuntimeEnsurer(() => root, {
      runCommand: async (_command, args) => {
        if (await emulateUserNodePackageCommand(args)) return
        if (args[0] !== "-m") return
        attempts += 1
        if (attempts === 1) throw new Error("first initialization failed")
        const environment = args.at(-1)!
        await mkdir(path.join(environment, "bin"), { recursive: true })
        await writeFile(path.join(environment, "pyvenv.cfg"), "home = /usr/bin\n")
      },
    })
    try {
      await expect(ensure("owner")).rejects.toThrow("first initialization failed")
      await expect(ensure("owner")).resolves.toBeDefined()
      await new Promise((resolve) => setImmediate(resolve))
      expect(attempts).toBe(2)
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", listener)
    }
  })
})

describe("Codex child identity", () => {
  it("spawns app-server through setpriv with all task capabilities cleared", async () => {
    const child = fakeChild()
    const factory = vi.fn((...args: Parameters<ChildProcessFactory>) => {
      void args
      return child
    })
    const client = new CodexJsonRpcClient({
      command: "codex",
      userHome: "/tmp/user-home",
      codexHome: "/tmp/codex-home",
      logger: pino({ level: "silent" }),
      childProcessFactory: factory,
      processIdentity: { uid: 1001, gid: 1000 },
    })

    expect(factory.mock.calls[0]?.[0]).toBe("/usr/bin/setpriv")
    expect(factory.mock.calls[0]?.[1].slice(0, 9)).toEqual([
      "--reuid=1001",
      "--regid=1000",
      "--keep-groups",
      "--bounding-set=-all",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--",
      "codex",
      "app-server",
    ])
    await client.close()
    expect(child.kill).toHaveBeenCalledWith("SIGTERM")
  })

  it("marks a timed-out app-server connection unhealthy and rejects later reuse", async () => {
    const child = fakeChild()
    const client = new CodexJsonRpcClient({
      command: "codex",
      userHome: "/tmp/user-home",
      codexHome: "/tmp/codex-home",
      logger: pino({ level: "silent" }),
      childProcessFactory: () => child,
      requestTimeoutMs: 5,
    })
    const unhealthy = vi.fn()
    client.on("unhealthy", unhealthy)

    await expect(client.request("thread/read", {})).rejects.toThrow(
      "app-server request timed out: thread/read",
    )
    expect(client.isHealthy).toBe(false)
    expect(unhealthy).toHaveBeenCalledWith({
      type: "request_timeout",
      method: "thread/read",
    })
    await expect(client.request("thread/read", {})).rejects.toThrow(
      "app-server connection is unhealthy",
    )

    await client.close()
  })

  it("bounds interruption independently of the normal RPC timeout", async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild()
      const client = new CodexJsonRpcClient({
        command: "codex", userHome: "/tmp/user-home", codexHome: "/tmp/codex-home",
        logger: pino({ level: "silent" }), childProcessFactory: () => child,
        requestTimeoutMs: 30_000,
      })
      const request = client.request("turn/interrupt", {}, { timeoutMs: 5_000 })
      const rejection = expect(request).rejects.toThrow("app-server request timed out: turn/interrupt")
      await vi.advanceTimersByTimeAsync(5_000)
      await rejection
      expect(client.isHealthy).toBe(false)
      await client.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("escalates shutdown to SIGKILL and waits for the final child exit", async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild()
      vi.mocked(child.kill).mockImplementation(() => true)
      const client = new CodexJsonRpcClient({
        command: "codex",
        userHome: "/tmp/user-home",
        codexHome: "/tmp/codex-home",
        logger: pino({ level: "silent" }),
        childProcessFactory: () => child,
      })

      const closing = client.close()
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM")

      await vi.advanceTimersByTimeAsync(2_000)
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL")

      let settled = false
      void closing.finally(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(client.isExited).toBe(false)

      child.emit("exit", null, "SIGKILL")
      await expect(closing).resolves.toBeUndefined()
      expect(client.isExited).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects close when the child remains alive after SIGKILL", async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild()
      vi.mocked(child.kill).mockImplementation(() => true)
      const client = new CodexJsonRpcClient({
        command: "codex",
        userHome: "/tmp/user-home",
        codexHome: "/tmp/codex-home",
        logger: pino({ level: "silent" }),
        childProcessFactory: () => child,
      })

      const closing = client.close()
      const rejected = expect(closing).rejects.toThrow(
        "codex app-server did not exit after SIGKILL",
      )
      await vi.advanceTimersByTimeAsync(4_000)

      await rejected
      expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM")
      expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL")
    } finally {
      vi.useRealTimers()
    }
  })

  it("marks a child process error unhealthy and emits only one cleanup signal", async () => {
    const child = fakeChild()
    vi.mocked(child.kill).mockImplementation(() => true)
    const client = new CodexJsonRpcClient({
      command: "codex",
      userHome: "/tmp/user-home",
      codexHome: "/tmp/codex-home",
      logger: pino({ level: "silent" }),
      childProcessFactory: () => child,
    })
    const unhealthy = vi.fn()
    const exited = vi.fn()
    client.on("unhealthy", unhealthy)
    client.on("exit", exited)
    const request = client.request("thread/read", {})

    child.emit("error", new Error("spawn failed"))

    await expect(request).rejects.toThrow("codex app-server failed to start")
    expect(client.isHealthy).toBe(false)
    expect(unhealthy).toHaveBeenCalledTimes(1)
    expect(unhealthy).toHaveBeenCalledWith({ type: "child_process_error" })

    child.emit("exit", 1, null)
    expect(unhealthy).toHaveBeenCalledTimes(1)
    expect(exited).not.toHaveBeenCalled()
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-user-runtime-"))
  roots.push(root)
  return root
}

async function createRuntimeToolBin(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  await Promise.all(
    ["linksense-browser", "linksense-uv", "linksense-pnpm"].map((name) =>
      writeExecutable(path.join(directory, name), "#!/bin/sh\nexit 0\n"),
    ),
  )
}

async function writeExecutable(destination: string, contents: string): Promise<void> {
  await writeFile(destination, contents)
  await chmod(destination, 0o755)
}

async function emulateUserNodePackageCommand(args: string[]): Promise<boolean> {
  if (
    args[0] !== "-e" ||
    !args[1]?.includes("linksense-user-node-package")
  ) {
    return false
  }
  const operation = args[2]
  const destination = args[3]!
  const contents = args[4]!
  if (operation === "create") {
    try {
      await writeFile(destination, contents, { mode: 0o660, flag: "wx" })
      await chmod(destination, 0o660)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error
      }
    }
    return true
  }
  if (operation === "write") {
    await writeFile(destination, contents)
    return true
  }
  throw new Error("unexpected user node package operation")
}

function fakeChild(): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as ChildProcessWithoutNullStreams
  Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 123,
    connected: false,
    exitCode: null,
    signalCode: null,
    killed: false,
    spawnargs: [],
    spawnfile: "codex",
  })
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    void signal
    queueMicrotask(() => emitter.emit("exit", 0, null))
    return true
  })
  Object.assign(emitter, { kill })
  return emitter
}

function resultPathFromCommand(command: string): string {
  return path.dirname(path.dirname(command))
}
