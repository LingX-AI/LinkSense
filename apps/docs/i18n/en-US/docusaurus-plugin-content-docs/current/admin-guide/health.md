---
title: System health and index rebuilds
description: Inspect service dependencies and safely rebuild all knowledge indexes.
---

# System health and index rebuilds

:::info Administrator operation
**Settings → System health** is read-only except for explicitly provided maintenance actions.
:::

## Health areas

The page reports API, database, Redis, local-login protection, authentication email, document parsing, retrieval and indexing, optional reranking, runner, workspace access, authoritative running slots, actual running turns, recovery, child process count, and concurrency limits. In Docker deployments it also reports CPU, memory, PID, and state for API, Runner, workers, Web, gateway, PostgreSQL, Redis, and other observed containers.

It shows redacted summaries and recommendations, not credentials, connection strings, Redis keys, internal logs, or secrets.

## Interpret status

- Liveness means the API process is running.
- Readiness means critical dependencies can serve full traffic.
- A required storage failure makes readiness unavailable while liveness continues probing.
- Document parsing or retrieval can be unavailable without making all LinkSense features unavailable.
- An unconfigured ranker is valid; RRF remains available.

## Disk usage

Disk usage is a compact total in the top health summary. It includes all users' project spaces, task artifacts and attachments, environments and caches, plus databases, knowledge indexes, backups, logs, and service programs for the current deployment. Retained files from completed or archived tasks are also included.

Measurements use allocated filesystem space. Sparse files use their allocated size; shared directories, hard links, and image layers are counted once. Separate stored copies are counted separately. This is not the host's total disk usage. Other deployments, global build caches, and historical images without confirmed ownership are excluded. Storage shared with another deployment is marked unmeasured when it cannot be attributed. Databases, object storage, and indexes on external servers are excluded from local disk usage and must be checked separately in those services.

Sampling starts once at service startup and then runs hourly in the background. A new scan is never started while the previous scan is still running. Large directories have independent time and resource limits. Other health information appears immediately. Disk usage is added to the summary automatically after the first complete measurement. Pending or incomplete measurements remain hidden; a subtotal is never shown as the total. Hover over the indicator to view the sample time. Scanning does not block readiness checks or task execution, and a sampling failure does not itself change service readiness.

Docker deployments use the existing Worker image for a temporary, read-only container without networking. It measures filesystem metadata without reading file contents and is removed afterward. This requires the existing Docker socket permission and container capabilities for read-only scanning. Storage drivers that do not expose image or writable layer locations leave those categories unmeasured. Local-process deployments cannot currently report complete deployment disk usage.

There is no database migration or user file modification, relocation, or cleanup. Update Runner, API, and Web to measure existing storage; tasks, projects, and applications do not need to be recreated.

## Service resource usage

**Service resource usage** shows the latest available Docker container snapshot. An unobservable result normally means that the Runner controller lacks a usable Docker socket or permission; it does not mean every container stopped. The cards are diagnostic and cannot restart or stop containers.

## Failed resource cleanup

When asynchronous cleanup after task or capability deletion repeatedly fails, System health lists the resource type, stage, stable reason, and attempt count. You can retry one or all failed items. LinkSense rechecks state, defers cleanup for an active goal task, and does not interrupt other running tasks.

Do not manually delete managed directories when path boundaries, permissions, or runtime state are uncertain. Fix deployment permissions or Runner first, then retry from System health.

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
