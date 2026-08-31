---
title: Audit logs
description: Query redacted cross-user management and security metadata.
---

# Audit logs

:::info Administrator operation
Open **Settings → Audit logs**. Audit is for security facts, not browsing user content.
:::

## Events

Audit covers account and role changes, groups, capability import and publication, credential lifecycle, knowledge governance, model and system configuration, safe task execution metadata, and error states.

Filter by time, actor, target type, action, or result. Details contain stable actions, necessary IDs, time, and redacted request metadata.

## Content boundary

Audit does not show another user's task body, files, deliverable content, complete tool arguments, raw third-party responses, passwords, tokens, API keys, credential plaintext, complete Base URLs, or internal paths.

Some records retain source IP and User-Agent as restricted metadata and display them only according to policy.

## Rejected operations

Self-disablement, self-demotion, attempts against the final administrator, unauthorized reads, and invalid governance requests are recorded with their stable error codes.

## Recommendations

- Start with a narrow time range.
- Preserve data-minimization rules when exporting or relaying audit facts.
- Correlate events with System Health time points.
- Expect permanent minimal audit after a business entity is deleted.
