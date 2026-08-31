import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseEnv } from "node:util"

import { modelProviderProtocolModeSchema } from "@linksense/shared"

import { UserHomeCapabilityMaterializer } from "../apps/api/src/modules/capabilities/user-home-materializer.ts"
import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts"
import type {
  CodexThread,
  CodexTurn,
  JsonRpcNotification,
} from "../apps/runner/src/codex/protocol.ts"
import {
  ModelGateway,
  modelGatewayEnvironmentKey,
} from "../apps/runner/src/model-gateway/model-gateway.ts"
import { makeDirectoryTreeRemovable } from "../apps/runner/src/workspace/filesystem.ts"
import { WorkspaceManager } from "../apps/runner/src/workspace/workspace-manager.ts"

const repositoryRoot = path.resolve(import.meta.dirname, "..")
const runnerEnvironment = parseEnv(
  await readFile(path.join(repositoryRoot, "deploy/runner.env"), "utf8")
)
const configuredProviderKey = runnerEnvironment.LINK_SENSE_API_KEY?.trim()
if (!configuredProviderKey) {
  throw new Error("LINK_SENSE_API_KEY is required in deploy/runner.env")
}
const providerKey: string = configuredProviderKey
const codexModel = runnerEnvironment.LINKSENSE_CODEX_MODEL?.trim()
if (!codexModel) {
  throw new Error("LINKSENSE_CODEX_MODEL is required in deploy/runner.env")
}
const providerBaseUrl =
  process.env.LINKSENSE_CODEX_BASE_URL?.trim() ||
  runnerEnvironment.LINKSENSE_CODEX_BASE_URL?.trim()
if (!providerBaseUrl) {
  throw new Error(
    "LINKSENSE_CODEX_BASE_URL is required in the process environment or deploy/runner.env",
  )
}
const protocolMode = modelProviderProtocolModeSchema.parse(
  process.env.LINKSENSE_CODEX_PROTOCOL_MODE?.trim() ||
    runnerEnvironment.LINKSENSE_CODEX_PROTOCOL_MODE?.trim() ||
    "native_responses",
)

const root = await mkdtemp(path.join(tmpdir(), "linksense-codex-thread-smoke-"))
const conversationId = "01900000-0000-7000-8000-000000000201"
const ownerId = "01900000-0000-7000-8000-000000000202"
const capabilityId = "01900000-0000-7000-8000-000000000203"
const firstProjectionId = "01900000-0000-7000-8000-000000000204"
const secondProjectionId = "01900000-0000-7000-8000-000000000205"
const structuredMarker = "STRUCTURED_SKILL_INJECTION_7F4A2C"
const contextMarker = "THREAD_CONTEXT_ALPHA_8D31B9"
const userDataRoot = path.join(root, "users")
const manager = new WorkspaceManager(
  userDataRoot,
  path.join(repositoryRoot, "deploy/codex-home-template"),
  { codexModel }
)
manager.bindOwner(conversationId, ownerId)
const paths = await manager.ensureConversation(conversationId, "smoke")
const capabilitySource = path.join(root, "structured-smoke")
await mkdir(capabilitySource, { recursive: true })
await writeFile(
  path.join(capabilitySource, "SKILL.md"),
  `---
name: structured-smoke
description: Proves that a structured Codex skill input was injected.
---

Reply with exactly this marker and nothing else: ${structuredMarker}
`
)
const capabilityMaterializer = new UserHomeCapabilityMaterializer({
  userDataRoot,
})
const logger = {
  warn: () => undefined,
  error: () => undefined,
} as never
const gateway = new ModelGateway({ logger })
await gateway.start()
const gatewayLease = gateway.issueLease({
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
let firstClient: CodexJsonRpcClient | undefined
let secondClient: CodexJsonRpcClient | undefined

try {
  await manager.configureModelProvider(conversationId, {
    revision: 1,
    baseUrl: gateway.baseUrl,
    protocolMode,
  })
  const materialized = await capabilityMaterializer.reconcile({
    ownerId,
    capabilities: [
      {
        id: capabilityId,
        name: "structured-smoke",
        type: "skill",
        sourcePath: capabilitySource,
        revision: "2026-07-24T00:00:00.000Z",
      },
    ],
  })
  await symlink(
    materialized.managedAgentsRoot,
    path.join(paths.home, ".agents"),
    "dir"
  )
  const [materializedHome, expectedHome] = await Promise.all([
    realpath(path.join(materialized.ownerRoot, "home")),
    realpath(paths.home),
  ])
  if (materializedHome !== expectedHome) {
    throw new Error(
      "capabilities were materialized into an unexpected user HOME"
    )
  }
  firstClient = createClient(
    paths.home,
    paths.codexHome,
    gatewayLease.token,
  )
  const firstTurns = collectCompletedTurns(firstClient)
  await firstClient.initialize()
  const catalog = await firstClient.request<{
    data: Array<{
      skills: Array<{ name: string; path: string; enabled: boolean }>
    }>
  }>("skills/list", { cwds: [paths.workspace], forceReload: true })
  const selectedSkill = catalog.data[0]?.skills.find(
    (skill) => skill.name === "structured-smoke" && skill.enabled
  )
  if (!selectedSkill)
    throw new Error("structured smoke skill was not discovered")
  const [discoveredSkillPath, expectedSkillPath] = await Promise.all([
    realpath(selectedSkill.path),
    realpath(
      path.join(paths.home, ".agents", "skills", "structured-smoke", "SKILL.md")
    ),
  ])
  if (discoveredSkillPath !== expectedSkillPath) {
    throw new Error("structured smoke skill was discovered outside user HOME")
  }
  const started = await firstClient.request<{ thread: CodexThread }>(
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
  const first = await firstClient.request<{ turn: CodexTurn }>("turn/start", {
    threadId: started.thread.id,
    model: codexModel,
    clientUserMessageId: firstProjectionId,
    input: [
      {
        type: "text",
        text: `Use the structured skill supplied with this turn. Do not read files or run commands. Remember ${contextMarker} for the next turn.`,
        text_elements: [],
      },
      {
        type: "skill",
        name: selectedSkill.name,
        path: selectedSkill.path,
      },
    ],
    cwd: paths.workspace,
    runtimeWorkspaceRoots: [paths.workspace],
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  })
  await firstTurns.wait(first.turn.id)
  const firstThread = await firstClient.request<{ thread: CodexThread }>(
    "thread/read",
    { threadId: started.thread.id, includeTurns: true }
  )
  const firstTurn = requiredTurn(firstThread.thread, first.turn.id)
  const firstAnswer = agentText(firstTurn)
  if (!firstAnswer.includes(structuredMarker)) {
    throw new Error(
      `Codex did not inject the selected structured skill: answer=${JSON.stringify(firstAnswer)}, status=${firstTurn.status}, error=${JSON.stringify(firstTurn.error?.message ?? null)}`
    )
  }
  await firstClient.close()
  firstClient = undefined

  await capabilityMaterializer.reconcile({ ownerId, capabilities: [] })
  secondClient = createClient(
    paths.home,
    paths.codexHome,
    gatewayLease.token,
  )
  const secondTurns = collectCompletedTurns(secondClient)
  await secondClient.initialize()
  const resumed = await secondClient.request<{ thread: CodexThread }>(
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
    throw new Error("Codex resumed a different native thread")
  }
  const second = await secondClient.request<{ turn: CodexTurn }>("turn/start", {
    threadId: started.thread.id,
    model: codexModel,
    clientUserMessageId: secondProjectionId,
    input: [
      {
        type: "text",
        text: "Reply with only the marker I explicitly asked you to remember in my previous user message.",
        text_elements: [],
      },
    ],
    additionalContext: {
      "linksense.current-skill-catalog": {
        kind: "application",
        value:
          "<linksense_current_skill_catalog>\n- none\nEarlier skill locators are expired.\n</linksense_current_skill_catalog>",
      },
    },
    cwd: paths.workspace,
    runtimeWorkspaceRoots: [paths.workspace],
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  })
  await secondTurns.wait(second.turn.id)
  const secondThread = await secondClient.request<{ thread: CodexThread }>(
    "thread/read",
    { threadId: started.thread.id, includeTurns: true }
  )
  const secondAnswer = agentText(
    requiredTurn(secondThread.thread, second.turn.id)
  )
  if (!secondAnswer.includes(contextMarker)) {
    throw new Error("the resumed Codex thread did not carry prior user context")
  }
  await secondClient.close()
  secondClient = undefined

  console.log(
    JSON.stringify({
      status: "ok",
      nativeThreadId: started.thread.id,
      nativeTurnIds: [first.turn.id, second.turn.id],
      structuredSkillInjected: true,
      priorContextRetained: true,
    })
  )
} finally {
  await Promise.all([
    firstClient?.close().catch(() => undefined),
    secondClient?.close().catch(() => undefined),
  ])
  gatewayLease.release()
  await gateway.close().catch(() => undefined)
  await makeDirectoryTreeRemovable(root).catch(() => undefined)
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
}

function createClient(
  userHome: string,
  codexHome: string,
  gatewayToken: string,
): CodexJsonRpcClient {
  return new CodexJsonRpcClient({
    command: process.env.CODEX_BIN?.trim() || "codex",
    userHome,
    codexHome,
    logger,
    requestTimeoutMs: 180_000,
    extraEnvironment: {
      [modelGatewayEnvironmentKey]: gatewayToken,
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
