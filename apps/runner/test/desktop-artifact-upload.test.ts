import { createHash, randomUUID } from "node:crypto"

import {
  desktopArtifactPartBytes,
  desktopArtifactPath,
  type DesktopArtifactUploadGrant,
} from "@linksense/shared"
import { afterEach, expect, it, vi } from "vitest"

import {
  DesktopArtifactSourceError,
  type DesktopArtifactSource,
} from "../src/desktop/artifact-source.js"
import { uploadDesktopArtifact } from "../src/desktop/artifact-upload.js"
import { FileServiceRequestError } from "../src/file-service-error.js"

vi.mock("undici", async (load) => ({
  ...await load<typeof import("undici")>(),
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}))

const origin = "https://server.example.test"
const turnId = "01900000-0000-7000-8000-000000000002"
const artifactId = "01900000-0000-7000-8000-000000000001"
const downloadCardEventId = "01900000-0000-7000-8000-000000000003"
const runToken = `lsdr_${"a".repeat(43)}`

interface FetchCall {
  url: URL
  init: RequestInit | undefined
}

function futureExpiry(): string {
  return new Date(Date.now() + 60_000).toISOString()
}

function receipt() {
  return {
    success: true,
    artifact_id: artifactId,
    file_id: artifactId,
    display_name: "report.txt",
    download_card_event_id: downloadCardEventId,
  }
}

function apiGrant(
  overrides: Partial<Pick<DesktopArtifactUploadGrant, "artifact_id" | "expires_at">> = {},
): DesktopArtifactUploadGrant {
  return {
    artifact_id: artifactId,
    expires_at: futureExpiry(),
    destination: { kind: "api" },
    ...overrides,
  }
}

function presignedGrant(
  url: string,
  fields: Record<string, string>,
): DesktopArtifactUploadGrant {
  return {
    artifact_id: artifactId,
    expires_at: futureExpiry(),
    destination: { kind: "presigned_post", url, fields },
  }
}

const storageGrant = () => presignedGrant("https://objects.example.test/bucket", { key: "artifact" })

function partsGrant(
  parts: { url: string; fields: Record<string, string> }[],
): DesktopArtifactUploadGrant {
  return {
    artifact_id: artifactId,
    expires_at: futureExpiry(),
    destination: { kind: "presigned_parts", parts },
  }
}

function storagePart(index: number) {
  return {
    url: `https://objects.example.test/part-${index}`,
    fields: {
      key: `artifacts/desktop/report.bin.${index}`,
      "x-amz-signature": String(index).repeat(64),
    },
  }
}

/** Just over one part, with markers on both sides of the part boundary. */
function partFixtureBytes(): Buffer {
  const bytes = Buffer.alloc(desktopArtifactPartBytes + 5, 0x5a)
  bytes.writeUInt32LE(0xdeadbeef, 0)
  bytes.writeUInt32LE(0xdeadbeef, desktopArtifactPartBytes - 4)
  bytes.writeUInt32LE(0xdeadbeef, desktopArtifactPartBytes)
  bytes.writeUInt32LE(0xdeadbeef, bytes.length - 4)
  return bytes
}

function artifactSource(
  bytes: Buffer,
  options: { chunkSize: number; failAtEnd?: boolean },
): {
  source: DesktopArtifactSource
  state: { started: boolean; validated: boolean; returnCalls: number; closeCalls: number; readCalls: number }
} {
  const state = { started: false, validated: false, returnCalls: 0, closeCalls: 0, readCalls: 0 }
  const source: DesktopArtifactSource = {
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    async *read(signal) {
      state.started = true
      state.readCalls += 1
      try {
        for (
          let offset = 0;
          offset < bytes.byteLength;
          offset += options.chunkSize
        ) {
          signal.throwIfAborted()
          yield bytes.subarray(
            offset,
            Math.min(offset + options.chunkSize, bytes.byteLength),
          )
        }
        if (options.failAtEnd) {
          throw new DesktopArtifactSourceError("ARTIFACT_REGISTRATION_BUSY")
        }
        state.validated = true
      } finally {
        state.returnCalls += 1
      }
    },
    async close() {
      state.closeCalls += 1
    },
  }
  return { source, state }
}

function requestUrl(input: string | URL | Request): URL {
  if (input instanceof URL) return input
  if (typeof input === "string") return new URL(input)
  return new URL(input.url)
}

function installFetch(
  handler: (call: FetchCall) => Response | Promise<Response>,
) {
  const fetcher = vi.fn<typeof fetch>(async (input, init) =>
    handler({ url: requestUrl(input), init }),
  )
  vi.stubGlobal("fetch", fetcher)
  return fetcher
}

async function readBodyChunks(
  init: RequestInit | undefined,
  observe?: (chunk: Buffer) => void,
): Promise<Buffer[]> {
  const body = init?.body
  if (!(body instanceof ReadableStream)) {
    throw new Error("Expected a streaming request body")
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  const chunks: Buffer[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      chunks.push(chunk)
      observe?.(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return chunks
}

function formField(text: string, name: string): string | undefined {
  const marker = `Content-Disposition: form-data; name="${name}"\r\n\r\n`
  const start = text.indexOf(marker)
  if (start < 0) return undefined
  const valueStart = start + marker.length
  return text.slice(valueStart, text.indexOf("\r\n", valueStart))
}

/** Byte-safe parse of one presigned form so 32 MiB file parts stay exact. */
function parsePresignedForm(body: Buffer, contentType: string) {
  const boundary = /^multipart\/form-data; boundary=(.+)$/u.exec(contentType)?.[1]
  if (!boundary) throw new Error("Missing multipart boundary")
  const closing = Buffer.from(`\r\n--${boundary}--\r\n\r\n`)
  if (!body.subarray(body.length - closing.length).equals(closing)) {
    throw new Error("Missing multipart closing boundary")
  }
  const fileHeader = Buffer.from(
    'Content-Disposition: form-data; name="file"; filename="artifact"\r\n' +
    "Content-Type: application/octet-stream\r\n\r\n",
  )
  const headerStart = body.indexOf(fileHeader)
  if (headerStart < 0) throw new Error("Missing multipart file part")
  const contentStart = headerStart + fileHeader.length
  return {
    fieldText: body.subarray(0, contentStart).toString("latin1"),
    file: body.subarray(contentStart, body.length - closing.length),
  }
}

function run(
  grant: DesktopArtifactUploadGrant,
  source: DesktopArtifactSource,
  signal: AbortSignal = AbortSignal.timeout(5_000),
) {
  return uploadDesktopArtifact({
    origin,
    turnId,
    runToken,
    source,
    grant,
    signal,
  })
}

afterEach(() => vi.unstubAllGlobals())

it("streams exact bytes to the api upload path and confirms the scoped receipt", async () => {
  const bytes = Buffer.from(Array.from({ length: 30 }, (_, index) => (index * 7) % 256))
  const chunkSize = 10
  const { source, state } = artifactSource(bytes, { chunkSize })
  const observed: { chunk: Buffer; validated: boolean }[] = []
  const uploads: { url: URL; headers: Headers; init: RequestInit }[] = []
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      if (!init) throw new Error("Missing upload init")
      const chunks = await readBodyChunks(init, chunk =>
        observed.push({ chunk, validated: state.validated }),
      )
      uploads.push({ url, headers: new Headers(init.headers), init })
      expect(Buffer.concat(chunks).equals(bytes)).toBe(true)
      return new Response(null, { status: 204 })
    }
    return Response.json(receipt())
  })

  await expect(run(apiGrant(), source)).resolves.toEqual(receipt())

  const upload = uploads[0]
  if (!upload) throw new Error("Missing upload request")
  expect(upload.url.href).toBe(
    new URL(`${desktopArtifactPath}/${turnId}/${artifactId}/upload`, origin).href,
  )
  expect(upload.init.method).toBe("PUT")
  expect(upload.init.redirect).toBe("error")
  expect(upload.init.body).toBeInstanceOf(ReadableStream)
  expect(upload.headers.get("authorization")).toBe(`Bearer ${runToken}`)
  expect(upload.headers.get("content-type")).toBe("application/octet-stream")
  expect(upload.headers.get("content-length")).toBe(String(bytes.byteLength))

  // Bounded chunks, and the final chunk is emitted only after the source's
  // trailing size/digest verification reported success.
  expect(observed).toHaveLength(3)
  expect(Math.max(...observed.map(entry => entry.chunk.byteLength))).toBe(chunkSize)
  expect(observed.at(-1)?.validated).toBe(true)
  expect(state.validated).toBe(true)
  // The caller, not the helper, owns closing the source.
  expect(state.closeCalls).toBe(0)

  const confirm = fetcher.mock.calls[1]
  if (!confirm) throw new Error("Missing confirm request")
  expect(requestUrl(confirm[0]).href).toBe(
    new URL(`${desktopArtifactPath}/${turnId}/${artifactId}/confirm`, origin).href,
  )
  expect(confirm[1]?.method).toBe("POST")
  expect(confirm[1]?.body ?? null).toBeNull()
  expect(new Headers(confirm[1]?.headers).get("authorization")).toBe(
    `Bearer ${runToken}`,
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it("withholds final bytes and skips confirm when trailing source verification fails", async () => {
  const bytes = Buffer.from(Array.from({ length: 30 }, (_, index) => index + 1))
  const { source } = artifactSource(bytes, { chunkSize: 10, failAtEnd: true })
  const observed: Buffer[] = []
  let drainError: unknown
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      try {
        await readBodyChunks(init, chunk => observed.push(chunk))
      } catch (error) {
        drainError = error
      }
      // A server may answer before the body pump observes the failure.
      return new Response(null, { status: 200 })
    }
    return Response.json(receipt())
  })

  await expect(run(apiGrant(), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_BUSY",
    retryable: true,
    statusCode: 409,
  })
  expect(drainError).toBeInstanceOf(DesktopArtifactSourceError)
  expect(Buffer.concat(observed).equals(bytes.subarray(0, 20))).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("does not confirm when a success response arrives before trailing verification finishes", async () => {
  const bytes = Buffer.from(Array.from({ length: 30 }, (_, index) => index + 1))
  const { source } = artifactSource(bytes, { chunkSize: 10, failAtEnd: true })
  let drained: Promise<void> | undefined
  const fetcher = installFetch(({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      drained = readBodyChunks(init).then(
        () => undefined,
        () => undefined,
      )
      return new Response(null, { status: 200 })
    }
    return Response.json(receipt())
  })

  await expect(run(apiGrant(), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_BUSY",
  })
  await drained
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("throws the caller's abort reason, cleans up, and never confirms", async () => {
  const bytes = Buffer.from(Array.from({ length: 8 }, (_, index) => index + 1))
  const controller = new AbortController()
  const reason = new Error("caller stopped the upload")
  const state = { returned: false }
  const source: DesktopArtifactSource = {
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    async *read(signal) {
      try {
        yield bytes.subarray(0, 2)
        yield bytes.subarray(2, 4)
        await new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason)
            return
          }
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          })
        })
      } finally {
        state.returned = true
      }
    },
    async close() {},
  }
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      const body = init?.body
      if (!(body instanceof ReadableStream)) {
        throw new Error("Expected a streaming request body")
      }
      const reader = (body as ReadableStream<Uint8Array>).getReader()
      await reader.read()
      controller.abort(reason)
      for (;;) {
        const { done } = await reader.read()
        if (done) return new Response(null, { status: 204 })
      }
    }
    return Response.json(receipt())
  })

  await expect(run(apiGrant(), source, controller.signal)).rejects.toBe(reason)
  expect(state.returned).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("throws the caller's abort reason before touching the source", async () => {
  const controller = new AbortController()
  const reason = new Error("stopped before start")
  controller.abort(reason)
  const { source, state } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(() => new Response(null, { status: 204 }))

  await expect(run(apiGrant(), source, controller.signal)).rejects.toBe(reason)
  expect(state.returnCalls).toBe(0)
  expect(fetcher).not.toHaveBeenCalled()
})

it.each([
  "https://objects.example.test/bucket",
  "http://127.0.0.1:9000/bucket",
])(
  "posts a bounded multipart form to %s without device credentials",
  async storageUrl => {
    const bytes = Buffer.from("artifact-bytes-fixture")
    const chunkSize = 5
    const fields = {
      key: "artifacts/desktop/report.txt",
      policy: "cG9saWN5",
      "x-amz-signature": "f".repeat(64),
    }
    const { source, state } = artifactSource(bytes, { chunkSize })
    let storage: { headers: Headers; init: RequestInit; body: Buffer } | undefined
    const fetcher = installFetch(async ({ url, init }) => {
      if (url.href === new URL(storageUrl).href) {
        if (!init) throw new Error("Missing storage init")
        storage = {
          headers: new Headers(init.headers),
          init,
          body: Buffer.concat(await readBodyChunks(init)),
        }
        return new Response(null, { status: 204 })
      }
      return Response.json(receipt())
    })

    await expect(run(presignedGrant(storageUrl, fields), source)).resolves.toEqual(
      receipt(),
    )

    if (!storage) throw new Error("Missing storage request")
    expect(storage.init.method).toBe("POST")
    expect(storage.init.redirect).toBe("error")
    expect(storage.init.credentials).toBe("omit")
    // Only the multipart framing headers cross to storage: no bearer, cookies
    // or other transient device headers.
    expect([...storage.headers.keys()].sort()).toEqual([
      "content-length",
      "content-type",
    ])
    expect(storage.headers.get("authorization")).toBeNull()
    expect(storage.headers.get("cookie")).toBeNull()
    expect(Number(storage.headers.get("content-length"))).toBe(
      storage.body.byteLength,
    )

    const contentType = storage.headers.get("content-type") ?? ""
    const boundary = /^multipart\/form-data; boundary=(.+)$/u.exec(contentType)?.[1]
    if (!boundary) throw new Error("Missing multipart boundary")
    const text = storage.body.toString("utf8")
    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true)
    for (const [name, value] of Object.entries(fields)) {
      expect(text).toContain(
        `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
    }
    const fileHeader =
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
      `filename="artifact"\r\nContent-Type: application/octet-stream\r\n\r\n`
    const closing = `\r\n--${boundary}--\r\n\r\n`
    const start = text.indexOf(fileHeader)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(text.endsWith(closing)).toBe(true)
    expect(text.slice(start + fileHeader.length, text.length - closing.length)).toBe(
      bytes.toString("utf8"),
    )
    expect(text).not.toContain(runToken)
    expect(state.validated).toBe(true)
    expect(state.closeCalls).toBe(0)

    const confirm = fetcher.mock.calls[1]
    if (!confirm) throw new Error("Missing confirm request")
    expect(requestUrl(confirm[0]).href).toBe(
      new URL(
        `${desktopArtifactPath}/${turnId}/${artifactId}/confirm`,
        origin,
      ).href,
    )
    expect(new Headers(confirm[1]?.headers).get("authorization")).toBe(
      `Bearer ${runToken}`,
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)

it.each([
  "http://objects.example.test/bucket",
  "https://user:secret@objects.example.test/bucket",
  "https://objects.example.test/bucket#fragment",
  "ftp://objects.example.test/bucket",
])("rejects the unsafe storage url %s before sending bytes", async url => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(() => new Response(null, { status: 204 }))

  await expect(run(presignedGrant(url, {}), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_INVALID",
  })
  expect(fetcher).not.toHaveBeenCalled()
})

const unsafeFields: { label: string; fields: Record<string, string> }[] = [
  { label: "quote in the field name", fields: { 'bad"name': "value" } },
  {
    label: "header injection in the field value",
    fields: { key: "value\r\ninjected: true" },
  },
  { label: "a field that shadows the file part", fields: { file: "value" } },
]

it.each(unsafeFields)("rejects $label before sending bytes", async ({ fields }) => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(() => new Response(null, { status: 204 }))

  await expect(
    run(presignedGrant("https://objects.example.test/bucket", fields), source),
  ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" })
  expect(fetcher).not.toHaveBeenCalled()
})

it("maps an upload failure and never confirms", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(({ url }) =>
    url.pathname.endsWith("/upload")
      ? new Response(JSON.stringify({ error_code: "CONFLICT" }), { status: 409 })
      : Response.json(receipt()),
  )

  await expect(run(apiGrant(), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_BUSY",
    retryable: true,
    statusCode: 409,
  })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each(["refused", "unreachable"])("falls back to the same grant once when storage is %s", async failure => {
  const bytes = Buffer.from("artifact-bytes-fixture")
  const { source, state } = artifactSource(bytes, { chunkSize: 2 })
  const returnedBeforeFallback = vi.fn()
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.hostname === "objects.example.test") {
      if (failure === "unreachable") throw new TypeError("fetch failed")
      const body = init?.body
      if (!(body instanceof ReadableStream)) throw new Error("Missing body")
      const reader = body.getReader()
      try {
        while (!state.started && !(await reader.read()).done) { /* reach file bytes */ }
      } finally {
        reader.releaseLock()
      }
      return new Response(null, { status: 403 })
    }
    if (url.pathname.endsWith("/upload")) {
      returnedBeforeFallback(state.returnCalls, Buffer.concat(await readBodyChunks(init)))
      return new Response(null, { status: 204 })
    }
    return Response.json(receipt())
  })

  await expect(run(storageGrant(), source)).resolves.toEqual(receipt())
  expect(fetcher.mock.calls.map(([url, init]) => ({
    url: requestUrl(url).href, method: init?.method, bearer: new Headers(init?.headers).get("authorization"),
  }))).toEqual([
    { url: "https://objects.example.test/bucket", method: "POST", bearer: null },
    { url: `${origin}${desktopArtifactPath}/${turnId}/${artifactId}/upload`, method: "PUT", bearer: `Bearer ${runToken}` },
    { url: `${origin}${desktopArtifactPath}/${turnId}/${artifactId}/confirm`, method: "POST", bearer: `Bearer ${runToken}` },
  ])
  expect(returnedBeforeFallback).toHaveBeenCalledExactlyOnceWith(failure === "refused" ? 1 : 0, bytes)
})

it("does not fall back or confirm when the direct upload fails source verification", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2, failAtEnd: true })
  const fetcher = installFetch(async ({ init }) => {
    await readBodyChunks(init).catch(() => undefined)
    return new Response(null, { status: 403 })
  })
  await expect(run(storageGrant(), source)).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_BUSY" })
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("does not fall back or confirm when the direct upload is cancelled", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const controller = new AbortController()
  const reason = new Error("cancelled")
  const fetcher = installFetch(() => {
    controller.abort(reason)
    return new Response(null, { status: 403 })
  })
  await expect(run(storageGrant(), source, controller.signal)).rejects.toBe(reason)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("leaves time for an API fallback when the direct connection stalls", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const deadline = new AbortController()
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
  const timeout = vi.spyOn(AbortSignal, "timeout")
    .mockImplementationOnce(nativeTimeout)
    .mockReturnValueOnce(deadline.signal)
  const caller = AbortSignal.abort()
  const signal = nativeTimeout(5_000)
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.hostname === "objects.example.test") {
      deadline.abort(caller.reason)
      init?.signal?.throwIfAborted()
    }
    if (url.pathname.endsWith("/upload")) {
      await readBodyChunks(init)
      return new Response(null, { status: 204 })
    }
    return Response.json(receipt())
  })
  try {
    await expect(run(storageGrant(), source, signal)).resolves.toEqual(receipt())
    expect(timeout.mock.calls[1]?.[0]).toBeLessThan(timeout.mock.calls[0]?.[0] ?? 0)
    expect(fetcher).toHaveBeenCalledTimes(3)
  } finally {
    timeout.mockRestore()
  }
})

it.each(["artifact_id", "file_id"] as const)(
  "rejects a confirm receipt whose %s falls outside the grant",
  async field => {
    const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
    const fetcher = installFetch(async ({ url, init }) => {
      if (url.pathname.endsWith("/upload")) {
        await readBodyChunks(init)
        return new Response(null, { status: 204 })
      }
      return Response.json({ ...receipt(), [field]: randomUUID() })
    })

    await expect(run(apiGrant(), source)).rejects.toMatchObject({
      code: "RUNNER_OPERATION_UNCERTAIN", retryable: false, artifactId,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  },
)

it("rejects a confirm response that is not a receipt without retrying", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      await readBodyChunks(init)
      return new Response(null, { status: 204 })
    }
    return Response.json({ success: true, artifact_id: artifactId })
  })

  await expect(run(apiGrant(), source)).rejects.toMatchObject({
    code: "RUNNER_OPERATION_UNCERTAIN", retryable: false, artifactId,
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it("maps a confirm failure with a stable typed error and no retry", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      await readBodyChunks(init)
      return new Response(null, { status: 204 })
    }
    return new Response(
      JSON.stringify({ error_code: "ARTIFACT_REGISTRATION_INVALID" }),
      { status: 400 },
    )
  })

  await expect(run(apiGrant(), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_INVALID",
    retryable: false,
    statusCode: 400,
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it("returns the original artifact ID without replay when the confirmation response is lost", async () => {
  const { source } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.pathname.endsWith("/upload")) {
      await readBodyChunks(init)
      return new Response(null, { status: 204 })
    }
    throw new TypeError("connection closed after confirmation")
  })

  await expect(run(apiGrant(), source)).rejects.toMatchObject({
    code: "RUNNER_OPERATION_UNCERTAIN", retryable: false, artifactId,
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it("rejects invalid scoped inputs before reading the source", async () => {
  const { source, state } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(() => new Response(null, { status: 204 }))
  const common = {
    origin,
    turnId,
    runToken,
    source,
    grant: apiGrant(),
    signal: AbortSignal.timeout(5_000),
  }

  for (const input of [
    { ...common, origin: "http://server.example.test" },
    { ...common, turnId: "not-a-uuid" },
    { ...common, runToken: "not-a-run-token" },
    { ...common, source: { ...source, sizeBytes: -1 } },
  ]) {
    await expect(uploadDesktopArtifact(input)).rejects.toMatchObject({
      code: "ARTIFACT_REGISTRATION_INVALID",
    })
  }
  expect(state.returnCalls).toBe(0)
  expect(fetcher).not.toHaveBeenCalled()
})

it("rejects an already expired grant before reading the source", async () => {
  const { source, state } = artifactSource(Buffer.from("fixture"), { chunkSize: 2 })
  const fetcher = installFetch(() => new Response(null, { status: 204 }))

  await expect(
    run(
      apiGrant({ expires_at: new Date(Date.now() - 1_000).toISOString() }),
      source,
    ),
  ).rejects.toBeInstanceOf(FileServiceRequestError)
  expect(state.returnCalls).toBe(0)
  expect(fetcher).not.toHaveBeenCalled()
})

it("uploads every presigned part in grant order with exact source slices", async () => {
  const bytes = partFixtureBytes()
  // 3 MiB chunks straddle the 32 MiB part boundary, so the slice carry is exercised.
  const { source, state } = artifactSource(bytes, { chunkSize: 3 * 1024 * 1024 })
  const parts = [storagePart(0), storagePart(1)]
  const stored: { url: URL; init: RequestInit; headers: Headers; body: Buffer; validated: boolean }[] = []
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.hostname === "objects.example.test") {
      if (!init) throw new Error("Missing storage init")
      stored.push({
        url,
        init,
        headers: new Headers(init.headers),
        body: Buffer.concat(await readBodyChunks(init)),
        validated: state.validated,
      })
      return new Response(null, { status: 204 })
    }
    return Response.json(receipt())
  })

  await expect(
    run(partsGrant(parts), source, AbortSignal.timeout(30_000)),
  ).resolves.toEqual(receipt())

  expect(stored.map(entry => entry.url.href)).toEqual(parts.map(part => part.url))
  const expectedFiles = [
    bytes.subarray(0, desktopArtifactPartBytes),
    bytes.subarray(desktopArtifactPartBytes),
  ]
  stored.forEach((entry, index) => {
    const part = parts[index]
    const expectedFile = expectedFiles[index]
    if (!part || !expectedFile) throw new Error("Missing part request")
    expect(entry.init.method).toBe("POST")
    expect(entry.init.redirect).toBe("error")
    expect(entry.init.credentials).toBe("omit")
    // Only multipart framing headers cross to storage: no bearer, cookies or device headers.
    expect([...entry.headers.keys()].sort()).toEqual(["content-length", "content-type"])
    expect(entry.headers.get("authorization")).toBeNull()
    expect(entry.headers.get("cookie")).toBeNull()
    expect(Number(entry.headers.get("content-length"))).toBe(entry.body.byteLength)
    const form = parsePresignedForm(entry.body, entry.headers.get("content-type") ?? "")
    for (const [name, value] of Object.entries(part.fields)) {
      expect(formField(form.fieldText, name)).toBe(value)
    }
    expect(form.file.equals(expectedFile)).toBe(true)
  })

  // The final form is withheld until the source verified EOF count and digest.
  expect(stored.map(entry => entry.validated)).toEqual([false, true])
  // One verified source read serves every part; no reread or replay.
  expect(state.readCalls).toBe(1)
  expect(state.validated).toBe(true)
  expect(state.closeCalls).toBe(0)

  const confirm = fetcher.mock.calls.at(-1)
  if (!confirm) throw new Error("Missing confirm request")
  expect(requestUrl(confirm[0]).href).toBe(
    new URL(`${desktopArtifactPath}/${turnId}/${artifactId}/confirm`, origin).href,
  )
  expect(confirm[1]?.method).toBe("POST")
  expect(confirm[1]?.body ?? null).toBeNull()
  expect(new Headers(confirm[1]?.headers).get("authorization")).toBe(`Bearer ${runToken}`)
  expect(fetcher).toHaveBeenCalledTimes(3)
})

it("rejects a part count that does not match the source size before any transfer", async () => {
  const { source, state } = artifactSource(Buffer.from("artifact-bytes-fixture"), { chunkSize: 4 })
  const part = storagePart(0)
  const fetcher = installFetch(() => new Response(null, { status: 204 }))

  await expect(run(partsGrant([part, storagePart(1)]), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_INVALID",
  })
  await expect(run(partsGrant([]), source)).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_INVALID",
  })
  await expect(
    run(partsGrant([part]), { ...source, sizeBytes: desktopArtifactPartBytes + 1 }),
  ).rejects.toMatchObject({ code: "ARTIFACT_REGISTRATION_INVALID" })

  expect(state.readCalls).toBe(0)
  expect(fetcher).not.toHaveBeenCalled()
})

it("stops on a part transfer error without api fallback or confirmation", async () => {
  const bytes = partFixtureBytes()
  const { source, state } = artifactSource(bytes, { chunkSize: desktopArtifactPartBytes })
  const parts = [storagePart(0), storagePart(1)]
  const [firstPart] = parts
  if (!firstPart) throw new Error("Expected a first part")
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.hostname === "objects.example.test") {
      await readBodyChunks(init)
      return new Response(null, { status: 403 })
    }
    return Response.json(receipt())
  })

  await expect(
    run(partsGrant(parts), source, AbortSignal.timeout(30_000)),
  ).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_FAILED",
    retryable: false,
    statusCode: 400,
  })
  expect(fetcher.mock.calls.map(([url]) => requestUrl(url).href)).toEqual([firstPart.url])
  expect(state.readCalls).toBe(1)
  expect(state.validated).toBe(false)
})

it("withholds the final part and confirmation when the source fails trailing verification", async () => {
  const bytes = partFixtureBytes()
  const { source, state } = artifactSource(bytes, {
    chunkSize: 3 * 1024 * 1024,
    failAtEnd: true,
  })
  const parts = [storagePart(0), storagePart(1)]
  const [firstPart] = parts
  if (!firstPart) throw new Error("Expected a first part")
  const requested: string[] = []
  const fetcher = installFetch(async ({ url, init }) => {
    if (url.hostname === "objects.example.test") {
      requested.push(url.href)
      await readBodyChunks(init).catch(() => undefined)
      return new Response(null, { status: 204 })
    }
    return Response.json(receipt())
  })

  await expect(
    run(partsGrant(parts), source, AbortSignal.timeout(30_000)),
  ).rejects.toMatchObject({
    code: "ARTIFACT_REGISTRATION_BUSY",
    retryable: true,
    statusCode: 409,
  })
  expect(requested).toEqual([firstPart.url])
  expect(state.validated).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it("stops the parts upload on caller abort and never confirms", async () => {
  const bytes = Buffer.from("parts-abort-fixture")
  const { source, state } = artifactSource(bytes, { chunkSize: 3 })
  const controller = new AbortController()
  const reason = new Error("caller stopped the parts upload")
  const fetcher = installFetch(async ({ url }) => {
    if (url.hostname === "objects.example.test") {
      controller.abort(reason)
      throw reason
    }
    return Response.json(receipt())
  })

  await expect(
    run(partsGrant([storagePart(0)]), source, controller.signal),
  ).rejects.toBe(reason)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(state.closeCalls).toBe(0)
})

it("stops buffering the final part when the caller aborts before eof", async () => {
  const controller = new AbortController()
  const reason = new Error("stopped before eof")
  const state = { readCalls: 0, returned: false }
  const source: DesktopArtifactSource = {
    sizeBytes: 64,
    sha256: "0".repeat(64),
    async *read(signal) {
      state.readCalls += 1
      try {
        yield Buffer.from([1, 2, 3, 4])
        // The caller aborts while the runner is still buffering the final slice.
        controller.abort(reason)
        signal.throwIfAborted()
        yield Buffer.alloc(0)
      } finally {
        state.returned = true
      }
    },
    async close() {},
  }
  const fetcher = installFetch(() => new Response(null, { status: 204 }))

  await expect(
    run(partsGrant([storagePart(0)]), source, controller.signal),
  ).rejects.toBe(reason)
  expect(state.readCalls).toBe(1)
  expect(state.returned).toBe(true)
  expect(fetcher).not.toHaveBeenCalled()
})
