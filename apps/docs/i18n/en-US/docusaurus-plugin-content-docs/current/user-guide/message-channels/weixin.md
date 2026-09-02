---
title: Connect and use Weixin
description: Connect a personal Weixin account by QR code and create LinkSense tasks from text or transcribed voice messages.
---

# Connect and use Weixin

## Connect by QR code

1. Go to **Settings → Message channels**.
2. Select **Connect Weixin** on the Weixin card.
3. Scan the QR code with Weixin on your phone and confirm there.
4. If your phone shows a pairing code, enter it in LinkSense and submit it.
5. Close the dialog after the status becomes **Online**.

Select **Generate again** if the QR code expires or connection fails. Use **Reconnect** to restore an existing connection; a successful new connection replaces the old runtime connection.

## Supported scope

The Weixin connection processes only text and transcribable voice messages sent by the account that scanned the code. Other accounts, group chats, and unsupported message types do not start LinkSense requests. Every accepted message runs in that user's task space and remains subject to model, capability, knowledge-base, concurrency, and token limits.

## Disconnect

Select **Disconnect** and confirm to stop receiving and replying to Weixin messages. Existing tasks, messages, and artifacts remain available in the web app.

## Connection or reply problems

- Make sure the QR code is valid and that you completed confirmation or the pairing-code step on the phone.
- Check that the status is **Online**. Reconnect when it is **Connecting**, **Connection error**, or **Reconnect required**.
- Send a supported text or voice message from the account that scanned the code.
- Check token allowance, scheduled maintenance, and task concurrency limits.
- If retries continue to fail, give an administrator the visible status and time. Do not share the QR code, pairing code, or sign-in credentials.

