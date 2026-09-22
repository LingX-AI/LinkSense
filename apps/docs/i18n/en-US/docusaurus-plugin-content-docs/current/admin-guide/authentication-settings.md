---
title: Authentication email and sign-in methods
description: Manage sign-in capabilities online while protecting authentication secrets.
---

# Authentication email and sign-in methods

:::info Administrator operation
Under **Settings → System settings**, use **Authentication email** for email delivery and **Sign-in methods** for enterprise and third-party accounts. Each configuration saves independently.
:::

## Configuration modes

Authentication email, enterprise SSO (OIDC), and sign-in within Teams support:

- **Inherit deployment environment**;
- **Managed in system settings** with encrypted storage;
- **Disabled**, with no environment fallback.

Changing away from managed mode or disabling configured authentication requires confirmation.

## Authentication email

Configure SMTP host, port, STARTTLS or direct TLS, sender, optional username, and password. An empty username means no SMTP password authentication. This service sends first-password and reset email; verify its connection in System Health.

## Open registration

Enable open registration under **Sign-in methods → Third-party accounts**. Self-registered users share the member weekly quota standard in [Quota management](./quota-settings.md) with users created or imported by administrators.

Disabling open registration blocks new requests and invalidates activation links that were issued but not yet used. It does not delete accounts created directly by administrators, existing activated accounts, or other configured sign-in methods.

## Enterprise accounts

Use organization-managed accounts. New accounts require administrator activation regardless of the open registration setting.

### Enterprise SSO (OIDC)

Enter an HTTPS issuer URL, client ID, and client secret. LinkSense derives and displays a read-only callback URL that must also be registered with the provider.

A new revision invalidates an unfinished callback started under an old revision. The user must restart sign-in. A first-time SSO identity creates a pending account by email; an administrator must enable it before the user signs in again.

### Enterprise SSO (SAML 2.0)

Configure HTTPS for the site, then enter the identity provider's entity ID, sign-in URL, and PEM signing certificate. Register the displayed service provider entity ID and ACS callback URL with your provider, or save and enable SAML to download and import the XML metadata.

The provider must sign assertions and supply accurate, organization-managed email addresses. Match the email attribute name exactly; enter `NameID` to use that identifier as the email address. The name attribute is optional. Existing accounts are matched by email and retain their roles. New accounts need administrator activation; disabled accounts cannot sign in.

If your provider requires signed authentication requests, enable request signing and enter the service provider RSA certificate and matching private key. Saved keys are never returned; leave the private key blank when changing other fields. Saving with request signing disabled removes that certificate and key. Replace expired identity provider certificates to restore sign-in.

Members start from **Sign in with a SAML enterprise account** on the LinkSense sign-in page. Complete each flow within five minutes; restart after a configuration change. This version supports SP-initiated sign-in only, without IdP-initiated sign-in, encrypted assertions, or single logout. Signing out of LinkSense does not sign out of the identity provider.

### Sign in within Teams

Enter Microsoft Entra tenant and client IDs. LinkSense settings do not replace Entra registration, Application ID URI, Teams manifest, or administrator consent.

## Third-party accounts

Configure Google, Apple, Microsoft personal accounts, Facebook, and GitHub. For Microsoft work or school accounts, configure Microsoft Entra ID under Enterprise accounts.

For GitHub, create an OAuth App in developer settings and copy the callback address from the configuration dialog into Authorization callback URL. Enter its Client ID and Client Secret in LinkSense and enable it. Create separate apps for test and production environments with different callback URLs. Sign-in only requests email access, not repository access. If GitHub cannot provide a verified email, new users must verify their email through LinkSense.

When registration is open, new users can start after email verification without administrator activation. Existing users must sign in first and link their account under **Settings → Security → Linked third-party accounts**; matching emails are not merged automatically. Closing registration does not block sign-in for linked accounts.

## Secret handling

The API returns only configured flags, never SMTP passwords or OIDC secrets. In managed mode, leave an unchanged secret blank; switching from another mode requires entering it again.

Corrupt or undecryptable configuration fails closed and never falls back to an unconfirmed old value.
