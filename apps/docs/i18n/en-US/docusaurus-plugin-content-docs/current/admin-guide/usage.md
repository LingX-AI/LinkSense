---
title: Usage and cost analytics
description: Analyze resources by time, workload, model, group, and user.
---

# Usage and cost analytics

:::info Administrator operation
Open **Settings → Usage**. Analytics observe resource facts and do not configure user credit quotas.
:::

Configure credits in [Quota management](./quota-settings.md), and adjust existing users under Groups & users → Users.

## Time range

Choose all time, the last 7 days, the last 30 days, or custom dates. Trends aggregate by day, month, or year based on the range.

## Views

- Global: tasks, actual turns, model calls, tokens, and total cost.
- Workload: AI responses, document embeddings, retrieval embeddings, and reranking.
- Model: type, collection method, calls, turns, token details, and cost.
- Application: tasks, turns, calls, tokens, costs, and per-model detail attributed when each task was created; tasks created outside an application appear as unassociated.
- Group: current members' activity projected into each group.
- User: active and disabled users, current groups, and per-model detail.

Tokens abbreviate as K, M, or B; task, turn, call, and member counts remain integers.

## Counting

A task and actual turn create one immutable activity fact each. Drafts, pending requests, reconnects, and duplicate events do not add turns. Native cumulative token snapshots are deduplicated by increment. External workloads use trusted usage when available or label protected-input estimates.

## Cost

Usage stores the prices active at call time in CNY per million tokens. Cached input is part of input, and reasoning output is part of output, so neither is double charged.

Future price changes do not recalculate history. Zero is a valid price; older tokens without a reliable price remain **Unpriced tokens**.

## Group overlap

A user in multiple groups contributes to every group. Group rows overlap and must not be summed for a global total. Users with no effective group appear as ungrouped.

## Sorting and export

Detail tables can be sorted by the columns exposed on the page. CSV export uses the current range and filter definitions. Recheck the scope before exporting and store or transfer the file under organizational policy. Exports do not contain prompts, response text, file contents, or credentials.

## Retention

Task, turn, call, token, and cost facts survive task hard deletion. They do not contain prompts, responses, file contents, credentials, Base URLs, or API keys.
