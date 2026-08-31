---
title: Sign in to LinkSense
description: Enter LinkSense with a local account, enterprise SSO, or Microsoft Teams.
---

# Sign in to LinkSense

Depending on deployment configuration, LinkSense can offer email and password, enterprise single sign-on, and Microsoft Teams sign-in. The login page only displays methods that are currently enabled.

## Email and password

1. Open the LinkSense login page.
2. Enter the email and password associated with your account.
3. Select **Sign in**.

Email matching is case-insensitive. Repeated failures may trigger temporary login protection. Check your credentials, wait before retrying, or ask an administrator to confirm the account status.

## Single sign-on

Choose the enterprise SSO option and complete authentication with the identity provider. A first-time SSO account may be created in a disabled state and require administrator activation before you sign in again.

## Microsoft Teams

When Teams integration is configured, LinkSense uses your Teams identity. If the organization has not configured Teams sign-in, the tab falls back to the standard LinkSense login page.

## If sign-in fails

- Confirm the account is not disabled.
- Local users can choose **Forgot password or set it for the first time**.
- Restart SSO from the login page if an old callback has expired.
- For a service error, share only the visible error and time with an administrator—never a password or login token.
