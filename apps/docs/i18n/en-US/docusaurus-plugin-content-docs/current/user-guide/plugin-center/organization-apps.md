---
title: Use shared and Application Center apps
description: Install and use application packages or services shared directly or published in Application Center.
---

# Use shared and Application Center apps

An organization application can combine models, plugins, Skills, knowledge bases, and fixed instructions as either an installable application package or a creator-managed application service.

Applications can be standard or interactive. An interactive application opens a creator-provided workflow UI with the trusted LinkSense chat in a separate pane on the right. Drag the divider to resize the chat, or hide and reopen it without stopping the task or losing application data.

## Find an application

Open **Plugin Center → Applications**:

- **Shared with me** contains versions granted directly to you or one of your groups.
- **Application Center** contains administrator-approved public releases.
- **My applications** contains applications you created and packages installed as personal copies.

Cards identify the available usage options. Details show the creator, purpose, version, usage guide, and a resource summary.

## Choose a usage option

A standard application may offer one or both options. Interactive applications support **Application service** only:

| Option | What installation creates | Who maintains resources and configuration |
| --- | --- | --- |
| Application package | An independent copy under **My applications** that you may continue editing | The app and bundled plugins or Skills are saved to your account; you configure credentials, knowledge bases, and external connections |
| Application service | Access to the creator's managed service | The creator maintains the app version, resources, and configured credentials; you do not gain permission to browse their content or configuration |

Review the version, usage guide, and required setup before installing. An application package can use a custom installed name. If it shows **Setup required** afterward, complete its resources and credentials under **My applications**. For a service, choose **Use** after installation to start a task.

## Start an application task

Select an installed application or service and follow its task UI. Depending on its configuration:

- the model is fixed by the creator or selected by you;
- plugins, Skills, knowledge bases, and instructions in a service are maintained by the creator; you maintain them in your independent package copy;
- a service's knowledge bases are searchable only inside the app and do not grant browse, preview, download, or management access.

Installation pins an explicit version. After the creator reshares or Application Center approves a newer release, **Update available** appears but does not silently replace your installation. Finish every running regular task for that application, then install the update manually. New tasks and the next execution in an existing task use the new version after a successful update; running turns and historical results are not rewritten. Package updates identify which personal settings can be preserved, and a failed update leaves the old installation available.

Interactive application tasks remain available in the task sidebar. After switching tasks, refreshing, or returning later, LinkSense opens the application version currently recorded for that task, restores its previously emitted structured data, and continues receiving new results. This does not rerun the task or install a newer version merely by opening the page. After you manually update the installation, an existing task adopts that version on its next execution; reopening it afterward uses the version it adopted.

## Unavailable applications

A disabled application, revoked service grant, unlisted Application Center service, or unavailable model, capability, credential, or knowledge base can block new service work. Existing task history remains. Revoking a grant does not delete an independently installed package, though its personal resources and administrator risk controls still apply. Contact the creator or an administrator to resolve a service dependency.

To build or maintain an entry point, see [Create and manage applications](./create-applications.md). [Share applications and configure external access](./application-access.md) explains organization grants and iframe access.

## Usage analytics for creators

Application creators can open **More actions → Usage analytics** on an application card and review active users, tasks, turns, model calls, tokens, and costs for all time, the last 7 or 30 days, or a custom date range. The page also provides trends, token and cost composition, and breakdowns by model and workload without exposing user names or email addresses.

Token and cost totals cover only calls recorded after collection began. Task and turn counts may include earlier history, but LinkSense does not estimate older tokens or costs using current model prices. Tokens without a reliable price snapshot are identified as unpriced.

See [View application usage](./application-usage.md) for range and metric definitions.

## Difference from regular tasks

You select resources for regular tasks. A service uses a creator-managed combination, while a package creates an independent copy that you maintain. Neither option grants extra permissions—LinkSense still validates every resource on the server.
