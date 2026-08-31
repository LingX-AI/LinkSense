---
title: Connect and manage MCP servers
description: Manage built-in and personal Streamable HTTP or STDIO MCP servers.
---

# Connect and manage MCP servers

MCP servers provide tools to tasks. Built-in entries are read-only; personal servers are assembled only for your new tasks.

## Built-in MCP

LinkSense may provide file-service, knowledge-base, and Skill-creator MCP servers. The platform manages them, so you cannot edit, disable, or delete them.

## Add an HTTP server

1. Open **Settings → MCP** and choose **Add server**.
2. Select HTTP and enter a name and Streamable HTTP URL.
3. Choose no authentication, Bearer token, or API key.
4. Set startup and tool timeouts.
5. Test the connection and save after tools are discovered.

Prefer HTTPS. HTTP sends credentials, arguments, and results without transport encryption and requires a separate risk acknowledgement.

## Add a STDIO server

Provide a one-server JSON object with `command`, optional `args`, and optional `env`. Environment values are encrypted and not returned. A single-entry `mcpServers` structure is also accepted.

Task containers use pnpm rather than npm or npx. Supported `npx -y` declarations are converted to controlled pnpm execution.

## Required connection

When **Required** is enabled, connection failure blocks task startup. An optional failed server may be skipped, but its tools will not be available.

## Manage secrets and deletion

Leaving saved HTTP secrets or STDIO `env` out of an edit preserves them; an empty `env` object clears STDIO variables. Deletion permanently removes configuration and encrypted values.

:::warning Trust boundary
Connect only trusted MCP servers. Tools can receive task arguments, access external systems, and return untrusted content.
:::
