import path from "node:path";
import { pathToFileURL } from "node:url";

export type DesktopModelPaths = {
  home: string;
  dataRoot?: string;
  runtimeRoot?: string;
};

const xmlEscapes = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ['"', "&quot;"], ["'", "&apos;"]]);

/** Project device paths only in the transient model request, not the native cwd or history. */
export function desktopModelPathProjection(paths: DesktopModelPaths): (body: Record<string, unknown>) => void {
  const replacements = new Map<string, string>();
  for (const [root, replacement] of [
    [path.join(paths.home, "workspace"), "."],
    [paths.home, "~"],
    [paths.dataRoot, "[desktop-data]"],
    [paths.runtimeRoot, "[desktop-runtime]"],
  ] as const) {
    if (!root || !path.isAbsolute(root) || path.parse(root).root === root) continue;
    for (const alias of macPathAliases(root)) {
      const uri = pathToFileURL(alias);
      for (const spelling of [
        alias, uri.pathname, uri.href, `file://localhost${uri.pathname}`,
        alias.replace(/[&<>"']/gu, char => xmlEscapes.get(char) ?? char),
        JSON.stringify(alias).slice(1, -1), alias.replace(/ /gu, "\\ "),
      ]) {
        if (!replacements.has(spelling)) replacements.set(spelling, replacement);
      }
    }
  }
  const pattern = new RegExp(
    `(?:${[...replacements.keys()].sort((a, b) => b.length - a.length)
      .map(value => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})(?=$|[/\\\\\\s"'<>:,;)=\\]?#\`])`,
    "gu",
  );
  return body => {
    const pending: Array<Record<string, unknown> | unknown[]> = [body];
    function project(value: unknown): unknown {
      if (typeof value === "string") return value.replace(pattern, match => replacements.get(match) ?? match);
      if (Array.isArray(value) || (value !== null && typeof value === "object")) {
        // The gateway already parsed this tree from JSON.
        pending.push(value as Record<string, unknown> | unknown[]);
      }
      return value;
    }
    for (let entry = pending.pop(); entry; entry = pending.pop()) {
      if (Array.isArray(entry)) {
        for (let index = 0; index < entry.length; index++) entry[index] = project(entry[index]);
      } else {
        for (const key of Object.keys(entry)) entry[key] = project(entry[key]);
      }
    }
  };
}

function macPathAliases(root: string): string[] {
  const canonical = root.replace(/^\/private(?=\/(?:var|tmp|etc)\/)/u, "");
  const aliases = /^\/(?:var|tmp|etc)\//u.test(canonical) ? [canonical, `/private${canonical}`] : [canonical];
  return [...new Set(aliases.flatMap(alias => [alias, alias.normalize("NFC"), alias.normalize("NFD")]))];
}
