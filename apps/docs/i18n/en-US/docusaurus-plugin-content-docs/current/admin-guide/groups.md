---
title: User group management
description: Maintain flat groups and understand their authorization and reporting effects.
---

# User group management

:::info Administrator operation
Open **Settings → Users & groups → Groups**. A group is an authorization convenience, not an organizational hierarchy.
:::

## Rules

- Groups are flat and cannot contain child groups.
- A user may belong to several groups.
- Names are globally unique.
- Membership never changes the user or administrator role.

## Create and edit

Add a name and optional description, then select existing users. Membership additions and removals record actor and time.

Normal removal revokes the relationship while retaining necessary history. A user may retain knowledge-base access through another group or direct share.

## View memberships

The user table may show only a compact subset of names. Use complete group details or the accessible overflow preview before making decisions.

## Delete a group

Deletion is irreversible. The same transaction removes active and revoked memberships and knowledge-base grants to avoid orphaned rows. Permanent audit keeps only minimal group ID and affected-count metadata.

Before deletion, identify access derived from the group, create a replacement when needed, and account for current-membership semantics in usage reporting.

## Usage reporting

Group usage applies each user's activity to every group they currently belong to. Rows overlap and must not be summed to calculate global totals.
