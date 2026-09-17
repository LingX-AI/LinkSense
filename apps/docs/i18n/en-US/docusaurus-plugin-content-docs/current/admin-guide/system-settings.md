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

When maintenance ends, the system automatically turns off scheduled maintenance and clears the reason, start time, end time, and duration. No additional save is required, and cleanup runs even when no administrator has the settings page open. An open settings page updates within a few seconds. Maintenance that ended while the service was stopped is cleared when the service starts again.

During active maintenance, signed-in administrators see a **System maintenance enabled** dialog on pages other than sign-in. Select **Don’t show again** to hide it for the current maintenance period, for your account in this browser. The choice survives navigation, refreshes, and reopening the browser, and synchronizes across tabs. Editing the maintenance details or extending the current period does not show it again; starting a new period does. Other accounts and devices are unaffected. Select **Maintenance settings** to open the configuration page. The close button and Esc dismiss only the current page’s reminder; navigating to another page shows it again. The dialog disappears when maintenance ends or is disabled and never appears on the sign-in page. A **System maintenance enabled** link also remains in the bottom-right corner of signed-in administrator pages and opens maintenance settings. Closing or suppressing the dialog does not hide this indicator; it disappears when maintenance ends.

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
