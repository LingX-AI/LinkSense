---
title: Connect and use Microsoft Teams
description: Administrators configure the Teams bot, and members link their own LinkSense accounts.
---

# Connect and use Microsoft Teams

## Administrator setup

1. Register a public-cloud single-tenant application in Microsoft Entra and create a client secret. Create an Azure Bot with the same application ID and tenant, and enable the Microsoft Teams channel.
2. In LinkSense, open **Administration → System settings → Organization message channels** and choose **Connect Microsoft Teams**. Enter the application Client ID, secret, and tenant ID. Choose whether members may mention the bot in groups, and save. No member ID is required.
3. Copy the displayed **Messaging endpoint** into Azure Bot. The address must be publicly reachable over HTTPS.
4. Create a Teams app package containing the bot with the required personal, group chat, or team scopes. Have an organization administrator approve, install, or distribute it to members.

Administrators maintain the connection and can pause, enable, or disconnect it. Members do not need application credentials or directory-read permissions to link their accounts. Teams sign-in settings and bot messaging settings are managed separately.

## Member access

1. Sign in to your own existing, active LinkSense account and open **Settings → Message channels**.
2. Choose **Link my account** on the Microsoft Teams card and get a confirmation message.
3. Send the complete message to the Teams bot in a private chat. It is valid for 10 minutes and one use. Do not forward it to anyone else.
4. Once the page shows **Account linked**, send private text or mention the bot in an allowed group chat or channel.

Tasks use the sender's own LinkSense permissions, resources, and quota. Unregistered, disabled, or unlinked accounts cannot start tasks. Members have separate task contexts in the same group; channel posts also keep separate threads. Group replies remain visible to group members.

## Scope and troubleshooting

Text is supported. Images, files, voice, and cards are not supported yet. An address reachable only on localhost cannot receive Teams messages.

Administrators should check the application ID, tenant, secret, Teams app scopes, organization approval, public HTTPS endpoint, and network when messages fail. Members can unlink their own identities from Message channels.

To replace the application or secret, an administrator disconnects and configures it again; members then link their accounts again. Disconnecting removes associations and queued channel messages while keeping existing LinkSense tasks.
