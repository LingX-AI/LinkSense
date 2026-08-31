---
title: Manage plugin credentials
description: Store personal secrets safely and bind them explicitly to plugin configuration keys.
---

# Manage plugin credentials

Plugin credentials hold API keys, tokens, or other secrets for your plugins. Plaintext is submitted once and never displayed after storage.

## Add a credential

1. Open **Settings → Plugin credentials**.
2. Choose **Add credential**.
3. Enter a non-sensitive name and provider type.
4. Add one or more secret fields and values.
5. Save.

LinkSense encrypts the values. Leaving a secret empty while editing preserves it; entering a value replaces it.

## Bind to a plugin

Credentials are never injected merely because their types appear compatible. Create a binding that identifies the plugin, credential, and exact configuration key declared by that plugin.

Each key must resolve to one active personal credential. A missing or conflicting binding blocks task preflight.

## Enable, disable, unbind, and delete

- Disable: preserve bindings but stop using the secret in new turns.
- Enable: make it eligible for new turns again.
- Unbind: stop injection through that relationship.
- Delete: permanently remove ciphertext and every binding.

## Security boundary

Credentials belong only to you and never fall back to another user or platform secret. LinkSense does not expose plaintext in workspaces, capability directories, logs, audit data, or UI. General shell and Skill scripts cannot inherit plugin credentials.
