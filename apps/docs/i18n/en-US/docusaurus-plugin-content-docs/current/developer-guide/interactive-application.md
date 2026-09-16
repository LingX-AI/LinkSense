---
title: Build an interactive application
description: Understand interactive application Manifest fields, their effects, limits, and recommended practices, then submit tasks and receive business events with the SDK.
---

# Build an interactive application

Interactive applications put your workflow forms, visualizations, and controls inside LinkSense. Your code runs in an iframe without a sandbox while the complete LinkSense chat occupies a separate pane on the right, preserving task progress, forms, approvals, attachments, and artifacts. Users can drag the divider to resize both panes, and the chat never covers the application UI.

## Package layout

Create a ZIP whose root directly contains `manifest.json` and `index.html`.

```text
manifest.json
index.html
app.js
styles.css
assets/
  logo.png
```

The archive can be up to 10 MiB, expand to at most 30 MiB, contain at most 200 files, and have no individual file larger than 5 MiB. Do not include dependency directories, caches, symbolic links, server code, or credentials. Hidden files and directories such as `.DS_Store` and `.git` cause import to fail, as do file paths that differ only in letter case.

Supported extensions are `.html`, `.css`, `.js`, `.mjs`, `.json`, `.map`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`, `.ico`, `.woff`, and `.woff2`. When using a build tool, package only the generated static files and configure relative references for bundled assets such as `./app.js` and `./assets/logo.png`. Fonts, scripts, styles, and images can be bundled or loaded from external CDNs.

## Manifest

`manifest.json` describes the application identity, task instructions, SDK permissions, and business event contracts. LinkSense validates it during import, fixes the corresponding package version when a task is created, and uses its permissions and event definitions at runtime.

### Minimal configuration

If the first version only collects input and starts work, begin with this configuration. It explicitly requests `tasks:write`; other optional fields use their defaults:

```json title="manifest.json"
{
  "schema_version": 1,
  "id": "research-workbench",
  "name": "Research workbench",
  "version": "1.0.0",
  "sdk_version": 1,
  "permissions": ["tasks:write"]
}
```

Package this file with `index.html`. It allows the page to submit and interrupt work but declares no business events, so users view results in the native LinkSense chat pane.

### Top-level field reference

String limits below apply after trimming leading and trailing whitespace. The Manifest root and individual `custom_events` definitions reject unknown fields. Do not add fields such as `author`, `homepage`, `model`, or `mcp_server_ids`.

| Field | Type and limits | Required / default | Meaning and effect | Recommended practice |
| --- | --- | --- | --- | --- |
| `schema_version` | Integer; only `1` is supported | Required | Version of the Manifest file format, determining how the platform parses it. | Keep `1`. Change `version` when releasing the application, rather than incrementing this field. |
| `id` | String, 1–120 characters; matches `^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$` | Required | Application identifier inside the package, such as `research-workbench`; it is not the platform-assigned application UUID. | Use a stable lowercase name with hyphen-separated words, keep it unchanged across updates, and omit version numbers. Importing the same `id` does not automatically overwrite an application; update through the target application's menu. |
| `name` | String, 1–160 characters | Required | Name displayed to users in places such as the application list; import and package updates write this into the application name. | Use a short, recognizable business name, such as “Research workbench”, without accumulating versions or technical terms. |
| `version` | String, 1–80 characters; matches `^[0-9A-Za-z][0-9A-Za-z._+-]*$` | Required | Identifies a release of the application package; a previously imported version cannot be reused within the same application. | Prefer semantic versions such as `1.0.0` and `1.1.0`. The platform checks format and uniqueness, does not require SemVer, and does not automatically upgrade by comparing version order. |
| `description` | String or `null`; at most 4,000 characters | Optional; `null` | User-facing application summary; import and updates write it into the application description. It is not a task instruction. | Explain the use case, expected input, and output. This accepts one string, not an object of translations. |
| `instructions` | String or `null`; at most 20,000 characters | Optional; `null` | Application-level task instructions. At runtime, declared event names, descriptions, and payload schemas are also appended. | Describe stable business goals, output requirements, and event triggers. Put this submission's form input in `tasks.run().prompt`. Omitting this field or using `null` selects the platform's basic instructions; an empty string does not. |
| `icon` | String or `null`; path of 1–500 characters | Optional; `null` | Path to an image inside the package, used as the application icon; not an external image URL. | Use a relative path such as `assets/logo.png`. PNG, JPEG, and WebP are supported, up to 612 KiB and 8,192 pixels per dimension. Prefer a compressed square image. Paths cannot start with `/` or contain `..`. Omitting it or using `null` during an update preserves the existing icon rather than deleting it. |
| `entry` | String; only `"index.html"` is supported | Optional; `"index.html"` | Entry document opened in the iframe; it must exist at the ZIP root. | Keep the default. Do not use a full URL, nested entry document, or frontend route. |
| `sdk_version` | Integer; only `1` is supported | Required | LinkSense SDK protocol version used by the page. | Load `/sdk/v1.js` using the complete path shown below. Do not use the SDK's string version `"1.0.0"`. |
| `permissions` | Array of permission strings; at most 6, without duplicates | Optional; the original five permissions (excluding `files:write`) below | Controls which SDK capabilities the page can call; it does not expand the current user's resource access. | Explicitly list what is needed. Use `["tasks:write"]` to start work only. `[]` requests none of these capabilities; omitting the field requests the original five, excluding `files:write`. |
| `custom_events` | Array of event definitions; at most 50, with unique names | Optional; `[]` | Declares structured business data that tasks may deliver to the application for display and restoration. | Start with a few meaningful events, such as “section ready”; do not design events around chat deltas or tool logs. |

### Choosing permissions

A permission enables the corresponding SDK methods. It does not automatically select resources, install plugins, or grant resource access. After reading a resource list, let the user select entries and include the relevant IDs in the submission. Calls without the required permission fail with `LINKSENSE_SDK_PERMISSION_DENIED`.

| Permission | SDK methods | Returned data or effect | When to request it |
| --- | --- | --- | --- |
| `user.profile:read` | `context.getCurrentUser()` | Current user's `id`, `name`, `avatar_url`, and `language`. | When displaying user information or choosing the interface language; omit it otherwise. |
| `capabilities:read` | `resources.listCapabilities()` | Skill and plugin summaries: `id`, `name`, `type`, `description`, `status`, `can_select`, `logo_url`. | For a skill or plugin picker. Allow selection of available entries and pass their IDs in `capability_ids`. |
| `knowledge_bases:read` | `resources.listKnowledgeBases()` | Knowledge base summaries: `id`, `name`, `description`, `lifecycle_status`, `availability_status`. | For a knowledge base picker. Reflect availability in the options and pass selected IDs in `knowledge_base_ids`. |
| `mcp_servers:read` | `resources.listMcpServers()` | MCP service summaries: `id`, `name`, `status`, `transport`; no addresses or credentials. | When displaying connection information. This permission does not expose direct MCP calls, and `tasks.run()` does not accept `mcp_server_ids`. |
| `tasks:write` | `tasks.run(input)`, `tasks.interrupt(turnId)` | Submits work in the current application task or requests interruption of a specified turn. | For generate, submit, or stop controls. Handle acceptance failures and conflicts with running work. |
| `files:write` | `files.upload(file)`, `files.list()`, `files.remove(fileId)` | Upload and list this application task’s attachments; remove unsubmitted files. | Explicitly request this permission for uploads. It is not granted to older applications by default. |

`ready()`, `events.on(...)`, and `chat.show()/hide()/toggle()` need no additional permission entry. Do not add method names as new permission strings. Resource list methods return `{ items: [...] }`. Read methods expose summaries, never passwords, tokens, MCP credentials, capability source, or knowledge base content.

### Writing instructions

`description` helps users decide whether to use the application; `instructions` guides task execution; `tasks.run().prompt` specifies what this submission should accomplish. Keep these separate so application guidance and form input can change independently.

Organize `instructions` around:

1. **Business goal**: the problem to solve and what falls outside its scope.
2. **Deliverables**: required conclusions, sections, or outputs, and when to ask the user for missing information.
3. **Event triggers**: when to send each event and whether it represents one record or a complete snapshot.
4. **Chat responsibilities**: communicate and handle forms and approvals in native chat; send only suitable business data to the application.

The complete example below sends an event after each research section is ready. Avoid vague rules such as “send events as needed”, and do not put secrets, fixed user identities, or all values from a particular submission in long-lived instructions.

### Custom event field reference

Each `custom_events` entry has the following fields. Event names must match `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$` and cannot start with `linksense.`, `conversation.`, `turn.`, or `item.`.

| Field | Type and limits | Required / default | Meaning and effect | Recommended practice |
| --- | --- | --- | --- | --- |
| `custom_events[].name` | String, 1–120 characters, following the naming rules above; unique within the package | Required | Exact name connecting the declaration, task emission, and `events.on(name, handler)` listener. | Use a business domain and an action that has occurred, such as `research.section_ready`. Match the spelling in all three places and avoid vague names such as `update`. |
| `custom_events[].description` | String, 1–2,000 characters; nonempty after trimming | Required | Explains when to emit the event and what its data means; supplied to the executing model with the contract. | Specify the trigger, granularity, and update semantics, such as “send a complete section summary when ready; the same section ID replaces its previous content”. |
| `custom_events[].schema_version` | Integer, 1–1,000 | Optional; `1` | Version of this event's data contract, delivered with the event; independent of the Manifest format and package versions. | Increment when field types, meanings, or required rules change, and update the handler and package `version` together. It does not automatically convert old data. |
| `custom_events[].payload_schema` | JSON Schema object; top-level `type` must explicitly be `"object"` | Required | Defines allowed event data. The schema is compiled at import, payloads are checked at emission, and invalid data is not delivered. | Use JSON Schema 2020-12, specify types and required fields, and bound strings and arrays. Prefer `additionalProperties: false` to exclude undefined data. |

### Writing payload_schema

LinkSense uses its existing Ajv 2020 validator for event contracts. The common keywords below cover most small business events. See the [JSON Schema object reference](https://json-schema.org/understanding-json-schema/reference/object) for optional and additional field behavior, and [Ajv's JSON Schema documentation](https://ajv.js.org/json-schema.html) for dialect support.

| Keyword | Meaning and effect | Recommended practice |
| --- | --- | --- |
| `$schema` | Optional JSON Schema dialect declaration; when included, use `https://json-schema.org/draft/2020-12/schema`. | Declare 2020-12 explicitly so editors and the platform interpret the contract consistently. |
| `type` | Constrains the data type. The event root must be `object`; fields may use types such as `string`, `number`, `integer`, `boolean`, `array`, or `object`. | Give every field a type and define nested object structures fully. |
| `properties` | Describes object fields and their constraints; declaring a property alone does not make it required. | Include only business fields the interface needs, using stable names. |
| `required` | Array of field names that must exist. Without it, fields in `properties` are optional. | Require fields needed to display or calculate results; define empty states for optional fields. |
| `additionalProperties` | Controls whether fields outside the contract are accepted; allowed by default. | Usually set to `false`, including separately on nested objects. |
| `description` | Explains a business field in the payload. | Describe units, sources, or identifier stability to guide data generation; it is not a validation rule. |
| `minLength` / `maxLength` | Constrains string length. | Set limits suited to the UI for titles and summaries; required text generally needs `minLength: 1`. |
| `enum` | Restricts values to a specified set. | Use stable codes such as `high`, `medium`, and `low` for status or priority, then translate them for display. |
| `items` / `maxItems` | Defines array elements and the maximum number of items. | Bound table rows and lists; split large results into smaller, meaningful business events. |

Send a JSON object matching the schema, not the schema itself or a string produced by `JSON.stringify(payload)`. Each payload is also limited by `JSON.stringify(payload).length <= 65,536`. Keep events well below that limit and deliver files or long reports as LinkSense artifacts.

### Complete configuration example

This version starts research and receives section events, so it still requests only `tasks:write`. It does not read user information or resource lists; add the corresponding permissions when adding those pickers.

```json title="manifest.json"
{
  "schema_version": 1,
  "id": "research-workbench",
  "name": "Research workbench",
  "version": "1.0.0",
  "description": "Collect research criteria and display structured progress.",
  "instructions": "Research the topic in the user's current submission. Ask for missing information in native chat first. After completing each independently useful section, use emit_application_event to send research.section_ready with a stable section_id, title, and summary. When updating a section, reuse its section_id and send the complete summary. Give the full research conclusions in native chat. Do not send chat deltas, reasoning, or tool progress as business events.",
  "icon": null,
  "entry": "index.html",
  "sdk_version": 1,
  "permissions": ["tasks:write"],
  "custom_events": [
    {
      "name": "research.section_ready",
      "description": "Send a complete summary when an independently useful research section is ready. A new event with the same section_id replaces that section's displayed content.",
      "schema_version": 1,
      "payload_schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "required": ["section_id", "title", "summary"],
        "properties": {
          "section_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "description": "Stable section identifier within one research turn; preserve it when updating the section."
          },
          "title": { "type": "string", "minLength": 1, "maxLength": 160 },
          "summary": { "type": "string", "minLength": 1, "maxLength": 2000 }
        }
      }
    }
  ]
}
```

An event payload matching this contract:

```json title="research.section_ready.payload.json"
{
  "section_id": "market-overview",
  "title": "Market overview",
  "summary": "This section outlines the main participants, changing demand, and scope of research in the target market."
}
```

`section_id` is your application's business identifier, not the platform-generated event `id`. The task sends `{ name, payload }` through LinkSense's `emit_application_event` tool. The page receives it through `events.on(...)`; the SDK has no `events.emit()` method for the iframe to publish business events itself.

### Distinguishing four kinds of version information

| Value | What it versions | When to change it |
| --- | --- | --- |
| Top-level `schema_version` | Manifest format | Currently fixed at `1`, according to the format supported by the platform. |
| `sdk_version` | SDK protocol | Currently fixed at `1`, matching the SDK v1 script. |
| `version` | Entire application release package | Use a never-published version when importing changes to HTML, JS, styles, instructions, permissions, or event contracts. |
| `custom_events[].schema_version` | One business event contract | Increment when its structure or meaning changes, and publish it with a new package version. |

Existing tasks keep the package, instructions, and event contracts fixed at creation; new tasks use the current package. An update neither switches old tasks to the new interface nor rewrites historical data with the new schema. Before releasing, check both creating a new task and reopening an existing one.

## Load the SDK

```html
<script src="/api/v1/interactive-app-runtime/sdk/v1.js?v=1.1.0"></script>
<script type="module" src="./app.js"></script>
```

The SDK is exposed as `window.LinkSense`. Register business event listeners early in `app.js`, then wait for readiness before enabling interactions:

```js
const sections = new Map()
const unsubscribe = LinkSense.events.on("research.section_ready", (event) => {
  const key = `${event.turn_id}:${event.payload.section_id}`
  sections.set(key, event.payload)
  renderSections([...sections.values()])
})

await LinkSense.ready()
```

Implement `renderSections` in your application. Render output through `textContent` or framework text interpolation, avoiding direct assignment of task output to `innerHTML`. Combining the turn ID and section ID replaces a section's previous summary without overwriting results from other turns. Call `unsubscribe()` when the component unmounts.

To read context or resources, add the permission first and call the method after `ready()`. For example, after adding `knowledge_bases:read`, use `const { items } = await LinkSense.resources.listKnowledgeBases()` to obtain options.

The runtime supports inline `<script>` blocks, event handler attributes, bundled scripts, and external scripts. Use the platform URL above for the SDK and relative paths for bundled application scripts. Opening the HTML outside LinkSense provides no host handshake, so `ready()` will not complete. You can develop the pure UI locally, but SDK integration needs an imported application.

## Submit work

```js
const receipt = await LinkSense.tasks.run({
  prompt: "Complete the competitive analysis and emit research.section_ready for each section.",
})
```

| Parameter | Meaning and limits | Recommended practice |
| --- | --- | --- |
| `prompt` | Required; 1–200,000 characters after trimming; the current task request. | Build it from validated form values, with a clear topic, constraints, and deliverables. Avoid submitting values without context. |
| `capability_ids` | Optional, default `[]`; up to 60 skill or plugin IDs. | Use the user's current selection. Reading a list does not select its entries, and the server still checks resource access and status. |
| `knowledge_base_ids` | Optional, default `[]`; up to 20 knowledge base UUIDs. | Include only the knowledge bases needed for this submission. |
| `file_ids` | Optional, defaults to `[]`; up to 100 unique file UUIDs. | Select staged IDs returned by `files.upload()` or `files.list()`; only these files are attached, excluding chat drafts. |
| `idempotency_key` | Optional; 1–120 characters after trimming. | Usually let the host manage it. If supplied, identify one logical submission; do not reuse a fixed value across different requests. |

On submission, LinkSense immediately opens the chat pane and shows the message as sending. Once accepted, the pending message is reconciled with the persisted message. `tasks.run()` returns the server's acceptance receipt without waiting for chat history refreshes or research results. Repeated calls for the same in-flight submission share one request; applications should still disable their generate button during submission and handle failures.

Application-submitted messages exceeding five rendered lines at the current chat width are collapsed by default with a fade at the bottom. Arrow icon buttons expand or collapse the full content. The complete prompt is still sent, saved, and copied. Manually typed chat messages are unaffected.

The native LinkSense chat displays message streaming, reasoning, and tool progress; these are not duplicated into the iframe. The application receives only its declared business events, with these callback fields:

| Callback field | Meaning and use |
| --- | --- |
| `id` | Stable platform-generated event ID for deduplication; not a business record ID. |
| `name` | Event name declared in the Manifest. |
| `schema_version` | Schema version from that event's definition. |
| `payload` | Business object validated against the event schema. |
| `turn_id` | ID of the task turn that produced the event; separates results from multiple submissions. |
| `sequence` | Position in the task's event stream, used for ordering; business events do not necessarily have consecutive values. |
| `created_at` | Event timestamp for display. |

The same event may arrive again after reconnection. The SDK deduplicates by event `id`, and application updates should also be idempotent. The acceptance receipt means the request was accepted, not that work has finished. To stop work, use `await LinkSense.tasks.interrupt(receipt.turn_id)`; hiding the chat is not an interruption.

### Re-entering a task and restoring events

After switching to another task, users can reopen an interactive application from the task sidebar or search results. LinkSense loads the immutable application package fixed when the task was created, replays all persisted custom events in `sequence` order, and then continues with live events. Restoring the page never reruns the task or asks the model to emit the data again.

The SDK buffers events that arrive before the application registers a listener and deduplicates them by stable event id. Register business event listeners early and keep handlers idempotent so the UI can be rebuilt from callbacks. Unsubmitted form drafts that were never represented by custom events are not persisted automatically.

## Chat controls

Users can resize the chat pane on desktop and show or hide it at any time. Applications can also request a visibility change:

```js
await LinkSense.chat.show()
await LinkSense.chat.hide()
await LinkSense.chat.toggle()
```

Hiding the panel never stops the task. Ask the user to reopen it when a LinkSense form, approval, or error needs attention.

## Network access, downloads, and trust boundaries

- Interactive applications have no iframe `sandbox`, and runtime resources send no CSP, Permissions-Policy, or X-Frame-Options. Applications can use `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` directly, load external resources, submit HTML forms, open new windows, and download files without adding Manifest permissions.
- Downloads can use ordinary file links, the `download` attribute, or Blob URLs created from files retrieved with `fetch`. Cross-origin `download` attributes, popups, and automatic downloads remain subject to browser rules; third-party servers can serve downloads with `Content-Disposition: attachment`.
- Browser CORS, HTTPS mixed-content rules, and permission prompts still apply. Permissions-Policy from an outer host or deployment gateway may also restrict device capabilities. Third-party APIs should allow the LinkSense page origin; HTTPS pages should use HTTPS APIs and WSS connections. Server-side connectivity does not establish connectivity from the user's browser.
- Import only trusted packages and external scripts. Applications share the host origin and are no longer a security isolation boundary: they can access the parent page, same-origin storage, and non-HttpOnly cookies, and may request LinkSense APIs as the current user. HttpOnly cookies remain unreadable by JavaScript. Never bundle long-lived tokens or third-party service secrets in frontend files.
- Existing applications use the new policy after deploying both the API and Web updates and reloading the page; no reimport or historical Manifest changes are needed. CSP declared by the application itself or additional policies from an external proxy still apply.
- Every SDK call is checked against Manifest permissions and server-side authorization.
- Custom event payloads must match their Manifest JSON Schema.
- Do not use custom events for chat content, reasoning, tool logs, credentials, or large files. Deliver files as LinkSense artifacts.

## Import and update

Open **Plugin Center → Applications → Create application → Import interactive app**. After import, enable, disable, and share it like a standard application. Use **Update application package** to import a new version.

Build the first version in this order:

1. Start with the minimal Manifest, one form, and `tasks.run()` to complete the flow from input to a chat result.
2. Define one useful business event and implement its schema, emission rules, and page listener.
3. Verify that switching away and reopening the task restores results from replayed events, then add resource pickers and visualizations.
4. Check loading, empty results, submitting, failure, denied permissions, and duplicate submissions before release. The layout should adapt when the chat pane is resized.
5. Update the package `version`, event contracts, and handlers together, checking new and existing tasks separately.

The repository's `examples/interactive-research-brief/` directory contains a complete static example with a Manifest, form, resource selection, and event display that you can use as an extension reference.

## Troubleshooting

| Symptom | Check first | Resolution |
| --- | --- | --- |
| Import reports an invalid package | ZIP root, unknown fields, version types, duplicate permissions or events, file and icon limits. | Compare with the minimal configuration. Use numeric `1`, not string `"1"`, and place `index.html` and `manifest.json` directly at the root. |
| An event schema prevents import | `payload_schema.type`, schema dialect, and resolvable references. | Use 2020-12 with an object root and a self-contained schema; do not rely on downloading external `$ref` targets at runtime. |
| An update reports a version conflict | Whether this application's new `version` was previously imported. | Use a never-published version. Changing file contents does not bypass uniqueness checks. |
| The icon fails import | Whether `icon` points to SVG, GIF, or an external URL. | Use a valid bundled PNG, JPEG, or WebP. Support for SVG page assets does not imply SVG application icon support. |
| Scripts, requests, or assets fail | Check browser errors, CORS, HTTPS mixed content, asset paths, and connectivity from the user's network. | Direct connections and external scripts are allowed. Configure the third-party service to allow the page origin, use HTTPS/WSS and correct asset paths, and check for CSP added by the application or a proxy. |
| The SDK reports not ready or permission denied | Whether `ready()` completed and the required permission is present. | Enable controls after initialization. Add permissions required by actual calls, publish a new package, and verify in a new task. |
| Chat has results but the application receives no business data | Matching event names in declaration, instructions, and listener; emission tool use; payload validity. | State precise triggers, check required fields, types, lengths, and extra fields, and register listeners early. |
| Reopening produces duplicates or loses drafts | Whether every event is appended as a new record, or unsent drafts are treated as saved results. | Deduplicate by event ID and update by business ID. Rebuild the interface from persisted events rather than relying on page memory to restore drafts. |


## Upload reference files

File methods are available in SDK `1.1.0`; the protocol `sdk_version` remains `1`. When updating a package, use the `v1.js?v=1.1.0` script URL above to bypass any previously cached SDK with a long immutable lifetime.

Explicitly add `files:write` to the Manifest permissions; task submission also needs `tasks:write`. The application owns its file picker, drop area, file list, and upload states. The SDK does not create a UI. Pass browser `File` objects to the host; do not encode them as Base64, call platform APIs directly, or send them through custom events.

```js
await LinkSense.ready()
const file = document.querySelector('input[type="file"]').files[0]
const uploaded = await LinkSense.files.upload(file)
const receipt = await LinkSense.tasks.run({
  prompt: "Analyze this reference and summarize the key findings.",
  file_ids: [uploaded.id],
})
```

| Method | Result and behavior |
| --- | --- |
| `files.upload(file)` | Upload one `File` and return its metadata. Call separately for multiple files. Uploading does not start a task. |
| `files.list()` | Return `{ items }` containing this application task’s staged and bound files, including after reopening the page. |
| `files.remove(fileId)` | Remove an unsubmitted application attachment; return `{ removed: true }`. Files already submitted or being admitted cannot be removed. |

File metadata contains only `id`, `filename`, `mime_type`, `size_bytes`, `status`, and `turn_id`. A `staged` file can be selected for submission; a `bound` file belongs to a turn. On reopening, display any files you need, but only select staged files for the next submission. The platform does not restore application-specific mappings between files and form fields.

Uploads use the platform’s existing per-file size and per-conversation file-count limits. Applications can further restrict types with `accept` and their own validation. Multiple uploads succeed or fail independently: retain successful files, allow failed files to be retried or removed, and enable submission only when all selected files are ready. Handle rejected SDK Promises with localized feedback. The host rejects task submission while uploads or removals are in progress. A failed task submission retains staged files for a user-initiated retry.

Omitting `file_ids` or passing `[]` submits no files. Application attachments and native chat drafts are managed separately: an application can only submit its current task’s staged application attachments, and chat does not automatically consume them. Accepted attachments belong to the submitted turn, appear in chat history, and are passed through the existing runner attachment context. Do not submit a bound file again as a new attachment. Reuse the same `idempotency_key` for the same logical submission; use a new key when changing file selection.

Existing packages continue to submit text without reimporting. To enable uploads, update the package with the permission and create a task using that version. Existing tasks retain their pinned package and permissions.

See `examples/interactive-research-brief/` for multiple selection, retry, removal, restoration, and explicit file-ID submission.

Before deploying this capability, run `pnpm db:migrate:deploy` to extend the attachment-source database constraint, then deploy matching API and frontend versions. The migration retains all existing source values, attachments, and field definitions. After new-origin attachments have been written, do not roll back to an API version that cannot parse that origin or mix old and new API instances.
