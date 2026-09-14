---
title: Draft and context management
description: Understand local drafts, the context window, context compaction, and limit recovery.
---

# Draft and context management

## Unsent drafts

LinkSense makes a best-effort attempt to keep composer text and the selected plugins, Skills, and knowledge bases in the current browser. When you return to the same task or the new-task composer, you can continue editing.

Drafts do not sync across devices or browsers and are not a substitute for permanent storage. Clearing site data, using private browsing, or running out of browser storage can remove a draft. The related draft is cleared after a request is submitted successfully. Attachments that have not finished uploading are not part of this local draft.

When you paste a large amount of text, LinkSense may convert it to an attachment to keep the composer manageable. Review or remove it in the attachment list before sending.

## View the context window

The ring in the model selector shows how much of the current task's context window is in use. Expand it to see used and total values. If the model has not reported usage or the administrator has not configured a context length, the interface shows that context usage is unavailable.

As the context window approaches its limit, LinkSense uses a known model context length to let the runtime compact its working context automatically. The activity shows compaction state. If the length is unknown or you still need to condense the context deliberately, finish the current turn before running a manual compaction.

## Compact context

In an existing, stopped, unarchived task, enter `/` and choose **Compact context**, or send the standalone `/compact` command. A running task, a task with no history, or an archived task cannot be compacted.

Manual compaction summarizes the working context into a shorter basis for continuing. It does not delete the messages, attachments, or artifacts visible in the page. The activity shows whether compaction is running, completed, or incomplete. Submit the next request after compaction completes.

## When the context limit is exceeded

If an ordinary task stops only because the model context window was exceeded, LinkSense attempts to continue once within the same user request. The model is instructed to use the persisted task and workspace state without repeating completed commands, file edits, or tool actions. This is not a second user request.

If recovery still fails, read the visible error, compact the context, and state exactly where work should continue. Do not repeatedly send the same request, because that may repeat an external action or incur additional cost.

See [Create and run tasks](./create-and-run.md) and [Running and queued requests](./running-requests.md) for related controls.
