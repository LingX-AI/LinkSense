---
title: Create and manage automations
description: Run recurring work hourly, daily, weekly, or monthly in one pinned task.
---

# Create and manage automations

Automations start turns on a schedule inside one fixed task. They are useful for reports, checks, and recurring summaries.

## Create an automation

1. Open **Automations** and choose **New automation**.
2. Enter a title and self-contained instruction.
3. Choose a target:
   - **Existing task:** select a valid task currently pinned by your account.
   - **New task:** LinkSense creates and automatically pins one task when the automation is saved; every later trigger reuses that task.
4. Choose hourly, daily, weekly, or monthly and set an interval from 1 to 999:
   - hourly: choose minute 0–59 within each interval;
   - daily: choose a time;
   - weekly: choose at least one weekday and a time;
   - monthly: choose a day and a time.
5. Confirm the displayed device time zone. LinkSense converts the saved schedule to system time.
6. Optionally set an expiration date. The automation can still run on that date and stops from the following day.
7. Optionally enable a specific model and reasoning effort. When disabled, the account's current defaults are used.
8. Save and review the displayed next run.

A nonexistent monthly date is skipped—for example, day 31 in a month without that date.

## Review and run now

Filter the list by **All**, **Active**, or **Paused**. Each automation shows its last and next run. Choose **Open task** to review the complete activity and artifacts.

**Run now** bypasses the schedule. It starts immediately when the target task is idle or enters that task's queue when it is busy. It does not change future scheduled runs.

The sidebar notification area shows completed or failed runs. Open a notification to visit the task and clear its unread state.

## Pause, resume, edit, and delete

- Pausing prevents new scheduled runs without affecting history.
- Resuming calculates future runs from the current time and saved schedule.
- Editing affects future runs only.
- Deleting removes the schedule but preserves linked tasks and history.

## Recommendations

- Write instructions that can run without a follow-up question.
- Keep the automation target pinned and valid. Update linked automations before unpinning or archiving it.
- Keep required models, capabilities, credentials, and knowledge bases enabled.
- Review failures regularly because permission or configuration changes can block future runs.
