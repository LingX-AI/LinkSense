---
title: First-time setup
description: Create the first administrator, configure a model, and verify task execution.
---

# First-time setup

## Create the first administrator

Open the address printed by the installer. The default port is `18081`, but a fresh install may select another available port. Run `linksense address` to check the actual address. Use the installer's one-time credential to create the first administrator. Keep the credential out of chats, tickets, and public logs.

## Configure a model

Use [model settings](/admin-guide/model-settings/) to add a model channel and save it in the administration UI. Verify network reachability, protocol compatibility, and tool support separately. Configure an embedding model for built-in Knowledge on Full.

## Verify your first task

1. Run `linksense status` and `linksense doctor` to check deployment health.
2. Send a short message by following the [first task guide](/user-guide/getting-started/first-task/).
3. Run a task that uses a tool, such as generating and opening a small file. Check its output separately from the chat response.
4. On Full, upload a representative document and check that retrieval cites the right source.

Before exposing the deployment publicly, read [operations](./operations.md) and the [execution boundaries](./architecture.md#execution-boundaries).
