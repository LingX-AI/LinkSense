import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { toString } from "mdast-util-to-string";
import {
  conversationSourceUrlSchema,
  type ConversationSource,
} from "@linksense/shared";

type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number];

/** Parse rendered links, never code, image resources or unused definitions. */
export function extractReferencedSources(content: string): ConversationSource[] {
  const tree = fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const definitions = new Map<string, { url: string; title: string | null }>();
  const footnotes = new Map<string, Extract<MarkdownNode, { type: "footnoteDefinition" }>>();
  const visitedFootnotes = new Set<string>();
  const collectDefinitions = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === "definition" && !definitions.has(node.identifier)) {
        definitions.set(node.identifier, { url: node.url, title: node.title ?? null });
      }
      if (node.type === "footnoteDefinition" && !footnotes.has(node.identifier)) {
        footnotes.set(node.identifier, node);
      }
      if ("children" in node) collectDefinitions(node.children);
    }
  };
  collectDefinitions(tree.children);
  const result: ConversationSource[] = [];
  const visit = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === "link" || node.type === "linkReference") {
        const target = node.type === "link" ? node : definitions.get(node.identifier);
        if (!target) continue;
        const label = toString(node).trim();
        // GFM allows CJK punctuation in autolinks; the reply renderer separates
        // these sentence delimiters too. Explicit Markdown targets are untouched.
        const bare = content[node.position?.start.offset ?? 0] !== "[";
        const href = bare ? target.url.split(/[，。；：！？、）]/u, 1)[0] : target.url;
        const parsed = conversationSourceUrlSchema.safeParse(href);
        if (!parsed.success) continue;
        const url = new URL(parsed.data).href;
        const title = target.title?.trim() || (bare || label === target.url ? null : label);
        result.push({ url, title: title?.slice(0, 400) ?? null });
      } else if (node.type === "footnoteReference") {
        const footnote = footnotes.get(node.identifier);
        if (footnote && !visitedFootnotes.has(node.identifier)) {
          visitedFootnotes.add(node.identifier);
          visit(footnote.children);
        }
      } else if (node.type !== "footnoteDefinition" && "children" in node) {
        visit(node.children);
      }
    }
  };
  visit(tree.children);
  return result;
}

export function mergeReferencedSources(
  target: Map<string, ConversationSource>,
  sources: readonly ConversationSource[],
): void {
  for (const source of sources) {
    const existing = target.get(source.url);
    if (!existing || (!existing.title && source.title)) target.set(source.url, source);
  }
}
