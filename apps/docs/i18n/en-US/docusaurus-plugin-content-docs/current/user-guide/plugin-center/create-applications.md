---
title: Create and manage applications
description: Combine models, instructions, capabilities, and knowledge bases into a standard or interactive application.
---

# Create and manage applications

Applications provide controlled entry points for repeatable workflows. A creator can combine a model, instructions, plugins, Skills, knowledge bases, and MCP servers and then share the result. An application does not expand permissions that its creator or users do not already have.

## Create a standard application

1. Go to **Plugin Center → Applications → Created by me**.
2. Select **Create application → Create standard application**.
3. Enter a name and description and choose a preset icon or upload an image.
4. Fix a model and reasoning effort, or let users choose them in chat.
5. Enter application instructions and select plugins, Skills, knowledge bases, and MCP servers that you manage.
6. Save, then use **Try now** to verify the complete workflow.

Shared users cannot see the application instructions. Plugins use the creator's bound plugin credentials. MCP tools may have external side effects, so verify their purpose and permissions before adding them.

## Import an interactive application

Select **Import interactive application** and upload a ZIP whose root contains `manifest.json` and `index.html`. The page runs in an isolated iframe and uses the LinkSense SDK to start tasks or control the native chat pane. See [Build an interactive application](../../developer-guide/interactive-application.md) for the package and API contract.

The manifest version must increase when you update an interactive package. New tasks use the new version; historical tasks remain pinned to the package version used when they were created.

## Update, disable, and delete

- After configuration changes, everyone's next new turn reads the latest resource set. Running and historical turns are not rewritten.
- Disabling prevents new tasks but keeps existing task history.
- The application becomes unavailable when a required dependency is disabled, deleted, or no longer accessible. Repair the dependency before enabling or testing again.
- Deleting removes the application from the Plugin Center and prevents new tasks; it does not delete users' existing tasks.

Before organizational release, also review [sharing and external access](./application-access.md) and [application usage](./application-usage.md).

