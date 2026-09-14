import { parseDocument } from "yaml"

const FRONTMATTER_LIMIT_CHARS = 32_000

export interface SkillManifestMetadata {
  name: string
  description?: string | null
}

export class SkillManifestValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "SkillManifestValidationError"
  }
}

export function parseSkillManifest(
  markdown: string,
): SkillManifestMetadata {
  const frontmatter = extractSkillFrontmatter(markdown)
  const document = parseDocument(frontmatter, { prettyErrors: false })
  if (document.errors.length > 0) {
    throw new SkillManifestValidationError("skill frontmatter is invalid YAML", {
      cause: document.errors[0],
    })
  }

  let value: unknown
  try {
    value = document.toJS({ maxAliasCount: 32 })
  } catch (error) {
    throw new SkillManifestValidationError("skill frontmatter is invalid YAML", {
      cause: error,
    })
  }

  if (!isRecord(value)) {
    throw new SkillManifestValidationError(
      "skill frontmatter must be a YAML mapping",
    )
  }

  const name = value.name
  if (typeof name !== "string" || name.trim() === "") {
    throw new SkillManifestValidationError(
      "skill frontmatter name is required",
    )
  }

  const metadata: SkillManifestMetadata = { name: name.trim() }
  if ("description" in value && value.description !== undefined) {
    const description = value.description
    if (description !== null && typeof description !== "string") {
      throw new SkillManifestValidationError(
        "skill frontmatter description must be a string",
      )
    }
    if (typeof description === "string") {
      const normalized = description.trim()
      if (normalized.length > 4_000) {
        throw new SkillManifestValidationError(
          "skill frontmatter description is too long",
        )
      }
      metadata.description = normalized
    } else {
      metadata.description = null
    }
  }

  return metadata
}

function extractSkillFrontmatter(markdown: string): string {
  return splitSkillMarkdown(markdown).frontmatter
}

export function splitSkillMarkdown(markdown: string): {
  frontmatter: string
  prefix: string
  content: string
} {
  const source = markdown.startsWith("\uFEFF")
    ? markdown.slice(1)
    : markdown
  const firstLineEnd = source.indexOf("\n")
  if (firstLineEnd < 0) {
    throw new SkillManifestValidationError(
      "skill frontmatter opening delimiter is missing",
    )
  }
  const openingLine = stripLineEnding(source.slice(0, firstLineEnd))
  if (!/^---[ \t]*$/u.test(openingLine)) {
    throw new SkillManifestValidationError(
      "skill frontmatter opening delimiter is missing",
    )
  }

  const frontmatterStart = firstLineEnd + 1
  let lineStart = frontmatterStart
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart)
    const rawLine =
      lineEnd < 0 ? source.slice(lineStart) : source.slice(lineStart, lineEnd)
    const line = stripLineEnding(rawLine)
    if (/^---[ \t]*$/u.test(line)) {
      const frontmatter = source.slice(frontmatterStart, lineStart)
      if (frontmatter.length > FRONTMATTER_LIMIT_CHARS) {
        throw new SkillManifestValidationError(
          "skill frontmatter is too large",
        )
      }
      const contentStart = lineEnd < 0 ? source.length : lineEnd + 1
      return {
        frontmatter,
        prefix: (markdown.startsWith("\uFEFF") ? "\uFEFF" : "") + source.slice(0, contentStart),
        content: source.slice(contentStart),
      }
    }

    if (lineStart - frontmatterStart > FRONTMATTER_LIMIT_CHARS) {
      throw new SkillManifestValidationError("skill frontmatter is too large")
    }
    if (lineEnd < 0) break
    lineStart = lineEnd + 1
  }

  throw new SkillManifestValidationError(
    "skill frontmatter closing delimiter is missing",
  )
}

function stripLineEnding(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
