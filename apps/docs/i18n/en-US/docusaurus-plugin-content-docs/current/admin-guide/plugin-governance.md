---
title: Plugin Center review and governance
description: Review immutable release snapshots and suspend or restore risky listings.
---

# Plugin Center review and governance

:::info Administrator operation
Open **Settings → Plugin Center**. Review applies to an immutable submitted snapshot, not a mutable personal source directory.
:::

## Review a release

Inspect the publisher, type, release number, release notes, files, executable bits, content SHA-256, manifest, Skill content, logo, and declarations for MCP, scripts, external connections, environment variables, credentials, or dependency downloads.

Every release requires a separate review and LinkSense verifies snapshot integrity again before approval.

## Approve or reject

- Approval makes that snapshot current and publishes a draft listing for the first time.
- Rejection requires a clear reason and does not affect an older approved release or installed copies.

An administrator who is also the publisher may review their own release, subject to any stricter organization policy.

## Suspend and restore

Suspension hides the listing and blocks installation, updates, and every installed copy from starting new tasks. Running turns retain their startup snapshot and are not assigned a fabricated final state.

Restoration makes the listing and installed copies eligible for later work.

## Unlisted versus suspended

A publisher-unlisted entry accepts no new installs, while existing copies can run and update. Administrator suspension is risk enforcement and blocks new execution from existing copies.

## Audit and privacy

Review and governance actions are audited. The role does not grant access to unsubmitted personal plugin or Skill content.
