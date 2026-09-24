# Goal start projection race and recovery

## Cause

A user can start or resume a Goal in a conversation that already has a previous
logical Goal turn. Native `turn/started` can arrive before the start response is
projected. `attachGoalContinuation` previously attached that native turn to the
previous Goal when its last attempt was terminal. The start projection then
failed on `conversation_turns_conversation_codex_turn_key` or
`conversation_turn_attempts_codex_turn_id_key`.

The durable start intent remained `runner_succeeded`, and its recovery exhausted
the queue's attempts. Once the user's capability catalog changed, publication
correctly refused to replace the shared projection while an unresolved start
existed. All subsequent task starts then returned `CAPABILITY_HOME_SYNC_FAILED`.
Restarting the API alone also failed its startup recovery gate.

## Fix

Before attaching a native Goal continuation, check for the conversation's durable
start intent under the existing conversation branch lock. While an intent exists,
return `TURN_PROJECTION_PENDING` so the event remains in the durable outbox until
the ordinary start projection establishes ownership. Other unprojected events
must also remain pending instead of being acknowledged as a stale Goal branch.
Existing automatic continuations without a user start intent retain their normal
behavior. No native turn is replayed and no extra native attempt is introduced.

The installed Codex 0.154.0 schema was generated and inspected on the deployment.
The [official app-server documentation](https://developers.openai.com/codex/app-server)
describes separate start responses and `turn/started` notifications; local
projection ownership must not depend on which arrives first.

## Existing records and deployment

No database schema, API contract, frontend, or worker change is required.
The code fix prevents new collisions but does not repair previously misassigned
attempts by itself. Do not delete unresolved intents or relax the native-turn
unique constraints to work around the failure.

On 2026-09-24, the affected production account had four such intents. A full
PostgreSQL custom-format backup was saved with root-only permissions and its
archive manifest verified. A narrowly scoped recovery was first executed inside
a transaction and rolled back, then committed after its preservation assertions
passed. The recovery reused the deployed start-projection writer, retained native
attempt IDs and results, reassigned the completed attempt suffix and associated
events, messages, files, user-input requests and usage records, and restored the
four missing user inputs. Historical Goal states were preserved. Existing message
contents, event and file counts, and token/fee totals were checked in the same
transaction. No user input was resubmitted to Codex.

The production API image received only the compiled event-service fix and its
source, layered on the inspected existing image. Both API replicas were recreated
and the gateway reloaded. The incident directory on the server retains the
backup, recovery script, patch, and hotfix build context; the previous API image
is retained as `linksense-api:pro-before-goal-start-fix-20260924`. The next normal
release must include this source patch: the emergency image is not a Git release.

## Verification

- Regression tests fail against the original event service, including both a
  premature `turn/started` and another event that was incorrectly discarded.
- `pnpm --filter @linksense/api exec vitest run test/services.preflight.test.ts test/conversations.service.test.ts test/events.service.test.ts test/user-home-capability-materializer.test.ts` — 589 passed.
- `pnpm --filter @linksense/api typecheck` — passed.
- Goal, runner event batch, knowledge event, and deployment fence tests — another
  28 passed (617 relevant tests total).
- ESLint for the two changed TypeScript files — passed.
- API TypeScript production compilation to an isolated temporary directory — passed.
- The hotfix module imports successfully in the production image; both API
  replicas and the gateway health endpoint passed after historical repair.
- The affected account's capability preflight passed against its existing task
  and newly installed plugin after repair.
- An authenticated API smoke test using the affected account completed one
  ordinary turn and two consecutive Goal starts in a separate test conversation.
  All three completed with no unresolved start intent. The test conversation was
  archived afterwards; no browser automation was used.
