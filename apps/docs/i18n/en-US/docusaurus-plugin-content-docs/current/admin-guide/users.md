---
title: User management
description: Create, import, edit, enable, and disable LinkSense users.
---

# User management

:::info Administrator operation
Open **Settings → Groups & users → Users**. LinkSense does not offer self-registration.
:::

## Create users

Provide a name, unique email, role, and optional groups. A new user has no local password and LinkSense does not automatically send an invitation.

The user may sign in through configured SSO or Teams, or request email to set a local password. Administrators cannot set, view, import, or reset user passwords.

## Excel import

Download the template, fill in name, email, role, and groups, then upload it. Import validates required fields, global email uniqueness, valid roles, and existing group names. The template has no password column and reports invalid rows for correction.

## Edit

You can update name, email, role, and group membership. An email change immediately revokes all sessions and unused password links, requiring sign-in with the new email.

## Token usage

When editing an existing user, you can set per-user token usage:

- Weekly usage: determines whether the user can start new tasks during the current week.
- Monthly usage: determines whether the user can start new tasks during the current month.
- Values use million tokens and accept positive numbers with up to 6 decimal places.
- Leave a field blank for no per-user usage setting.

After usage remaining reaches 0 for the current period, the user cannot start new tasks until the next period resets. Already running tasks are not affected.

Select multiple users in the user list to batch set weekly and monthly usage. Unchecked fields stay unchanged; a checked blank field clears that per-user usage field.

:::tip Initial usage for new users
To give newly created or imported users an automatic usage setting, configure **Settings → Model settings → Initial user token usage** first. Changing the initial usage does not affect existing users.
:::

The current version does not delete user accounts. Disable an account to prevent access.

## Disable and restore

Disabling rejects new login, expires active sessions on the next request, blocks new activity and downloads, and cancels requests that have not started. A running turn continues to its native final state. History, knowledge bases, published releases, and audit data remain.

Restoring permits access again but does not restart canceled queued requests.

## Administrator protection

An administrator cannot disable or demote themself, and at least one active administrator must remain. The server checks this transactionally even during concurrent changes. Rejected attempts are audited.
