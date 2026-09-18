---
title: Use organization applications
description: Start a managed workflow that combines approved models and resources.
---

# Use organization applications

An organization application combines models, plugins, Skills, knowledge bases, and fixed instructions into a managed entry point.

Applications can be standard or interactive. An interactive application opens a creator-provided workflow UI with the trusted LinkSense chat in a separate pane on the right. Drag the divider to resize the chat, or hide and reopen it without stopping the task or losing application data.

## Find an application

Open **Plugin Center → Applications** and search the public catalog. Details identify the owner, purpose, and resources managed by the application.

## Start an application task

Depending on its configuration:

- the model is fixed by the creator or selected by you;
- plugins, Skills, knowledge bases, and application instructions are maintained by the creator;
- application knowledge bases are searchable only inside the app and do not grant browse, preview, download, or management access.

Configuration is read for each new turn. After the creator updates sharing, new tasks and the next execution in existing tasks use the latest shared version. Applications used through Application Center use its current approved and listed version. Draft edits do not change the shared version; confirmed **Publish update** or a successful package update automatically updates organization sharing. Running turns and historical results are not rewritten.

Interactive application tasks remain available in the task sidebar. After switching tasks, refreshing, or returning later, LinkSense opens the application version currently recorded for that task, restores its previously emitted structured data, and continues receiving new results. This does not rerun the task or switch versions just by opening the page. An existing task adopts the latest published version for its access channel on its next execution; reopening it afterward uses the version it has adopted.

## Unavailable applications

An application cannot start new work when it is disabled or a required model, capability, credential, or knowledge base is unavailable. Existing task history remains. Contact the creator or an administrator to resolve the dependency.

To build or maintain an entry point, see [Create and manage applications](./create-applications.md). [Share applications and configure external access](./application-access.md) explains organization grants and iframe access.

## Usage analytics for creators

Application creators can open **More actions → Usage analytics** on an application card and review active users, tasks, turns, model calls, tokens, and costs for all time, the last 7 or 30 days, or a custom date range. The page also provides trends, token and cost composition, and breakdowns by model and workload without exposing user names or email addresses.

Token and cost totals cover only calls recorded after collection began. Task and turn counts may include earlier history, but LinkSense does not estimate older tokens or costs using current model prices. Tokens without a reliable price snapshot are identified as unpriced.

See [View application usage](./application-usage.md) for range and metric definitions.

## Difference from regular tasks

You select resources for regular tasks; the creator curates the resource combination for an application. An application is not a source of extra permissions—LinkSense still validates every resource on the server.
