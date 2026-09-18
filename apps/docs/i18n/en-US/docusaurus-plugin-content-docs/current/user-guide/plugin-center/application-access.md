---
title: Share applications and configure external access
description: Grant access inside the organization or expose a controlled application iframe to an external website.
---

# Share applications and configure external access

## Share inside the organization

Under **My applications**, open the application's three-dot menu, choose **Share within organization**, and add users or user groups. After manually installing the application, a recipient can start tasks but does not gain access to hidden application instructions, creator credentials, or the documents in application knowledge bases.

Revoking a grant prevents new application tasks but keeps each user's existing tasks and results. If a user has access both directly and through a group, removing one grant may not remove access.

### Update a shared interactive application

Successful **Publish update** or **Update application package** updates only the creator's installation. Organization sharing and Application Center must be updated separately, and other users must manually install the new version. Draft edits do not publish early.

1. Choose **Publish update** in the development view and confirm, or choose **Update application package** from the application's menu and import the new ZIP.
2. Configure all required resources and enter a higher `x.x.x` release version.
3. Open **Share within organization** again and choose **Save sharing** to make this published version available. The dialog preselects existing users and user groups; adjust them as needed.

Recipients must manually install an available update. If any of their tasks for this application are running, they must stop those tasks or wait for completion before installing. After installation:

| Scenario | Version used |
| --- | --- |
| New task | The currently installed version; an available update is not yet installed. |
| Next execution in an existing task | The currently installed version, keeping conversations and work files. |
| Already running | Keeps its version; it does not switch mid-execution and prevents concurrent installation. |
| Only open or refresh a historical task without submitting a request | Neither executes a task nor automatically installs an update. |

Historical results are not rewritten. Task files and conversation context remain available. Failed installation leaves the previously installed version unchanged.

Application Center offers its current approved and listed version, which users must still install manually. Publishing or **Save sharing** does not update Application Center; submit a separate listing update for review.

## External iframe access

Only the application creator can open **More actions → External access**. Configure it as follows:

1. Add allowed website origins, one per line with no duplicates. Use HTTPS in production; local development can use HTTP on localhost or 127.0.0.1.
2. Choose **Authentication required** or **No authentication**.
3. Optionally add up to four starter questions per origin, each no longer than 500 characters.
4. Save the security configuration and copy the iframe URL or snippet for that origin.
5. Test the complete host integration, then turn on **Enable external access**.

An allowed origin must exactly match the protocol, host, and port of the host page. Disabling external access invalidates new requests and already-open external sessions.

### How external access receives updates

External access uses the creator's current release. It does not wait for organization sharing or an Application Center listing, and external users do not install updates manually.

- A new external session starts with the creator's current release.
- Before starting a new task or continuing a conversation, an existing external user's installation updates automatically if all of that user's tasks for this application have finished.
- If any task is starting, running, or still stopping, the previous version remains in use without interrupting active tasks. During an update, other new start requests are asked to try again shortly.
- If an update fails, that start request reports an error. The previous version, conversations, and work files are retained; the next start checks for an update again.
- Merely opening, refreshing, or restoring a session does not trigger an update. Unpublished drafts do not affect external users.

These rules apply to authenticated and public access. Organization sharing and Application Center continue to require manual installation.

## Authentication required

A trusted business backend exchanges the App ID and App Secret for a short-lived ticket. The frontend passes only the ticket to the iframe. Keep the App Secret on the server; never put it in browser code, URLs, logs, or screenshots. Rotating the secret immediately invalidates the old secret and related unused tickets.

See [Embed a LinkSense application](../../developer-guide/embed-application.md) for request flow, user identity, and the `postMessage` protocol.

## No authentication

Public mode does not require the business backend to issue a ticket, but requests are still limited to allowed origins. Anyone who can reach the host page may be able to create an application session. Use it only for low-risk content that does not require external-user identity; it is not access control.
