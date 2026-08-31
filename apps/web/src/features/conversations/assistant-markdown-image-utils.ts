import { defaultUrlTransform } from "react-markdown"

const INLINE_ARTIFACT_PREFIX = "linksense-artifact:"
const UNAVAILABLE_INLINE_ARTIFACT_URL = `${INLINE_ARTIFACT_PREFIX}unavailable`
const INLINE_ARTIFACT_URL_PATTERN =
  /^linksense-artifact:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu
const INLINE_ARTIFACT_URL_GLOBAL_PATTERN =
  /linksense-artifact:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/giu
const KNOWLEDGE_ASSET_URL_PATTERN =
  /^kb-asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu
const LEGACY_STREAMING_KNOWLEDGE_ASSET_URL_PATTERN =
  /^kb-asset:\$ABSOLUTE([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu

export function assistantMarkdownUrlTransform(
  url: string,
  key: string,
  node: Readonly<{ tagName: string }>
): string {
  if (node.tagName === "img") {
    const knowledgeAssetId = getKnowledgeAssetId(url)
    if (knowledgeAssetId) return `kb-asset://${knowledgeAssetId}`
    if (
      url === UNAVAILABLE_INLINE_ARTIFACT_URL ||
      INLINE_ARTIFACT_URL_PATTERN.test(url)
    ) {
      return url
    }
    if (
      url.startsWith(INLINE_ARTIFACT_PREFIX) ||
      url.startsWith("kb-asset:") ||
      isServerLocalUrl(url, true)
    ) {
      return UNAVAILABLE_INLINE_ARTIFACT_URL
    }
  } else if (isServerLocalUrl(url)) {
    return ""
  }
  void key
  return defaultUrlTransform(url)
}

export function getSafeAssistantMarkdownLinkUrl(value?: string): string | null {
  const candidate = value?.trim()
  if (!candidate) return null

  if (/^mailto:/iu.test(candidate)) {
    return defaultUrlTransform(candidate) || null
  }
  if (!/^https?:\/\//iu.test(candidate) || isLoopbackWebUrl(candidate)) {
    return null
  }

  try {
    return new URL(candidate).toString()
  } catch {
    return null
  }
}

export function collectInlineArtifactIds(markdown: string): Set<string> {
  return new Set(
    Array.from(markdown.matchAll(INLINE_ARTIFACT_URL_GLOBAL_PATTERN), (match) =>
      match[1]!.toLowerCase()
    )
  )
}

export function getInlineArtifactId(value?: string): string | null {
  return (
    INLINE_ARTIFACT_URL_PATTERN.exec(value ?? "")?.[1]?.toLowerCase() ?? null
  )
}

export function isInlineArtifactUrl(value?: string): boolean {
  return value?.startsWith(INLINE_ARTIFACT_PREFIX) ?? false
}

export function getKnowledgeAssetId(value?: string): string | null {
  const candidate = value ?? ""
  return (
    KNOWLEDGE_ASSET_URL_PATTERN.exec(candidate)?.[1]?.toLowerCase() ??
    LEGACY_STREAMING_KNOWLEDGE_ASSET_URL_PATTERN.exec(
      candidate
    )?.[1]?.toLowerCase() ??
    null
  )
}

export function isKnowledgeAssetUrl(value?: string): boolean {
  return value?.startsWith("kb-asset:") ?? false
}

function isServerLocalUrl(value: string, includeRelative = false): boolean {
  const decoded = decodeUrl(value)
  if (decoded.startsWith("//")) return false
  if (
    decoded.startsWith("/") ||
    decoded.startsWith("\\") ||
    decoded.startsWith("$CODEX_HOME/") ||
    decoded.startsWith("${CODEX_HOME}/") ||
    decoded.startsWith("$WORKSPACE/") ||
    decoded.startsWith("${WORKSPACE}/") ||
    /^[A-Za-z]:[\\/]/u.test(decoded)
  ) {
    return true
  }
  if (isLoopbackWebUrl(decoded)) return true
  const protocol = /^([a-z][a-z0-9+.-]*):/iu.exec(decoded)?.[1]?.toLowerCase()
  return protocol ? protocol === "file" : includeRelative
}

function isLoopbackWebUrl(value: string): boolean {
  if (!/^https?:\/\//iu.test(value)) return false
  try {
    const hostname = new URL(value).hostname
      .toLowerCase()
      .replace(/^\[|\]$/gu, "")
      .replace(/\.$/u, "")
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      /^127(?:\.\d{1,3}){3}$/u.test(hostname)
    )
  } catch {
    return false
  }
}

function decodeUrl(value: string): string {
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
