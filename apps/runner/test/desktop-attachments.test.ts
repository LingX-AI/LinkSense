import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { desktopExecutionCommandSchema, type DesktopAttachment } from "@linksense/shared"
import pino from "pino"
import { afterEach, expect, it, onTestFinished, vi } from "vitest"
import { DesktopWorkerProvider, desktopWorkerSecret } from "../src/controller/desktop-worker-provider.js"
import { prepareDesktopAttachments } from "../src/desktop/attachments.js"
import { DesktopLink } from "../src/desktop/link.js"
import { DesktopTurns } from "../src/desktop/turns.js"
import { desktopWorkerCallbacks } from "../src/desktop/worker-callbacks.js"
import { StartOperationStore } from "../src/start-operation.js"
import { prepareConversationControl, WorkspaceManager } from "../src/workspace/workspace-manager.js"
import { deferred } from "./deferred.js"

const logger = pino({ enabled: false })
const origin = "https://server.example.test"

async function fixture(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-input-"))
  const provider = new DesktopWorkerProvider({ dataRoot: path.join(root, "sessions"), runtimeRoot: root, controlToken: "a".repeat(64) }, logger)
  const workerLost = vi.fn()
  const turns = new DesktopTurns(provider, root, origin, workerLost, logger)
  onTestFinished(async () => {
    try { await turns.shutdown(); await provider.shutdown() } finally { await rm(root, { recursive: true, force: true }) }
  })
  const generation = "0".repeat(64)
  const bundle = path.join(root, "capabilities")
  for (const name of ["skills", "plugins", "plugin-sources"]) await mkdir(path.join(bundle, name), { recursive: true })
  await writeFile(path.join(bundle, "capability-snapshot.json"), JSON.stringify({
    version: 1, id: `${generation}-${randomUUID()}`, generation, contentDigest: generation, sourceDigest: generation, pluginNames: [],
  }))
  const scope = { owner_id: randomUUID(), conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID() }
  const paths = provider.pathsFor(scope.owner_id, scope.conversation_id)
  const expiry = Date.now() + 20_000
  const expires_at = new Date(expiry).toISOString()
  const commandId = randomUUID()
  const data = Buffer.from("approved fixture bytes")
  const manifest: DesktopAttachment = {
    id: randomUUID(), filename: "Résumé 进度.txt", size_bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"), download_grant: `${expiry}.${commandId}.${"a".repeat(64)}`,
  }
  const command = desktopExecutionCommandSchema.parse({
    ...scope, type: "command", id: commandId, expires_at, operation: "turn.start",
    body: { native_thread_id: null, input: "", reasoning_effort: "low", attachments: [manifest], credentials: {
      turn_id: scope.turn_id, expires_at, run_token: `lsdr_${"a".repeat(43)}`,
      primary: { purpose: "primary", token: `lsdm_${"b".repeat(43)}`, model: "fixture", revision: 1, protocol_mode: "native_responses" },
    } },
  })
  if (command.operation !== "turn.start") throw new Error("Missing attachment start")
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetcher)
  const acquire = vi.spyOn(provider, "acquire").mockResolvedValue({
    id: randomUUID(), ownerId: scope.owner_id, serviceSessionId: scope.conversation_id,
    storageKey: scope.conversation_id, name: "fixture", endpoint: "http://127.0.0.1:1", state: "running",
  })
  const ready = vi.fn(async () => {})
  const request = vi.spyOn(provider, "request").mockImplementation(async (_worker, route) => {
    if (route === "/health/ready") return Response.json({ status: "available" })
    return Response.json({
      status: "succeeded", createdAt: expires_at, updatedAt: expires_at,
      conversationId: scope.conversation_id, projectionTurnId: scope.turn_id,
      result: { codexTurnId: randomUUID(), codexThreadId: randomUUID() },
    })
  })
  const response = (bytes = data, headers?: Record<string, string>) =>
    new Response(Uint8Array.from(bytes), { headers: {
      "content-type": "application/octet-stream", "content-length": String(data.length), ...headers,
    } })
  const stop = desktopExecutionCommandSchema.parse({ ...scope, type: "command", id: randomUUID(), expires_at, operation: "turn.interrupt" })
  const run = (signal = AbortSignal.timeout(5_000)) => turns.execute(command, signal, { attachmentsReady: ready })
  return { turns, provider, paths, command, fetcher, manifest, data, acquire, ready, request, response, run, stop }
}

afterEach(() => vi.unstubAllGlobals())

it("makes a verified attachment available before acknowledging readiness or submitting Codex", async ({ onTestFinished }) => {
  const { paths, command, fetcher, manifest, data, ready, request, response, run, acquire } = await fixture(onTestFinished)
  fetcher.mockResolvedValue(response())
  const localPath = async () => {
    const parent = path.join(paths.home, "workspace", "attachments")
    const [folder] = await readdir(parent)
    if (!folder) throw new Error("Attachment was not published")
    return `workspace/attachments/${folder}/${manifest.id}/${manifest.filename}`
  }
  ready.mockImplementation(async () => {
    expect(acquire).not.toHaveBeenCalled()
    expect(await readFile(path.join(paths.home, await localPath()))).toEqual(data)
  })
  expect(await run()).toMatchObject({ ok: true })
  expect(fetcher).toHaveBeenCalledWith(
    new URL(`/api/v1/desktop/attachments/${command.turn_id}/${manifest.id}`, origin),
    expect.objectContaining({
      redirect: "error",
      headers: expect.objectContaining({ "x-linksense-desktop-attachment-grant": manifest.download_grant }),
    }),
  )
  expect(request).toHaveBeenLastCalledWith(expect.anything(), expect.stringMatching(/\/turns\/start$/u), expect.anything(), expect.objectContaining({
    context: { userInput: "", attachments: [{ filename: manifest.filename, homeRelativePath: await localPath() }], priorityPlugins: [], prioritySkills: [] },
  }))
  expect(ready).toHaveBeenCalledOnce()
})

it.each(["checksum", "length", "refused", "redirect"] as const)("does not submit or publish a file on %s failure", async failure => {
  const { paths, fetcher, acquire, ready, response, run, data } = await fixture(onTestFinished)
  fetcher.mockResolvedValue(failure === "refused" ? new Response(null, { status: 403 })
    : failure === "redirect" ? Response.redirect("https://wrong.example.test")
    : failure === "checksum" ? response(Buffer.alloc(data.length))
    : response(data.subarray(0, 1)))
  expect(await run()).toMatchObject({ ok: false, error_code: "ATTACHMENT_UPLOAD_INVALID" })
  expect(acquire).not.toHaveBeenCalled()
  expect(ready).not.toHaveBeenCalled()
  expect(await readdir(path.join(paths.home, "workspace", "attachments"))).toEqual([])
  expect((await readdir(paths.control)).some(name => name.startsWith("attachments-"))).toBe(false)
})

it("leaves the original file untouched when the attachment parent is a symlink", async ({ onTestFinished }) => {
  const { paths, provider, fetcher, acquire, run, command } = await fixture(onTestFinished)
  await provider.prepareOwnerFilesystem(paths)
  await symlink(paths.control, path.join(paths.home, "workspace", "attachments"))
  expect(await run()).toMatchObject({ ok: false, error_code: "ATTACHMENT_UPLOAD_INVALID" })
  expect(fetcher).not.toHaveBeenCalled()
  expect(acquire).not.toHaveBeenCalled()
  expect((await readdir(paths.control)).some(name => name.startsWith(`attachments-${command.turn_id}`))).toBe(false)
})

it("stops an in-flight attachment download, clears staging, and seals the unstarted turn", async ({ onTestFinished }) => {
  const { paths, turns, fetcher, stop, acquire, ready, run } = await fixture(onTestFinished)
  const fetching = deferred<void>()
  fetcher.mockImplementation(async (_url, options) => {
    fetching.resolve()
    const signal = options?.signal
    if (!signal) throw new Error("Missing fetch signal")
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  })
  const start = run()
  await fetching.promise
  expect(await turns.execute(stop, AbortSignal.timeout(5_000))).toMatchObject({ ok: true, result: { code: "TURN_INTERRUPT_REQUESTED" } })
  expect(await start).toMatchObject({ ok: true, result: { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" } })
  expect(acquire).not.toHaveBeenCalled()
  expect(ready).not.toHaveBeenCalled()
  expect(await readdir(path.join(paths.home, "workspace", "attachments"))).toEqual([])
  expect((await readdir(paths.control)).some(name => name.startsWith("attachments-"))).toBe(false)
})

it("discards published files if the gateway refuses the readiness callback", async ({ onTestFinished }) => {
  const { paths, fetcher, acquire, ready, response, run } = await fixture(onTestFinished)
  fetcher.mockResolvedValue(response())
  ready.mockRejectedValueOnce(new Error("fixture permission revoked"))
  expect(await run()).toMatchObject({ ok: false, error_code: "ATTACHMENT_UPLOAD_INVALID" })
  expect(acquire).not.toHaveBeenCalled()
  expect(await readdir(path.join(paths.home, "workspace", "attachments"))).toEqual([])
})

it("keeps a real worker admission POST alive after reading its request body", async ({ onTestFinished }) => {
  const requestHttp = globalThis.fetch
  const { turns, command, fetcher, ready, response, run } = await fixture(onTestFinished)
  fetcher.mockResolvedValue(response())
  const link = new DesktopLink(randomUUID(), command.owner_id, turns, async () => {}, vi.fn())
  const callbacks = desktopWorkerCallbacks("a".repeat(64), () => ({ link, turns }), origin)
  onTestFinished(() => callbacks.close())
  const address = await callbacks.listen({ host: "127.0.0.1", port: 0 })
  expect(await run()).toMatchObject({ ok: true })
  ready.mockImplementation(async () => { await delay(30) })
  const confirmation = await requestHttp(`${address}/internal/runner/attachments-ready`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${desktopWorkerSecret(command.owner_id, "a".repeat(64), command.conversation_id, {
        turnId: command.turn_id, runtimeGeneration: command.runtime_generation,
      })}`,
      "content-type": "application/json",
      "x-linksense-owner-id": command.owner_id,
      "x-linksense-service-session": command.conversation_id,
    },
    body: JSON.stringify({
      conversationId: command.conversation_id,
      projectionTurnId: command.turn_id,
      runtimeGeneration: command.runtime_generation,
    }),
    signal: AbortSignal.timeout(2_000),
  })
  expect(confirmation.status).toBe(200)
  expect(await confirmation.json()).toEqual({ confirmed: true, expiresAt: Date.parse(command.expires_at) })
  expect(ready).toHaveBeenCalledTimes(2)
})

it.each([
  { state: "missing", retains: false },
  { state: "correlated", retains: true },
  { state: "sealed", retains: false },
  { state: "foreign owner", retains: true },
] as const)("reconciles a published folder on restart with a $state journal", async ({ state, retains }) => {
  const { provider, paths, command, fetcher, response } = await fixture(onTestFinished)
  fetcher.mockResolvedValue(response())
  await provider.prepareOwnerFilesystem(paths)
  await prepareConversationControl(paths, command.conversation_id, "workspace", undefined, command.runtime_generation)
  await prepareDesktopAttachments(paths, origin, command, AbortSignal.timeout(5_000))
  const parent = path.join(paths.home, "workspace", "attachments")
  const userFolder = `attachments-${randomUUID()}-manual`
  const [published] = await readdir(parent)
  expect(published).toBeDefined()
  await mkdir(path.join(parent, userFolder), { mode: 0o700 })
  if (state !== "missing") {
    const journal = new StartOperationStore(new WorkspaceManager(paths.root, undefined, {
      fixedOwnerId: command.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
    }))
    const starting = await journal.createStarting(command.conversation_id, command.turn_id,
      state === "foreign owner" ? randomUUID() : command.owner_id, "f".repeat(64))
    if (!starting) throw new Error("Missing worker start journal")
    const correlated = await journal.updateCorrelation(starting, {
      codexThreadId: randomUUID(), baselineTurnIds: [], preparedAt: command.expires_at,
    })
    if (state === "sealed" || state === "foreign owner") {
      await journal.update(correlated, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
    }
  }
  await provider.pruneWorkspaces(Date.now())
  expect(new Set(await readdir(parent))).toEqual(new Set(retains ? [published, userFolder] : [userFolder]))
})

it.each([
  { journalState: "starting", files: "removes", status: "failed" },
  { journalState: "correlated", files: "retains", status: "uncertain" },
  { journalState: "sealed", files: "removes", status: "failed" },
] as const)("$files published files when the worker closes with a $journalState journal", async ({
  journalState, files, status,
}) => {
  const { paths, command, fetcher, acquire, request, response, run } = await fixture(onTestFinished)
  fetcher.mockResolvedValue(response())
  const workspace = new WorkspaceManager(paths.root, undefined, {
    fixedOwnerId: command.owner_id, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
  })
  const journal = new StartOperationStore(workspace)
  const parent = path.join(paths.home, "workspace", "attachments")
  let published: string[] = []
  request.mockImplementation(async (_worker, route) => {
    if (route === "/health/ready") return Response.json({ status: "available" })
    published = await readdir(parent)
    const stored = await journal.createStarting(command.conversation_id, command.turn_id, command.owner_id, "c".repeat(64))
    if (!stored) throw new Error("Missing newly created worker start journal")
    if (journalState !== "starting") {
      const correlated = await journal.updateCorrelation(stored, {
        codexThreadId: randomUUID(), baselineTurnIds: [], preparedAt: command.expires_at,
      })
      if (journalState === "sealed") {
        await journal.update(correlated, { status: "failed", errorCode: "RUNNER_TURN_START_SEALED" })
      }
    }
    throw new Error("Fixture closed the worker connection before receiving its start reply")
  })

  expect(await run()).toMatchObject({ ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" })
  expect(published).toHaveLength(1)
  expect(await readdir(parent)).toEqual(files === "retains" ? published : [])
  expect(await run()).toMatchObject({ ok: true, result: { status } })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(acquire).toHaveBeenCalledOnce()
})
