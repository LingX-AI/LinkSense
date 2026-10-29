import { posix } from "node:path";
import { parse, parseFragment, serialize, defaultTreeAdapter, type DefaultTreeAdapterMap } from "parse5";
import { SaxesParser } from "saxes";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import valueParser from "postcss-value-parser";
import { webBundleLimits } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { sha256 } from "./resources.js";

type Element = DefaultTreeAdapterMap["element"];
function elements(root: DefaultTreeAdapterMap["node"]): Element[] {
  const result: Element[] = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if ("tagName" in node) result.push(node);
    if ("childNodes" in node) pending.push(...node.childNodes);
  }
  return result;
}

/** External <use> has no CORS opt-in in an opaque-origin sandbox. Inline only
 * verified bundle-local sprites, keeping scripts/HTML out of formerly inert SVG. */
export async function inlineSvgSprites(data: Buffer, path: string, read: (path: string) => Promise<Buffer | null>): Promise<Buffer> {
  const document = parse(data.toString("utf8"));
  const nodes = elements(document);
  const body = nodes.find(node => node.tagName === "body");
  if (!body) return data;
  const existingIds = new Set(nodes.flatMap(node => node.attrs.filter(attr => attr.name === "id").map(attr => attr.value)));
  const sprites = new Map<string, Set<string>>();
  let totalBytes = data.length;
  for (const node of nodes.filter(node => node.tagName === "use")) {
    for (const attribute of node.attrs.filter(attr => attr.name === "href")) {
      const href = attribute.value.trim();
      if (!href || href.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(href)) continue;
      const url = new URL(href, `https://bundle.invalid/${path}`);
      let target: string, symbol: string;
      try { target = decodeURIComponent(url.pathname).slice(1); symbol = decodeURIComponent(url.hash.slice(1)); }
      catch { throw new AppError("WEB_SITE_BUNDLE_INVALID"); }
      if (!symbol || !target.endsWith(".svg")) throw new AppError("WEB_SITE_BUNDLE_INVALID");
      const prefix = `ls-svg-${sha256(Buffer.from(target)).slice(0, 16)}-`;
      let ids = sprites.get(target);
      if (!ids) {
        const bytes = await read(target);
        if (!bytes) continue;
        totalBytes += bytes.length;
        if (totalBytes > webBundleLimits.fileBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
        let source: string;
        try {
          source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const xml = new SaxesParser({ xmlns: true });
          xml.on("doctype", () => { throw new Error("SVG doctype is not allowed"); });
          xml.write(source).close();
        } catch { throw new AppError("WEB_SITE_BUNDLE_INVALID"); }
        const fragment = parseFragment(source);
        const roots = fragment.childNodes.filter(child => "tagName" in child);
        const root = roots[0];
        if (roots.length !== 1 || !root || !("tagName" in root) || root.tagName !== "svg") throw new AppError("WEB_SITE_BUNDLE_INVALID");
        const svgNodes = elements(root);
        ids = new Set<string>();
        for (const item of svgNodes) {
          if (item.namespaceURI !== "http://www.w3.org/2000/svg" || ["script", "foreignObject", "animate", "animateMotion", "animateTransform", "set", "discard"].includes(item.tagName) || item.attrs.some(attr => /^on/iu.test(attr.name) || attr.name === "base")) throw new AppError("WEB_SITE_BUNDLE_INVALID");
          const id = item.attrs.find(attr => attr.name === "id");
          if (id) {
            if (ids.has(id.value) || existingIds.has(prefix + id.value)) throw new AppError("WEB_SITE_BUNDLE_INVALID");
            ids.add(id.value); existingIds.add(prefix + id.value);
          }
        }
        const reference = (value: string): string => {
          if (value.startsWith("#")) return `#${prefix}${value.slice(1)}`;
          if (/^(?:https?:|data:|\/\/)/iu.test(value)) return value;
          if (/^[a-z][a-z\d+.-]*:/iu.test(value) || value.includes("\\")) throw new AppError("WEB_SITE_BUNDLE_INVALID");
          const resolved = new URL(value, `https://bundle.invalid/${target}`);
          return `${posix.relative(posix.dirname(path), decodeURIComponent(resolved.pathname).slice(1))}${resolved.search}${resolved.hash}`;
        };
        const urls = (value: string): string => {
          const parsed = valueParser(value);
          parsed.walk(part => {
            if (part.type === "function" && part.value.toLowerCase() === "url") {
              const urlNode = part.nodes[0];
              if (urlNode && (urlNode.type === "word" || urlNode.type === "string")) urlNode.value = reference(urlNode.value);
            }
          });
          return parsed.toString();
        };
        for (const item of svgNodes) {
          for (const attr of item.attrs) {
            if (attr.name === "id") attr.value = prefix + attr.value;
            else if (attr.name === "class") attr.value = attr.value.split(/\s+/u).map(value => prefix + value).join(" ");
            else if (attr.name === "href") {
              if (item.tagName === "use" && !attr.value.startsWith("#")) throw new AppError("WEB_SITE_BUNDLE_INVALID");
              attr.value = reference(attr.value);
            } else if (["aria-labelledby", "aria-describedby"].includes(attr.name)) attr.value = attr.value.split(/\s+/u).map(value => prefix + value).join(" ");
            else attr.value = urls(attr.value);
          }
          if (item.tagName === "style") for (const child of item.childNodes) {
            if (!("value" in child)) continue;
            try {
              const css = postcss.parse(child.value);
              css.walkAtRules(rule => { if (rule.name === "import") throw new AppError("WEB_SITE_BUNDLE_INVALID"); });
              css.walkRules(rule => {
                if (rule.parent?.type === "atrule" && /keyframes$/iu.test(rule.parent.name)) return;
                rule.selector = selectorParser(selectors => {
                  selectors.walkIds(id => { id.value = prefix + id.value; });
                  selectors.walkClasses(value => { value.value = prefix + value.value; });
                  // Type/universal selectors in a sprite must not restyle the host page.
                  for (const selector of selectors.nodes) {
                    selector.prepend(selectorParser.combinator({ value: " " }));
                    selector.prepend(selectorParser.attribute({ attribute: "data-linksense-sprite", operator: "=", value: prefix, quoteMark: '"', raws: {} }));
                  }
                }).processSync(rule.selector);
              });
              css.walkDecls(decl => { decl.value = urls(decl.value); });
              child.value = css.toString();
            } catch { throw new AppError("WEB_SITE_BUNDLE_INVALID"); }
          }
        }
        // A zero-sized SVG keeps definitions available without changing layout.
        const style = root.attrs.find(attr => attr.name === "style")?.value ?? "";
        root.attrs = root.attrs.filter(attr => !["width", "height", "aria-hidden", "style", "data-linksense-sprite"].includes(attr.name));
        root.attrs.push({ name: "width", value: "0" }, { name: "height", value: "0" }, { name: "aria-hidden", value: "true" }, { name: "data-linksense-sprite", value: prefix }, { name: "style", value: `${style};position:absolute;overflow:hidden;pointer-events:none` });
        defaultTreeAdapter.appendChild(body, root);
        sprites.set(target, ids);
      }
      if (!ids.has(symbol)) throw new AppError("WEB_SITE_RESOURCES_MISSING");
      attribute.value = `#${prefix}${symbol}`;
    }
  }
  if (!sprites.size) return data;
  const result = Buffer.from(serialize(document));
  if (result.length > webBundleLimits.fileBytes) throw new AppError("FILE_LIMIT_EXCEEDED");
  return result;
}
