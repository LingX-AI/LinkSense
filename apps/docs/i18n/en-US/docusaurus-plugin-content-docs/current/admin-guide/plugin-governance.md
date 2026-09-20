---
title: Plugin Center and Application Center review
description: Review immutable plugin, Skill, MCP, and application releases and govern risky listings.
---

# Plugin Center and Application Center review

:::info Administrator operation
Open **Settings → Plugin Center**. Review applies to an immutable submitted snapshot, not a mutable personal source directory.
:::

## Review a release

Inspect the publisher, type, release number, release notes, files, executable bits, content SHA-256, manifest, Skill content, logo, and declarations for MCP, scripts, external connections, environment variables, credentials, or dependency downloads.

Every release requires a separate review and LinkSense verifies snapshot integrity again before approval.

## Review Application Center releases

An application review shows its creator, standard or interactive kind, version, release notes, and offered usage options. Open the detail to inspect its instructions, plugin and Skill names, knowledge-base and MCP counts, and—for an interactive application—package file paths.

An **Application package** becomes an independently maintained user copy, while an **Application service** uses creator-managed resources and credentials. Interactive applications cannot be distributed as copy-installable packages and support the service option only. Before approval, confirm that release notes match the submitted behavior and assess the instructions, external connections, data scope, and usage options. Rejection requires a reason.

## Approve or reject

- Approval makes that snapshot current and publishes a draft listing for the first time.
- Rejection requires a clear reason and does not affect an older approved release or installed copies.

An administrator who is also the publisher may review their own release, subject to any stricter organization policy.

## Suspend and restore

Suspension hides the listing and blocks installation, updates, and every installed copy from starting new tasks. Running turns retain their startup snapshot and are not assigned a fabricated final state.

Restoration makes the listing and installed copies eligible for later work.

Application Center has a separate listing status. Administrator suspension requires a reason and blocks new installation and service starts while preserving task history. It does not remotely delete independent application packages that users already installed; those remain subject to their personal resource state and platform capability governance. Restoring the listing allows eligible users to install or use the service again.

## Unlisted versus suspended

A publisher-unlisted entry accepts no new installs, while existing copies can run and update. Administrator suspension is risk enforcement and blocks new execution from existing copies.

## Audit and privacy

Review and governance actions are audited. Application review exposes only the submitted version's required instructions and resource summary. The role does not grant access to unsubmitted personal plugin, Skill, or application-draft content.
