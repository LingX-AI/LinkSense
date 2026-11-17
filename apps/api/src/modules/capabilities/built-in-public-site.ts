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
description: Create, update and publish standalone public websites or dynamic applications directly in the current conversation. Use for shareable links and externally used apps with independent visitor accounts, persistent data, uploads or business APIs on self-hosted Appwrite. Use linksense-interactive-app-builder for LinkSense AI, tasks, knowledge bases, plugins, platform identity or organization sharing.
---

# Public website development

Create and register a complete website in the current task. Deliver a
preview unless the user explicitly requests publication or a public link.
Do not send the user to a creation page or require manual Skill selection.

## Choose the right delivery shape

- Use this Skill for a public page, landing page, portfolio, calculator, timer,
  tracker, or other browser-only tool that anyone can open with a link and that
  does not need LinkSense login, AI, tasks, files, knowledge bases, plugins, or
  organization sharing.
- Use \`linksense-interactive-app-builder\` instead when the user wants the result
  inside LinkSense, needs LinkSense AI or task execution, needs LinkSense
  resources or identity, or needs organization/install distribution.
- For a public application needing its own visitor accounts, persistent data,
  uploads or business APIs, follow the dynamic application workflow below.
  These visitors do not need LinkSense accounts.
  Visitor login, data and uploads do not require LinkSense platform identity.
- If the delivery shape is genuinely ambiguous, ask once with
  \`${coreMcpServerKey}.request_user_form\` using one \`radio\` field with 2–5
  short options. In \`message\`, explain what each shape means and when to use
  it, and give each option a one-line description: public website — anyone with
  the link can open it, optionally with its own visitor accounts and backend,
  no LinkSense platform login or AI; LinkSense application —
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
- Static sites have no server-side code, secrets, or background jobs.
  External HTTPS assets are loaded by the visitor's browser and remain subject
  to CORS and availability.
- The preceding static runtime restrictions apply to ordinary static sites.
  New dynamic backends use a sandbox SDK and server-side visitor sessions.
  Existing origin-based backends retain their original runtime.
- Static sites and HTML artifact previews use a sandboxed iframe without same-origin:
  \`localStorage\`, \`sessionStorage\`, IndexedDB, cookies, Service Workers, and
  browser notifications are unavailable. Keep state in memory or in the URL.
  If the user needs progress to survive reloads or needs reminders, explain the
  limitation and use the self-hosted dynamic workflow if appropriate; never
  claim that local persistence works.
- Match the language the user asked for. Keep the page usable on mobile and
  cover loading, empty, and error states where relevant.

## Dynamic application workflow

For an existing site, first call \`${coreMcpServerKey}.list_web_sites\` and
resolve the intended site before changing resources. If it has a \`backend_id\`,
call \`${coreMcpServerKey}.inspect_web_site_backend\` and reuse its configuration,
even from a different conversation. Only use backend preparation for recovery
with that same ID; do not prepare a replacement by name.

If an existing static site has no \`backend_id\` and now needs a backend, explain
that its backend binding cannot be added or replaced by publishing an update.
Do not overwrite the static site with backend-dependent frontend code.
Create a separate dynamic application and its new URL only when the user
requests or approves that change; preserve the original site and link.

1. For a new authorized public dynamic application, call
   \`${coreMcpServerKey}.prepare_web_site_backend\` with a short name. It returns
   \`id\` (use as \`backend_id\`), \`runtime_mode\`, \`project_id\`, \`origin\`,
   \`endpoint\` and \`database_id: app\`. New backends have
   \`runtime_mode: sandbox\`, \`url: <LinkSense>/app/<address>\` and \`sdk_url\`.
   Supply a short readable \`address\` before generating the frontend.
   Reuse this backend for subsequent versions. If the service is not configured,
   report the actual error; do not silently use a cloud service or simulate
   successful persistence in localStorage.
2. Use \`${coreMcpServerKey}.configure_web_site_backend\` to create tables,
   columns/indexes, upload buckets and HTTP functions. Tables and files use
   record-level permissions and default to private. Give a visitor explicit
   read/update/delete permissions for their own records. Broad table reads
   are additive and defeat row privacy: use \`public_read\` only for intentionally
   public content. For server-controlled workflows such as approval, set
   \`client_create: false\` and create records through a function that validates
   fields and assigns owner permissions. Add only optional columns to existing tables. Never recreate
   a database, project or table to implement an update.
3. Follow the returned runtime; never replace an existing application's runtime.
   For \`sandbox\`, load the exact returned \`sdk_url\` with a classic
   \`<script src="..."></script>\` before the app code. Await
   \`LinkSenseApp.ready()\` before backend operations. The parent shell owns
   networking and credentials; do not use the Appwrite Web SDK, direct API
   fetch, localStorage, sessionStorage, IndexedDB, cookies or Service Workers.
   The SDK rejects in artifact previews; show a localized preview/loading/error
   state and explain that backend testing needs the published application.
   Available async operations (database is always \`app\`):
   - \`account.create({email,password,name?})\`, \`account.login({email,password})\`,
     \`account.anonymous()\`, \`account.get()\`, \`account.logout()\`.
   - \`tables.list(tableId, queries?: string[])\`, \`tables.get(tableId,rowId)\`,
     \`tables.create(tableId,data,permissions?: string[],rowId?: string)\`,
     \`tables.update(tableId,rowId,data)\`, \`tables.delete(tableId,rowId)\`.
     Queries use Appwrite's serialized query format. Assign permissions such as
     \`read("user:<visitor-id>")\`, \`update("user:<visitor-id>")\` and
     \`delete("user:<visitor-id>")\` explicitly when creating private rows.
   - \`storage.upload(bucketId, File, fileId?: string)\`,
     \`storage.download(bucketId,fileId)\` (returns Blob), \`storage.delete(bucketId,fileId)\`.
     Use \`URL.createObjectURL(blob)\` for images/downloads and revoke it on cleanup.
     Uploads are limited to 20 MiB and the bucket's own lower limits.
   - \`functions.execute(functionId,{body?: string,path?,method?,headers?})\`.
     It returns the native execution object; check \`responseStatusCode\`
     and parse \`responseBody\` as appropriate.
   - \`request("/account/prefs",{method:"PATCH",body:{prefs:{...}}})\` covers
     other allowed visitor operations. Paths are native Appwrite client paths,
     never arbitrary URLs; project selection, privileged APIs and OAuth are denied.
   Every SDK error has an optional stable \`code\`; render a localized error.
   For existing \`origin\` applications only, keep their bundled Appwrite Web SDK
   or native same-origin fetch against the returned endpoint and native visitor
   sessions. Never use LinkSense credentials or management keys in either mode.
   Build assets locally; external CDN scripts, fonts, analytics, hosted storage
   and cloud functions are not default dependencies. Keep local asset URLs relative.
4. For business APIs, create a Node.js 24 function, package its source and all
   dependencies as \`code.tar.gz\`, register that archive as a normal artifact,
   and deploy its \`file_id\` with \`deploy_function\`. Builds are asynchronous:
   inspect \`/functions/<id>/deployments/<deployment-id>\` until the native status
   is ready. Uploading code does not change the active function. At the
   authorized rollout, explicitly call \`activate_function\` with the ready
   deployment ID; retain the previous active ID for recovery. A failed draft
   build must not replace a working function. The entrypoint is an Appwrite function exporting
   \`async ({ req, res, log, error }) => ...\`, not a listening HTTP server.
   Prefer native fetch and bundled dependencies; no build-time install command
   is run. Function execution is limited to 30 seconds. Do not add schedules,
   event triggers, always-on processes or external services in this workflow.
5. Grant only the function scopes it actually needs. Appwrite injects a
   project-scoped execution key for server data access. Keep it in the function;
   validate the actual visitor and record ownership before privileged actions.
   An admin approval function must check an administrator role; login alone is
   insufficient. Test another visitor's direct record ID and concurrent writes
   when uniqueness matters. Never put execution keys or credentials in logs,
   responses, browser code, the HTML bundle or chat.
6. Inspect tables, indexes and native function deployments before publishing.
   Register the frontend HTML and complete asset bundle normally, then pass
   \`backend_id\` to \`publish_web_site\` when creating the site. The tool refuses
   publication while resources are still building. Use the returned URL as the
   main result. An artifact preview is still sandboxed and does not validate
   the dynamic application's login or backend behavior. Sandbox applications
   keep the address bar at the returned \`/app/<address>\` URL.
7. Update with the existing \`site_id\`; the backend, visitor accounts, data and
   application URL remain unchanged. New function deployments are managed by
   Appwrite separately from frontend releases; do not claim frontend rollback
   also restores database schemas or function code.
8. Disable through the existing site controls. Application pages and client
   APIs are served through the same LS publication gate. Data is retained on
   disable or site deletion; permanent backend-data deletion needs a separate,
   explicit decision. Realtime, OAuth/SMS, scheduled jobs and SSR are outside
   this first workflow; explain a required unsupported capability explicitly.

## Register and publish

1. Create the complete site first; do not publish a placeholder.
2. Register the HTML entry with \`${coreMcpServerKey}.register_artifact\`:
   pass \`workspace_relative_path: artifacts/<site-name>/index.html\`,
   \`web_root_relative_path: artifacts/<site-name>\`, a concise
   \`display_name\`, and \`mime_type: text/html\`. The tool returns \`file_id\`.
3. If the user only asked to see the result, deliver the registered HTML
   preview. Do not publish. For a static site, mention its Publish as site action.
   For a dynamic application, explain that this is a UI preview without working
   visitor login or backend access. The generic HTML Publish as site action does not attach a dynamic backend;
   invite the user to ask for publication in this conversation. Once authorized,
   reuse the prepared \`backend_id\` and publish through the tool.
4. For an authorized publication, choose a readable English slug before
   publishing if the user did not specify one: 3–80 lowercase letters, digits,
   and hyphens, for example \`water-reminder\`. Call
   \`${coreMcpServerKey}.publish_web_site\` with the registered \`file_id\` and the
   new site's \`name\` and \`slug\`, or the existing \`site_id\` for an update.
   For a new dynamic application, also include its prepared \`backend_id\`.
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
  short_description: "Build public websites and dynamic applications"
  default_prompt: "Use $${name} to build or update a public website or self-hosted dynamic application in this conversation. Publish when I request a public site or link."
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
