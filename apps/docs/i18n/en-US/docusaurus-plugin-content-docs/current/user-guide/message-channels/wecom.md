---
title: Connect and use WeCom
description: Use an organization bot to send text tasks to LinkSense.
---

# Connect and use WeCom

## Setup

1. Create an internal WeCom intelligent bot in API mode with a persistent connection. Obtain its bot ID and secret and make it available to the member who will use it.
2. Open Settings → Message channels → Connect WeCom. Enter the bot ID, secret and the allowed member’s WeCom directory userid.
3. Save and wait for Online. Send text in a private chat, or add the bot to a group and mention it as the allowed member.

## Supported messages

- Text private messages and group mentions from the one configured member. Disable group messages if you only need private chats.
- Each private or group chat continues its corresponding LinkSense task.
- Replies are visible to other members of the same group. Complete execution details, files and very long results remain available in LinkSense.
- Images, files, voice messages and cards are not supported. WeCom customer messages are outside this integration.

## Connection issues

Check the application credentials, member ID, application permissions and network access. Ensure the sender is the configured member and mentions the bot in a group. An installed application may also need administrator approval.

A public callback endpoint is not required. Keep LinkSense running with outbound HTTPS and WebSocket access to the platform.

## Disconnect or replace credentials

Choose Disconnect and confirm. Pending channel messages and replies are removed; existing LinkSense tasks and the platform application remain. Reconnect to replace the application or its credentials.
