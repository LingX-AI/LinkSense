---
title: Audit logs
description: Query redacted cross-user management and security metadata.
---

# Audit logs

:::info Administrator operation
Open **Settings → Audit logs**. Audit is for security facts, not browsing user content.
:::

## Events

The audit area has three data surfaces:

- **Permanent audit logs** cover account and role changes, groups, capability import and publication, credential lifecycle, knowledge governance, model and system configuration, and management results.
- **Task execution metadata** is a cross-user redacted summary of execution status, capability names, and file counts, without titles, messages, or download actions.
- **Deleted-task artifacts** reports retained artifact count, size, checksum state, and deletion time without content viewing, recovery, or download.

Filter permanent events by time, actor, target type, action, or result. Task execution metadata can also be filtered by plugin, Skill, error code, Runner status, archive status, and creation or run dates. Open a record to inspect stable actions, required IDs, timestamps, and structured redacted metadata. The UI does not expose raw protocol fields as user content.

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
