---
title: Message channel overview
description: Compare connection methods and supported behavior for Weixin, Feishu, WeCom, DingTalk, and Microsoft Teams.
---

# Message channel overview

Open **Settings → Message channels** to connect LinkSense to a chat platform. Channel messages are still processed inside your private task space and remain subject to model, capability, concurrency, and credit limits.

## Choose a channel

| Channel | Connection method | Supported messages | Network requirement |
| --- | --- | --- | --- |
| [Weixin](./weixin.md) | Scan a QR code with a personal Weixin account | Text and transcribable voice from the linked account | No public callback |
| [Feishu](./feishu.md) | Scan a QR code to create or update an official bot | One-to-one text from the bot creator | Outbound HTTPS and WebSocket; no public callback |
| [WeCom](./wecom.md) | Bot ID, secret, and one allowed member | Private text and group @ mentions from that member | Outbound HTTPS and long connection; no public callback |
| [DingTalk](./dingtalk.md) | Client ID, Client Secret, and one allowed member | Private text and group @ mentions from that member | Stream connection; no public callback |
| [Microsoft Teams](./teams.md) | Entra/Azure Bot application and one allowed member | Private, group, or channel @ mentions from that member | A publicly reachable HTTPS messaging endpoint is required |

Each channel continues the corresponding LinkSense task within the same chat. Group replies may be visible to other people in that group, so do not send content that should remain private.

## Where to view complete results

Message channels mainly return the final text. Return to the corresponding LinkSense task for tool activity, execution details, attachments, generated files, and long results. Add unsupported files or message types from the web interface instead.

## Before connecting

- Use your own platform account or an organization-approved bot application.
- Verify the allowed sender identity carefully.
- Make sure enterprise proxies, firewalls, and DNS do not block the required outbound connections.
- Only Teams needs a public HTTPS callback. Never share secrets, QR codes, pairing codes, or callback credentials while troubleshooting.
