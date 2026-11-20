import { File } from "node:buffer"
import { randomBytes } from "node:crypto"
import { Readable } from "node:stream"
import { finished } from "node:stream/promises"

import {
  desktopArtifactMaxBytes,
  desktopArtifactPartBytes,
  desktopArtifactPath,
  desktopArtifactPathDigestHeader,
  desktopArtifactPathDigestSchema,
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

type ArtifactDestination = DesktopArtifactUploadGrant["destination"]
type PartsDestination = Extract<ArtifactDestination, { kind: "presigned_parts" }>
type SingleDestination = Exclude<ArtifactDestination, { kind: "presigned_parts" }>

export async function uploadDesktopArtifact(input: {
  origin: string
  turnId: string
  runToken: string
  source: DesktopArtifactSource
  /** Optional for callers without a workspace path binding; the worker always sends it. */
  desktopSourcePathDigest?: string
  grant: DesktopArtifactUploadGrant
  signal: AbortSignal
}): Promise<DesktopArtifactReceipt> {
  const { origin, turnId, runToken, source, desktopSourcePathDigest, signal } = input
  signal.throwIfAborted()
  const grant = desktopArtifactUploadGrantSchema.safeParse(input.grant)
  if (!grant.success || !desktopServerOriginSchema.safeParse(origin).success ||
      !z.uuid().safeParse(turnId).success || !desktopRunTokenSchema.safeParse(runToken).success ||
      (desktopSourcePathDigest !== undefined &&
        !desktopArtifactPathDigestSchema.safeParse(desktopSourcePathDigest).success) ||
      !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes < 1 || source.sizeBytes > desktopArtifactMaxBytes) {
    throw invalidRequest()
  }
  const { artifact_id: artifactId, destination, expires_at: expiresAt } = grant.data
  // The grant order is authoritative; reject a count mismatch before any transfer.
  if (destination.kind === "presigned_parts" &&
      destination.parts.length !== Math.ceil(source.sizeBytes / desktopArtifactPartBytes)) {
    throw invalidRequest()
  }
  const remaining = Date.parse(expiresAt) - Date.now()
  if (remaining <= 0) throw invalidRequest()
  const budget = Math.min(remaining, desktopArtifactUploadLifetimeMs)
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(budget)])
  const endpoint = `${desktopArtifactPath}/${turnId}/${artifactId}`
  const apiHeaders = { authorization: `Bearer ${runToken}`, accept: "application/json" }
  const requestDefaults = { redirect: "error", cache: "no-store", credentials: "omit" } as const

  function byteStream(bytes: AsyncIterable<Uint8Array>, streamSignal: AbortSignal): Readable {
    return Readable.from(bytes, { objectMode: false, highWaterMark: 1, signal: streamSignal })
  }

  /** The one presigned multipart encoder shared by single and part uploads. */
  function presignedForm(
    destination: { url: string; fields: Record<string, string> },
    file: AsyncIterable<Uint8Array>,
    sizeBytes: number,
    formSignal: AbortSignal,
  ): { url: URL; method: "POST"; headers: Record<string, string>; bytes: AsyncIterable<Uint8Array> } {
    class ArtifactFile extends File {
      override readonly size = sizeBytes
      override stream() { return Readable.toWeb(byteStream(file, formSignal)) }
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
    return { url: new URL(destination.url), method: "POST", headers: encoder.headers, bytes: encoder }
  }

  async function performUpload(request: {
    url: URL
    method: "PUT" | "POST"
    headers: Record<string, string>
    bytes: AsyncIterable<Uint8Array>
    signal: AbortSignal
    stop: AbortController
    readErrorBody: boolean
  }): Promise<FileServiceRequestError | undefined> {
    const body = byteStream(request.bytes, request.signal)
    const completed = finished(body, { cleanup: true })
    void completed.catch(() => undefined)
    let failure: FileServiceRequestError | undefined
    try {
      const init: RequestInit = {
        ...requestDefaults, method: request.method, headers: request.headers,
        body: Readable.toWeb(body), signal: request.signal, duplex: "half",
      }
      const response = await fetch(request.url, init)
      try {
        if (response.ok) await completed
        else failure = fileServiceErrorFromApi(response.status,
          request.readErrorBody ? await readResponseJson(response) : undefined)
      } finally {
        await response.body?.cancel().catch(() => undefined)
      }
    } catch (error) {
      failure = error instanceof FileServiceRequestError ? error : unavailable()
    } finally {
      request.stop.abort()
      await completed.catch(() => undefined)
    }
    return failure
  }

  async function sendUpload(destination: SingleDestination): Promise<boolean> {
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
    const file = verifiedBytes()
    const request = destination.kind === "presigned_post"
      ? presignedForm(destination, file, source.sizeBytes, uploadSignal)
      : {
          url: new URL(`${endpoint}/upload`, origin),
          method: "PUT" as const,
          headers: { ...apiHeaders, "content-type": "application/octet-stream", "content-length": String(source.sizeBytes) },
          bytes: file,
        }
    let failure: FileServiceRequestError | undefined
    try {
      failure = await performUpload({
        ...request, signal: uploadSignal, stop, readErrorBody: destination.kind === "api",
      })
    } finally {
      await file.return(undefined).catch(() => undefined)
    }
    lifetime.throwIfAborted()
    if (sourceError !== undefined) throw sourceError instanceof FileServiceRequestError ? sourceError : failedRequest()
    if (!failure) return true
    if (destination.kind === "api") throw failure
    return false
  }

  /**
   * Streams the single verified source read into every presigned part in grant
   * order, holding only one source chunk between parts and one part buffer for
   * the final slice, which is sent only after the source verifies EOF.
   */
  async function sendParts(parts: PartsDestination["parts"]): Promise<void> {
    const finalPart = parts.at(-1)
    if (!finalPart) throw invalidRequest()
    const leadingParts = parts.slice(0, -1)
    const finalBytes = source.sizeBytes - leadingParts.length * desktopArtifactPartBytes
    const stop = new AbortController()
    const uploadSignal = AbortSignal.any([lifetime, stop.signal])
    const iterator = source.read(uploadSignal)[Symbol.asyncIterator]()
    let sourceError: unknown
    let pending: Buffer | undefined
    let consumed = 0

    async function* sliceBytes(length: number): AsyncGenerator<Buffer> {
      let remaining = length
      try {
        while (remaining > 0) {
          let chunk = pending
          pending = undefined
          while (chunk === undefined) {
            const next = await iterator.next()
            if (next.done) throw failedRequest()
            if (next.value.length === 0) continue
            consumed += next.value.length
            if (consumed > source.sizeBytes) throw failedRequest()
            chunk = next.value
          }
          const take = Math.min(remaining, chunk.length)
          if (take < chunk.length) pending = chunk.subarray(take)
          remaining -= take
          yield take === chunk.length ? chunk : chunk.subarray(0, take)
        }
      } catch (error) {
        if (!uploadSignal.aborted) sourceError = error
        throw error
      }
    }

    async function sendPart(
      part: PartsDestination["parts"][number],
      sizeBytes: number,
      buffered?: Buffer,
    ): Promise<FileServiceRequestError | undefined> {
      const partStop = new AbortController()
      const partSignal = AbortSignal.any([uploadSignal, partStop.signal])
      async function* bufferedBytes(): AsyncGenerator<Uint8Array> {
        if (buffered !== undefined) yield buffered
      }
      const request = presignedForm(part, buffered !== undefined ? bufferedBytes() : sliceBytes(sizeBytes),
        sizeBytes, partSignal)
      return performUpload({
        ...request, signal: partSignal, stop: partStop, readErrorBody: false,
      })
    }

    let failure: FileServiceRequestError | undefined
    try {
      for (const part of leadingParts) {
        failure = await sendPart(part, desktopArtifactPartBytes)
        if (failure) break
      }
      if (!failure) {
        const finalPartBytes = Buffer.allocUnsafe(finalBytes)
        let offset = 0
        for await (const chunk of sliceBytes(finalBytes)) {
          finalPartBytes.set(chunk, offset)
          offset += chunk.length
        }
        uploadSignal.throwIfAborted()
        // EOF here means the source verified the full count and digest.
        if (offset !== finalBytes || !(await iterator.next()).done) throw failedRequest()
        uploadSignal.throwIfAborted()
        failure = await sendPart(finalPart, finalBytes, finalPartBytes)
      }
    } catch (error) {
      if (!uploadSignal.aborted) sourceError = error
    } finally {
      stop.abort()
      await iterator.return(undefined).catch(() => undefined)
    }
    lifetime.throwIfAborted()
    if (sourceError !== undefined) throw sourceError instanceof FileServiceRequestError ? sourceError : failedRequest()
    if (failure) throw failure
  }

  // Parts never fall back to the API. The single signed form only writes
  // staging, so its failure may try the same grant through the API once.
  if (destination.kind === "presigned_parts") {
    await sendParts(destination.parts)
  } else if (destination.kind === "api" || !await sendUpload(destination)) {
    await sendUpload({ kind: "api" })
  }
  lifetime.throwIfAborted()
  const confirmHeaders = desktopSourcePathDigest === undefined
    ? apiHeaders
    : { ...apiHeaders, [desktopArtifactPathDigestHeader]: desktopSourcePathDigest }
  try {
    const response = await fetch(new URL(`${endpoint}/confirm`, origin), {
      ...requestDefaults, method: "POST",
      // Only the confirmation carries the digest; upload requests and storage never see it.
      headers: confirmHeaders,
      signal: lifetime,
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
