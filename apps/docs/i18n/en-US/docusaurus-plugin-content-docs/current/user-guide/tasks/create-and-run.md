---
title: Create and run tasks
description: Configure a LinkSense turn with a model, plugins, Skills, and knowledge bases.
---

# Create and run tasks

## Write an actionable request

A useful request normally states:

- Objective: what must be accomplished.
- Inputs: files, data, or knowledge bases to use.
- Constraints: language, format, length, date range, or mandatory rules.
- Deliverable: an answer or a Word, Excel, PowerPoint, PDF, image, or archive file.

## Select a model and reasoning effort

The selector shows only chat models marked as available in conversations. Model and reasoning effort are fixed when a new turn starts. Later administrator changes do not rewrite running or historical turns.

If a previous model is no longer available in conversations, select another or use the conversation default.

## Add capabilities

Before sending, you can select enabled plugins or Skills, choose accessible knowledge bases, and review personal MCP status. These resources are fixed for the turn.

Preflight blocks execution if a capability is disabled, a credential is missing, or knowledge-base access is no longer valid.

When speaking is more convenient, use [voice input](./voice-input.md) to convert microphone speech into an editable draft. You still decide when to send it.

## Use Goal mode for longer work

When a request cannot be completed in a single reply, use a [Goal task](./goal-tasks.md). Choose **+**, then **Goal**, describe a measurable outcome, and add files, plugins, Skills, or knowledge bases just as you would for a normal task.

Goal tasks show a Goal label on the user message and a Goal card while work is running. After completion, the final reply shows how long it took to reach the Goal.

## Run controls

- **Stop** requests interruption of the current turn.
- A temporary connection loss recovers the same turn rather than creating a duplicate.
- Refreshing the page does not erase task state.
- After failure, resolve the visible model, capability, or input problem before retrying.

:::info Tasks and turns
A task contains multiple turns. A continuation creates a new turn; page refreshes, reconnects, and duplicate event delivery do not.
:::
