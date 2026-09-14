---
title: CLI administration and maintenance
description: Use the linksense command to inspect, diagnose, repair, and upgrade a deployment.
---

# CLI administration and maintenance

The installer provides the `linksense` administration command. On Linux, it prompts for `sudo` when elevated access is required. On macOS, do not use `sudo`, and make sure `$HOME/.local/bin` is in `PATH`.

## Common commands

```bash
linksense status
linksense start
linksense stop
linksense restart
linksense port 19090
linksense credential
linksense logs api
linksense doctor
linksense repair
linksense upgrade v0.3.0
```

- `status`: inspect deployment status.
- `start`, `stop`, and `restart`: control services.
- `port 19090`: change the HTTP port, then use the new port to access LinkSense.
- `credential`: show the one-time initialization credential only before the first administrator is created.
- `logs api`: inspect logs for one service. Do not publish complete logs before checking them for sensitive data.
- `doctor`: check the host, Docker, services, and critical dependencies.
- `repair`: repair the deployment at the currently installed release; it does not upgrade to a newer release.
- `upgrade <version>`: upgrade to an explicit version. The script detects Core or Full automatically.

Port changes check availability and recreate only affected services; a failed health check restores the previous port configuration automatically. Stopping, repairing, and upgrading can still affect availability, so schedule a maintenance window and notify users first.

You can also run the matching maintenance scripts directly on Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-core.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/repair-full.sh | sudo sh
curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh
```

Run the same scripts without `sudo` on macOS. Use the matching repair script for Core or Full; the upgrade script detects the installed edition automatically.

## Upgrade data boundaries

The upgrade script waits for active tasks and creates and validates a PostgreSQL backup before database migration. The printed backup location is under `volume://linksense-backups/postgres/`; retain the exact location shown in the terminal.

The script does not delete data volumes. If a failure occurs after database migration starts, the database is not rolled back automatically. Do not delete volumes or run undocumented database commands. Review diagnostics and logs, confirm that the backup is available, fix the issue, and rerun the upgrade.

See [System updates](../admin-guide/system-update.md) for update checks and upgrade behavior in the web administration interface.

## Troubleshooting order

1. Run `linksense status` to inspect service state.
2. Run `linksense doctor` for actionable diagnostics.
3. Inspect only the relevant service logs, such as `linksense logs api`.
4. Run `linksense repair` when current-release files or configuration are incomplete.
5. When an upgrade is needed, run `linksense upgrade <version>` with an explicit target release.

Never paste one-time credentials, API keys, database connection strings, complete environment files, or unreviewed logs into a ticket or chat.
