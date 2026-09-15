import { execFile } from "node:child_process"
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { modelProviderProtocolModeSchema } from "../packages/shared/src/index.ts"

import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts"
import { serializePromptLink } from "../apps/runner/src/codex/prompt.ts"
import {
  CODEX_SCHEMA_VERSION,
  type CodexThread,
  type CodexTurn,
  type JsonRpcNotification,
} from "../apps/runner/src/codex/protocol.ts"
import {
  ModelGateway,
  modelGatewayEnvironmentKey,
  type ModelGatewayLease,
} from "../apps/runner/src/model-gateway/model-gateway.ts"
import { UserHomeCapabilityMaterializer } from "../apps/api/src/modules/capabilities/user-home-materializer.ts"
import { makeDirectoryTreeRemovable } from "../apps/runner/src/workspace/filesystem.ts"
import { WorkspaceManager } from "../apps/runner/src/workspace/workspace-manager.ts"

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)
const runnerEnvironment = await readRunnerEnvironment()
const codexCommand = process.env.CODEX_BIN?.trim() || "codex"
const codexModel =
  process.env.LINKSENSE_CODEX_MODEL?.trim() ||
  runnerEnvironment.LINKSENSE_CODEX_MODEL?.trim()
const discoveryOnly = process.env.CODEX_DISCOVERY_ONLY === "1"
const skillName = "structured-smoke"
const marker = "CODEX_HOME_SKILL_DISCOVERY_4E9C17"
const conversationId = "01900000-0000-7000-8000-000000000211"
const ownerId = "01900000-0000-7000-8000-000000000212"
const capabilityId = "01900000-0000-7000-8000-000000000214"
const projectionId = "01900000-0000-7000-8000-000000000213"
let actualCodexVersion: string | undefined
let completedPhase = "not-started"
let discoveredSkillRelativePath: string | undefined
let activeSkillRelativePath: string | undefined
let discoveredBrowserSkillRelativePath: string | undefined
let nativeThreadId: string | undefined
let skillCatalogSummary: unknown

try {
  await runSmoke()
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      expectedCodexVersion: CODEX_SCHEMA_VERSION,
      actualCodexVersion,
      codexBinary: codexCommand,
      discoveryOnly,
      completedPhase,
      discoveredSkillRelativePath,
      activeSkillRelativePath,
      discoveredBrowserSkillRelativePath,
      nativeThreadId,
      skillCatalogSummary,
      error: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
}

async function runSmoke(): Promise<void> {
  actualCodexVersion = await readCodexVersion(codexCommand)
  if (actualCodexVersion !== CODEX_SCHEMA_VERSION) {
    throw new Error(
      `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, but CODEX_BIN=${JSON.stringify(codexCommand)} reports ${actualCodexVersion}. Run this smoke inside the worker image or set CODEX_BIN to the fixed worker binary; a different desktop Codex version is not a deployment verification.`
    )
  }
  completedPhase = "version-verified"

  const root = await mkdirTemporaryRoot()
  let client: CodexJsonRpcClient | undefined
  let gateway: ModelGateway | undefined
  let gatewayLease: ModelGatewayLease | undefined
  try {
    const userDataRoot = path.join(root, "users")
    const manager = new WorkspaceManager(
      userDataRoot,
      path.join(repositoryRoot, "deploy/codex-home-template"),
      { ...(codexModel ? { codexModel } : {}) }
    )
    manager.bindOwner(conversationId, ownerId)
    const paths = await manager.ensureConversation(conversationId)
    const capabilitySource = path.join(root, "capability-source", skillName)
    await mkdir(capabilitySource, { recursive: true })
    await writeFile(
      path.join(capabilitySource, "SKILL.md"),
      `---
name: ${skillName}
description: Proves Codex discovers a Skill from the isolated user Skill directory.
---

When this Skill is supplied explicitly, reply with exactly this marker and nothing else: ${marker}
`
    )
    const materializedCapabilities = await new UserHomeCapabilityMaterializer({
      userDataRoot,
    }).reconcile({
      ownerId,
      conversationId,
      capabilities: [
        {
          id: capabilityId,
          name: skillName,
          type: "skill",
          sourcePath: capabilitySource,
          revision: "2026-07-24T00:00:00.000Z",
        },
      ],
    })
    await symlink(
      path.dirname(materializedCapabilities.managedAgentsRoot),
      path.join(paths.home, ".agents"),
      "dir"
    )
    const activeSkillPath = path.join(
      paths.home,
      ".agents",
      "skills",
      skillName,
      "SKILL.md"
    )
    const expectedMaterializedSkillPath = path.join(
      materializedCapabilities.skillsRoot,
      skillName,
      "SKILL.md"
    )
    const expectedBrowserSkillPath = path.join(
      materializedCapabilities.skillsRoot,
      "linksense-browser",
      "SKILL.md"
    )

    const providerKey =
      process.env.LINK_SENSE_API_KEY?.trim() ||
      runnerEnvironment.LINK_SENSE_API_KEY?.trim()
    let gatewayToken: string | undefined
    if (!discoveryOnly) {
      if (!providerKey) {
        throw new Error(
          "LINK_SENSE_API_KEY is required to verify Markdown-linked Skill execution; provide it in the process environment or deploy/runner.env, or set CODEX_DISCOVERY_ONLY=1 to verify discovery without a model request"
        )
      }
      if (!codexModel) {
        throw new Error(
          "LINKSENSE_CODEX_MODEL is required to verify Markdown-linked Skill execution; provide it in the process environment or deploy/runner.env"
        )
      }
      const providerBaseUrl =
        process.env.LINKSENSE_CODEX_BASE_URL?.trim() ||
        runnerEnvironment.LINKSENSE_CODEX_BASE_URL?.trim()
      if (!providerBaseUrl) {
        throw new Error(
          "LINKSENSE_CODEX_BASE_URL is required to verify Markdown-linked Skill execution through the managed model gateway"
        )
      }
      const protocolMode = modelProviderProtocolModeSchema.parse(
        process.env.LINKSENSE_CODEX_PROTOCOL_MODE?.trim() ||
          runnerEnvironment.LINKSENSE_CODEX_PROTOCOL_MODE?.trim() ||
          "native_responses"
      )
      gateway = new ModelGateway({
        logger: {
          warn: () => undefined,
          error: () => undefined,
        } as never,
      })
      await gateway.start()
      gatewayLease = gateway.issueLease({
        conversationId,
        ownerId,
        revision: 1,
        upstreamBaseUrl: providerBaseUrl,
        apiKey: providerKey,
        protocolMode,
        model: codexModel,
        pricing: {
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: "0",
        },
      })
      await manager.configureModelProvider(conversationId, {
        revision: 1,
        baseUrl: gateway.baseUrl,
        protocolMode,
      })
      gatewayToken = gatewayLease.token
    }
    client = createClient(paths.home, paths.codexHome, gatewayToken)
    const completedTurns = collectCompletedTurns(client)
    const initialized = await client.initialize()
    const [
      initializedCodexHomeRealPath,
      expectedCodexHomeRealPath,
      expectedUserHomeRealPath,
      materializedUserHomeRealPath,
    ] = await Promise.all([
      realpath(initialized.codexHome),
      realpath(paths.codexHome),
      realpath(paths.home),
      realpath(path.join(materializedCapabilities.ownerRoot, "home")),
    ])
    if (initializedCodexHomeRealPath !== expectedCodexHomeRealPath) {
      throw new Error(
        `Codex initialized with an unexpected home: ${JSON.stringify(initialized.codexHome)}`
      )
    }
    if (materializedUserHomeRealPath !== expectedUserHomeRealPath) {
      throw new Error(
        `Capabilities were materialized into an unexpected user HOME: ${JSON.stringify(path.join(materializedCapabilities.ownerRoot, "home"))}`
      )
    }
    completedPhase = "isolated-home-verified"

    const catalog = await client.request<{
      data: Array<{
        skills: Array<{
          name: string
          path: string
          enabled: boolean
          scope?: string
        }>
        errors?: unknown[]
      }>
    }>("skills/list", { cwds: [paths.workspace], forceReload: true })
    skillCatalogSummary = catalog.data.map((entry) => ({
      skills: entry.skills.map(({ name, enabled, scope }) => ({
        name,
        enabled,
        scope,
      })),
      errorCount: entry.errors?.length ?? 0,
    }))
    const matchingSkills = catalog.data
      .flatMap((entry) => entry.skills)
      .filter((skill) => skill.name === skillName && skill.enabled)
    const matchingBrowserSkills = catalog.data
      .flatMap((entry) => entry.skills)
      .filter((skill) => skill.name === "linksense-browser" && skill.enabled)
    if (matchingSkills.length !== 1) {
      throw new Error(
        `Expected exactly one enabled ${skillName} Skill, but skills/list returned ${matchingSkills.length}`
      )
    }
    if (matchingBrowserSkills.length !== 1) {
      throw new Error(
        `Expected exactly one enabled linksense-browser Skill, but skills/list returned ${matchingBrowserSkills.length}`
      )
    }
    const selectedSkill = matchingSkills[0]
    const selectedBrowserSkill = matchingBrowserSkills[0]
    if (!selectedSkill) {
      throw new Error(`${skillName} Skill was not discovered`)
    }
    if (!selectedBrowserSkill) {
      throw new Error("linksense-browser Skill was not discovered")
    }
    const [discoveredRealPath, expectedRealPath, activeRealPath] =
      await Promise.all([
        realpath(selectedSkill.path),
        realpath(expectedMaterializedSkillPath),
        realpath(activeSkillPath),
      ])
    if (discoveredRealPath !== expectedRealPath) {
      throw new Error(
        `Codex discovered ${skillName} from the wrong location: expected ${JSON.stringify(expectedRealPath)}, received ${JSON.stringify(discoveredRealPath)}`
      )
    }
    if (activeRealPath !== expectedRealPath) {
      throw new Error(
        `The active .agents/skills entry does not resolve to the published user Skill: expected ${JSON.stringify(expectedRealPath)}, received ${JSON.stringify(activeRealPath)}`
      )
    }
    const [discoveredBrowserRealPath, expectedBrowserRealPath] =
      await Promise.all([
        realpath(selectedBrowserSkill.path),
        realpath(expectedBrowserSkillPath),
      ])
    if (discoveredBrowserRealPath !== expectedBrowserRealPath) {
      throw new Error(
        `Codex discovered linksense-browser from the wrong location: expected ${JSON.stringify(expectedBrowserRealPath)}, received ${JSON.stringify(discoveredBrowserRealPath)}`
      )
    }
    discoveredSkillRelativePath = path.relative(
      expectedUserHomeRealPath,
      discoveredRealPath
    )
    activeSkillRelativePath = path.relative(paths.home, activeSkillPath)
    discoveredBrowserSkillRelativePath = path.relative(
      expectedUserHomeRealPath,
      discoveredBrowserRealPath
    )
    completedPhase = "skill-discovered"

    if (discoveryOnly) {
      console.log(
        JSON.stringify({
          status: "ok",
          mode: "discovery-only",
          codexBinary: codexCommand,
          expectedCodexVersion: CODEX_SCHEMA_VERSION,
          actualCodexVersion,
          codexHomeIsolated: true,
          skillRoot: "$HOME/.agents/skills",
          activeSkillRelativePath,
          discoveredSkill: {
            name: selectedSkill.name,
            relativePath: discoveredSkillRelativePath,
          },
          discoveredBuiltInBrowserSkill: {
            name: selectedBrowserSkill.name,
            relativePath: discoveredBrowserSkillRelativePath,
          },
          markdownSkillExecuted: false,
          nativeThreadResumed: false,
        })
      )
      return
    }
    const started = await client.request<{ thread: CodexThread }>(
      "thread/start",
      {
        model: codexModel,
        cwd: paths.workspace,
        runtimeWorkspaceRoots: [paths.workspace],
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        ephemeral: false,
      }
    )
    nativeThreadId = started.thread.id
    const turn = await client.request<{ turn: CodexTurn }>("turn/start", {
      threadId: started.thread.id,
      model: codexModel,
      clientUserMessageId: projectionId,
      input: [
        {
          type: "text",
          text: `${serializePromptLink(`$${selectedSkill.name}`, selectedSkill.path)} Follow the selected Skill.`,
          text_elements: [],
        },
      ],
      cwd: paths.workspace,
      runtimeWorkspaceRoots: [paths.workspace],
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    })
    const completed = await completedTurns.wait(turn.turn.id)
    if (completed.status !== "completed") {
      throw new Error(
        `Markdown Skill turn did not complete: ${JSON.stringify(completed.error)}`
      )
    }
    const thread = await client.request<{ thread: CodexThread }>(
      "thread/read",
      {
        threadId: started.thread.id,
        includeTurns: true,
      }
    )
    const answer = agentText(requiredTurn(thread.thread, turn.turn.id))
    if (answer.trim() !== marker) {
      throw new Error(
        `Codex did not execute the discovered Markdown-linked Skill: ${JSON.stringify(answer)}`
      )
    }
    completedPhase = "markdown-skill-executed"

    await client.close()
    client = createClient(paths.home, paths.codexHome, gatewayToken)
    await client.initialize()
    const resumed = await client.request<{ thread: CodexThread }>(
      "thread/resume",
      {
        threadId: started.thread.id,
        model: codexModel,
        cwd: paths.workspace,
        runtimeWorkspaceRoots: [paths.workspace],
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        excludeTurns: true,
      }
    )
    if (resumed.thread.id !== started.thread.id) {
      throw new Error(
        `Codex resumed a different native thread: expected ${started.thread.id}, received ${resumed.thread.id}`
      )
    }
    completedPhase = "thread-resumed"

    console.log(
      JSON.stringify({
        status: "ok",
        codexBinary: codexCommand,
        expectedCodexVersion: CODEX_SCHEMA_VERSION,
        actualCodexVersion,
        codexHomeIsolated: true,
        skillRoot: "$HOME/.agents/skills",
        activeSkillRelativePath,
        discoveredSkill: {
          name: selectedSkill.name,
          relativePath: discoveredSkillRelativePath,
        },
        markdownSkillExecuted: true,
        nativeThreadResumed: true,
        nativeThreadId: started.thread.id,
        nativeTurnId: turn.turn.id,
      })
    )
  } finally {
    await client?.close().catch(() => undefined)
    gatewayLease?.release()
    await gateway?.close().catch(() => undefined)
    await makeDirectoryTreeRemovable(root).catch(() => undefined)
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  }
}

async function mkdirTemporaryRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "linksense-codex-skill-smoke-"))
}

async function readRunnerEnvironment(): Promise<Record<string, string>> {
  try {
    return parseEnvironmentFile(
      await readFile(path.join(repositoryRoot, "deploy/runner.env"), "utf8")
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
}

function parseEnvironmentFile(source: string): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u
    )
    const name = match?.[1]
    const rawValue = match?.[2]
    if (!name || rawValue === undefined) continue
    environment[name] = parseEnvironmentValue(rawValue)
  }
  return environment
}

function parseEnvironmentValue(rawValue: string): string {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      return JSON.parse(rawValue) as string
    } catch {
      throw new Error("deploy/runner.env contains an invalid quoted value")
    }
  }
  if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1)
  }
  return rawValue.replace(/\s+#.*$/u, "").trim()
}

async function readCodexVersion(command: string): Promise<string> {
  let output: string
  try {
    const result = await execFileAsync(command, ["--version"], {
      env: process.env,
      timeout: 30_000,
    })
    output = `${result.stdout}\n${result.stderr}`
  } catch (error) {
    throw new Error(
      `Unable to execute CODEX_BIN=${JSON.stringify(command)} --version: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const match = output.match(/\bcodex-cli\s+(\d+\.\d+\.\d+)\b/u)
  if (!match?.[1]) {
    throw new Error(
      `Unable to parse Codex version from CODEX_BIN=${JSON.stringify(command)} output: ${JSON.stringify(output.trim())}`
    )
  }
  return match[1]
}

function createClient(
  userHome: string,
  codexHome: string,
  gatewayToken: string | undefined
): CodexJsonRpcClient {
  return new CodexJsonRpcClient({
    command: codexCommand,
    userHome,
    codexHome,
    logger: {
      warn: () => undefined,
      error: () => undefined,
    } as never,
    requestTimeoutMs: 180_000,
    extraEnvironment: {
      ...(gatewayToken
        ? { [modelGatewayEnvironmentKey]: gatewayToken }
        : {}),
      ...(runnerEnvironment.HTTP_PROXY?.trim()
        ? { HTTP_PROXY: runnerEnvironment.HTTP_PROXY.trim() }
        : {}),
      ...(runnerEnvironment.HTTPS_PROXY?.trim()
        ? { HTTPS_PROXY: runnerEnvironment.HTTPS_PROXY.trim() }
        : {}),
      ...(runnerEnvironment.NO_PROXY?.trim()
        ? { NO_PROXY: runnerEnvironment.NO_PROXY.trim() }
        : {}),
    },
  })
}

function collectCompletedTurns(client: CodexJsonRpcClient): {
  wait(turnId: string): Promise<CodexTurn>
} {
  const completed = new Map<string, CodexTurn>()
  const waiters = new Map<
    string,
    { resolve: (turn: CodexTurn) => void; reject: (error: Error) => void }
  >()
  client.on("notification", (notification: JsonRpcNotification) => {
    if (notification.method !== "turn/completed") return
    const turn = (notification.params as { turn?: CodexTurn } | undefined)?.turn
    if (!turn?.id) return
    const waiter = waiters.get(turn.id)
    if (waiter) {
      waiters.delete(turn.id)
      waiter.resolve(turn)
    } else {
      completed.set(turn.id, turn)
    }
  })
  return {
    wait(turnId) {
      const existing = completed.get(turnId)
      if (existing) return Promise.resolve(existing)
      return new Promise<CodexTurn>((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(turnId)
          reject(new Error(`timed out waiting for Codex turn ${turnId}`))
        }, 180_000)
        timeout.unref()
        waiters.set(turnId, {
          resolve: (turn) => {
            clearTimeout(timeout)
            resolve(turn)
          },
          reject,
        })
      })
    },
  }
}

function agentText(turn: CodexTurn): string {
  return turn.items
    .filter(
      (
        item
      ): item is Extract<
        (typeof turn.items)[number],
        { type: "agentMessage" }
      > => item.type === "agentMessage"
    )
    .map((item) => item.text)
    .join("\n")
}

function requiredTurn(thread: CodexThread, turnId: string): CodexTurn {
  const turn = thread.turns?.find((candidate) => candidate.id === turnId)
  if (!turn) throw new Error(`Codex thread is missing turn ${turnId}`)
  return turn
}
