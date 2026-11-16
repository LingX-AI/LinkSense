import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { writeBuiltInPublicSite } from "../src/modules/capabilities/built-in-public-site.js";

describe("built-in public site builder", () => {
  it("materializes a discoverable Skill with publishing tools, routing and sandbox limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-public-site-skill-"));
    try {
      await writeBuiltInPublicSite(root);
      const path = join(root, "linksense-public-site");
      const skill = await readFile(join(path, "SKILL.md"), "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(skill)?.[1];
      expect(parse(frontmatter ?? "")).toMatchObject({
        name: "linksense-public-site",
        description: expect.stringContaining("standalone public website"),
      });
      expect(skill).toContain("linksense_core.register_artifact");
      expect(skill).toContain("linksense_core.publish_web_site");
      expect(skill).toContain("linksense_core.list_web_sites");
      expect(skill).toContain("linksense_core.update_web_site");
      expect(skill).toContain("linksense_core.prepare_web_site_backend");
      expect(skill).toContain("linksense_core.configure_web_site_backend");
      expect(skill).toContain("Never recreate");
      expect(skill).toContain("self-hosted");
      expect(skill).toContain("Function execution is limited to 30 seconds");
      expect(skill).toContain("linksense_core.request_user_form");
      expect(skill).toContain("one-line description");
      expect(skill).toContain("linksense-interactive-app-builder");
      expect(skill).toContain("localStorage");
      expect(skill).toContain("browser notifications");
      expect(skill).toContain("web_root_relative_path");
      expect(skill).toContain("water-reminder");
      expect(skill).toContain('action: "open_site"');
      expect(skill).toContain("Do not publish");
      expect(parse(await readFile(join(path, "agents/openai.yaml"), "utf8"))).toMatchObject({
        interface: { display_name: "LinkSense 公开站点开发" },
        policy: { allow_implicit_invocation: true },
        dependencies: { tools: [{ type: "mcp", value: "linksense_core", transport: "stdio" }] },
      });
      for (const directory of [path, join(path, "agents")]) expect((await stat(directory)).mode & 0o777).toBe(0o750);
      for (const file of ["SKILL.md", "agents/openai.yaml"]) expect((await stat(join(path, file))).mode & 0o777).toBe(0o640);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
