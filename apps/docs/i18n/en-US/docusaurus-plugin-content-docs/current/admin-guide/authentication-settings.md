---
title: Authentication email, OIDC, and Teams
description: Manage sign-in capabilities online while protecting authentication secrets.
---

# Authentication email, OIDC, and Teams

:::info Administrator operation
Authentication sections are under **Settings → System settings** and save independently.
:::

## Configuration modes

Each capability supports:

- **Inherit deployment environment**;
- **Managed in system settings** with encrypted storage;
- **Disabled**, with no environment fallback.

Changing away from managed mode or disabling configured authentication requires confirmation.

## Authentication email

Configure SMTP host, port, STARTTLS or direct TLS, sender, optional username, and password. An empty username means no SMTP password authentication. This service sends first-password and reset email; verify its connection in System Health.

## OIDC

Enter an HTTPS issuer URL, client ID, and client secret. LinkSense derives and displays a read-only callback URL that must also be registered with the provider.

A new revision invalidates an unfinished callback started under an old revision. The user must restart sign-in. Successful provider authentication still respects LinkSense account activation.

## Teams

Enter Microsoft Entra tenant and client IDs. LinkSense settings do not replace Entra registration, Application ID URI, Teams manifest, or administrator consent.

## Secret handling

The API returns only configured flags, never SMTP passwords or OIDC secrets. In managed mode, leave an unchanged secret blank; switching from another mode requires entering it again.

Corrupt or undecryptable configuration fails closed and never falls back to an unconfirmed old value.
