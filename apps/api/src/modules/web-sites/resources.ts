import { posix } from "node:path";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { parse, parseFragment, serialize, defaultTreeAdapter, type DefaultTreeAdapterMap } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { init, parse as parseModules } from "es-module-lexer";
import { lookup } from "mime-types";
import srcset from "srcset";
import { z } from "zod";
import { webBundleLimits, webBundlePathSchema, type WebBundleManifest } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";

const extensions = new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".webm", ".ogg", ".wav", ".wasm", ".txt", ".csv", ".pdf"]);
export function resourceMimeType(path: string): string {
  if (!webBundlePathSchema.safeParse(path).success || !extensions.has(posix.extname(path).toLowerCase())) {
    throw new AppError("WEB_SITE_BUNDLE_INVALID");
  }
  return lookup(path) || "application/octet-stream";
}
export function sha256(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }

export async function readResource(stream: Readable, expectedSize: number): Promise<Buffer> {
  if (expectedSize < 0 || expectedSize > webBundleLimits.fileBytes) {
    stream.destroy();
    throw new AppError("FILE_LIMIT_EXCEEDED");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const input of stream) {
      const chunk: unknown = input;
      if (!Buffer.isBuffer(chunk)) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      size += chunk.length;
      if (size > expectedSize) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      chunks.push(chunk);
    }
    if (size !== expectedSize) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    return Buffer.concat(chunks, size);
  } finally { stream.destroy(); }
}

/** Rewrite known root-relative references to portable relative references.
 * Runtime-computed URLs must already use the webpage's base, never the app root.
 * External resources remain browser requests; the API never fetches them.
 */
export async function prepareWebResource(data: Buffer, path: string, paths: ReadonlySet<string>): Promise<Buffer> {
  const extension = posix.extname(path).toLowerCase();
  if (![".html", ".htm", ".css", ".js", ".mjs"].includes(extension)) return data;
  const reference = (value: string, required = true): string => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("#") || /^(?:https?:|data:|blob:|\/\/)/iu.test(trimmed)) return value;
    if (!required && /^(?:mailto:|tel:)/iu.test(trimmed)) return value;
    if (/^[a-z][a-z\d+.-]*:/iu.test(trimmed) || trimmed.includes("\\")) throw new AppError("WEB_SITE_BUNDLE_INVALID");
    const url = new URL(trimmed, `https://bundle.invalid/${path}`);
    let target: string;
    try { target = decodeURIComponent(url.pathname).slice(1); } catch { throw new AppError("WEB_SITE_BUNDLE_INVALID"); }
    if (target.endsWith("/") && required) target += "index.html";
    if (required && !paths.has(target)) throw new AppError("WEB_SITE_RESOURCES_MISSING", { path: target.slice(0, 240) });
    if (!trimmed.startsWith("/")) return value;
    const relative = posix.relative(posix.dirname(path), target);
    return `${relative.startsWith(".") ? "" : "./"}${relative}${target.endsWith("/") && relative ? "/" : ""}${url.search}${url.hash}`;
  };
  const css = (text: string): string => {
    const root = postcss.parse(text);
    const rewriteValue = (value: string): string => {
      const parsed = valueParser(value);
      parsed.walk(node => {
        if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
        const token = node.nodes[0];
        if (token?.type === "string" || token?.type === "word") token.value = reference(token.value);
        return false;
      });
      return parsed.toString();
    };
    root.walkDecls(declaration => { declaration.value = rewriteValue(declaration.value); });
    root.walkAtRules("import", rule => {
      const parsed = valueParser(rule.params);
      const first = parsed.nodes[0];
      if (first?.type === "string") first.value = reference(first.value);
      rule.params = rewriteValue(parsed.toString());
    });
    return root.toString();
  };
  const javascript = async (text: string): Promise<string> => {
    await init;
    const [imports] = parseModules(text);
    let result = text;
    for (const item of [...imports].reverse()) {
      if (!item.n || (!item.n.startsWith(".") && !item.n.startsWith("/"))) continue;
      const next = reference(item.n);
      if (next !== item.n) result = result.slice(0, item.s) + (item.d >= 0 ? JSON.stringify(next) : next) + result.slice(item.e);
    }
    return result;
  };
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (extension === ".css") return Buffer.from(css(source));
    if (extension === ".js" || extension === ".mjs") return Buffer.from(await javascript(source));
    const document = parse(source);
    const visit = async (node: DefaultTreeAdapterMap["node"]): Promise<void> => {
      if ("tagName" in node) {
        if (node.tagName === "base") throw new AppError("WEB_SITE_BUNDLE_INVALID");
        if (node.tagName === "head" && !node.childNodes.some(child => "tagName" in child && child.tagName === "meta" && child.attrs.some(attr => attr.name === "charset"))) {
          const charset = parseFragment('<meta charset="utf-8">').childNodes[0];
          if (charset) {
            const first = node.childNodes[0];
            if (first) defaultTreeAdapter.insertBefore(node, charset, first);
            else defaultTreeAdapter.appendChild(node, charset);
          }
        }
        if (node.tagName === "meta") {
          const charset = node.attrs.find(attr => attr.name === "charset");
          if (charset) charset.value = "utf-8";
        }
        for (const attribute of node.attrs) {
          if (["src", "poster"].includes(attribute.name)) attribute.value = reference(attribute.value);
          if (["srcset", "imagesrcset"].includes(attribute.name)) attribute.value = srcset.stringify(srcset.parse(attribute.value).map(item => ({ ...item, url: reference(item.url) })));
          if (attribute.name === "href" && node.tagName === "link") attribute.value = reference(attribute.value);
          if (attribute.name === "href" && node.tagName === "a") attribute.value = reference(attribute.value, false);
          if (attribute.name === "style") attribute.value = css(attribute.value);
        }
        for (const child of node.childNodes) {
          if (child.nodeName === "#text" && "value" in child) {
            if (node.tagName === "style") child.value = css(child.value);
            if (node.tagName === "script" && node.attrs.some(attr => attr.name === "type" && attr.value === "module")) child.value = await javascript(child.value);
            if (node.tagName === "script" && node.attrs.some(attr => attr.name === "type" && attr.value === "importmap")) {
              const specifiers = z.record(z.string(), z.string().nullable());
              const map = z.object({ imports: specifiers.optional(), scopes: z.record(z.string(), specifiers).optional() }).parse(JSON.parse(child.value));
              const rewrite = (entries: z.infer<typeof specifiers>) => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, value === null ? null : reference(value, !value.endsWith("/"))]));
              child.value = JSON.stringify({ ...(map.imports ? { imports: rewrite(map.imports) } : {}), ...(map.scopes ? { scopes: Object.fromEntries(Object.entries(map.scopes).map(([scope, entries]) => [reference(scope, false), rewrite(entries)])) } : {}) }).replaceAll("<", "\\u003c");
            }
          }
        }
      }
      if ("childNodes" in node) for (const child of node.childNodes) await visit(child);
    };
    await visit(document);
    return Buffer.from(serialize(document));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("WEB_SITE_BUNDLE_INVALID");
  }
}

export function bundleSize(manifest: WebBundleManifest): number {
  return manifest.files.reduce((sum, file) => sum + file.size_bytes, 0);
}

export function resourceContentType(mimeType: string): string {
  return /^(?:text\/|application\/(?:json|javascript)|image\/svg\+xml)/u.test(mimeType) ? `${mimeType}; charset=utf-8` : mimeType;
}
