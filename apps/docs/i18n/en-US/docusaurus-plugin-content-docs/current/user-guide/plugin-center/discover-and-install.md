---
title: Discover, install, and update capabilities
description: Install plugins, Skills, MCP extensions, and organization content from Plugin Center.
---

# Discover, install, and update capabilities

Plugin Center provides one catalog for published plugins, Skills, MCP extensions, and applications.

The **ClawHub Skill repository** is a separate external Skill source. See [Install Skills from ClawHub](./clawhub.md) for its pre-install checks and trust boundary.

## Browse and search

1. Open **Plugin Center**.
2. Select Plugins, Skills, MCP, or Applications.
3. Search by name, description, or publisher.
4. Open details and review the publisher, release notes, risk summary, manifest, and content hash.

## Install

Installation creates a personal copy from the current approved release. Before confirming, check whether it contains executable scripts or an MCP server, reaches external services, requires environment variables or credentials, and comes from a trusted publisher.

Manage the installed copy's enabled state from the Installed or Personal area.

Applications use a separate distribution flow. Direct shares appear under **Applications → Shared with me**, while public releases appear in **Application Center**. Depending on the usage option offered by the creator, install an independent application copy or install the application service before using it. See [Use organization applications](./organization-apps.md) for the difference. Creators can [create and manage applications](./create-applications.md).

## Update

When **Update available** appears, compare the release notes and explicitly update. Approval of a new catalog release never silently replaces your installed copy.

## Uninstall

Uninstalling removes your copy and related personal configuration without changing the catalog release or other users' installations. Historical task and audit facts remain.

:::warning Risk suspension
An administrator can suspend a risky listing. A suspended listing is hidden and all installed copies are blocked from starting new tasks until it is restored.
:::
