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
| [WeCom](./wecom.md) | Administrator setup followed by each member linking their account | Private text and group @ mentions from linked members | Outbound HTTPS and long connection; no public callback |
| [DingTalk](./dingtalk.md) | Personal QR creation and authorization, then account linking | Your private text and group @ mentions | Stream connection; no public callback |
| [Microsoft Teams](./teams.md) | Administrator-managed Entra/Azure Bot followed by member account linking | Private, group, or channel @ mentions from linked members | A publicly reachable HTTPS messaging endpoint is required |

Channels continue the corresponding task for each member and chat. Different members of an organization bot have separate task contexts. Group replies may be visible to other people in that group, so do not send content that should remain private.

## Where to view complete results

Message channels mainly return the final text. Return to the corresponding LinkSense task for tool activity, execution details, attachments, generated files, and long results. Add unsupported files or message types from the web interface instead.

## Before connecting

- Use your own platform account or an organization-approved bot application.
- Link WeCom, DingTalk, and Teams identities to your own existing, active LinkSense account. You do not need to enter a member ID.
- Make sure enterprise proxies, firewalls, and DNS do not block the required outbound connections.
- Only Teams needs a public HTTPS callback. Never share secrets, QR codes, pairing codes, or callback credentials while troubleshooting.
