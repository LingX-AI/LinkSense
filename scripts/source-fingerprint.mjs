import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

export function sourceFingerprint(rootDirectory, relativePaths, excludedPaths = []) {
  const hash = createHash("sha256");
  const dependencyCaches = new Set(["node_modules", ".venv", "__pycache__"]);
  function visit(relativePath) {
    if (excludedPaths.includes(relativePath) || basename(relativePath) === ".DS_Store" || dependencyCaches.has(basename(relativePath))) return;
    const absolutePath = resolve(rootDirectory, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      for (const entry of readdirSync(absolutePath).sort()) visit(`${relativePath}/${entry}`);
      return;
    }
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(absolutePath));
    hash.update("\0");
  }
  for (const relativePath of [...relativePaths].sort()) visit(relativePath);
  return hash.digest("hex");
}
