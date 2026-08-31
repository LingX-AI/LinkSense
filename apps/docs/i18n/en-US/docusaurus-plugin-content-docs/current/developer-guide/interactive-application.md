---
title: Build an interactive application
description: Build an importable interactive application with HTML, CSS, JavaScript, and the LinkSense SDK.
---

# Build an interactive application

Interactive applications put your workflow forms, visualizations, and controls inside LinkSense. Your code runs in an isolated iframe while the complete trusted LinkSense chat occupies a separate pane on the right, preserving task progress, forms, approvals, attachments, and artifacts. Users can drag the divider to resize both panes, and the chat never covers the application UI.

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

The archive can be up to 10 MiB, expand to at most 30 MiB, and contain at most 200 files. Do not include dependency directories, caches, symbolic links, server code, or credentials.

## Manifest

```json
{
  "schema_version": 1,
  "id": "research-workbench",
  "name": "Research workbench",
  "version": "1.0.0",
  "description": "Collect research criteria and display structured progress.",
  "instructions": "Emit the declared business events as research sections complete.",
  "icon": "assets/logo.png",
  "entry": "index.html",
  "sdk_version": 1,
  "permissions": [
    "user.profile:read",
    "capabilities:read",
    "knowledge_bases:read",
    "mcp_servers:read",
    "tasks:write"
  ],
  "custom_events": [
    {
      "name": "research.section_ready",
      "description": "Emit after completing a research section that the app can display independently.",
      "schema_version": 1,
      "payload_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "summary"],
        "properties": {
          "title": { "type": "string" },
          "summary": { "type": "string" }
        }
      }
    }
  ]
}
```

Every `payload_schema` must describe a top-level JSON object. Declare event fields under that object's `properties`; do not encode the whole event payload as a JSON string.

Change `version` whenever you update the package. Existing tasks keep their original package; new tasks use the current version.

## Load the SDK

```html
<script src="/api/v1/interactive-app-runtime/sdk/v1.js"></script>
<script type="module" src="./app.js"></script>
```

After initialization, the SDK is available as `window.LinkSense`:

```js
await LinkSense.ready()
const user = await LinkSense.context.getCurrentUser()
const capabilities = await LinkSense.resources.listCapabilities()
const knowledgeBases = await LinkSense.resources.listKnowledgeBases()
const mcpServers = await LinkSense.resources.listMcpServers()
```

These methods return summaries that the current signed-in user may use. They never return passwords, tokens, MCP credentials or addresses, capability source, or knowledge-base content.

## Run work and receive business events

```js
const receipt = await LinkSense.tasks.run({
  prompt: "Complete the competitive analysis and emit research.section_ready for each section.",
  capability_ids: selectedCapabilityIds,
  knowledge_base_ids: selectedKnowledgeBaseIds,
})

const unsubscribe = LinkSense.events.on(
  "research.section_ready",
  (event) => renderSection(event.payload),
)
```

The trusted LinkSense chat displays message streaming, reasoning, and tool progress, so those native events are not duplicated into the iframe. Custom events include a stable id, schema version, turn, sequence, and timestamp. Keep UI updates idempotent across reconnects.

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

## Security boundaries

- The iframe cannot call LinkSense APIs directly or read authentication cookies and tokens.
- Network connections, HTML form submission, objects, and base URL changes are blocked by default.
- Every SDK call is checked against Manifest permissions and server-side authorization.
- Custom event payloads must match their Manifest JSON Schema.
- Do not use custom events for chat content, reasoning, tool logs, credentials, or large files. Deliver files as LinkSense artifacts.

## Import and update

Open **Plugin Center → Applications → Create application → Import interactive app**. After import, enable, disable, and share it like a standard application. Use **Update application package** to import a new version.
