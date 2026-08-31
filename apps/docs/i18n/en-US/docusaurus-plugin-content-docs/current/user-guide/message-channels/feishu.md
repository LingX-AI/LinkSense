---
title: Connect and use Feishu
description: Create or update a Feishu bot by scanning a QR code, then start LinkSense tasks from a private chat.
---

# Connect and use Feishu

After connecting Feishu, you can send text to the bot in a private chat. LinkSense processes the message and returns the final response in the same chat.

## Connect by QR code

1. Open **Settings → Message channels**.
2. On the Feishu card, select **Scan to create bot**.
3. Scan the QR code with Feishu and approve the request.
4. Wait until the page shows a successful connection, then open the new bot in Feishu and send a text message.

LinkSense creates an official Feishu bot and securely stores the information needed for the connection. You do not need to enter application credentials or configure a callback URL manually.

When you scan again, LinkSense updates the associated Feishu application instead of creating a duplicate for the same account. If Feishu created the application during an earlier attempt but LinkSense did not finish associating it, follow the dialog to select the existing application and continue.

## Wait for administrator approval

Some organizations require an administrator to approve new applications or permissions. The channel then shows **Waiting for administrator approval** or a similar status:

- You do not need to scan again.
- After approval, LinkSense automatically detects the change and restores the connection, usually within a few seconds.
- The bot may be unable to send or receive messages while approval is pending.

If approval is complete but the status does not update for an extended period, refresh the Message channels page and confirm that the Feishu application still exists and its required permissions have not been revoked.

## Supported messages

- Only one-to-one private text messages from the person who created the bot are accepted.
- Each accepted message creates or continues a private LinkSense task and starts one processing turn.
- Feishu receives only the final text result. Open the LinkSense task to see the full progress, tool activity, and file results.
- Group chats, messages from other people, images, files, voice messages, cards, and proactive pushes are not currently supported.

## Use with a local deployment

Local deployment is supported. The computer or server running LinkSense connects outward to Feishu, so you do not need to expose `localhost` publicly or configure a public callback URL.

The LinkSense environment must be able to reach Feishu over HTTPS and WebSocket. A corporate proxy, firewall, DNS issue, or TLS interception can leave the channel looking connected while messages or replies do not arrive.

## Feishu says the application does not exist

If the original Feishu application was deleted, do not keep scanning a QR code that points to it:

1. Close the current QR dialog and start the Feishu connection again.
2. Select **Application deleted? Create a new application** or the equivalent option shown on the page.
3. Scan the new QR code and approve it.

After the new application connects, it replaces the invalid association. Later scans will update this application.

## Disconnect

After disconnection, LinkSense stops receiving new messages from the bot. The official Feishu application and existing LinkSense tasks remain available. When you reconnect, LinkSense first tries to reuse and update the original application.

To remove the application from Feishu as well, delete it separately in Feishu administration. Use the **Create a new application** path the next time you connect.

## The bot does not respond

Check these items in order:

1. The channel is connected, not waiting for administrator approval or requesting reconnection.
2. The bot creator is sending plain text in a one-to-one private chat.
3. The Feishu application still exists and its approved permissions have not been revoked.
4. The LinkSense environment can reach Feishu over HTTPS and WebSocket.
5. Refresh the Message channels page, wait a few seconds, and send one short text message. Do not submit repeated copies.

## An untitled task appears but does not start

A newly created task may briefly appear as **Untitled task**. If it stays empty and never starts:

1. Open the task and refresh the page to check whether the original message arrived.
2. Return to Message channels and confirm that Feishu is still connected.
3. Send a new, short text message in the same bot chat instead of repeating the original one.
4. If the problem continues, record the time, Feishu sender, and stable error message shown on the page before contacting an administrator. Do not share QR codes, application credentials, or sensitive message content.

See [Troubleshoot common problems](../troubleshooting/common-problems.md) for additional checks.
