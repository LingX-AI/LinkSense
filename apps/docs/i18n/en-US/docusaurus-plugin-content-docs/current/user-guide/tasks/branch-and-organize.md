---
title: Branch and reorder tasks
description: Create an independent branch from a historical response and organize pinned and recent tasks.
---

# Branch and reorder tasks

## Branch from a response

In a stopped task, find the final assistant response you want to use as the branch point and select **Branch into new chat** from its message actions. LinkSense creates and opens a new task containing the conversation, attachments, artifacts, knowledge citations, and resumable runtime context through that response.

The branch does not include anything after the selected response and does not modify the source task. Its title receives a sequence suffix and it starts unpinned. Messages, files, and subsequent runs are independent in the two tasks.

You cannot branch when:

- The source task is running or starting, or has a queued request.
- The selected response is not the final assistant response of a finished turn.
- The source task is archived or its runtime context cannot be copied safely.

A failed operation does not leave a visible partial task. Confirm that the source task has stopped before retrying.

## Reorder tasks

Drag tasks within the **Pinned** and **Recent** groups in the sidebar. A task can move only within its current group; pin or unpin it first, then choose its position in the destination group.

With a keyboard, focus the reorder handle, press Space to pick up the task, use the Up and Down arrow keys, and press Space again to save. Press Escape to cancel. If another window changes the list at the same time, LinkSense may reject the stale order; refresh and reorder again.

## Archiving and deletion

A branch and its source are independent tasks. Archiving or permanently deleting one does not automatically affect the other. If artifacts were copied into a branch, access and download them from the appropriate task under its current permissions.

