import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { interactiveApplicationManifestSchema, interactiveDependenciesSchema } from "@linksense/shared";
import { inspectInteractiveApplicationArchive } from "../src/modules/applications/interactive-package.js";

it.each([
  "../../../apps/docs/docs/developer-guide/interactive-application.md",
  "../../../apps/docs/i18n/en-US/docusaurus-plugin-content-docs/current/developer-guide/interactive-application.md",
])("keeps dependency snippets and complete manifest examples valid in %s", async guidePath => {
  const guide = await readFile(new URL(guidePath, import.meta.url), "utf8");
  const examples = [...guide.matchAll(/```json title="(manifest(?:-with-dependencies)?\.json|dependencies\.json)"\n([\s\S]*?)```/gu)];
  expect(examples).toHaveLength(4);
  for (const [, name, source] of examples) {
    if (!source) throw new Error("Missing JSON example");
    const input: unknown = JSON.parse(source);
    if (name === "dependencies.json") {
      const dependencies = interactiveDependenciesSchema.parse(
        input && typeof input === "object" && "dependencies" in input ? input.dependencies : undefined,
      );
      expect(Object.values(dependencies).every(items => items.length === 1)).toBe(true);
    } else {
      const manifest = interactiveApplicationManifestSchema.parse(input);
      if (name === "manifest-with-dependencies.json") {
        expect(manifest.dependencies.skills).toHaveLength(1);
        expect(manifest.dependencies.knowledge_bases).toHaveLength(1);
        expect(manifest.permissions).toEqual(["tasks:write"]);
        expect(manifest.dependencies.plugins).toEqual([]);
        expect(manifest.dependencies.mcp_servers).toEqual([]);
      }
    }
  }
});

it("builds importable test packages with four declarations and one changed UUID in the update", async () => {
  const output = await mkdtemp(join(tmpdir(), "linksense-dependency-example-"));
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../../../examples/interactive-dependency-check/build.mjs", import.meta.url)), output]);
    const packages = await Promise.all(["1.0.0", "1.1.0"].map(async version => inspectInteractiveApplicationArchive(await readFile(join(output, `interactive-dependency-check-${version}.zip`)))));
    const first = packages[0], update = packages[1];
    if (!first || !update) throw new Error("Missing package");
    expect(first.manifest.dependencies.plugins).toHaveLength(1);
    expect(first.manifest.dependencies.skills).toHaveLength(1);
    expect(first.manifest.dependencies.mcp_servers).toHaveLength(1);
    expect(first.manifest.dependencies.knowledge_bases).toHaveLength(1);
    expect(update.manifest.version).toBe("1.1.0");
    expect(update.manifest.dependencies.skills).toEqual(first.manifest.dependencies.skills);
    expect(update.manifest.dependencies.plugins).toEqual(first.manifest.dependencies.plugins);
    expect(update.manifest.dependencies.mcp_servers).toEqual(first.manifest.dependencies.mcp_servers);
    expect(update.manifest.dependencies.knowledge_bases[0]?.id).not.toBe(first.manifest.dependencies.knowledge_bases[0]?.id);
    expect(first.assets.map(asset => asset.path).sort()).toEqual(["app.js", "index.html", "manifest.json", "styles.css"]);
  } finally { await rm(output, { recursive: true, force: true }); }
});
