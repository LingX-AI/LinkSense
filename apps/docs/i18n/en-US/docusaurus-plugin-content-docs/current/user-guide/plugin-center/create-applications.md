---
title: Create and manage applications
description: Combine models, instructions, capabilities, and knowledge bases into a standard or interactive application.
---

# Create and manage applications

Applications provide controlled entry points for repeatable workflows. A creator can combine a model, instructions, plugins, Skills, knowledge bases, and MCP servers and then share the result. An application does not expand permissions that its creator or users do not already have.

In **My applications**, use the filter beside search to choose **All applications**, **In development**, **Standard applications**, or **Interactive applications**. Filters work together with search. Interactive applications include unpublished development drafts, while Standard applications excludes them. The URL preserves the selected filter when you reload the page.

## View application details

**My applications** shows the published version whenever one exists. Applications with only a draft show **Draft** and a code corner icon. Published applications never show that corner icon; when they have unpublished changes, **New development version** appears after the MCP count. Details show the development version separately, including its name, description, icon, plugin / Skill, knowledge base and MCP counts, and last saved time. **In development** includes both draft-only applications and published applications with new development versions, with one card per application.

Development actions are in the card's three-dot menu: **Continue developing** opens an existing project, while **Develop new version** starts one. The card's **Use** action always opens the published version.

Click the body of an application card in **My applications**, **Shared with me**, or **Application center** to view its name, full description, creator, type, model, version (when available), dates, and resources grouped into plugins, skills, MCP servers, and knowledge bases. **Use** and the actions menu remain separate controls.

- Cards and details in **My applications** show the same installed release, including its name, description, icon, and resources. Unpublished apps show their current configuration, and development drafts are shown separately. Resource lists for shared applications and the application center use their corresponding published version, without the creator's unpublished resource selections.
- Resource lists show the configured resource name first. When it differs from the application's declaration, **Declared by application** appears underneath. A green check indicates **Configured**; hover over it to see the label. Unmatched declarations appear as **Not configured**, and disabled or deleted resources appear as **Unavailable**. **Configured** only means a resource is linked; actual use still depends on credentials, authorization, and service availability.
- Details do not display resource IDs, credentials, connection settings, or application instructions. Seeing resource names does not grant permission to browse or manage those resources.

## Create a standard application

1. Go to **Plugin Center → Applications → My applications**.
2. Select **Create application → Create standard application**.
3. Enter a name and description and choose a preset icon or upload an image. Standard and interactive applications default to the colorful cube icon. Existing icon settings are preserved.
4. Fix a model and reasoning effort, or let users choose them in chat.
5. Enter application instructions and select plugins, Skills, knowledge bases, and MCP servers that you manage.
6. Save, then select **Use** to verify the complete workflow.

Shared users cannot see the application instructions. Plugins use the creator's bound plugin credentials. MCP tools may have external side effects, so verify their purpose and permissions before adding them.

## Build an interactive application in conversation

1. In My applications, choose Create application → Create an interactive app through chat, enter a name, and start building. You can also ask a regular task to build a LinkSense interactive application.
2. Describe your requirements in the development conversation. The adjacent preview updates as files change, without exporting and importing packages. Click the name or description above the preview to edit it. Changes save automatically after you stop typing or leave the field.
3. Try the application with real tasks, files, and results. Its test conversation is separate from the development conversation.
4. Use Configure capabilities to search, select, or remove plugins, skills, knowledge bases, and MCP servers the application can use. Saving writes your choices to the application's configuration, updates the preview, and includes them when you install or update the application. If the conversation changes the application at the same time, reload the configuration before saving. Preview errors appear in Debug logs and can be inspected by the assistant.
5. Choose Publish when ready and confirm in the dialog. This enables the application for your own use in My applications. Later, choose Develop from the application's menu, then Publish update and confirm. This does not automatically share or list the application.

Incomplete changes retain the last working preview. An active test finishes on its original version before switching to the latest changes. Publication checks for any changes that have not reached the preview. If content changes after the confirmation dialog opens, review it and confirm again.

A subtle **Draft** or **Published** status sits beside the application name. Further changes return the current content to **Draft**. The three-dot menu at the top right contains **Publish / Publish update**, **Configure capabilities**, **New debug conversation**, **Debug conversation history**, and **Debug logs**. The application preview updates automatically, without manual refresh. Select history or logs to view their content below, then use the close button at the top right of that view to return to the application without losing your form inputs. Only submitted tests appear under **Debug conversation history** in the development panel, outside the sidebar, regular task search, and archive list. Review inputs, outputs, files, and activity there. Editing code or refreshing a preview creates no empty records, and internal preview version numbers are not displayed. **New debug conversation** resets the preview and preserves submitted tests. Older records can be deleted individually. Stop any active test and resolve pending requests before restarting or deleting the application.

Draft edits leave installed, shared, and listed versions unchanged. **Publish update** activates the update only for the creator. Save organization sharing again or submit a new Application Center listing, then recipients manually install the update. See [Share applications and configure external access](./application-access.md).

Archiving or deleting a development task preserves the application, draft and debug conversation history in **My applications**. Select **Continue developing** from the three-dot menu to continue; if the original task was deleted, a new task opens with the same source files and debug conversation history. Choose **Delete development draft** in the three-dot menu to remove the draft and its debug conversations while keeping the published application. **Delete** removes the entire application, including its draft and debug history. Both actions preserve development tasks, regular tasks and workspace files, and clean up associated runtime resources in the background.

## Annotate the preview and ask LinkSense to change it

Select **Annotate** immediately to the left of the three-dot menu at the top right of the development view. Click an element or drag to select an area, then choose **Ask LinkSense** beside the selection. Describe the change in the popover and choose **Add annotation**. Continue adding requests for other selections. Each annotation has a numbered marker. The annotation list lets you locate, remove, clear, or send all annotations together.

Requests go to the development conversation on the left. LinkSense edits the current application, and the preview resumes updating after you send. If the development conversation is busy, annotations join its pending requests without creating another test task. App buttons do not activate while annotating. You can exit annotation mode to try the app and return later with your added annotations preserved.

Automatic preview updates pause during annotation so selected locations stay stable. If another action updates the application, you will be asked to select again. Failed submissions retain annotations. Clear them and exit annotation mode, wait for the preview to update, and select again.

## Edit the app icon and details

Click the icon beside the app name in the development header to select a preset or upload an image, and edit the name and description. In My applications, choose Edit for an installed app or Edit app details for a draft. Images must be PNG, JPEG or WebP, at most 512 KiB and 1024 pixels per side.

You can also upload an image in the development conversation and say “Use this as the app icon”, or ask to change the name or description. Changes save to the draft and update its preview. Publish when ready to use them in My applications.

## Import an interactive application

Select **Import interactive application** and upload a ZIP whose root contains `manifest.json` and `index.html`. The page runs in an isolated iframe and uses the LinkSense SDK to start tasks or control the native chat pane. See [Build an interactive application](../../developer-guide/interactive-application.md) for the package and API contract.

When preparing a package, open **Resource declaration list** from the import dialog to choose the resources it needs. Closing the list returns to the import dialog and preserves the selected package.

When updating an interactive package, the manifest version may stay unchanged or increase, but cannot be lower than the highest existing version. **Update** immediately activates the package and resource configuration for you. Save organization sharing or update the Application Center listing separately; recipients install updates manually. If you have regular tasks running for this application, the update is blocked until you stop them or they finish.

## Update, disable, and delete

An existing task's next execution uses the currently installed version, rather than remaining tied to its original version. Running tasks do not switch versions mid-execution, and historical results remain unchanged. Simply opening or refreshing a historical task does not install updates automatically.

For both standard and interactive apps, choose **Edit**, then **Save**. Editing keeps the current version; applications without a version start at 0.0.1. You may enter a higher x.x.x version, but cannot lower it. Saving updates your card, details, and subsequent tasks together. Unchanged version labels still produce separate records. Failed saves leave no partial changes. Saving is blocked while you have regular tasks running for this application. Organization sharing and Application Center updates remain separate and require recipients to install manually. The create, import, and package update buttons read **Create**, **Import**, and **Update**; each activates the saved application for you immediately.

- Configuration edits are saved to the current application. Use **Save sharing** to update organization sharing, and update the Application Center listing separately. Neither action rewrites running turns or historical results.
- Disabling prevents new tasks but keeps existing task history.
- The application becomes unavailable when a required dependency is disabled, deleted, or no longer accessible. Repair the dependency before enabling or testing again.
- Deleting removes the application from the Plugin Center and prevents new tasks; it does not delete users' existing tasks.

Before organizational release, also review [sharing and external access](./application-access.md) and [application usage](./application-usage.md).
