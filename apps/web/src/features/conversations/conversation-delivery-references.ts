import { fromMarkdown } from "mdast-util-from-markdown"

import type { ConversationFile } from "@/api/contracts"
import { getInlineArtifactId } from "@/features/conversations/assistant-markdown-image-utils"

type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number]

function collectDeliveryUrls(content: string): string[] {
  const tree = fromMarkdown(content)
  const definitions = new Map<string, string>()
  const collectDefinitions = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === "definition" && !definitions.has(node.identifier)) {
        definitions.set(node.identifier, node.url)
      }
      if ("children" in node) collectDefinitions(node.children)
    }
  }
  collectDefinitions(tree.children)

  const urls: string[] = []
  const visit = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === "image" || node.type === "link") {
        urls.push(node.url)
      } else if (
        node.type === "imageReference" ||
        node.type === "linkReference"
      ) {
        const url = definitions.get(node.identifier)
        if (url) urls.push(url)
      }
      if ("children" in node) {
        visit(node.children)
      }
    }
  }
  visit(tree.children)
  return urls
}

function getLocalDeliveryFilename(url: string): string | null {
  if (url.startsWith("//")) return null
  const protocol = /^([a-z][a-z0-9+.-]*):/iu.exec(url)?.[1]?.toLowerCase()
  if (protocol && protocol !== "file" && protocol !== "sandbox") return null

  try {
    if (protocol === "file" && new URL(url).hostname) return null
    const path = decodeURIComponent(url.split(/[?#]/u, 1)[0] ?? "")
    return path.split(/[\\/]/u).at(-1) || null
  } catch {
    return null
  }
}

export function resolveConversationDeliveryFiles(
  content: string,
  files: readonly ConversationFile[]
): ConversationFile[] {
  const filesById = new Map(files.map((file) => [file.id.toLowerCase(), file]))
  const filesByName = new Map<string, ConversationFile | null>()
  for (const file of files) {
    filesByName.set(file.name, filesByName.has(file.name) ? null : file)
  }
  const resolved = new Map<string, ConversationFile>()
  for (const url of collectDeliveryUrls(content)) {
    const artifactId = getInlineArtifactId(url)
    const filename = artifactId ? null : getLocalDeliveryFilename(url)
    const file = artifactId
      ? filesById.get(artifactId)
      : filename
        ? filesByName.get(filename)
        : null
    if (file) resolved.set(file.id, file)
  }
  return [...resolved.values()]
}
