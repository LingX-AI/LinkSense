import { execFile } from "node:child_process"
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, "..")
const runnerDist =
  process.env.LINKSENSE_RUNNER_DIST?.trim() ||
  path.join(repositoryRoot, "apps/runner/dist")
const apiDist =
  process.env.LINKSENSE_API_DIST?.trim() ||
  path.join(repositoryRoot, "apps/api/dist")
const codexHomeTemplate =
  process.env.LINKSENSE_CODEX_HOME_TEMPLATE?.trim() ||
  path.join(repositoryRoot, "deploy/codex-home-template")
const codexCommand = process.env.CODEX_BIN?.trim() || "codex"
const conversationId = "01900000-0000-7000-8000-000000000311"
const ownerId = "01900000-0000-7000-8000-000000000312"
const root = await mkdtemp(
  path.join(tmpdir(), "linksense-browser-skill-discovery-")
)
let client
let makeDirectoryTreeRemovable

try {
  const [
    { CodexJsonRpcClient },
    { CODEX_SCHEMA_VERSION },
    { WorkspaceManager },
    { makeDirectoryTreeRemovable: removeDirectoryTree },
    { UserHomeCapabilityMaterializer },
  ] = await Promise.all([
    importRunnerModule("codex/json-rpc-client.js"),
    importRunnerModule("codex/protocol.js"),
    importRunnerModule("workspace/workspace-manager.js"),
    importRunnerModule("workspace/filesystem.js"),
    importApiModule("modules/capabilities/user-home-materializer.js"),
  ])
  makeDirectoryTreeRemovable = removeDirectoryTree
  const actualCodexVersion = await readCodexVersion()
  if (actualCodexVersion !== CODEX_SCHEMA_VERSION) {
    throw new Error(
      `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, received ${actualCodexVersion}`
    )
  }

  const userDataRoot = path.join(root, "users")
  const manager = new WorkspaceManager(userDataRoot, codexHomeTemplate)
  manager.bindOwner(conversationId, ownerId)
  const paths = await manager.ensureConversation(conversationId, "smoke")
  const materializedCapabilities = await new UserHomeCapabilityMaterializer({
    userDataRoot,
  }).reconcile({ ownerId, capabilities: [] })
  await symlink(
    materializedCapabilities.managedAgentsRoot,
    path.join(paths.home, ".agents"),
    "dir"
  )
  const [materializedHome, expectedUserHome] = await Promise.all([
    realpath(path.join(materializedCapabilities.ownerRoot, "home")),
    realpath(paths.home),
  ])
  if (materializedHome !== expectedUserHome) {
    throw new Error(
      "capabilities were materialized into an unexpected user HOME"
    )
  }

  client = new CodexJsonRpcClient({
    command: codexCommand,
    userHome: paths.home,
    codexHome: paths.codexHome,
    logger: {
      warn: () => undefined,
    },
    requestTimeoutMs: 30_000,
  })
  const initialized = await client.initialize()
  const [initializedHome, expectedCodexHome] = await Promise.all([
    realpath(initialized.codexHome),
    realpath(paths.codexHome),
  ])
  if (initializedHome !== expectedCodexHome) {
    throw new Error("Codex initialized with an unexpected CODEX_HOME")
  }

  const catalog = await client.request("skills/list", {
    cwds: [paths.workspace],
    forceReload: true,
  })
  const matches = catalog.data
    .flatMap((entry) => entry.skills)
    .filter((skill) => skill.name === "linksense-browser" && skill.enabled)
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one enabled linksense-browser Skill, received ${matches.length}`
    )
  }
  const [discoveredPath, expectedPath] = await Promise.all([
    realpath(matches[0].path),
    realpath(
      path.join(
        paths.home,
        ".agents",
        "skills",
        "linksense-browser",
        "SKILL.md"
      )
    ),
  ])
  if (discoveredPath !== expectedPath) {
    throw new Error("Codex discovered linksense-browser from the wrong path")
  }

  console.log(
    JSON.stringify({
      status: "ok",
      codexVersion: actualCodexVersion,
      codexHomeIsolated: true,
      skillRoot: "$HOME/.agents/skills",
      discoveredSkill: {
        name: matches[0].name,
        relativePath: path.relative(expectedUserHome, discoveredPath),
      },
    })
  )
} finally {
  await client?.close()
  await makeDirectoryTreeRemovable?.(root)
  await rm(root, { recursive: true, force: true })
}

function importRunnerModule(relativePath) {
  return importBuiltModule(
    runnerDist,
    relativePath,
    "pnpm --filter @linksense/runner build"
  )
}

function importApiModule(relativePath) {
  return importBuiltModule(
    apiDist,
    relativePath,
    "pnpm --filter @linksense/api build"
  )
}

async function importBuiltModule(distRoot, relativePath, buildCommand) {
  const modulePath = path.join(distRoot, relativePath)
  try {
    return await import(pathToFileURL(modulePath).href)
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `Built module is required at ${modulePath}. Run \`${buildCommand}\` before this smoke.`,
        { cause: error }
      )
    }
    throw error
  }
}

async function readCodexVersion() {
  const { stdout, stderr } = await execFileAsync(codexCommand, ["--version"], {
    encoding: "utf8",
  })
  const output = `${stdout}\n${stderr}`
  const match = output.match(/\bcodex-cli\s+(\d+\.\d+\.\d+)\b/u)
  if (!match?.[1]) {
    throw new Error(`Unable to parse Codex version from ${codexCommand}`)
  }
  return match[1]
}
