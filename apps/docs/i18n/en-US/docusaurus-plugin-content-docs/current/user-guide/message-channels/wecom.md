---
title: Connect and use WeCom
description: Administrators configure a shared bot, and members link their own LinkSense accounts.
---

# Connect and use WeCom

## Administrator setup

1. Create an internal WeCom intelligent bot in API mode with a long connection. Make it available to the members who need access.
2. In LinkSense, open **Administration → System settings → Organization message channels** and choose **Connect WeCom**.
3. Enter the bot ID and secret, choose whether members may mention the bot in groups, and save. Wait for the connection to come online. There is no single allowed-member setting.

Administrators maintain the connection and can pause, enable, or disconnect it. Members do not need bot credentials. Pausing keeps account associations and existing tasks.

## Member access

1. Sign in to your own existing, active LinkSense account and open **Settings → Message channels**.
2. Choose **Link my account** on the WeCom card and get a confirmation message.
3. Send the complete message to the WeCom bot in a private chat. It is valid for 10 minutes and one use. Do not forward it to anyone else.
4. Once the page shows **Account linked**, send private text or mention the bot in an allowed group.

Tasks use the sender's own LinkSense permissions, resources, and quota. Unregistered, disabled, or unlinked accounts cannot start tasks. Different members in the same group have separate task contexts; replies in the group remain visible to its members.

## Scope and troubleshooting

Internal member text messages and group mentions are supported. Customer messages, images, files, voice, and cards are not supported yet.

Ask an administrator to configure or enable an unavailable channel. Administrators should check bot credentials, visibility, and network access when a connection fails. Members can choose **Unlink account** on their Message channels page.

To replace the bot or its secret, an administrator disconnects and configures it again; members then link their accounts again. Disconnecting removes associations and queued channel messages while keeping existing LinkSense tasks.
