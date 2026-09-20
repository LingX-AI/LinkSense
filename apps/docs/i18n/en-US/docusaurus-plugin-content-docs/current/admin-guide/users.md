---
title: User management
description: Create, import, edit, enable, and disable LinkSense users.
---

# User management

:::info Administrator operation
Open **Settings → Users & groups → Users**. Administrators can enable open registration in System settings.
:::

## Create users

Provide a name, unique email, role, and optional groups. A new user has no local password and LinkSense does not automatically send an invitation.

The user may sign in through configured SSO or Teams, or request email to set a local password. Administrators cannot set, view, import, or reset user passwords.

## Excel import

Download the template, fill in name, email, role, and groups, then upload it. Import validates required fields, global email uniqueness, valid roles, and existing group names. The template has no password column and reports invalid rows for correction.

## Edit

You can update name, email, role, and group membership. An email change immediately revokes all sessions and unused password links, requiring sign-in with the new email.

## Credit quotas

Set weekly quotas individually or in bulk, in credits. Positive amounts accept up to six decimal places. Blank means unlimited, and bulk changes affect only the selected users.

Reaching the limit prevents new tasks while running tasks finish. Weekly quotas reset every Monday at midnight in the system time zone.

Members created, imported, or self-registered share the default weekly quota in [Quota management](./quota-settings.md). Saving the default does not affect existing members; use **Apply limit to all** when an overwrite is intended.

## Disable and restore

Disabling rejects new login, expires active sessions on the next request, blocks new activity and downloads, and cancels requests that have not started. A running turn continues to its native final state. History, knowledge bases, published releases, and audit data remain.

Restoring permits access again but does not restart canceled queued requests.

## Administrator protection

An administrator cannot disable or demote themself, and at least one active administrator must remain. The server checks this transactionally even during concurrent changes. Rejected attempts are audited.
