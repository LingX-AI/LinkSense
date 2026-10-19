---
title: Personalization, instructions, and memory
description: Set persistent instructions for future work and manage personal memory.
---

# Personalization, instructions, and memory

Open **Settings → Personalization** for preferences that apply to future tasks.

## Custom instructions

Use custom instructions for stable preferences:

- Answer in English by default.
- Run relevant unit tests after code changes.
- Put report conclusions before supporting evidence.

Saved instructions apply from future turns. Platform rules, safety boundaries, and administrator governance remain higher priority. Never store passwords or tokens here.

## Automatic task naming

Choose when task names update. Changes are saved automatically:

- **First message** (default): name a task when you first send a message, then keep its name.
- **Every message**: update the name with each new message, using the latest request and recent context.

Manually edited task names stay unchanged. This preference applies to future messages in both new and existing tasks; changing it does not rename historical tasks in bulk. Naming runs independently of task execution and keeps the current name if generation fails.

## Show reasoning

**Show reasoning** is off by default. Turn it on to display the full reasoning text provided by the model during tasks and in task history. Some models provide only summaries or no full text; no full reasoning body is shown in those cases. Changes are saved per user and affect only the display, not reasoning effort. Existing brief reasoning summaries and tool calls are unaffected by this switch.

During a task, hover over **Thinking** and click the arrow on the right to expand that stage's tool calls. Click again to collapse them. The arrow is absent when there are no tool calls. After completion, you can revisit the records in the activity history.

## Memory

Memory is off by default, and you can enable it when needed. When enabled, LinkSense may derive personal memory from eligible tasks and use it in future work. Tasks involving external tools or web context do not create memory.

Disabling memory stops creating and using memory but does not automatically erase saved entries.

## Reset

Resetting permanently deletes all personal memory and cannot be undone. It does not delete tasks, custom instructions, plugins, Skills, knowledge bases, or other settings.

Confirm that you want **Reset**, rather than simply turning memory off.
