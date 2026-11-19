import { createHash, randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  desktopExecutionAckSchema,
  type DesktopArtifactUploadGrant,
  type DesktopToolOperation,
} from "@linksense/shared"
import pino from "pino"
import { afterEach, expect, it, onTestFinished, vi } from "vitest"

import { desktopWorkerSecret } from "../src/controller/desktop-worker-provider.js"
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js"
import { verifyDirectory } from "../src/desktop/attachments.js"
import { DesktopLink } from "../src/desktop/link.js"
import { DesktopTurns, type DesktopRuntimeRun } from "../src/desktop/turns.js"
import { desktopWorkerCallbacks } from "../src/desktop/worker-callbacks.js"
import { fileServiceCoreMcpModule } from "../src/mcp/core-services/file-service.js"
import { deferred } from "./deferred.js"

vi.mock("undici", async (load) => ({
  ...await load<typeof import("undici")>(),
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}))

const logger = pino({ enabled: false })
const origin = "https://server.example.test"
const localSecret = "a".repeat(64)

afterEach(() => vi.unstubAllGlobals())

type SeenFrame = { type?: string; operation?: string; id?: string; body?: unknown }

function createProvider(root: string): ConstructorParameters<typeof DesktopTurns>[0] {
  return {
    pathsFor(ownerId: string, conversationId: string): WorkerOwnerPaths {
      const owner = path.join(root, ownerId, "services", conversationId)
      const home = path.join(owner, "home")
      const managed = path.join(owner, "managed")
      const managedAgents = path.join(managed, "agents")
      return {
        root, owner, home, homeAgentsMountpoint: path.join(home, ".agents"), managed, managedAgents,
        managedSkills: path.join(managedAgents, "skills"),
        managedPluginSources: path.join(managedAgents, "plugin-sources"),
        managedPlugins: path.join(managedAgents, "plugins"),
        control: path.join(owner, "control"),
        workspaces: path.join(home, "projects"),
      }
    },
    prepareOwnerFilesystem: async () => {},
    acquire: async () => { throw new Error("artifact fixture must not acquire a worker") },
    inspect: async () => "running" as const,
    request: async () => { throw new Error("artifact fixture must not reach a worker") },
    release: async () => {},
    stopWorkers: async () => {},
  }
}

async function artifactFixture(operations: readonly DesktopToolOperation[] = ["artifact.prepare"]) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-artifact-callback-"))
  const provider = createProvider(root)
  const turns = new DesktopTurns(provider, root, origin, vi.fn(), logger, operations)
  const scope = {
    owner_id: randomUUID(), conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(),
  }
  const workspace = path.join(provider.pathsFor(scope.owner_id, scope.conversation_id).home, "workspace")
  const artifactDirectory = path.join(workspace, "artifacts")
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
  const bytes = Buffer.from("desktop artifact bytes")
  const file = path.join(artifactDirectory, "report.txt")
  await writeFile(file, bytes)

  const stop = new AbortController()
  const pinned = operations.includes("artifact.prepare") ? await verifyDirectory(root, workspace) : undefined
  const timer = setTimeout(() => {}, 60_000)
  timer.unref()
  const run: DesktopRuntimeRun = {
    scope, token: `lsdr_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000, timer,
    ...(pinned && {
      artifacts: { workspace: pinned.path, check: pinned.check, signal: stop.signal },
    }),
  }
  vi.spyOn(turns, "scopedRun").mockReturnValue(run)

  const artifactId = randomUUID()
  const grant: DesktopArtifactUploadGrant = {
    artifact_id: artifactId,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    destination: { kind: "api" },
  }
  const receipt = {
    success: true as const,
    artifact_id: artifactId,
    file_id: artifactId,
    display_name: "report.txt",
    download_card_event_id: randomUUID(),
  }
  const frames: SeenFrame[] = []
  const fail = vi.fn()
  const write = async (output: { type: string; frame?: unknown }): Promise<void> => {
    const frame = output.frame as SeenFrame | undefined
    if (!frame) return
    frames.push(frame)
    if (frame.type === "tool.request" && frame.operation === "artifact.prepare" && typeof frame.id === "string") {
      link.receive(desktopExecutionAckSchema.parse({
        type: "tool.result", id: frame.id, operation: "artifact.prepare", ok: true, data: grant,
      }))
    }
  }
  const link = new DesktopLink(randomUUID(), scope.owner_id, turns, write, fail, operations)
  const callbacks = desktopWorkerCallbacks(localSecret, () => ({ link, turns }), origin)
  const address = await callbacks.listen({ host: "127.0.0.1", port: 0 })

  const authorization = `Bearer ${desktopWorkerSecret(scope.owner_id, localSecret, scope.conversation_id, {
    turnId: scope.turn_id, runtimeGeneration: scope.runtime_generation,
  })}`
  // The test stubs global fetch for artifact bytes; the local supervisor call
  // must keep using the real transport.
  const localFetch = globalThis.fetch
  const request = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    localFetch(`${address}/internal/file-service/register-artifact`, {
      method: "POST",
      headers: {
        authorization, "content-type": "application/json",
        "x-linksense-owner-id": scope.owner_id, "x-linksense-service-session": scope.conversation_id,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    })
  const body = {
    conversationId: scope.conversation_id,
    turnId: scope.turn_id,
    workspaceRelativePath: "artifacts/report.txt",
    displayName: "report.txt",
    mimeType: "text/plain",
  }

  onTestFinished(async () => {
    await link.close()
    await callbacks.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, workspace, bytes, run, stop, link, frames, fail, request, body, receipt, artifactId, scope }
}

async function drainBody(init?: RequestInit): Promise<number> {
  const body = init?.body
  if (!body || typeof body !== "object" || !("getReader" in body)) return 0
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return bytes
    bytes += value.byteLength
  }
}

it("refuses a workspace alias substituted after the run was admitted", async () => {
  const fixture = await artifactFixture()
  const movedWorkspace = `${fixture.workspace}-moved`
  await rename(fixture.workspace, movedWorkspace)
  await symlink(movedWorkspace, fixture.workspace)
  const response = await fixture.request(fixture.body)
  expect(response.status).toBe(403)
  expect(fixture.frames).toEqual([])
})

it("uploads a verified local file with no workspace path in the device frame", async () => {
  const fixture = await artifactFixture()
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const href = String(url)
    if (href.endsWith("/upload")) {
      expect(await drainBody(init)).toBe(fixture.bytes.byteLength)
      return new Response(null, { status: 200 })
    }
    if (href.endsWith("/confirm")) return Response.json(fixture.receipt)
    throw new Error(`unexpected artifact request ${href}`)
  })
  vi.stubGlobal("fetch", fetchMock)

  const response = await fixture.request(fixture.body)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(fixture.receipt)

  const prepare = fixture.frames.find(frame => frame.type === "tool.request" && frame.operation === "artifact.prepare")
  expect(prepare?.body).toEqual({
    filename: "report.txt",
    display_name: "report.txt",
    mime_type: "text/plain",
    size_bytes: fixture.bytes.byteLength,
    sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
  })
  expect(JSON.stringify(prepare)).not.toContain(fixture.workspace)
  const requested = fetchMock.mock.calls.map(([url]) => String(url))
  expect(requested).toEqual([
    `${origin}/api/v1/desktop/artifacts/${fixture.scope.turn_id}/${fixture.artifactId}/upload`,
    `${origin}/api/v1/desktop/artifacts/${fixture.scope.turn_id}/${fixture.artifactId}/confirm`,
  ])
  for (const url of requested) expect(url).not.toContain(fixture.workspace)
})

it("rejects a website root before any file access or tool request", async () => {
  const fixture = await artifactFixture()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetchMock)

  const response = await fixture.request({ ...fixture.body, webRootRelativePath: "artifacts/site" })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ code: "ARTIFACT_REGISTRATION_INVALID", retryable: false })
  expect(fixture.frames).toEqual([])
  expect(fetchMock).not.toHaveBeenCalled()
})

it("refuses artifact registration when the link did not negotiate artifact.prepare", async () => {
  const fixture = await artifactFixture([])
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetchMock)

  const response = await fixture.request(fixture.body)
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({ code: "FILE_SERVICE_FORBIDDEN", retryable: false })
  expect(fixture.frames).toEqual([])
  expect(fetchMock).not.toHaveBeenCalled()
})

it("binds the callback to the exact conversation, turn and worker bearer", async () => {
  const fixture = await artifactFixture()
  const fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetchMock)

  const wrongTurn = await fixture.request({ ...fixture.body, turnId: randomUUID() })
  expect(wrongTurn.status).toBe(403)
  const wrongBearer = await fixture.request(fixture.body, { authorization: "Bearer wrong" })
  expect(wrongBearer.status).toBe(503)
  const invalid = await fixture.request({ ...fixture.body, displayName: "" })
  expect(invalid.status).toBe(400)
  expect(fixture.frames).toEqual([])
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each(["link close", "stop"] as const)("aborts an in-flight upload on %s without replaying it", async reason => {
  const fixture = await artifactFixture()
  const started = deferred<void>()
  const fetchMock = vi.fn<typeof fetch>((_url, init) => {
    started.resolve()
    const signal = init?.signal
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new Error("aborted"))
      if (signal?.aborted) abort()
      else signal?.addEventListener("abort", abort, { once: true })
    })
  })
  vi.stubGlobal("fetch", fetchMock)

  const pending = fixture.request(fixture.body)
  await started.promise
  if (reason === "link close") await fixture.link.close()
  else fixture.stop.abort()

  const response = await pending
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ code: "ARTIFACT_REGISTRATION_UNAVAILABLE", retryable: true })
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/upload$/u)
})

it("keeps desktop register_artifact local without shared permission changes", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "linksense-desktop-file-mcp-"))
  onTestFinished(() => rm(workspace, { recursive: true, force: true }))
  const directory = path.join(workspace, "generated")
  const file = path.join(directory, "report.txt")
  await mkdir(directory, { recursive: true })
  await writeFile(file, "report", { mode: 0o600 })
  await chmod(directory, 0o700)
  await chmod(file, 0o600)
  const receipt = {
    success: true,
    artifact_id: randomUUID(),
    file_id: randomUUID(),
    display_name: "report.txt",
    download_card_event_id: randomUUID(),
  }
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(receipt))
  vi.stubGlobal("fetch", fetchMock)
  const module = fileServiceCoreMcpModule.create({
    environment: {
      LINKSENSE_FILE_SERVICE_ENDPOINT: `${origin}/register-artifact?desktop=1`,
      LINKSENSE_FILE_SERVICE_TOKEN: "b".repeat(32),
      LINKSENSE_CONVERSATION_ID: randomUUID(),
    },
    workspaceRoot: workspace,
  })

  const result = await module.callTool({
    toolName: "register_artifact",
    argumentsValue: {
      workspace_relative_path: "generated/report.txt",
      display_name: "report.txt",
      mime_type: "text/plain",
      artifact_kind: "text",
    },
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(false)
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    workspaceRelativePath: "generated/report.txt",
    displayName: "report.txt",
    mimeType: "text/plain",
    artifactKind: "text",
  })
  expect((await lstat(directory)).mode & 0o7777).toBe(0o700)
  expect((await lstat(file)).mode & 0o777).toBe(0o600)

  const rejected = await module.callTool({
    toolName: "register_artifact",
    argumentsValue: {
      workspace_relative_path: "generated/report.txt",
      display_name: "report.txt",
      web_root_relative_path: "generated",
    },
    signal: new AbortController().signal,
  })
  expect(rejected.isError).toBe(true)
  expect(JSON.parse(String((rejected.content[0] as { text: string }).text))).toEqual({
    code: "ARTIFACT_REGISTRATION_INVALID",
    retryable: false,
  })
  expect(fetchMock).toHaveBeenCalledOnce()
  expect((await lstat(directory)).mode & 0o7777).toBe(0o700)
  expect((await lstat(file)).mode & 0o777).toBe(0o600)
})
