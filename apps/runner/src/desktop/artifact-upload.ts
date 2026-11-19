import { File } from "node:buffer"
import { randomBytes } from "node:crypto"
import { Readable } from "node:stream"
import { finished } from "node:stream/promises"

import {
  desktopArtifactMaxBytes,
  desktopArtifactPath,
  desktopArtifactReceiptSchema,
  desktopArtifactUploadGrantSchema,
  desktopArtifactUploadLifetimeMs,
  desktopRunTokenSchema,
  desktopServerOriginSchema,
  type DesktopArtifactReceipt,
  type DesktopArtifactUploadGrant,
} from "@linksense/shared"
import { FormDataEncoder } from "form-data-encoder"
import { fetch, FormData, type RequestInit, type Response } from "undici"
import { z } from "zod"

import { FileServiceRequestError, desktopArtifactUncertain, fileServiceErrorFromApi } from "../file-service-error.js"
import type { DesktopArtifactSource } from "./artifact-source.js"

export async function uploadDesktopArtifact(input: {
  origin: string
  turnId: string
  runToken: string
  source: DesktopArtifactSource
  grant: DesktopArtifactUploadGrant
  signal: AbortSignal
}): Promise<DesktopArtifactReceipt> {
  const { origin, turnId, runToken, source, signal } = input
  signal.throwIfAborted()
  const grant = desktopArtifactUploadGrantSchema.safeParse(input.grant)
  if (!grant.success || !desktopServerOriginSchema.safeParse(origin).success ||
      !z.uuid().safeParse(turnId).success || !desktopRunTokenSchema.safeParse(runToken).success ||
      !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > desktopArtifactMaxBytes) {
    throw invalidRequest()
  }
  const { artifact_id: artifactId, destination, expires_at: expiresAt } = grant.data
  const remaining = Date.parse(expiresAt) - Date.now()
  if (remaining <= 0) throw invalidRequest()
  const budget = Math.min(remaining, desktopArtifactUploadLifetimeMs)
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(budget)])
  const endpoint = `${desktopArtifactPath}/${turnId}/${artifactId}`
  const apiHeaders = { authorization: `Bearer ${runToken}`, accept: "application/json" }
  const requestDefaults = { redirect: "error", cache: "no-store", credentials: "omit" } as const

  async function sendUpload(destination: DesktopArtifactUploadGrant["destination"]): Promise<boolean> {
    const stop = new AbortController()
    // Leave time to use the API if the storage server accepts a connection but stalls.
    const uploadSignal = AbortSignal.any([lifetime, stop.signal,
      ...(destination.kind === "presigned_post" ? [AbortSignal.timeout(Math.floor(budget * 2 / 3))] : []),
    ])
    let sourceError: unknown
    async function* verifiedBytes(): AsyncGenerator<Buffer> {
      let last: Buffer | undefined
      let count = 0
      try {
        // The source verifies its digest at EOF; don't send the final bytes until it succeeds.
        for await (const chunk of source.read(uploadSignal)) {
          count += chunk.length
          if (count > source.sizeBytes) throw failedRequest()
          if (last) yield last
          last = chunk
        }
        uploadSignal.throwIfAborted()
        if (count !== source.sizeBytes || !last) throw failedRequest()
        yield last
      } catch (error) {
        if (!uploadSignal.aborted) sourceError = error
        throw error
      }
    }
    const stream = (bytes: AsyncIterable<Uint8Array>) => Readable.from(bytes, { objectMode: false, highWaterMark: 1, signal: uploadSignal })
    const file = verifiedBytes()
    let bytes: AsyncIterable<Uint8Array> = file
    let url = new URL(`${endpoint}/upload`, origin)
    let method = "PUT"
    let headers: Record<string, string> = { ...apiHeaders, "content-type": "application/octet-stream", "content-length": String(source.sizeBytes) }
    if (destination.kind === "presigned_post") {
      class ArtifactFile extends File {
        override readonly size = source.sizeBytes
        override stream() { return Readable.toWeb(stream(file)) }
      }
      const form = new FormData()
      for (const [name, value] of Object.entries(destination.fields)) form.set(name, value)
      form.set("file", new ArtifactFile([], "artifact", { type: "application/octet-stream" }))
      // Pass the encoder's byte stream to fetch to preserve backpressure on Node 24.
      function* entries() { yield* form }
      const encoder = new FormDataEncoder({
        [Symbol.toStringTag]: "FormData",
        append: form.append.bind(form),
        getAll: form.getAll.bind(form),
        entries,
        [Symbol.iterator]: entries,
      }, randomBytes(24).toString("hex"))
      bytes = encoder
      headers = encoder.headers
      url = new URL(destination.url)
      method = "POST"
    }
    const body = stream(bytes)
    const completed = finished(body, { cleanup: true })
    void completed.catch(() => undefined)
    let failure: FileServiceRequestError | undefined
    try {
      const request: RequestInit = {
        ...requestDefaults, method, headers, body: Readable.toWeb(body), signal: uploadSignal, duplex: "half",
      }
      const response = await fetch(url, request)
      try {
        if (response.ok) await completed
        else failure = fileServiceErrorFromApi(response.status,
          destination.kind === "api" ? await readResponseJson(response) : undefined)
      } finally {
        await response.body?.cancel().catch(() => undefined)
      }
    } catch (error) {
      failure = error instanceof FileServiceRequestError ? error : unavailable()
    } finally {
      stop.abort()
      await completed.catch(() => undefined)
      await file.return(undefined).catch(() => undefined)
    }
    lifetime.throwIfAborted()
    if (sourceError !== undefined) throw sourceError instanceof FileServiceRequestError ? sourceError : failedRequest()
    if (!failure) return true
    if (destination.kind === "api") throw failure
    return false
  }

  // The signed form only writes staging. If it fails, try the same grant through the API once.
  if (destination.kind === "api" || !await sendUpload(destination)) await sendUpload({ kind: "api" })
  lifetime.throwIfAborted()
  try {
    const response = await fetch(new URL(`${endpoint}/confirm`, origin), {
      ...requestDefaults, method: "POST", headers: apiHeaders, signal: lifetime,
    })
    const payload = await readResponseJson(response)
    lifetime.throwIfAborted()
    if (response.status >= 500 || response.status === 408) throw desktopArtifactUncertain(artifactId)
    if (!response.ok) throw fileServiceErrorFromApi(response.status, payload)
    const receipt = desktopArtifactReceiptSchema.safeParse(payload)
    if (!receipt.success || receipt.data.artifact_id !== artifactId || receipt.data.file_id !== artifactId) {
      throw desktopArtifactUncertain(artifactId)
    }
    return receipt.data
  } catch (error) {
    if (error instanceof FileServiceRequestError) throw error
    throw desktopArtifactUncertain(artifactId)
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined
  const chunks: Uint8Array[] = []
  let count = 0
  try {
    for await (const chunk of response.body) {
      count += chunk.byteLength
      if (count > 64 * 1024) return undefined
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks, count).toString("utf8"))
  } catch {
    return undefined
  }
}

function invalidRequest(): FileServiceRequestError {
  return new FileServiceRequestError("ARTIFACT_REGISTRATION_INVALID", false, 400)
}

function failedRequest(): FileServiceRequestError {
  return new FileServiceRequestError("ARTIFACT_REGISTRATION_FAILED", false, 400)
}

function unavailable(): FileServiceRequestError {
  return new FileServiceRequestError("ARTIFACT_REGISTRATION_UNAVAILABLE", true, 503)
}
