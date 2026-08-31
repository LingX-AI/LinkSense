---
title: Roles and authorization boundaries
description: Understand the fixed LinkSense user and administrator roles.
---

# Roles and authorization boundaries

:::info Administrator operation
**Settings → Roles** is a read-only overview. Custom roles are not available.
:::

## Fixed roles

- **User** manages personal tasks, capabilities, and owned knowledge bases and uses resources granted to them.
- **Administrator** also manages users, groups, catalog governance, knowledge governance, models, settings, health, audit, and usage.

There is no super administrator, department administrator, read-only administrator, or custom permission bundle. The first administrator has no hidden privileges.

## Role is not content access

Administrative governance does not automatically expose another user's tasks, personal capability content, or knowledge-base documents. Ownership and sharing continue to control content access.

## Change a role

Change another account from User Management. Before demoting an administrator, ensure another active administrator remains.

An administrator cannot demote or disable themself, nor demote or disable the final active administrator. The server enforces this inside the update transaction.

## Groups and roles

Groups provide flat membership and resource grants. Adding a user to any group cannot make them an administrator.
