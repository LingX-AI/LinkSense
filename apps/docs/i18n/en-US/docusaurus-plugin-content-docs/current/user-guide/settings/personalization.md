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

## Memory

Memory is off by default, and you can enable it when needed. When enabled, LinkSense may derive personal memory from eligible tasks and use it in future work. Tasks involving external tools or web context do not create memory.

Disabling memory stops creating and using memory but does not automatically erase saved entries.

## Reset

Resetting permanently deletes all personal memory and cannot be undone. It does not delete tasks, custom instructions, plugins, Skills, knowledge bases, or other settings.

Confirm that you want **Reset**, rather than simply turning memory off.
