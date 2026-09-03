---
title: Share applications and configure external access
description: Grant access inside the organization or expose a controlled application iframe to an external website.
---

# Share applications and configure external access

## Share inside the organization

Select **Share** on an application under **Created by me**, then add users or user groups. A recipient can start application tasks but does not gain access to hidden application instructions, creator credentials, or the documents in application knowledge bases.

Revoking a grant prevents new application tasks but keeps each user's existing tasks and results. If a user has access both directly and through a group, removing one grant may not remove access.

## External iframe access

Only the application creator can open **More actions → External access**. Configure it as follows:

1. Add allowed website origins, one per line with no duplicates. Use HTTPS in production; local development can use HTTP on localhost or 127.0.0.1.
2. Choose **Authentication required** or **No authentication**.
3. Optionally add up to four starter questions per origin, each no longer than 500 characters.
4. Save the security configuration and copy the iframe URL or snippet for that origin.
5. Test the complete host integration, then turn on **Enable external access**.

An allowed origin must exactly match the protocol, host, and port of the host page. Disabling external access invalidates new requests and already-open external sessions.

## Authentication required

A trusted business backend exchanges the App ID and App Secret for a short-lived ticket. The frontend passes only the ticket to the iframe. Keep the App Secret on the server; never put it in browser code, URLs, logs, or screenshots. Rotating the secret immediately invalidates the old secret and related unused tickets.

See [Embed a LinkSense application](../../developer-guide/embed-application.md) for request flow, user identity, and the `postMessage` protocol.

## No authentication

Public mode does not require the business backend to issue a ticket, but requests are still limited to allowed origins. Anyone who can reach the host page may be able to create an application session. Use it only for low-risk content that does not require external-user identity; it is not access control.
