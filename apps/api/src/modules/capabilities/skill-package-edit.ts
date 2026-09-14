import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMap, parseDocument, type Document } from "yaml";
import type { SkillEditInput } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { parseSkillManifest, splitSkillMarkdown } from "./skill-manifest.js";
import { readSkillDisplayName } from "./skill-interface.js";

/** Edits a private staged copy. Unexposed metadata and all other files survive. */
export async function editSkillPackageFiles(root: string, input: SkillEditInput): Promise<void> {
  const filename = join(root, "SKILL.md");
  const markdown = await readFile(filename, "utf8");
  const metadata = parseSkillManifest(markdown);
  const document = splitSkillMarkdown(markdown);
  let prefix = document.prefix;
  if ((metadata.description || null) !== input.description) {
    const yaml = parseDocument(document.frontmatter, { prettyErrors: false });
    if (input.description === null) yaml.delete("description");
    else yaml.set("description", input.description);
    prefix = `---\n${yaml.toString()}---\n`;
  }
  if (!prefix.endsWith("\n")) prefix += "\n";
  if (prefix + input.content !== markdown) {
    await writeFile(filename, prefix + input.content, "utf8");
  }

  if (await readSkillDisplayName(root) === input.display_name) return;
  const interfaceDirectory = join(root, "agents");
  const interfacePath = join(interfaceDirectory, "openai.yaml");
  const info = await lstat(interfacePath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (info !== null && (!info.isFile() || info.isSymbolicLink() || info.size > 32_000)) {
    throw new AppError("INVALID_PACKAGE");
  }
  const yaml: Document = parseDocument(info === null ? "{}" : await readFile(interfacePath, "utf8"), { prettyErrors: false });
  if (yaml.errors.length > 0) throw new AppError("INVALID_PACKAGE");
  if (!isMap(yaml.contents)) yaml.contents = yaml.createNode({});
  if (!isMap(yaml.get("interface", true))) {
    const value: unknown = yaml.toJS({ maxAliasCount: 32 });
    const settings = typeof value === "object" && value !== null && "interface" in value
      ? value.interface : null;
    yaml.set("interface", yaml.createNode(settings ?? {}));
  }
  if (input.display_name === null) yaml.deleteIn(["interface", "display_name"]);
  else {
    yaml.setIn(["interface", "display_name"], input.display_name);
  }
  await mkdir(interfaceDirectory, { recursive: true, mode: 0o700 });
  await writeFile(interfacePath, yaml.toString(), { encoding: "utf8", mode: 0o600 });
}
