---
title: Manage plugin credentials
description: Add authorization details for external services and manage the plugins that use them.
---

# Manage plugin credentials

Plugin credentials contain API keys, tokens, and other authorization details plugins use to access external services. Add a credential and link it to a plugin to use these details automatically when the plugin runs. Saved authorization values are not shown again.

## Add a credential

1. Open **Settings → Plugin credentials** and select **Add credential**.
2. Enter a recognizable name and service identifier. Do not include secrets in the name.
3. Follow the plugin instructions to enter configuration names and authorization values. You can add multiple items.
4. Save, then select **Link plugin**.

When editing, leave a value blank to keep it, or enter a new value to replace it.

## Check linked plugins and configuration

Each credential shows how many plugins use it. Multiple items for the same plugin are grouped together, such as “Used by 1 plugin” and “2 items linked”.

- **Credentials configured**: the plugin’s declared configuration items have corresponding information. This does not verify external service access.
- **More information needed**: view configuration details to see what is missing, then select **Complete setup** from the plugin’s three-dot menu.
- **This credential is disabled**: select **Enable credential** to use it again.
- **Conflicting links / Configuration needs updating**: check the saved information and select **Resolve links** from the plugin’s three-dot menu.
- **Plugin unavailable**: the plugin is unavailable or you do not have access. Unlink it or contact an administrator.

Configuration names and links appear under **View configuration details**. Select **Credential details** from the credential’s more menu to view its service identifier. Unlinked credentials are not used automatically.

## Link a plugin

1. Select **Link plugin**, or choose **Manage links** from the three-dot menu beside an existing plugin.
2. Choose the plugin and review the number of selected items. Matching names are selected automatically.
3. For unmatched items, select **Select or adjust information** and choose the corresponding information from this credential. If a value has not been saved yet, edit the credential to add it first.
4. Select **Save links**. The plugin will use this information in subsequent runs.

Each configuration item must have one explicit credential source. Saving updates the information you have selected for the plugin.

## Disable, unlink, or delete

- **Disable a credential**: keep the credential and links, but stop using it in subsequent runs. Enable it to use it again.
- **Unlink plugin**: select **Unlink plugin** from the plugin’s more menu. After confirmation, remove all links between this credential and the selected plugin. Keep the credential itself.
- **Remove one information link**: remove an individual relationship in configuration details. Keep the saved value.
- **Delete a credential**: permanently delete the credential and its links. This cannot be undone.

Credentials are used only for your own plugins. Other users’ credentials are never selected automatically.
