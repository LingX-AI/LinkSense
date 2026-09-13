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

Click the model and reasoning effort button at the bottom of the composer to open the selection card. Drag the slider to preview effort levels and release to save. You can also click a position on the track or use the arrow keys. The slider shows only the levels supported by the current model.

Click the model name at the top of the card to switch models. The reset button in the upper-right corner restores the current model's default effort. Switching models keeps your effort level when supported; otherwise, the new model's default is used.

The selector shows only chat models marked as available in conversations. Model and reasoning effort are fixed when a new turn starts. Later administrator changes do not rewrite running or historical turns.

If a previous model is no longer available in conversations, select another or use the conversation default.

The ring in the model card shows context-window usage for the current task. When it approaches the limit, finish the current turn and follow [Draft and context management](./context-and-drafts.md) to compact the context.

## Add capabilities

Before sending, you can select enabled plugins or Skills, choose accessible knowledge bases, and review personal MCP status. These resources are fixed for the turn.

Preflight blocks execution if a capability is disabled, a credential is missing, or knowledge-base access is no longer valid.

When speaking is more convenient, use [voice input](./voice-input.md) to convert microphone speech into an editable draft. You still decide when to send it.

When an administrator has enabled an image-generation model, you can also [generate images](./generate-images.md) directly. Successful output is registered as task artifacts.

## Use Goal mode for longer work

When a request cannot be completed in a single reply, use a [Goal task](./goal-tasks.md). Choose **+**, then **Goal**, describe a measurable outcome, and add files, plugins, Skills, or knowledge bases just as you would for a normal task.

Goal tasks show a Goal label on the user message and a Goal card while work is running. After completion, the final reply shows how long it took to reach the Goal.

## Plan before implementation

When you need to confirm scope, risk, and implementation steps first, select **Add → Plan mode**. LinkSense analyzes the request, asks clarification questions when needed, and waits for you to implement, revise, skip, or exit after the plan is ready. See [Use Plan mode](./plan-mode.md).

Type `/` to open shortcuts for a new task, context compaction, plugins, Skills, applications, knowledge bases, and MCP. Availability still depends on the current task state and your resource permissions.

## Run controls

- **Stop** requests interruption of the current turn.
- A temporary connection loss recovers the same turn rather than creating a duplicate.
- Refreshing the page does not erase task state.
- Activity shows plans, tool actions, and status changes. The task overview brings together subagents, artifact files, and external sources. See [View task progress, artifacts, and sources](./progress-and-sources.md).
- After failure, resolve the visible model, capability, or input problem before retrying.

:::info Tasks and turns
A task contains multiple turns. A continuation creates a new turn; page refreshes, reconnects, and duplicate event delivery do not.
:::
