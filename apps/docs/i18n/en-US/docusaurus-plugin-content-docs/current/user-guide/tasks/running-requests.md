---
title: Send requests while a task is running
description: Steer the current turn, queue the next request, or stop execution.
---

# Send requests while a task is running

When a turn is still running, LinkSense uses your message content and the preference in **Settings → General** to choose a safe action.

## Steer the current turn

Steering is useful for immediate text-only clarification:

- Analyze only the last three months.
- Put the conclusion first.
- Stop making a presentation and create a workbook instead.

The clarification is delivered to the current execution rather than starting a parallel turn.

## Queue the next request

Queueing preserves the current turn and starts the new request after it finishes. LinkSense always queues a request that:

- contains a new attachment;
- changes plugins, Skills, or knowledge bases; or
- requires a fresh, stable execution context.

Pending requests appear in the task and can be changed or removed when the UI offers those actions.

## Stop

Stopping requests interruption. Already visible messages or deliverables may remain, while an unfinished tool action might not produce a usable result.

## Choose the default

In **Settings → General → Messages sent during execution**, choose **Steer current execution** or **Queue as the next request**. The preference applies in Web and Teams; resource-bearing requests are still queued.
