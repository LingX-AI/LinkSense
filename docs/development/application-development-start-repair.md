# Application development turn admission repair

## Cause

Development conversations do not run an installed application and have no
`application_id` or `application_updated_at` on their turn start intent. Their
development instructions were nevertheless written into `application_instructions`.
The existing `conversation_turn_start_intents_application_check` requires those
three snapshot fields to be either all null or all populated. A production
database with that constraint rejected the insert before the runner received the
request. The user saw a generic operation failure.

The local database lacked that constraint, so the same invalid insert appeared
to work. Migration-history checks alone did not establish that the actual table
constraints matched the source migrations.

## Storage and execution

`development_instructions` is a separate nullable text column on
`conversation_turn_start_intents`. Ordinary conversations leave both instruction
fields null; installed application tasks retain their complete application
snapshot; development conversations populate only the development field.

Admission and recovery use the persisted instructions through the existing runner
instruction channel. Turn-attempt continuation context also retains them. This
does not change the runner protocol, native turn lifecycle, retries, authorization,
or frontend contracts.

## Upgrade

Include all of these changes when merging into another edition:

- `prisma/schema.prisma` and the new forward migration
  `20260918230000_separate_development_turn_instructions`.
- The conversation service's admission, parsing, dispatch and projection changes.
- The service regression tests and the PostgreSQL integration test/CI command.

The migration adds the new column, moves existing unbound application instructions
into it without discarding their content, and restores the original application
snapshot constraint if it is absent. It leaves an existing production constraint
unchanged and adds a check that prevents mixed application/development contexts.
Existing requests, application records, conversations and historical migration
files/checksums are retained. No application recreation, import or publication is
required.

The production deployment script already builds fresh Prisma clients, blocks
ingress, stops/settles execution, takes a database backup and starts the migration
service before the new API. Use that normal deployment path. Do not run old API
writers alongside the cutover or roll back only the API image: the old writer is
incompatible with the restored constraint. Keep the backup and use the deployment
recovery process if a database restore becomes necessary.

For local Docker development, `pnpm dev:prepare` rebuilds schema-dependent images,
runs `prisma migrate deploy`, and starts the services with regenerated clients.
Run `pnpm dev` afterward to attach source watching. Back up the local database and
wait for active tasks to finish before preparing it.

If unrelated invalid partial application snapshots exist, the transaction fails
without deleting or silently correcting them; inspect those records before
retrying. This repair does not reconcile other unrelated local schema/history
drift and must not be used to rewrite historical migration checksums.

## Verification

```sh
pnpm db:generate
pnpm --filter @linksense/api test test/conversations.service.test.ts
pnpm test:development-instructions:postgres
pnpm --filter @linksense/api typecheck
```

The PostgreSQL test owns a disposable Docker database and never migrates the
application's configured database. It checks a fresh installation, an upgrade
with the original constraint, and an upgrade with the constraint missing and a
previously accepted development request. It first reproduces the old failure,
then verifies retained request contents, unchanged migration history, valid
ordinary/application/development writes, rejected mixed/partial contexts, and
repeat deployment. Service tests verify initial dispatch and recovery from the
persisted development context, including already-started native operations.

Verified for this repair:

- `pnpm --filter @linksense/api exec vitest run --pool=threads --maxWorkers=1 --maxConcurrency=2`:
  280 files / 3457 tests passed. The initial four-worker run hit four 5-second
  test timeouts; the complete rerun passed without changing assertions or timeouts.
- `pnpm test:development-instructions:postgres`: all three database scenarios passed.
- `node --test scripts/database-interactive-applications.test.mjs scripts/production-deployment-control.test.mjs scripts/dev-database.test.mjs`:
  16 deployment/database checks passed.
- `pnpm db:generate`, `pnpm db:validate`, `pnpm --filter @linksense/api typecheck`,
  `pnpm --filter @linksense/shared build`, and `pnpm --filter @linksense/api build`: passed.
- `pnpm --filter @linksense/api exec eslint src/modules/conversations/service.ts test/conversations.service.test.ts test/integration/development-turn-instructions-postgres.ts --max-warnings=0`: passed.
- Local runtime: the migration is applied, both constraints are validated, the
  API contains the regenerated client and repaired service, readiness reports
  ready, and a post-migration development turn completed without an error.

The commercial edition's existing start-intent model was checked against this
model (identical apart from the new column). No remote deployment was performed
as part of this local repair; repeat the production health and development-turn
checks after merging and deploying there. Browser automation was not used.
