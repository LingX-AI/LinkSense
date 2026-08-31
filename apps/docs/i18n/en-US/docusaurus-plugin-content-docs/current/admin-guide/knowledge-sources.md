---
title: Knowledge-base sources
description: Configure SharePoint connections and understand synchronization behavior.
---

# Knowledge-base sources

:::info Administrator operation
Open **Settings → Knowledge bases → Knowledge sources** for external source configuration.
:::

## Configure SharePoint

Enter the Microsoft Entra tenant and application information requested by the page. LinkSense verifies application identity on save and never returns the stored secret.

Use `Sites.Selected` where possible, with Microsoft 365 administrators granting read access only to approved Sites.

## Create an external knowledge base

After enabling the source, an administrator can enter a SharePoint folder URL when creating a knowledge base. LinkSense verifies access to that folder before scheduling synchronization.

## Synchronization

- New files use the same secure processing pipeline as local uploads.
- Changed content creates a replacement version.
- A name-only change performs a rename.
- Remote deletion enters controlled citation, index, object, and quota cleanup.
- Unsupported formats are marked skipped without blocking other files.

## Troubleshoot

For authentication failure, check tenant, app ID, secret validity, and target-Site authorization in Microsoft 365. Never paste a client secret into audit notes, tickets, or chat.

LinkSense does not automatically start or reconfigure an unreachable external service. Restore connectivity and retry from the supported UI.
