---
title: System and product settings
description: Manage supported online product settings and preserve deployment boundaries.
---

# System and product settings

:::info Administrator operation
Open **Settings → System settings**. Only explicitly supported product configuration is writable; infrastructure secrets remain deployment-managed.
:::

## Product settings

The current page may expose non-sensitive settings such as product display name and default language. Saved updates use a shared revision and take effect without service restart.

Permanent audit records the actor, setting key, before and after values, and request metadata.

## Read-only deployment configuration

Database, Redis, MinIO, document processing, other runner runtime parameters, file limits, JWT/HMAC/encryption keys, token periods, and retention remain in controlled `.env` or deployment configuration.

The page may show a redacted configured state but never connection strings, complete internal endpoints, passwords, keys, tokens, or encryption material. Model channels are an explicit exception managed on the Model Settings page.

## Task concurrency

The **Task concurrency** tab lets administrators override two deployment defaults:

- The system-wide running task limit caps running tasks across all users.
- The per-user task process limit caps Codex app-server processes loaded by each user worker.

Leaving either field blank keeps the corresponding deployment default. New task starts read the latest saved settings without a service restart. Lowering a limit does not interrupt running tasks; new task or process admission pauses until current usage falls below the new limit.

## System update

**System update** is a separate administrator page that checks official GitHub releases and shows the safe upgrade workflow. The web page never upgrades the deployment silently. See [Check for and install LinkSense updates](./system-update.md) for preparation, host commands, and post-upgrade verification.

## Scheduled maintenance

Open the **System maintenance** tab, enter a reason and the start and end times, then enable scheduled maintenance. Maintenance becomes active only when the current time enters the configured window and ends automatically at the specified end time.

During maintenance:

- Regular users see the reason and expected maintenance window on a dedicated page and cannot call business APIs.
- Administrators can still sign in and use the system to inspect status, adjust the schedule, or end maintenance early.
- Sign-in, initialization, health, and current-user identification remain available so administrators cannot be locked out.

Confirm the device time zone before saving and provide a realistic end time.

## Conflict and failure

Revision checks prevent one administrator from silently overwriting another. On conflict, refresh, inspect the latest state, and confirm the change again.

The server rejects attempts to alter a deployment-only setting even when a custom request bypasses the UI.

## Recommendations

- Change organization-wide display settings during a low-risk period.
- Validate results with a regular user account.
- Use the separate authentication sections for login capability changes.
