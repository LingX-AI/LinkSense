import assert from "node:assert/strict";
import { cpSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const previousVersions = { "brace-expansion": "5.0.9", "http-cache-semantics": "4.2.0", undici: "6.28.0" };
const manifest = (directory) => JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));

// This is a distribution build step, not a runtime fallback. Copy complete,
// pnpm-locked upstream packages, including code and licenses, into vendor CLIs.
export function patchToolingLibraries(source, packageRoot, tool) {
  assert.ok(["pnpm", "npm"].includes(tool));
  const root = realpathSync(packageRoot);
  const identity = manifest(root);
  assert.equal(identity.name, tool);
  assert.equal(identity.version, tool === "pnpm" ? "10.34.6" : "12.2.0");
  const pins = manifest(source).dependencies;
  const names = tool === "pnpm" ? ["http-cache-semantics"] : Object.keys(previousVersions);
  if (tool === "npm") assert.equal(manifest(join(source, "node_modules/balanced-match")).version, "4.0.4");
  const parent = join(root, tool === "pnpm" ? "dist/node_modules" : "node_modules");
  assert.equal(realpathSync(parent), parent);
  // Validate every replacement before changing any directory.
  const changes = names.map((name) => {
    const from = join(source, "node_modules", name);
    const to = join(parent, name);
    assert.ok(lstatSync(from).isDirectory() && lstatSync(to).isDirectory());
    const replacement = manifest(from);
    const existing = manifest(to);
    assert.equal(replacement.name, name);
    assert.equal(replacement.version, pins[name]);
    assert.equal(existing.name, name);
    assert.equal(existing.version, previousVersions[name]);
    return { name, from, to };
  });
  for (const { name, from, to } of changes) {
    rmSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
    if (name === "brace-expansion") {
      const dependency = join(source, "node_modules", "balanced-match");
      mkdirSync(join(to, "node_modules"));
      cpSync(dependency, join(to, "node_modules", "balanced-match"), { recursive: true });
    }
    assert.equal(manifest(to).version, pins[name]);
    console.log(`${tool}: installed complete ${name}@${pins[name]} distribution`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, packageRoot, tool] = process.argv.slice(2);
  patchToolingLibraries(source, packageRoot, tool);
}
