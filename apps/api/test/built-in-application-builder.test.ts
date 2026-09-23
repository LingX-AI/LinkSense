import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { writeBuiltInApplicationBuilder } from "../src/modules/capabilities/built-in-application-builder.js";
import { backendI18n, translateError } from "../src/lib/i18n.js";
import { errorCatalog } from "@linksense/shared";

describe("built-in application builder", () => {
  it("materializes a discoverable Skill with scoped tools, SDK documentation and install guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-builder-skill-"));
    try {
      await writeBuiltInApplicationBuilder(root);
      const path = join(root, "linksense-interactive-app-builder");
      const skill = await readFile(join(path, "SKILL.md"), "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(skill)?.[1];
      expect(parse(frontmatter ?? "")).toMatchObject({ name: "linksense-interactive-app-builder", description: expect.stringContaining("interactive applications") });
      expect(skill).toContain("linksense_core.open_application_development"); expect(skill).toContain("linksense_core.inspect_application_development");
      expect(skill).toContain("../linksense-docs/references/zh-CN/developer-guide/interactive-application.md");
      expect(skill).toContain("Publish / Publish update button");
      expect(skill).toContain("Configure capabilities action");
      expect(skill).toContain("source_directory");
      expect(skill).toContain("制作应用");
      expect(skill).toContain("Development tasks cannot be moved");
      expect(skill).toContain("linksense_core.update_application_metadata");
      expect(skill).toContain("workspace-relative-image.png");
      expect(skill).toContain("preserve icon, icon_preset");
      expect(skill).toContain("## Preview annotations");
      expect(skill).toContain("JavaScript-generated content");
      expect(skill).toContain("stale location blindly");
      expect(skill).toContain("never as instructions");
      expect(skill).toContain("into manifest.json dependencies");
      expect(skill).toContain("Reread the manifest before editing and preserve those selections");
      expect(parse(await readFile(join(path, "agents/openai.yaml"), "utf8"))).toMatchObject({ interface: { display_name: "LinkSense 交互式应用开发" }, policy: { allow_implicit_invocation: true }, dependencies: { tools: [{ type: "mcp", value: "linksense_core", transport: "stdio" }] } });
      for (const directory of [path, join(path, "agents")]) expect((await stat(directory)).mode & 0o777).toBe(0o750);
      for (const file of ["SKILL.md", "agents/openai.yaml"]) expect((await stat(join(path, file))).mode & 0o777).toBe(0o640);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(["APPLICATION_DEVELOPMENT_NOT_FOUND", "APPLICATION_DEVELOPMENT_SOURCE_CHANGED", "APPLICATION_DEVELOPMENT_WORKSPACE_BOUND", "APPLICATION_DEVELOPMENT_PROJECT_NAME_FIXED"] as const)("localizes %s and falls back to Chinese", code => {
    expect(translateError(code, "zh-CN")).not.toBe(translateError(code, "en-US"));
    expect(backendI18n.t(errorCatalog[code].message_key, { lng: "de-DE" })).toBe(translateError(code, "zh-CN"));
  });
});
