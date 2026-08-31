---
title: System health and index rebuilds
description: Inspect service dependencies and safely rebuild all knowledge indexes.
---

# System health and index rebuilds

:::info Administrator operation
**Settings → System health** is read-only except for explicitly provided maintenance actions.
:::

## Health areas

The page reports API, database, Redis, local-login protection, authentication email, document parsing, retrieval and indexing, optional reranking, runner, workspace access, authoritative running slots, actual running turns, recovery, child process count, and concurrency limits.

It shows redacted summaries and recommendations, not credentials, connection strings, Redis keys, internal logs, or secrets.

## Interpret status

- Liveness means the API process is running.
- Readiness means critical dependencies can serve full traffic.
- A required storage failure makes readiness unavailable while liveness continues probing.
- Document parsing or retrieval can be unavailable without making all LinkSense features unavailable.
- An unconfigured ranker is valid; RRF remains available.

## Rebuild all knowledge indexes

After changing the embedding model or detecting a deployment-wide mismatch:

1. Confirm model and dimension configuration is stable.
2. Read the full-rebuild impact.
3. Start it in a maintenance window.
4. Monitor progress and failures.
5. Verify retrieval after completion.

The rebuild uses a deployment-wide concurrency limit and keeps failed entries retryable. Do not start duplicate rebuilds by repeatedly selecting the action.

## Escalation

Deployment-authorized operators must resolve environment, network, or external-service problems. The health page does not automatically create or reconfigure external Docling, Elasticsearch, or model-service containers.
