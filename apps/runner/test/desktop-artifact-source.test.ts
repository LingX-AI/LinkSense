import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFile,
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, expect, it } from "vitest"

import {
  DESKTOP_ARTIFACT_CHUNK_BYTES,
  DesktopArtifactSourceError,
  openDesktopArtifactSource,
  type DesktopArtifactSource,
  type DesktopArtifactSourceErrorCode,
} from "../src/desktop/artifact-source.js"

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

const temporaryDirectories = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
  temporaryDirectories.clear()
})

async function temporaryDirectory(
  prefix = "linksense-desktop-artifact-",
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.add(directory)
  return directory
}

function freshSignal(): AbortSignal {
  return new AbortController().signal
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function patternedBytes(length: number): Buffer {
  const block = Buffer.from("linksense-desktop-artifact-0123456789")
  const bytes = Buffer.alloc(length)
  for (let offset = 0; offset < length; offset += block.byteLength) {
    block.copy(bytes, offset, 0, Math.min(block.byteLength, length - offset))
  }
  return bytes
}

async function collect(
  source: DesktopArtifactSource,
  signal: AbortSignal = freshSignal(),
): Promise<Buffer[]> {
  const chunks: Buffer[] = []
  for await (const chunk of source.read(signal)) chunks.push(chunk)
  return chunks
}

async function drain(iterator: AsyncGenerator<Buffer>): Promise<void> {
  let next = await iterator.next()
  while (!next.done) next = await iterator.next()
}

async function expectAbort(value: Promise<unknown>): Promise<void> {
  const failure: unknown = await value.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(failure).not.toBeNull()
  expect((failure as { name?: unknown }).name).toBe("AbortError")
}

async function refusal(
  promise: Promise<DesktopArtifactSource>,
): Promise<DesktopArtifactSourceError> {
  const failure: unknown = await promise.then(
    async (source) => {
      await source.close()
      return null
    },
    (reason: unknown) => reason,
  )
  expect(failure).toBeInstanceOf(DesktopArtifactSourceError)
  if (!(failure instanceof DesktopArtifactSourceError)) {
    throw new Error("expected a DesktopArtifactSourceError")
  }
  return failure
}

async function expectRefusal(
  root: string,
  workspaceRelativePath: string,
  maximumBytes: number,
  code: DesktopArtifactSourceErrorCode,
): Promise<DesktopArtifactSourceError> {
  const failure = await refusal(
    openDesktopArtifactSource(
      root,
      workspaceRelativePath,
      maximumBytes,
      freshSignal(),
    ),
  )
  expect(failure.code).toBe(code)
  return failure
}

it("pins a nested regular file and streams bounded chunks matching its digest", async () => {
  const root = await temporaryDirectory()
  const bytes = patternedBytes(DESKTOP_ARTIFACT_CHUNK_BYTES * 2 + 123)
  await mkdir(path.join(root, "nested"))
  await writeFile(path.join(root, "nested", "artifact.bin"), bytes)

  const source = await openDesktopArtifactSource(
    root,
    "nested/artifact.bin",
    bytes.byteLength,
    freshSignal(),
  )
  try {
    expect(source.sizeBytes).toBe(bytes.byteLength)
    expect(source.sha256).toBe(sha256(bytes))
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(Object.keys(source).sort()).toEqual([
      "close",
      "read",
      "sha256",
      "sizeBytes",
    ])

    const chunks = await collect(source)
    expect(chunks.length).toBeGreaterThan(1)
    expect(
      chunks.every(
        (chunk) =>
          chunk.byteLength > 0 &&
          chunk.byteLength <= DESKTOP_ARTIFACT_CHUNK_BYTES,
      ),
    ).toBe(true)
    const streamed = Buffer.concat(chunks)
    expect(streamed.byteLength).toBe(bytes.byteLength)
    expect(streamed.equals(bytes)).toBe(true)

    const repeated = Buffer.concat(await collect(source))
    expect(repeated.equals(bytes)).toBe(true)
  } finally {
    await source.close()
  }
  await source.close()
})

it("accepts an empty regular file without yielding chunks", async () => {
  const root = await temporaryDirectory()
  await writeFile(path.join(root, "empty.bin"), Buffer.alloc(0))

  const source = await openDesktopArtifactSource(
    root,
    "empty.bin",
    0,
    freshSignal(),
  )
  try {
    expect(source.sizeBytes).toBe(0)
    expect(source.sha256).toBe(sha256(Buffer.alloc(0)))
    expect(await collect(source)).toEqual([])
  } finally {
    await source.close()
  }
})

it("enforces the maximum byte count including the exact limit", async () => {
  const root = await temporaryDirectory()
  await writeFile(path.join(root, "artifact.bin"), Buffer.from("12345678"))

  const accepted = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    8,
    freshSignal(),
  )
  await accepted.close()

  const failure = await expectRefusal(
    root,
    "artifact.bin",
    7,
    "FILE_LIMIT_EXCEEDED",
  )
  expect(failure.statusCode).toBe(413)
  expect(failure.retryable).toBe(false)
})

it("reports missing files, missing roots, and non-directory roots", async () => {
  const root = await temporaryDirectory()
  await expectRefusal(root, "missing.txt", 1024, "ARTIFACT_NOT_FOUND")
  await expectRefusal(
    path.join(root, "missing-root"),
    "file.txt",
    1024,
    "ARTIFACT_NOT_FOUND",
  )

  const rootFile = path.join(root, "root.txt")
  await writeFile(rootFile, "not a directory")
  await expectRefusal(
    rootFile,
    "file.txt",
    1024,
    "ARTIFACT_REGISTRATION_INVALID",
  )
})

it("rejects malformed relative paths", async () => {
  const root = await temporaryDirectory()
  for (const value of [
    "",
    ".",
    "..",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "\\\\server\\share\\file",
    "nested\u0000file",
    "../outside.txt",
    "nested/../../outside.txt",
    "nested/./artifact.bin",
    "nested//artifact.bin",
    "nested/artifact.bin/",
    "nested\\artifact.bin",
  ]) {
    await expectRefusal(root, value, 1024, "ARTIFACT_REGISTRATION_INVALID")
  }
})

it("rejects dot and backslash components that would alias trusted files", async () => {
  const root = await temporaryDirectory()
  await mkdir(path.join(root, "nested"))
  await writeFile(path.join(root, "artifact.bin"), "trusted")
  // A literal backslash filename exists on macOS; it must still be refused.
  await writeFile(path.join(root, "nested\\artifact.bin"), "literal")

  for (const value of [
    "./artifact.bin",
    "nested/../artifact.bin",
    "nested\\artifact.bin",
  ]) {
    await expectRefusal(root, value, 1024, "ARTIFACT_REGISTRATION_INVALID")
  }
})

it("rejects invalid byte limits", async () => {
  const root = await temporaryDirectory()
  await writeFile(path.join(root, "artifact.bin"), "content")
  for (const maximumBytes of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    await expectRefusal(
      root,
      "artifact.bin",
      maximumBytes,
      "ARTIFACT_REGISTRATION_INVALID",
    )
  }
})

it("rejects a symlinked file and keeps paths out of diagnostics", async () => {
  const root = await temporaryDirectory()
  const outside = await temporaryDirectory("linksense-artifact-outside-")
  const secret = path.join(outside, "secret.txt")
  await writeFile(secret, "outside")
  await symlink(secret, path.join(root, "alias.txt"))

  const failure = await expectRefusal(
    root,
    "alias.txt",
    1024,
    "FILE_SERVICE_FORBIDDEN",
  )
  expect(failure.message).toBe("FILE_SERVICE_FORBIDDEN")
  expect(failure.message).not.toContain(root)
  expect(failure.message).not.toContain("alias.txt")
})

it("rejects a file reached through a symlinked directory", async () => {
  const root = await temporaryDirectory()
  const outside = await temporaryDirectory("linksense-artifact-outside-")
  await writeFile(path.join(outside, "secret.txt"), "outside")
  await symlink(outside, path.join(root, "linked"))

  await expectRefusal(
    root,
    "linked/secret.txt",
    1024,
    "FILE_SERVICE_FORBIDDEN",
  )
})

it("rejects directories", async () => {
  const root = await temporaryDirectory()
  await mkdir(path.join(root, "folder"))
  await expectRefusal(root, "folder", 1024, "FILE_SERVICE_FORBIDDEN")
})

it.skipIf(process.platform === "win32")(
  "rejects FIFOs without blocking",
  async () => {
    const root = await temporaryDirectory()
    await run("mkfifo", [path.join(root, "pipe")])
    await expectRefusal(root, "pipe", 1024, "FILE_SERVICE_FORBIDDEN")
  },
)

it("rejects files hardlinked from outside the workspace", async () => {
  const root = await temporaryDirectory()
  const outside = await temporaryDirectory("linksense-artifact-outside-")
  const shared = path.join(outside, "shared.bin")
  await writeFile(shared, "shared")
  await link(shared, path.join(root, "hardlinked.bin"))

  await expectRefusal(
    root,
    "hardlinked.bin",
    1024,
    "FILE_SERVICE_FORBIDDEN",
  )
})

it("honors an already-aborted signal", async () => {
  const root = await temporaryDirectory()
  await writeFile(path.join(root, "artifact.bin"), "content")
  const controller = new AbortController()
  controller.abort()

  await expectAbort(
    openDesktopArtifactSource(
      root,
      "artifact.bin",
      1024,
      controller.signal,
    ),
  )
})

it("aborts hashing while the source is opening", async () => {
  const root = await temporaryDirectory()
  await writeFile(
    path.join(root, "large.bin"),
    patternedBytes(16 * 1024 * 1024),
  )
  const controller = new AbortController()
  setImmediate(() => controller.abort())

  await expectAbort(
    openDesktopArtifactSource(
      root,
      "large.bin",
      32 * 1024 * 1024,
      controller.signal,
    ),
  )
})

it("stops streaming when the signal aborts between chunks", async () => {
  const root = await temporaryDirectory()
  await writeFile(
    path.join(root, "artifact.bin"),
    patternedBytes(DESKTOP_ARTIFACT_CHUNK_BYTES * 3),
  )
  const source = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    DESKTOP_ARTIFACT_CHUNK_BYTES * 3,
    freshSignal(),
  )
  try {
    const controller = new AbortController()
    const iterator = source.read(controller.signal)
    const first = await iterator.next()
    expect(first.done).toBe(false)
    controller.abort()
    await expectAbort(iterator.next())
  } finally {
    await source.close()
  }
})

it("refuses a file appended after the snapshot was pinned", async () => {
  const root = await temporaryDirectory()
  const target = path.join(root, "artifact.bin")
  await writeFile(target, patternedBytes(4096))
  const source = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    1_000_000,
    freshSignal(),
  )
  try {
    await appendFile(target, Buffer.from("appended"))
    await expect(collect(source)).rejects.toMatchObject({
      name: "DesktopArtifactSourceError",
      code: "ARTIFACT_REGISTRATION_BUSY",
    })
  } finally {
    await source.close()
  }
})

it("refuses a path replaced by a different inode before streaming", async () => {
  const root = await temporaryDirectory()
  const target = path.join(root, "artifact.bin")
  const replacement = path.join(root, "replacement.bin")
  await writeFile(target, patternedBytes(4096))
  await writeFile(replacement, Buffer.alloc(4096, 0x41))

  const source = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    1_000_000,
    freshSignal(),
  )
  try {
    await rename(replacement, target)
    await expect(collect(source)).rejects.toMatchObject({
      name: "DesktopArtifactSourceError",
      code: "ARTIFACT_REGISTRATION_BUSY",
    })
  } finally {
    await source.close()
  }
})

it("refuses a workspace root replaced at the same path after opening", async () => {
  const root = await temporaryDirectory()
  const target = path.join(root, "artifact.bin")
  await writeFile(target, patternedBytes(4096))
  const moved = `${root}-moved`
  temporaryDirectories.add(moved)

  const source = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    1_000_000,
    freshSignal(),
  )
  try {
    await rename(root, moved)
    await mkdir(root)
    await writeFile(target, Buffer.alloc(4096, 0x62))
    await expect(collect(source)).rejects.toMatchObject({
      name: "DesktopArtifactSourceError",
      code: "ARTIFACT_REGISTRATION_BUSY",
    })
  } finally {
    await source.close()
  }
})

it("refuses an ancestor replaced by a symlink after opening", async () => {
  const root = await temporaryDirectory()
  await mkdir(path.join(root, "folder"))
  await writeFile(
    path.join(root, "folder", "artifact.bin"),
    patternedBytes(4096),
  )
  const outside = await temporaryDirectory("linksense-artifact-outside-")
  await writeFile(path.join(outside, "artifact.bin"), Buffer.alloc(4096, 0x63))

  const source = await openDesktopArtifactSource(
    root,
    "folder/artifact.bin",
    1_000_000,
    freshSignal(),
  )
  try {
    await rename(path.join(root, "folder"), path.join(root, "moved-folder"))
    await symlink(outside, path.join(root, "folder"))
    await expect(collect(source)).rejects.toMatchObject({
      name: "DesktopArtifactSourceError",
      code: "FILE_SERVICE_FORBIDDEN",
    })
  } finally {
    await source.close()
  }
})

it("fails streaming when the file is rewritten in place", async () => {
  const root = await temporaryDirectory()
  const target = path.join(root, "artifact.bin")
  const bytes = patternedBytes(DESKTOP_ARTIFACT_CHUNK_BYTES * 3)
  await writeFile(target, bytes)

  const source = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    bytes.byteLength,
    freshSignal(),
  )
  try {
    const iterator = source.read(freshSignal())
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(first.value?.byteLength).toBe(DESKTOP_ARTIFACT_CHUNK_BYTES)
    await writeFile(target, Buffer.alloc(bytes.byteLength, 0x7a))
    await expect(drain(iterator)).rejects.toMatchObject({
      name: "DesktopArtifactSourceError",
      code: "ARTIFACT_REGISTRATION_BUSY",
    })
  } finally {
    await source.close()
  }
})

it("closes once and refuses further reads", async () => {
  const root = await temporaryDirectory()
  await writeFile(path.join(root, "artifact.bin"), "content")

  const source = await openDesktopArtifactSource(
    root,
    "artifact.bin",
    1024,
    freshSignal(),
  )
  await source.close()
  await source.close()

  await expect(collect(source)).rejects.toMatchObject({
    name: "DesktopArtifactSourceError",
    code: "ARTIFACT_REGISTRATION_INVALID",
  })
})
