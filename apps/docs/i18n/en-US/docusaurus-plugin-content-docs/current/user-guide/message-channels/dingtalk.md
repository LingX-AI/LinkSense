---
title: Connect and use DingTalk
description: Use an organization bot to send text tasks to LinkSense.
---

# Connect and use DingTalk

## Setup

1. Create an internal application on the DingTalk developer platform, enable its robot, select Stream mode and publish it.
2. Grant robot permissions to send one-to-one and group messages, configure its audience and add the bot to the groups you need.
3. Open Settings → Message channels → Connect DingTalk. Enter the application Client ID, Client Secret and the allowed member’s organization UserId.
4. Save and wait for Online. Use that member account to send private text or mention the bot in a group.

## Supported messages

- Text private messages and group mentions from the one configured member. Disable group messages if you only need private chats.
- Each private or group chat continues its corresponding LinkSense task.
- Replies are visible to other members of the same group. Complete execution details, files and very long results remain available in LinkSense.
- Images, files, voice messages and cards are not supported.

## Connection issues

Check the application credentials, member ID, application permissions and network access. Ensure the sender is the configured member and mentions the bot in a group. An installed application may also need administrator approval.

A public callback endpoint is not required. Keep LinkSense running with outbound HTTPS and WebSocket access to the platform.

## Disconnect or replace credentials

Choose Disconnect and confirm. Pending channel messages and replies are removed; existing LinkSense tasks and the platform application remain. Reconnect to replace the application or its credentials.
