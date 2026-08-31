---
title: Use Goal tasks
description: Let LinkSense keep working toward a goal until it completes or needs your attention.
---

# Use Goal tasks

Goal tasks are for work that needs sustained progress, such as creating a presentation, summarizing long documents, researching a topic and producing a deliverable, or completing a complex request in multiple steps.

After a Goal starts, LinkSense keeps working toward the same objective until the Goal is complete, a limit is reached, or your input is needed. A normal message does not start in Goal mode by default. You can choose **Goal** before sending, and LinkSense may also create a Goal while working when a normal task needs sustained progress.

## Start a Goal

1. Select **+** in the lower-left corner of the input box.
2. Choose **Goal** from the capability menu.
3. Confirm that the **Goal** chip appears in the lower-left corner of the input box.
4. Describe what you want LinkSense to accomplish.
5. Add files, plugins, Skills, knowledge bases, a model, or reasoning effort as needed.
6. Send the task.

Hover over the **Goal** chip in the input box to exit Goal mode. After you exit, the next message is sent as a normal task request.

## Create a Goal during execution

When a normal task needs multiple steps of sustained work, LinkSense can create a Goal while it is running. The current task moves directly into Goal mode and shows the Goal card without resubmitting your request or creating a second user message.

Later steps continue in the same task. The interface shows the usual Goal status when the Goal completes, reaches a limit, or needs your attention. Automatic continuation does not resubmit your original request or replay tool actions that already completed.

## Write a measurable Goal

The more concrete the Goal, the easier it is for LinkSense to know when it is done. Include:

- Result: the expected deliverable, such as an article, workbook, presentation, analysis report, or archive.
- Scope: files, dates, topics, source material, or boundaries.
- Criteria: language, format, length, page count, quality requirements, or required sections.
- Stop condition: what counts as complete and when LinkSense should ask you first.

Example:

> Use the attached product material to create a 10-page Chinese pitch deck with positioning, core features, customer value, competitor comparison, and next steps, then generate a downloadable file.

## Use capabilities and files

Goal tasks can use files, plugins, Skills, knowledge bases, and personal MCP just like normal tasks. Capabilities selected before sending are used as context for that Goal task.

If you need to add new material or change capabilities while the Goal is running, send another request in the same task. Requests with new attachments or capability selections follow the running-request queue rules so the active context is not interrupted unexpectedly.

## Follow Goal status

The user message that started a Goal shows a Goal icon and **Goal** label in its lower-right corner, so you can distinguish it from normal requests later.

While the Goal is active, a Goal card appears above the input box. It shows the current status, objective, and elapsed time. Select the time to view Goal details, including time used, tokens used, and the token budget.

The token budget in Goal details belongs to that Goal. The per-user token usage set by an administrator is an account-level setting that controls whether you can start new tasks. The two settings apply independently.

After the Goal is complete, the Goal card disappears and the final assistant reply shows a completion marker such as “Reached the Goal within a duration.”

## Pause, resume, and clear

- Edit Goal: change the objective while preserving time and tokens already used.
- Pause Goal: stop future automatic continuation; an already running turn may still finish naturally.
- Resume Goal: continue a Goal that is paused, needs attention, or has stopped at a limit.
- Clear Goal: remove Goal status and usage records from the task; this does not force-stop the current native run.

Use the task **Stop** action if you want to interrupt the currently running turn immediately. Pausing a Goal and stopping the current turn are different actions.

## Common statuses

| Status | Meaning |
| --- | --- |
| Goal in progress | LinkSense is automatically working toward the Goal. |
| Goal paused | The Goal will not automatically continue unless you resume it. |
| Goal needs attention | LinkSense needs your input, an external change, or confirmation. |
| Goal usage limited | The current usage limit prevents the Goal from continuing. |
| Goal budget limited | The Goal reached its configured token budget. |
| Goal complete | LinkSense marked the Goal as complete. |
