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
      expect(skill).toContain("linksense_core.delete_web_site");
      expect(skill).toContain("Deletion is permanent");
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
      expect(skill).toContain("/app/s/<site-id>");
      expect(skill).toContain('action: "open_site"');
      expect(skill).toContain("Do not publish");
      expect(skill).toContain("deliver a private preview without asking first");
      expect(skill).toContain("lead with the registered HTML preview card");
      expect(skill).toContain("Ask about publication only when the intended audience is unclear");
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

  it("keeps dynamic creation and later publication in the current conversation", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-public-site-conversation-"));
    try {
      const name = "linksense-public-site-builtin-2";
      await writeBuiltInPublicSite(root, name);
      const skill = await readFile(join(root, name, "SKILL.md"), "utf8");
      const frontmatter = parse(/^---\n([\s\S]*?)\n---/u.exec(skill)?.[1] ?? "");
      const metadata = parse(await readFile(join(root, name, "agents/openai.yaml"), "utf8"));

      expect(frontmatter.description).toContain("directly in the current conversation");
      expect(frontmatter.description.length).toBeLessThanOrEqual(512);
      expect(skill).toContain("Do not send the user to a creation page");
      expect(skill).toContain("Visitor login, data and uploads do not require LinkSense platform identity");
      expect(skill).toContain("ask for publication in this conversation");
      expect(skill).toContain("generic HTML Publish as site action does not attach a dynamic backend");
      expect(skill).toContain("reuse the prepared");
      expect(skill).toContain("backend_id");
      expect(metadata).toMatchObject({
        interface: {
          short_description: expect.stringContaining("dynamic applications"),
          default_prompt: expect.stringContaining(`$${name}`),
        },
        policy: { allow_implicit_invocation: true },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses existing backends and enhances static sites without replacing their identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-public-site-update-"));
    try {
      await writeBuiltInPublicSite(root);
      const skill = await readFile(join(root, "linksense-public-site", "SKILL.md"), "utf8");
      const workflow = skill.slice(
        skill.indexOf("## Dynamic application workflow"),
        skill.indexOf("## Register and publish"),
      );

      expect(workflow).toContain("linksense_core.list_web_sites");
      expect(workflow).toContain("linksense_core.inspect_web_site_backend");
      expect(workflow.indexOf("list_web_sites")).toBeLessThan(workflow.indexOf("prepare_web_site_backend"));
      expect(workflow).toContain("even from a different conversation");
      expect(workflow).toContain("existing `site_id` and prepared `backend_id`");
      expect(workflow).toContain("one transaction and keeps the application ID and link");
      expect(workflow).toContain("Never replace an existing backend");
      expect(workflow).toContain("previous page available");
      expect(skill).toContain("Public publishing and schedule activation require explicit authorization");
      expect(skill).toContain("preview and delivery choice are not consent");
      expect(skill).toContain("only the next outcome-changing question");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
