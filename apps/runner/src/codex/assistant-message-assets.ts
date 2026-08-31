import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { fileURLToPath } from "node:url"

import type {
  Definition,
  Image,
  ImageReference,
  Nodes,
  Parent,
  Root,
} from "mdast"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfm } from "micromark-extension-gfm"
import { z } from "zod"

import { workspacePermissionPolicy } from "@linksense/shared"

import type { AuthorizedTurnSkill } from "../context.js"

const MAX_INLINE_IMAGES = 12
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024
const INLINE_IMAGE_SCHEME = "linksense-artifact:"
const UNAVAILABLE_INLINE_IMAGE_URL = `${INLINE_IMAGE_SCHEME}unavailable`
const INLINE_IMAGE_DIRECTORY_MODE =
  workspacePermissionPolicy.sharedReadonlyDirectory
const INLINE_IMAGE_FILE_MODE = workspacePermissionPolicy.sharedReadonlyFile

const artifactRegistrationResultSchema = z.object({
  file_id: z.uuid(),
})

type InlineImageMime = "image/jpeg" | "image/png" | "image/webp"

type MarkdownImage = Readonly<{
  start: number
  end: number
  url: string
  alt: string
  definitionRange?: Readonly<{
    start: number
    end: number
  }>
}>

type AllowedRoot = Readonly<{
  logicalPath: string
  canonicalPath: string
}>

type Replacement = Readonly<{
  start: number
  end: number
  value: string
}>

export type AssistantMessageAssetProjection = Readonly<{
  text: string
  registeredImageCount: number
  unavailableImageCount: number
}>

export type ImageViewAssetProjection = Readonly<{
  fileId: string
}>

export type RegisterInlineImageArtifact = (input: {
  workspaceRelativePath: string
  displayName: string
  mimeType: InlineImageMime
  artifactKind: "inline_image"
}) => Promise<unknown>

export async function projectAssistantMessageAssets(input: {
  text: string
  workspace: string
  codexHome: string
  authorizedSkills: readonly AuthorizedTurnSkill[]
  turnId: string
  itemId: string
  registerArtifact: RegisterInlineImageArtifact
}): Promise<AssistantMessageAssetProjection> {
  const images = collectMarkdownImages(input.text)
  if (images.length === 0) {
    return {
      text: input.text,
      registeredImageCount: 0,
      unavailableImageCount: 0,
    }
  }

  const roots = await allowedImageRoots(
    input.workspace,
    input.authorizedSkills,
  )
  const replacements: Replacement[] = []
  const removedDefinitions = new Set<string>()
  const registrations = new Map<string, Promise<string>>()
  let registeredImageCount = 0
  let unavailableImageCount = 0
  let localImageIndex = 0
  let temporaryDirectory: string | null = null

  const ensureTemporaryDirectory = async () => {
    if (temporaryDirectory) return temporaryDirectory
    temporaryDirectory = await createInlineImageTemporaryDirectory({
      workspace: input.workspace,
      turnId: input.turnId,
      itemId: input.itemId,
    })
    return temporaryDirectory
  }

  try {
    for (const image of images) {
      if (
        image.url.startsWith(INLINE_IMAGE_SCHEME) ||
        !isLocalImageUrl(image.url)
      ) {
        continue
      }

      const imageIndex = localImageIndex
      localImageIndex += 1
      let replacementUrl = UNAVAILABLE_INLINE_IMAGE_URL
      if (imageIndex < MAX_INLINE_IMAGES) {
        const source = localImagePath(image.url, {
          workspace: input.workspace,
          codexHome: input.codexHome,
        })
        if (source) {
          const registrationKey = source
          const existing = registrations.get(registrationKey)
          const registration =
            existing ??
            registerLocalImage({
              source,
              roots,
              temporaryDirectory: ensureTemporaryDirectory,
              imageIndex,
              registerArtifact: input.registerArtifact,
            })
          if (!existing) registrations.set(registrationKey, registration)
          replacementUrl = await registration.catch(
            () => UNAVAILABLE_INLINE_IMAGE_URL,
          )
        }
      }

      if (replacementUrl === UNAVAILABLE_INLINE_IMAGE_URL) {
        unavailableImageCount += 1
      } else {
        registeredImageCount += 1
      }
      replacements.push({
        start: image.start,
        end: image.end,
        value: markdownImage(image.alt, replacementUrl),
      })
      removeLocalImageDefinition(
        image,
        replacements,
        removedDefinitions,
      )
    }
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      )
    }
  }

  return {
    text: applyReplacements(input.text, replacements),
    registeredImageCount,
    unavailableImageCount,
  }
}

export async function projectImageViewAsset(input: {
  path: string
  workspace: string
  codexHome: string
  authorizedSkills: readonly AuthorizedTurnSkill[]
  turnId: string
  itemId: string
  registerArtifact: RegisterInlineImageArtifact
}): Promise<ImageViewAssetProjection> {
  const source = localImagePath(input.path, {
    workspace: input.workspace,
    codexHome: input.codexHome,
  })
  if (!source) throw new Error("image_view_path_invalid")

  const roots = await allowedImageRoots(
    input.workspace,
    input.authorizedSkills,
  )
  let temporaryDirectory: string | null = null
  const ensureTemporaryDirectory = async () => {
    if (temporaryDirectory) return temporaryDirectory
    temporaryDirectory = await createInlineImageTemporaryDirectory({
      workspace: input.workspace,
      turnId: input.turnId,
      itemId: input.itemId,
    })
    return temporaryDirectory
  }

  try {
    const url = await registerLocalImage({
      source,
      roots,
      temporaryDirectory: ensureTemporaryDirectory,
      imageIndex: 0,
      displayName: basename(source),
      registerArtifact: input.registerArtifact,
    })
    return { fileId: url.slice(INLINE_IMAGE_SCHEME.length) }
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(
        () => undefined,
      )
    }
  }
}

export function blockUnresolvedLocalMarkdownImages(
  text: string,
): string {
  const replacements: Replacement[] = []
  const removedDefinitions = new Set<string>()
  for (const image of collectMarkdownImages(text)) {
    if (!isLocalImageUrl(image.url)) continue
    replacements.push({
      start: image.start,
      end: image.end,
      value: markdownImage(image.alt, UNAVAILABLE_INLINE_IMAGE_URL),
    })
    removeLocalImageDefinition(
      image,
      replacements,
      removedDefinitions,
    )
  }
  return applyReplacements(text, replacements)
}

async function registerLocalImage(input: {
  source: string
  roots: readonly AllowedRoot[]
  temporaryDirectory: () => Promise<string>
  imageIndex: number
  displayName?: string
  registerArtifact: RegisterInlineImageArtifact
}): Promise<string> {
  const source = await validateSource(input.source, input.roots)
  const data = await readStableImage(source)
  const mimeType = detectImageMime(data)
  if (!mimeType) throw new Error("inline_image_type_unsupported")

  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg"
  const checksum = createHash("sha256").update(data).digest("hex")
  const directory = await input.temporaryDirectory()
  const displayName =
    input.displayName ?? `inline-image-${input.imageIndex + 1}.${extension}`
  const temporaryPath = join(directory, `${checksum}.${extension}`)
  await writeFile(temporaryPath, data, {
    flag: "wx",
    mode: INLINE_IMAGE_FILE_MODE,
  }).catch(async (error: unknown) => {
    if (!hasErrorCode(error, "EEXIST")) throw error
    const existing = await readFile(temporaryPath)
    const existingChecksum = createHash("sha256")
      .update(existing)
      .digest("hex")
    if (existingChecksum !== checksum) {
      throw new Error("inline_image_temporary_file_conflict")
    }
  })
  await chmod(temporaryPath, INLINE_IMAGE_FILE_MODE)

  const workspaceRelativePath = relative(
    input.roots[0]?.logicalPath ?? "",
    temporaryPath,
  )
  if (
    !workspaceRelativePath ||
    workspaceRelativePath === ".." ||
    workspaceRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(workspaceRelativePath)
  ) {
    throw new Error("inline_image_workspace_path_invalid")
  }
  const result = artifactRegistrationResultSchema.parse(
    await input.registerArtifact({
      workspaceRelativePath,
      displayName,
      mimeType,
      artifactKind: "inline_image",
    }),
  )
  return `${INLINE_IMAGE_SCHEME}${result.file_id}`
}

async function createInlineImageTemporaryDirectory(input: {
  workspace: string
  turnId: string
  itemId: string
}): Promise<string> {
  const internalRoot = join(input.workspace, ".linksense")
  const handoffRoot = join(internalRoot, "inline-images")
  await mkdir(handoffRoot, {
    recursive: true,
    mode: INLINE_IMAGE_DIRECTORY_MODE,
  })
  await Promise.all([
    chmod(internalRoot, INLINE_IMAGE_DIRECTORY_MODE),
    chmod(handoffRoot, INLINE_IMAGE_DIRECTORY_MODE),
  ])
  const temporaryDirectory = await mkdtemp(
    join(
      handoffRoot,
      `${safePathSegment(input.turnId)}-${safePathSegment(input.itemId)}-`,
    ),
  )
  await chmod(temporaryDirectory, INLINE_IMAGE_DIRECTORY_MODE)
  return temporaryDirectory
}

async function allowedImageRoots(
  workspace: string,
  authorizedSkills: readonly AuthorizedTurnSkill[],
): Promise<AllowedRoot[]> {
  const candidates = [
    workspace,
    ...authorizedSkills.map((skill) => join(dirname(skill.path), "assets")),
  ]
  const roots: AllowedRoot[] = []
  for (const logicalPath of candidates) {
    const canonicalPath = await realpath(logicalPath).catch(() => null)
    if (!canonicalPath) continue
    roots.push({ logicalPath: resolve(logicalPath), canonicalPath })
  }
  return roots
}

async function validateSource(
  source: string,
  roots: readonly AllowedRoot[],
): Promise<string> {
  const resolvedSource = resolve(source)
  const sourceStats = await lstat(resolvedSource)
  if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
    throw new Error("inline_image_source_invalid")
  }
  const canonicalSource = await realpath(resolvedSource)
  if (
    !roots.some((root) => isDescendant(root.canonicalPath, canonicalSource))
  ) {
    throw new Error("inline_image_source_forbidden")
  }
  return canonicalSource
}

async function readStableImage(source: string): Promise<Buffer> {
  const before = await stat(source)
  if (!before.isFile() || before.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("inline_image_source_too_large")
  }
  const data = await readFile(source)
  const after = await stat(source)
  if (
    data.byteLength !== before.size ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ino !== after.ino ||
    before.dev !== after.dev
  ) {
    throw new Error("inline_image_source_changed")
  }
  return data
}

function detectImageMime(data: Buffer): InlineImageMime | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png"
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg"
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

function collectMarkdownImages(text: string): MarkdownImage[] {
  let root: Root
  try {
    root = fromMarkdown(text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    })
  } catch {
    return []
  }

  const definitions = new Map<string, Definition>()
  visit(root, (node) => {
    if (node.type === "definition") {
      definitions.set(normalizeIdentifier(node.identifier), node)
    }
  })

  const images: MarkdownImage[] = []
  visit(root, (node) => {
    if (node.type !== "image" && node.type !== "imageReference") return
    const range = nodeOffsets(node)
    if (!range) return
    const url =
      node.type === "image"
        ? node.url
        : definitions.get(normalizeIdentifier(node.identifier))?.url
    if (!url) return
    const definition =
      node.type === "imageReference"
        ? definitions.get(normalizeIdentifier(node.identifier))
        : undefined
    const definitionRange = definition
      ? positionOffsets(definition)
      : null
    images.push({
      ...range,
      url,
      alt: node.alt ?? "",
      ...(definitionRange ? { definitionRange } : {}),
    })
  })
  return images
}

function visit(node: Nodes, visitor: (node: Nodes) => void): void {
  visitor(node)
  if (!("children" in node)) return
  for (const child of (node as Parent).children) visit(child, visitor)
}

function nodeOffsets(
  node: Image | ImageReference,
): { start: number; end: number } | null {
  return positionOffsets(node)
}

function positionOffsets(
  node: Pick<Nodes, "position">,
): { start: number; end: number } | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return typeof start === "number" && typeof end === "number"
    ? { start, end }
    : null
}

function removeLocalImageDefinition(
  image: MarkdownImage,
  replacements: Replacement[],
  removedDefinitions: Set<string>,
): void {
  if (!image.definitionRange) return
  const key = `${image.definitionRange.start}:${image.definitionRange.end}`
  if (removedDefinitions.has(key)) return
  removedDefinitions.add(key)
  replacements.push({
    ...image.definitionRange,
    value: "",
  })
}

function normalizeIdentifier(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase()
}

function isLocalImageUrl(value: string): boolean {
  if (
    !value ||
    value.startsWith(INLINE_IMAGE_SCHEME) ||
    value.startsWith("#") ||
    value.startsWith("//")
  ) {
    return false
  }
  const decoded = decodeUrlPath(value)
  if (
    decoded.startsWith("$CODEX_HOME/") ||
    decoded.startsWith("${CODEX_HOME}/") ||
    decoded.startsWith("$WORKSPACE/") ||
    decoded.startsWith("${WORKSPACE}/") ||
    decoded.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(decoded) ||
    decoded.startsWith("\\")
  ) {
    return true
  }
  const protocol = /^([a-z][a-z0-9+.-]*):/iu.exec(decoded)?.[1]?.toLowerCase()
  return protocol ? protocol === "file" : true
}

function localImagePath(
  value: string,
  roots: { workspace: string; codexHome: string },
): string | null {
  const decoded = decodeUrlPath(value)
  if (decoded.startsWith("file:")) {
    try {
      const url = new URL(decoded)
      if (url.hostname && url.hostname !== "localhost") return null
      return fileURLToPath(url)
    } catch {
      return null
    }
  }
  for (const [prefix, root] of [
    ["$CODEX_HOME/", roots.codexHome],
    ["${CODEX_HOME}/", roots.codexHome],
    ["$WORKSPACE/", roots.workspace],
    ["${WORKSPACE}/", roots.workspace],
  ] as const) {
    if (decoded.startsWith(prefix)) {
      return resolve(root, decoded.slice(prefix.length))
    }
  }
  if (/^[A-Za-z]:[\\/]/u.test(decoded) || decoded.startsWith("\\")) {
    return null
  }
  return isAbsolute(decoded)
    ? resolve(decoded)
    : resolve(roots.workspace, decoded)
}

function decodeUrlPath(value: string): string {
  let decoded = value
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

function markdownImage(alt: string, url: string): string {
  return `![${alt.replace(/\\/gu, "\\\\").replace(/\]/gu, "\\]")}](${url})`
}

function applyReplacements(
  text: string,
  replacements: readonly Replacement[],
): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.value}${current.slice(replacement.end)}`,
      text,
    )
}

function isDescendant(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  )
}

function safePathSegment(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 80)
  return safe || "turn"
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}
