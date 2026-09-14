---
title: Administrator guide overview
description: Understand LinkSense administration areas, authorization boundaries, and responsibilities.
---

# Administrator guide overview

Anyone may read this guide, while LinkSense administration pages and operations require an active administrator account.

:::info Administrator operation
Administration appears under the **Management** group in Settings. The server validates role and status on every request; a hidden menu is not the security boundary.
:::

## Administration areas

| Page | Responsibility |
| --- | --- |
| Groups & users | Create accounts, import users, control status, and maintain flat groups |
| Roles | Review the fixed user and administrator boundaries |
| Plugin Center | Review releases and suspend or restore risky listings |
| Knowledge bases | Govern metadata, state, access, and ownership |
| Knowledge sources | Configure external sources such as SharePoint |
| Model settings | Manage chat, retrieval, transcription, image-understanding, and image-generation models and prices |
| System settings | Manage supported product and authentication settings |
| System health | Inspect dependencies, execution runtime, container resources, and failed cleanup |
| User feedback | Review text and issue screenshots submitted by users |
| Audit logs | Query permanent events, task execution metadata, and deleted-task artifact summaries |
| Usage | Analyze tasks, turns, models, tokens, and cost |
| System update | Check official versions and follow the safe deployment upgrade process |

## Content administrators do not receive

The role does not automatically grant another user's task body, attachments, deliverables, personal capability content, or knowledge-base document content. It never reveals passwords, tokens, API keys, connection strings, or encrypted secrets.

## Initial setup

An uninitialized deployment shows a one-time wizard that creates the first local administrator. This account is not a super administrator and has the same role as later administrators.

## Operating principles

- Confirm scope before disabling, deleting, transferring, or switching models.
- Keep business approval evidence for irreversible actions.
- Verify management results with audit records.
- Use System Health for diagnosis, then let deployment-authorized operators change infrastructure configuration.
