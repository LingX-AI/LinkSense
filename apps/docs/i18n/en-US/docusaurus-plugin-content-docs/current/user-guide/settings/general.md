---
title: General settings
description: Set the interface language, default handling for messages sent during execution, and browser notifications.
---

# General settings

Open the account menu and choose **Settings → General**.

## Interface language

LinkSense supports Simplified Chinese and English. The interface changes immediately and the preference is saved for Web and Teams.

The help center has its own language menu. A help link opened from LinkSense uses the current interface language automatically.

## Messages sent during execution

Choose the default for a message sent while a turn is running:

- **Steer current execution** adds a text-only clarification to the running turn.
- **Queue as the next request** starts after the current turn reaches a final state.

A request with an attachment or an explicit plugin, Skill, or knowledge-base selection is queued regardless of the default.

If saving fails, LinkSense restores the previous value and shows an error. Retry after connectivity returns.

## Browser notifications

Browser notifications are off by default. When you turn on **Enable browser notifications**, the browser asks for permission if it has not already been granted. Notifications are enabled only after you allow the permission. LinkSense immediately sends a test notification after enabling; you can also select **Send test notification** at any time.

If notifications are not effectively enabled in the current browser, and the browser supports notifications without a permanently denied permission, LinkSense shows a notification prompt in the lower-left corner. **Enable** runs the same complete activation and test flow as Settings. **Not now** hides the prompt only for the current browser session, so it can appear again after you reopen the browser. When permission is blocked, LinkSense does not show an unusable prompt; allow notifications in the site's browser permissions first.

The setting applies only to the current signed-in user and the current browser. It does not sync to other browsers or devices. A LinkSense page must remain open. Notifications can appear while the page is in the background, but not after the page or browser is closed. LinkSense does not use Web Push or a Service Worker for background delivery.

When enabled, LinkSense sends a notification when a regular task or automation reaches a terminal state. The notification reflects the actual outcome:

- **Succeeded**: the task completed successfully; an automation must also have produced a result you can view.
- **Failed**: the task failed, or an automation ended without producing a result you can view.
- **Interrupted**: the task or automation was interrupted.

The first time you enable the setting, LinkSense starts from the current terminal position and does not send notifications for earlier work.

LinkSense sends the system notification even when you are already viewing the task. The notification title shows the task name. Its body identifies a regular task or automation and shows the actual **Succeeded**, **Failed**, or **Interrupted** status. The task name is visible to the browser and operating system, but the notification does not include input, answers, error details, attachments, or artifact names. Clicking the notification focuses LinkSense and opens the corresponding task directly.

If the browser does not support notifications, cannot save the setting, cannot reach the task-completion notification service, or permission has been denied, the settings page explains the issue. The switch is saved as enabled only after permission, the test notification, and the completion-listener baseline are all ready. If the browser resets an existing grant to **Ask**, select **Grant permission and send test**. After denying permission, allow notifications for the LinkSense site in your browser settings before turning the switch on again. If LinkSense reports that the test was sent but no system notification appears, check whether the operating system allows this browser to send notifications and whether Do Not Disturb or Focus is enabled.

## Install on a desktop or home screen

LinkSense publishes web-app installation metadata. In a supported browser, use **Install app**, **Add to Home Screen**, or the equivalent browser menu command to open LinkSense in a standalone window. The command name depends on the browser and operating system.

Installation does not enable offline use; LinkSense still needs a connection to the deployment. Launching from the installed icon returns to the application entry point and uses the login session stored by that browser. Always sign out normally after using a shared device.
