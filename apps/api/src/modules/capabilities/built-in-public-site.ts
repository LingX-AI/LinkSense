import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PUBLIC_SITE_SKILL_NAME, coreMcpServerKey } from "@linksense/shared";

export async function writeBuiltInPublicSite(skillsRoot: string, name: string = PUBLIC_SITE_SKILL_NAME): Promise<void> {
  const root = join(skillsRoot, name);
  await mkdir(join(root, "agents"), { recursive: true, mode: 0o750 });
  await chmod(root, 0o750);
  await chmod(join(root, "agents"), 0o750);
  const files = {
    "SKILL.md": `---
name: ${name}
description: Create and publish a standalone public website with a shareable link. Use when the user wants a public page, landing page, or browser-only tool that anyone can open without LinkSense login or LinkSense AI. Do not use for applications that need LinkSense tasks, AI, knowledge bases, files, plugins, organization sharing, or in-LinkSense login; use linksense-interactive-app-builder instead.
---

# Public website development

Create and register a complete static website in the current task. Deliver a
preview unless the user explicitly requests publication or a public link.

## Choose the right delivery shape

- Use this Skill for a public page, landing page, portfolio, calculator, timer,
  tracker, or other browser-only tool that anyone can open with a link and that
  does not need LinkSense login, AI, tasks, files, knowledge bases, plugins, or
  organization sharing.
- Use \`linksense-interactive-app-builder\` instead when the user wants the result
  inside LinkSense, needs LinkSense AI or task execution, needs LinkSense
  resources or identity, or needs organization/install distribution.
- If the delivery shape is genuinely ambiguous, ask once with
  \`${coreMcpServerKey}.request_user_form\` using one \`radio\` field with 2–5
  short options. In \`message\`, explain what each shape means and when to use
  it, and give each option a one-line description: public website — anyone with
  the link can open it, static, no LinkSense login or AI; LinkSense application —
  runs inside LinkSense and can use AI, tasks, knowledge, files, plugins, or
  organization sharing. Do not create either artifact before the answer. Do not
  ask again when the user already said “public / website / link / no login” or
  “inside LinkSense / AI / tasks”.
- The two shapes are separate deliverables. Do not silently convert one into the
  other, and do not create an interactive application first.
- Ask about the requirement that affects the result, not the technology. For a
  reminder, ask whether it must work after the page closes. If it must, use the
  existing scheduled notification workflow; a static site cannot do that.

## Build the site

- Keep the deployable site in a dedicated directory under
  \`artifacts/<site-name>/\`. Put the HTML entry and every public JS, CSS, image,
  font, and data file there.
- Use relative URLs for local assets. The published site is served under a
  release path, not at the domain root.
- Do not rely on SPA history routing. Use hash routing or separate pages if the
  site needs multiple views.
- Public sites are static: no server-side code, no secrets, no background jobs.
  External HTTPS assets are loaded by the visitor's browser and remain subject
  to CORS and availability.
- The current public-site runtime is a sandboxed iframe without same-origin:
  \`localStorage\`, \`sessionStorage\`, IndexedDB, cookies, Service Workers, and
  browser notifications are unavailable. Keep state in memory or in the URL.
  If the user needs progress to survive reloads or needs reminders, explain the
  limitation and offer a LinkSense application or an external backend; never
  claim that local persistence works.
- Match the language the user asked for. Keep the page usable on mobile and
  cover loading, empty, and error states where relevant.

## Register and publish

1. Create the complete site first; do not publish a placeholder.
2. Register the HTML entry with \`${coreMcpServerKey}.register_artifact\`:
   pass \`workspace_relative_path: artifacts/<site-name>/index.html\`,
   \`web_root_relative_path: artifacts/<site-name>\`, a concise
   \`display_name\`, and \`mime_type: text/html\`. The tool returns \`file_id\`.
3. If the user only asked to see the result, deliver the registered HTML
   preview and mention its Publish as site action. Do not publish.
4. For an authorized publication, choose a readable English slug before
   publishing if the user did not specify one: 3–80 lowercase letters, digits,
   and hyphens, for example \`water-reminder\`. Call
   \`${coreMcpServerKey}.publish_web_site\` with the registered \`file_id\` and the
   new site's \`name\` and \`slug\`, or the existing \`site_id\` for an update.
   If the chosen slug is taken, ask the user or offer an alternative; never
   silently replace their choice. If publication fails, keep the preview.
5. A successful publication with status \`published\` delivers the website card
   with its link. Briefly describe the result and any limitations. Do not
   present the source HTML as the main delivery or claim a site is live if its
   status is disabled. A loopback address is local, not a shareable public URL.
6. Only when the user explicitly asks to open the site in their local browser,
   call \`${coreMcpServerKey}.browser_use\` once with \`action: "open_site"\` and
   \`site_id\` from the publication result. This uses the paired local extension.
   If the extension is unavailable, denied, or times out, leave the card's Open
   and Copy actions available. Do not retry or substitute the cloud browser.

## Update and manage

- Find an existing site with \`${coreMcpServerKey}.list_web_sites\` (search by
  name or slug). Reuse its \`site_id\` instead of creating a duplicate.
- To change content, rebuild the site, register the new HTML entry, and call
  \`publish_web_site\` with \`site_id\` and the new \`file_id\`. The slug stays the
  same and the public link keeps working.
- To change only the name, description, slug, or published status, call
  \`${coreMcpServerKey}.update_web_site\`. Changing the slug immediately invalidates
  the old link; confirm before doing it.
- Unpublish with \`update_web_site\` and \`status: "disabled"\`. Republish with
  \`status: "published"\`. Deleting a site is a destructive action and should be
  left to the user in “资料库 → 我的站点” unless they explicitly ask for it.

## Safety

- The published page is public. Remove credentials, tokens, personal data,
  internal addresses, and content that should not be public before publishing.
- Do not add analytics, tracking, or third-party requests unless the user asks.
- Treat the published site as an external side effect: only publish when the
  user asked for a public site or selected the public-website option.
- Keep the assistant's final answer short: what was published, the public URL,
  and any limitation that materially affects the user (for example, no local
  persistence in the current public-site sandbox).
`,
    "agents/openai.yaml": `interface:
  display_name: "LinkSense 公开站点开发"
  short_description: "Build and publish a standalone public website"
  default_prompt: "Use $${name} to build and publish a public website in this conversation."
dependencies:
  tools:
    - type: "mcp"
      value: "${coreMcpServerKey}"
      description: "Register website artifacts and publish public links"
      transport: "stdio"
policy:
  allow_implicit_invocation: true
`,
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content, { mode: 0o640 });
    await chmod(join(root, name), 0o640);
  }
}
