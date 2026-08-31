---
title: Passwords, reset links, and SSO
description: Set a local password, use reset email, and understand session invalidation.
---

# Passwords, reset links, and SSO

LinkSense never displays your existing password in pages, logs, or email.

## Set or reset a password

1. On the login page, choose **Forgot password or set it for the first time**.
2. Enter your account email.
3. If local password login is available, LinkSense sends a one-time secure link.
4. Open the link and choose a password that satisfies the page rules.
5. Return to the login page and sign in.

The submission response does not reveal whether an account exists. A reset link is single-use and expires; request another when necessary.

## Change an existing password

Open **Settings → Security**, enter the current and new passwords, and submit. All existing sessions are revoked after a successful change, so you must sign in again.

## SSO accounts

Administrators determine which local, SSO, and Teams methods are available. Successful identity-provider authentication does not override LinkSense account activation. A new or disabled account may still require administrator action.

:::warning Protect the account
Never share a password, reset URL, browser token, or SSO callback URL.
:::
