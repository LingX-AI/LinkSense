---
title: Check for and install LinkSense updates
description: Review official releases, schedule maintenance, and run a safe upgrade on the deployment host.
---

# Check for and install LinkSense updates

:::info Administrator action
Go to **Settings → System update**. The web page checks and displays versions; it never downloads or installs an update silently.
:::

## Check version status

The page checks official LinkSense GitHub releases and shows the current and latest versions, check time, publication time, and release notes. Select **Check now** to refresh or open the GitHub release page for complete information.

A failed check does not affect other product features. LinkSense distinguishes an unavailable GitHub connection, rate limiting, and an unrecognized response. Repair server egress or wait for the limit to clear before retrying.

Administrators see a product notice when an update is available. Dismissing it applies only to that administrator and release; a later release displays a new notice.

## Prepare for the upgrade

1. Read release notes from the current version through the target version.
2. Schedule a low-traffic window and notify users under **System settings → System maintenance**.
3. Verify disk capacity, Docker services, and the PostgreSQL backup location on the host.
4. Wait for or stop tasks that should not span the upgrade and make sure an administrator can still open System health.

## Run on the deployment host

Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

macOS (do not use `sudo`):

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sh
```

The script detects Core or Full, waits for running tasks, and creates and verifies a PostgreSQL backup before database migration. Save the backup location printed by the script. A failure after migration begins does not automatically roll back the database.

## Verify after upgrading

Open **System health** and verify API, database, Redis, storage, Runner, knowledge parsing, and search. Run one minimal task to check the execution path. Then end maintenance early or let the window expire.

If upgrading fails, retain the terminal output and backup location for a deployment operator. Do not repeatedly rerun the script before confirming database state.

