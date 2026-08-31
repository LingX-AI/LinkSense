---
title: Knowledge-base governance
description: Govern cross-user metadata, availability, cleanup, and ownership.
---

# Knowledge-base governance

:::info Administrator operation
Open **Settings → Knowledge bases**. The page exposes governance metadata without automatically granting document content, preview, or download access.
:::

## Find entries

Search by name or owner and review lifecycle, availability, source, document counts, and capacity summaries.

## Governance actions

- Disable or enable use in future tasks.
- Archive into read-only state.
- Permanently delete an already archived knowledge base.
- Retry failed resource cleanup.
- Revoke a selected access source.
- Transfer ownership to another active user.

Actions that require a reason store it in safe audit metadata. Permanent deletion remains a separate confirmation after archival.

## Disabled owner

An owned knowledge base remains and recipients keep existing access. The disabled owner cannot maintain it. Transfer ownership or disable the knowledge base when necessary.

## Retrieval and indexing

Owners retry individual document failures. A deployment-wide embedding or index mismatch requires full rebuild from System Health, not ad hoc edits to every user's knowledge base.

## Authorization boundary

If an administrator must read a document, the owner should grant access through the normal sharing path. Governance APIs must not bypass content authorization.
