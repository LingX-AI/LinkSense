# Archived task cleanup and failed preparation recovery

## Failure and fix

Clearing archived tasks previously stopped at the first per-task conflict. Earlier
deletions had already committed, while the caller saw only an error. The API now
returns `deleted_count` and `failed_tasks` for task-level deletion guards, continues
with the remaining tasks, and preserves the existing ownership, transaction,
automation, running-turn and artifact-retention checks. Unexpected infrastructure
errors still propagate; the UI refreshes the task list on either outcome.

A separate runtime leak occurred when model-transition preparation became
uncertain before the user turn was submitted. Durable recovery classified the
start as failed because it had no native correlation, but the managed process
retained its uncertain-start marker and capability lease. Runtime cleanup then
continued to reject the task as active.

Recovery now closes the matching unsubmitted preparation process and confirms
its exit before classifying the start as failed. It also recognizes already
persisted failed starts during cleanup. A live start, native turn, active goal,
different operation or submitted native correlation remains protected. Process
close failures do not release the lease or convert an uncertain start to failed.
The fix does not replay user input or add native turn attempts.

## Upgrade and recovery

- No Prisma schema or data migration is required. Existing applications, drafts,
  task files and retained artifacts keep their current deletion policies.
- Deploy shared contracts, API, web, runner and worker runtime from the same
  release. The archived-clear response now requires `failed_tasks`; do not mix
  old API replicas with the new web client during rollout.
- Rebuild the worker image as well as the controller. Existing workers must use
  the updated runtime before the process-pool fix can take effect.
- Pending cleanup records continue through the existing cleanup queue. Records
  that already exhausted their retry limit remain failed: after updating the
  runtime, use the administrator's system health **Retry cleanup** action for the
  affected record. This uses the existing audited retry path; do not delete
  cleanup records or manually mark them completed.
- Verify that the affected cleanup record completes and that the application
  draft remains accessible. This local fix has not itself deployed to 113.

## Regression coverage

- Partial clearing across running-task, automation and unsaved-artifact guards;
  successful clearing and tasks restored concurrently.
- Partial-result display, list refresh, Chinese/English copy and fallback locale.
- Unsubmitted preparation timeout, historical failed start state, process-exit
  failure, and existing active/uncertain submitted-turn protection.
