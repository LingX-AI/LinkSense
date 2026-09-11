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

## Open registration

Enable open registration in its settings tab. Configure weekly, monthly, and total credit quotas independently in [Quota management](./quota-settings.md). Any quota can be left blank.

Disabling open registration blocks new requests and invalidates activation links that were issued but not yet used. It does not delete accounts created directly by administrators, existing activated accounts, or other configured sign-in methods.

## OIDC

Enter an HTTPS issuer URL, client ID, and client secret. LinkSense derives and displays a read-only callback URL that must also be registered with the provider.

A new revision invalidates an unfinished callback started under an old revision. The user must restart sign-in. A first-time SSO identity creates a pending account by email; an administrator must enable it before the user signs in again.

## Teams

Enter Microsoft Entra tenant and client IDs. LinkSense settings do not replace Entra registration, Application ID URI, Teams manifest, or administrator consent.

## Secret handling

The API returns only configured flags, never SMTP passwords or OIDC secrets. In managed mode, leave an unchanged secret blank; switching from another mode requires entering it again.

Corrupt or undecryptable configuration fails closed and never falls back to an unconfirmed old value.

## Open registration

Enable or disable self-registration in the **Open registration** settings tab. Set weekly, monthly, and total credit quotas independently in [Quota management](./quota-settings.md). Any quota can be left blank.
