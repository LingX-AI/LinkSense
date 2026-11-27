import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applicationIntentInstructions, PUBLIC_SITE_SKILL_NAME, coreMcpServerKey } from "@linksense/shared";

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

${applicationIntentInstructions("this Skill", `${coreMcpServerKey}.request_user_form`)}

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
- Treat static and dynamic pages as one Web application with optional backend.
  A schedule is an execution capability, not a mutually exclusive application type.
  Use ordinary outcome language in the user's language. For a water reminder,
  ask whether it must work after closing the page, with choices such as “yes”,
  “only while open” and “preview first, decide reminders later”.
  Ask about publication only when the intended audience is unclear and affects
  the outcome. Use a required form for necessary publication, recipient or
  schedule decisions.
  For low-impact unknown details, explain a reversible assumption and build a draft.
  Resolve essential follow-up details only when needed; “ask once” is not a ban
  on asking a different necessary question. A chosen Web delivery is not itself
  permission to publish. An explicit publication request already supplies permission.
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
- Every site ships with a favicon; generate it automatically instead of leaving
  the browser tab blank. Draw a small self-contained \`favicon.svg\` in the same
  directory (the key noun, a monogram, or a simple mark derived from the page's
  palette), keep it legible at 16px, and link it with a relative URL:
  \`<link rel="icon" type="image/svg+xml" href="favicon.svg">\`. Never point at a
  root-absolute \`/favicon.ico\`; the release is served under a release path.
  Do not ask the user to design the favicon first — ship a reasonable one and
  offer to regenerate it.
- Match the language the user asked for. Keep the page usable on mobile and
  cover loading, empty, and error states where relevant.

## Dynamic application workflow

For an existing site, first call \`${coreMcpServerKey}.list_web_sites\` and
resolve the intended site before changing resources. If it has a \`backend_id\`,
call \`${coreMcpServerKey}.inspect_web_site_backend\` and reuse its configuration,
even from a different conversation. Only use backend preparation for recovery
with that same ID; do not prepare a replacement by name.

If an existing static site has no \`backend_id\` and now needs a backend, prepare
a new sandbox backend only for the requested capability. Validate the new frontend
and backend, then publish with the existing \`site_id\` and prepared \`backend_id\`.
The platform binds both in one transaction and keeps the application ID and link.
Never replace an existing backend. A failed preparation or publication leaves
the previous page available; do not publish backend-dependent code without its binding.
The stable published address is \`/app/s/<site-id>\`; \`/web/<slug>\` and sandbox
\`/app/<backend-address>\` remain aliases, including after renaming.
Return the publishing tool's URL, not a URL inferred from backend preparation.

1. For a new authorized public dynamic application, call
   \`${coreMcpServerKey}.prepare_web_site_backend\` with a short name. It returns
   \`id\` (use as \`backend_id\`), \`runtime_mode\`, \`project_id\`, \`origin\`,
   \`endpoint\` and \`database_id: app\`. New backends have
   \`runtime_mode: sandbox\`, \`url: <LinkSense>/app/<address>\` and \`sdk_url\`.
   The backend \`address\` is an optional alias, not the application's stable
   identity. Do not ask the user to choose it before building a draft.
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
     Call \`account.get()\` first and create an anonymous session only when it
     fails with \`AUTH_REQUIRED\`; \`account.anonymous()\` returns 401 while a
     session is already active.
   - \`tables.list(tableId, queries?: string[])\`, \`tables.get(tableId,rowId)\`,
     \`tables.create(tableId,data,permissions?: string[],rowId?: string)\`,
     \`tables.update(tableId,rowId,data)\`, \`tables.delete(tableId,rowId)\`.
     Queries use Appwrite's serialized query format. Permission targets are
     account user IDs: use the \`userId\` from the account or session response,
     never the session \`$id\`. Assign \`read("user:<userId>")\`,
     \`update("user:<userId>")\` and \`delete("user:<userId>")\` explicitly when
     creating private rows.
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
   \`backend_id\` to \`publish_web_site\` when creating the site or adding backend
   capabilities to an existing static site. The tool refuses
   publication while resources are still building. Use the returned URL as the
   main result. An artifact preview is still sandboxed and does not validate
   the dynamic application's login or backend behavior. Sandbox applications
   keep the address bar at the returned stable application URL.
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
3. Without publication authorization, lead with the registered HTML preview card,
   not a workspace path. Do not publish. For source-only requests, deliver a
   download. For a static site, mention its Publish as site action only if sharing helps.
   For a dynamic application, explain that this is a UI preview without working
   visitor login or backend access. The generic HTML Publish as site action does not attach a dynamic backend.
   If sharing helps, invite the user to ask for publication in this conversation.
   Once authorized, reuse the prepared \`backend_id\` and publish through the tool.
4. For an authorized publication, choose a readable English slug before
   publishing if the user did not specify one: 3–80 lowercase letters, digits,
   and hyphens, for example \`water-reminder\`. Call
   \`${coreMcpServerKey}.publish_web_site\` with the registered \`file_id\` and the
   new site's \`name\` and \`slug\`, or the existing \`site_id\` for an update.
   For a new dynamic application or static-to-dynamic enhancement, also include
   its prepared \`backend_id\`.
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
- To change or regenerate the favicon, update or redraw \`favicon.svg\` in the
  site bundle (same palette, same relative \`<link rel="icon">\`), register the
  new entry, and republish with the existing \`site_id\`. A favicon-only request
  is a normal content update, not a new site.
- To change only the name, description, slug, or published status, call
  \`${coreMcpServerKey}.update_web_site\`. Renaming keeps the stable application
  URL and old aliases usable; do not request repeated confirmation for an
  already authorized rename.
- To require an access passcode, call \`update_web_site\` with
  \`passcode: "<code>"\` (4–128 characters); \`passcode: null\` removes it.
  Visitors then unlock the site on a LinkSense passcode page, and changing the
  passcode immediately revokes earlier unlocks. Never put the passcode in the
  page bundle or logs, and do not invent one if the user has not chosen a code.
- To collect visitor statistics, call \`update_web_site\` with
  \`analytics: true\` after the site is published, then share the returned
  \`analytics_url\` as the dashboard link. Only a published site can enable it;
  \`analytics: false\` stops collection but keeps its history. This built-in
  setting is the only supported analytics integration. Never embed a
  third-party analytics script or invent a dashboard URL, and report an
  unconfigured analytics service as an actual error.
- Unpublish with \`${coreMcpServerKey}.update_web_site\` and \`status: "disabled"\`.
  Republish with \`status: "published"\`.
- Delete only when the user explicitly asks to delete a specific site. Confirm
  its name and public URL first, then call \`${coreMcpServerKey}.delete_web_site\`
  with its \`site_id\`. Deletion is permanent: releases, the address and any
  backend binding go away, and the freed address may be reused by others. When
  the user only wants to withdraw the site, unpublish instead. Never delete as
  a side effect of another request.

## Safety

- The published page is public. Remove credentials, tokens, personal data,
  internal addresses, and content that should not be public before publishing.
- Do not add analytics, tracking, or third-party requests unless the user asks.
  For visitor statistics, use the site's \`analytics\` setting; do not embed a
  third-party tracker yourself.
- Treat the published site as an external side effect: only publish when the
  user explicitly requested publication or a public link. Selecting a delivery
  shape alone does not authorize publication.
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
