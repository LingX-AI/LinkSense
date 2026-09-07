---
title: Connect and use Microsoft Teams
description: Use an organization bot to send text tasks to LinkSense.
---

# Connect and use Microsoft Teams

## Setup

1. Register a single-tenant application in Microsoft Entra and create a client secret. Create an Azure Bot using that application ID and tenant, then enable the Microsoft Teams channel.
2. Open Settings → Message channels → Connect Microsoft Teams. Enter the application Client ID, secret, tenant ID and the allowed user’s Microsoft Entra object ID.
3. After saving, open View configuration. Copy the Message endpoint into the Azure Bot messaging endpoint. It must be reachable over public HTTPS.
4. Create a Teams application containing the bot in Teams Developer Portal. Enable personal, groupChat and team scopes as needed, publish or upload it to your tenant, and install it.
5. Send private text as the specified user, or mention the bot in a group/chat channel. Waiting for message verification changes to Online after the first authorized message.

## Supported messages

- Text private messages and group mentions from the one configured member. Disable group messages if you only need private chats.
- Each chat continues its own LinkSense task. Teams channel posts use separate task threads.
- Replies are visible to other members of the same group. Complete execution details, files and very long results remain available in LinkSense.
- Images, files, voice messages and cards are not supported. WeCom customer messages are outside this integration.

## Connection issues

Check the application credentials, member ID, application permissions and network access. Ensure the sender is the configured member and mentions the bot in a group. An installed application may also need administrator approval.

A local-only address cannot receive Teams messages. Configure the public HTTPS address before copying the endpoint, and verify the Azure Bot and Teams application use the same application ID. This integration supports public-cloud single-tenant bots.

## Disconnect or replace credentials

Choose Disconnect and confirm. Pending channel messages and replies are removed; existing LinkSense tasks and the platform application remain. Reconnect to replace the application or its credentials.
