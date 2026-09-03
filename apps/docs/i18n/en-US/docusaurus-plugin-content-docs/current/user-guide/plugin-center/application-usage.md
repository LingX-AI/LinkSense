---
title: View application usage
description: Let application creators inspect users, tasks, model calls, tokens, and costs.
---

# View application usage

An application creator can select **More actions → Usage** on an application under **Created by me**. Being a shared user or having access to the administrator-wide usage page does not automatically grant this creator view.

## Choose a range

Choose all time, the last 7 days, the last 30 days, or custom dates. The page shows active users, tasks, actual turns, model calls, tokens, and cost, with trends, token and cost composition, and model and workload breakdowns.

An active user is a distinct user who created an application task or actually started a turn during the selected period. The creator view does not disclose user names or email addresses.

## Interpret the data

- A task is attributed to the application recorded when it was created. Renaming or updating the application does not change historical attribution.
- Turns count actual executions, not drafts, reconnects, or duplicate events.
- Token and cost data cover model calls after collection began. Earlier tasks may still be counted, but LinkSense does not estimate their costs using current prices.
- Tokens without a reliable price snapshot appear as **Unpriced tokens**.
- Cost uses the price saved at call time; later price changes do not recalculate history.

Administrators can compare organization-wide applications in [Usage and cost analytics](../../admin-guide/usage.md), subject to the administrator data boundary.

