---
title: Use Plan mode
description: Analyze and approve a plan before LinkSense implements a complex task.
---

# Use Plan mode

Plan mode is useful when a request is complex, costly to implement, or needs an agreed scope before files are changed. It differs from a [goal task](./goal-tasks.md): Plan mode produces a plan and waits for approval, while a goal task continues working until the goal is complete or needs your attention.

## Enable Plan mode

In the composer, select **Add → Plan mode**, describe the objective, current state, constraints, and acceptance criteria, and send the request. A **Plan** chip appears in the composer; remove it to leave the mode before sending.

You cannot switch mode while a task is running or starting, has a queued request, has an unfinished goal, or is bound to an automation. Controlled surfaces such as interactive applications may also omit Plan mode.

## Answer clarification questions

LinkSense may ask for more information before it can finish the plan. Complete required fields and submit the form to continue the same run. Values marked as secret are not echoed in the task interface. A question may expire, in which case you need to start it again.

## Review the plan

After the plan is ready, choose one of these actions:

- **Yes, implement this plan** leaves Plan mode and starts a new implementation turn.
- **No, revise the plan first** submits your feedback, stays in Plan mode, and creates a complete revised plan.
- **Skip** leaves the decision unresolved and keeps Plan mode active.
- **Exit Plan mode** returns to Default mode without implementing the plan.

Before approval, review scope, file changes, dependencies, risks, and verification. If the plan is stale or the task state changed, LinkSense rejects the old action; refresh and use the current state.

## Follow implementation progress

During implementation, the task overview can show plan steps, the current step, file changes, artifacts, and sub-agent activity. Step status reflects execution progress and does not by itself mean that every intermediate result has passed your business acceptance checks.

