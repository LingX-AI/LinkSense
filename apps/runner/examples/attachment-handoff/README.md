# Business-owned attachment handoff

Reference integration for issue #67. It uses the existing STDIO MCP transport;
it does not add a LinkSense upload endpoint or make attachments public.

Run from the repository:

```sh
pnpm --filter @linksense/runner exec tsx examples/attachment-handoff/server.ts
pnpm --filter @linksense/runner exec vitest run test/attachment-handoff-example.test.ts
```

For deployment, package `server.ts` and `transfer.ts` with the business-owned
adapter, using the existing `@modelcontextprotocol/sdk` and `zod` dependencies.
Register its compiled entry point as a STDIO MCP server and select it in the
published application. The repository command is for local development, not a
path that will exist in a deployed Worker.

## Configuration and consent

Supply these through the adapter's trusted launch configuration, never tool
arguments:

- `HANDOFF_ATTACHMENT_ROOT`: the current conversation's attachment directory,
  not the user's HOME or a shared project's whole attachment tree.
- `LINKSENSE_CONVERSATION_ID`: the host-bound conversation ID.
- `HANDOFF_AUTHORIZATION_URL` and `HANDOFF_UPLOAD_URL`: fixed HTTPS endpoints
  owned by the destination. Redirects are rejected.
- `HANDOFF_BEARER_TOKEN`: a backend-issued credential restricted to this
  external user, application, conversation and destination.

The destination must implement both endpoints. It owns authorization,
storage, business-record association, consent revocation and idempotency.
These are a reference destination contract, not existing LinkSense APIs.

Before calling the tool, the user reviews filenames, media types, sizes and
the target business action in an authenticated destination/host UI, and can
exclude files or cancel. That backend persists the confirmed file manifest,
including SHA-256 hashes, bound to the user and conversation. It then returns
a **non-secret** handoff ID. Knowing that ID must never grant access without
the scoped credential.

LinkSense's `request_user_form` can present choices, but a model's claimed
confirmation, prompt text, boolean argument or guessed handoff ID is not
proof of consent. The destination must verify its own server-side consent
record. Do not launch a broadly privileged adapter for anonymous embeds.

## Destination contract

`HANDOFF_AUTHORIZATION_URL` receives a JSON POST containing `handoff_id` and
`conversation_id`. It validates the bearer credential's user/application/
conversation scope and returns only the reviewed files:

```json
{
  "id": "10000000-0000-4000-8000-000000000001",
  "conversation_id": "20000000-0000-4000-8000-000000000001",
  "status": "confirmed",
  "expires_at": "2026-10-29T00:00:00Z",
  "files": [{
    "relative_path": "selected/evidence.pdf",
    "filename": "evidence.pdf",
    "media_type": "application/pdf",
    "size": 1234,
    "sha256": "the-lowercase-64-character-sha256-from-the-reviewed-file"
  }]
}
```

The backend, not the model, supplies the paths and hashes. If cancelled,
return the same manifest with `status: "cancelled"`; no upload follows.
Reject expired, deleted, foreign or revoked handoffs. Local deletion,
replacement or symlink escape also prevents upload.

`HANDOFF_UPLOAD_URL` receives a multipart POST with `handoff_id` and repeated
`files` fields. Each part preserves the approved filename and media type.
`Idempotency-Key` is the handoff ID. Before storing anything, revalidate scope,
expiry, consent and the complete manifest, including content types and hashes.
Associate all selected files with the business record transactionally. Return:

```json
{
  "record_id": "case-123",
  "accepted_sha256": ["the-actual-64-character-sha256"]
}
```

Persist the idempotency receipt at the destination so repeated calls return the
same record and accepted files; do not create duplicate records. A partial
receipt is an error, not success. After a lost response, resolve the existing
handoff outcome rather than creating a new one. Cancellation or failure before
commit must not create a record; clean up uncommitted objects at the destination.

## Limits and verification

This example supports PNG, JPEG and PDF, up to 8 MiB per file and 16 MiB total.
It checks the exact selected bytes before sending, uses a 30-second overall
timeout, honors cancellation and never automatically replays the operation.
It returns stable error codes without filesystem paths, remote errors or tokens.
The destination maps those codes to its localized UI.

The regression test starts a real STDIO MCP process for tool discovery and uses
a simulated destination HTTP boundary for transfers. It verifies
exact bytes, filenames/types, a stable retry key, cancellation, foreign
conversations, expiry, unsupported types, file replacement, traversal, symlink
escape and partial results. It does **not** prove the destination's storage,
transactional record creation, persistent deduplication, host review UI or a
deployed STDIO integration; implement and test those before using real evidence.
