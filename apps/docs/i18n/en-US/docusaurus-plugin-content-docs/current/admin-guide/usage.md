---
title: Usage, cost, and billing
description: Analyze resource usage by time and business dimension, then review and export monthly model statements.
---

# Usage, cost, and billing

:::info Administrator operation
Open **Settings → Usage analytics**. The **Usage analytics** tab reports resource facts, while **Billing** contains closed natural-month model statements. Credit quotas remain under **Quota management**.
:::

Configure credits in [Quota management](./quota-settings.md), and adjust existing users under **Users & groups → Users**.

## Time range

Choose all time, the last 7 days, the last 30 days, or custom dates. Trends aggregate by day, month, or year based on the range.

## Views

- Global: tasks, actual turns, model calls, tokens, and total cost.
- Workload: AI responses, task auto-naming, memory generation, document embeddings, retrieval-query embeddings, reranking, and image generation.
- Model: collection method, calls, turns, token details, and cost for generation, embedding, reranking, and image models.
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

Detail tables can be sorted by the columns exposed on the page. **Export Excel** uses the current range and filter definitions to create a multi-sheet workbook with the summary, trends, and the current model, workload, application, group, and user dimensions and details. Recheck the scope before exporting and store or transfer the file under organizational policy. Exports do not contain prompts, response text, file contents, or credentials.

## Monthly statements

Open the **Billing** tab to review the current open period and generated monthly statements. Statements close on natural calendar months in the system time zone and are generated automatically after month end. The current-period card shows the expected generation time. If the service restarts or is upgraded, it also catches up missing closed months.

Each monthly statement is an immutable per-model cost snapshot with input, cached-input, output, and total tokens, pricing mode, and amount:

- A model with one price throughout the month shows its per-million-token rate. A price change during the month is labeled **Mixed pricing**.
- Tokens without a reliable price snapshot remain unpriced and are not repriced with today's catalog.
- Statements aggregate by model only. They do not include prompts, responses, file contents, user details, or quota settings.
- Later price changes, task deletion, or membership changes do not recalculate a generated statement.

Open a statement to preview its model lines, or export a PDF in the current interface language. Exports are recorded in the audit log. Store the downloaded file according to your organization's billing and financial-record policy.

## Retention

Task, turn, call, token, cost, application-attribution, and generated-statement facts survive task hard deletion. They do not contain prompts, responses, file contents, credentials, Base URLs, or API keys.
