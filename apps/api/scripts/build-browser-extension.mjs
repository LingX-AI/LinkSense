import { build, transform } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import postcss from "postcss";
import sharp from "sharp";
const root = fileURLToPath(new URL("../", import.meta.url));
const outdir = `${root}/dist/browser-extension`;
await mkdir(outdir, { recursive: true });
await cp(`${root}/browser-extension/public`, outdir, { recursive: true });
for (const name of [
  "LICENSE",
  "LICENSE-EXCEPTIONS.md",
  "ATTRIBUTION.md",
  "TRADEMARK.md",
  "NOTICE",
]) {
  await cp(`${root}/../../${name}`, `${outdir}/${name}`);
}
const require = createRequire(import.meta.url);
await cp(
  path.join(path.dirname(require.resolve("zod/package.json")), "LICENSE"),
  `${outdir}/ZOD-LICENSE`,
);
await cp(path.join(path.dirname(require.resolve("lucide/package.json")), "LICENSE"), `${outdir}/LUCIDE-LICENSE`);
await cp(path.join(path.dirname(require.resolve("tailwindcss/package.json")), "LICENSE"), `${outdir}/TAILWIND-LICENSE`);
const webRoot = path.resolve(root, "../web");
await mkdir(`${outdir}/icons`, { recursive: true });
const mark = await readFile(`${webRoot}/public/linksense-appicon.svg`);
for (const size of [16, 32, 48, 128]) {
  await sharp(mark).resize(size, size).png().toFile(`${outdir}/icons/icon-${size}.png`);
}

// The extension consumes the app's actual semantic colors without shipping its React/CSS runtime.
const tokens = new Set(["--background", "--foreground", "--muted", "--muted-foreground", "--primary", "--primary-foreground", "--border", "--destructive", "--success", "--ring"]);
const appCss = postcss.parse(await readFile(`${webRoot}/src/index.css`, "utf8"));
const theme = (selector) => {
  const rule = appCss.nodes.find(node => node.type === "rule" && node.selector === selector);
  if (!rule) throw new Error(`Missing LinkSense theme ${selector}`);
  const declarations = rule.nodes.filter(node => node.type === "decl" && tokens.has(node.prop));
  const primary = declarations.find(node => node.prop === "--primary");
  if (!primary) throw new Error(`Missing LinkSense primary color ${selector}`);
  return { css: declarations.map(node => node.toString()).join(";"), primary: primary.value };
};
async function stylesheet(name, candidates, selector) {
  const source = await readFile(`${root}/browser-extension/public/${name}.css`, "utf8");
  const light = theme(":root");
  const dark = theme(".dark");
  const pointer = name === "control" ? `;--control-pointer:${light.primary}` : "";
  const css = await compile(`${source}\n${selector}{${light.css}${pointer}}\n@media(prefers-color-scheme:dark){${selector}{${dark.css}}}`, {
    base: `${root}/browser-extension/public`,
    loadStylesheet: async (id, base) => {
      const filename = id.startsWith(".") ? path.resolve(base, id) : require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id);
      return { path: filename, base: path.dirname(filename), content: await readFile(filename, "utf8") };
    },
  });
  let output = css.build(candidates);
  if (name === "control") {
    // Page root font sizes must not resize the extension's isolated controls.
    const fixed = postcss.parse(output);
    const defaults = postcss.rule({ selector: ":host,*,::before,::after" });
    fixed.walkAtRules("property", rule => {
      const initial = rule.nodes.find(node => node.type === "decl" && node.prop === "initial-value");
      if (initial) defaults.append(postcss.decl({ prop: rule.params, value: initial.value }));
    });
    // @property registrations do not initialize these variables inside a shadow stylesheet.
    fixed.append(postcss.atRule({ name: "layer", params: "base" }).append(defaults));
    fixed.walkDecls(declaration => {
      declaration.value = declaration.value.replace(/(-?(?:\d*\.)?\d+)rem\b/g, (_match, value) => `${Number(value) * 16}px`);
    });
    output = fixed.toString();
  }
  const compiled = await transform(output, { loader: "css", minify: true });
  await writeFile(`${outdir}/${name}.css`, compiled.code);
  return compiled.code;
}
const html = await readFile(`${root}/browser-extension/public/popup.html`, "utf8");
await stylesheet("popup", [...html.matchAll(/class="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/)), ":root");
const controlSource = await readFile(`${root}/browser-extension/control.ts`, "utf8");
const controlCss = await stylesheet("control", [...controlSource.matchAll(/"([^"\n]+)"/g)].flatMap(match => match[1].split(/\s+/)), ":host");
for (const name of ["background", "popup", "content", "control"]) {
  await build({
    entryPoints: [`${root}/browser-extension/${name}.ts`],
    outfile: `${outdir}/${name}.js`,
    bundle: true,
    format: name === "content" || name === "control" ? "iife" : "esm",
    platform: "browser",
    target: "chrome127",
    conditions: ["development"],
    minify: true,
    legalComments: "eof",
    define: name === "control" ? { LINKSENSE_CONTROL_CSS: JSON.stringify(controlCss) } : {},
  });
}
