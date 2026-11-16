# Privacy masking

Privacy masking keeps secrets out of model-provider traffic. Before a
request leaves the runner's model gateway, the gateway replaces secrets and
the user's own words with stable placeholders; the provider's reply is put
back before Codex or LinkSense sees it. The model provider receives
placeholders, while Codex, generated files, and the task UI keep the real
values.

It is **wire masking**, not storage redaction. LinkSense still stores task
history, events, and tool output as written. The feature is for users who do
not want an API key, token, or internal codename sent to a model provider.

## Where it runs

```
Codex ── Responses API / WebSocket ──► runner ModelGateway ──► provider
                                         │
                                         ├── mask request body
                                         └── restore response stream
```

The settings are per user:

- `GET/PUT /api/v1/me/privacy-masking-settings`
- Settings live in `user_privacy_masking_settings`, encrypted with the
  credential master key. No row means the defaults (masking off).
- A user's settings are resolved when a turn starts and travel to the
  runner with the provider runtime (`modelProvider.privacyMasking`).
- The placeholder key is derived per user from
  `LINKSENSE_CREDENTIAL_MASTER_KEY`, so the same secret never gets the same
  placeholder for two users sending to a shared provider account.
- When masking is off, the field is absent and the gateway takes its
  original path with no extra work.

## What is masked

Phase 1 masks:

- private-key blocks, common API-key shapes (OpenAI, Anthropic, GitHub,
  GitLab, Google, Slack, AWS, Stripe, Hugging Face, Groq, xAI, npm, PyPI,
  DigitalOcean, SendGrid), JWT-shaped tokens;
- passwords in URLs, `Authorization`/`Cookie` values, and
  `password = ...` / `api_key: ...` assignments;
- Chinese, Japanese, and Korean “password/key/token is …” phrases;
- words the user adds in Settings → Personalization → Privacy masking.

The request walker keeps structural values intact: model ids, message and
tool-call ids, tool names and schemas, tool-choice, `prompt_cache_key`,
encrypted reasoning/signatures, and image data URLs. Tool descriptions are
masked; tool names and parameter schemas are not.

## Placeholders

A placeholder is `{{KIND_<16 lowercase hex>}}`, produced by HMAC-SHA256 over
the kind and value with the user's placeholder key. The same value gets the
same placeholder every turn, so the provider's prompt cache prefix stays
valid. Values live only in the runner process's memory, bounded and evicted
oldest-first; a value evicted before its reply arrives stays a placeholder
rather than leaking.

Matching respects the user's “any case” and “whole word” choices, and an
allowlisted value is sent as written. Per-kind actions are supported by the
engine (`mask`, `warn`, `block`); Phase 1 exposes only `mask`.

## Streaming restore

The gateway restores:

- whole JSON responses, before usage capture and before writing the reply;
- every SSE event in native, tool-compatible, and Chat Completions bridge
  paths;
- placeholders split between two text deltas, by holding the event tail and
  carrying it into the next delta (keepalive events pass through without
  breaking the hold);
- tool-call argument strings, with one extra JSON escaping layer so values
  containing quotes, backslashes, or newlines remain valid JSON.

An unknown placeholder is left as it is and counted; the gateway never
guesses a value.

## Failure behavior

- Masking enabled and the engine throws → `503 privacy_masking_unavailable`,
  and no request is sent.
- A kind set to `block` is found → `422 privacy_masking_blocked`, and no
  request is sent.
- Settings that cannot be decrypted or validated →
  `PRIVACY_MASKING_SETTINGS_UNAVAILABLE`; the turn fails closed instead of
  treating the user as opted out.
- Masking enabled for a conversation disables the Codex Responses WebSocket;
  the gateway rejects an upgrade attempt with 426, and Codex falls back to
  HTTP SSE.

## Operational notes

- Apply `prisma/migrations/20261116090000_add_user_privacy_masking_settings`
  before using the settings page.
- Changing settings increments a revision that is part of the runner's
  runtime fingerprint, so the next turn rebuilds the conversation process
  with the new configuration.
- Turning masking on (or changing the words) changes the wire text once, so
  the provider's prompt cache prefix is rebuilt on that turn.
- The placeholder key is stable while `LINKSENSE_CREDENTIAL_MASTER_KEY` is;
  rotating the master key changes placeholders and invalidates cached
  prefixes.
- In a shared conversation, model calls use the conversation owner's
  settings, because the owner's runtime performs the turn.
- Public-knowledge runtimes, title generation, web search, image prompts,
  and knowledge embeddings do not use these settings in Phase 1.

## Known limits

- Detection is heuristic. Add a value to the allowlist when a legitimate
  value is masked; use the task result, not the placeholder count, to judge
  whether masking is too aggressive.
- A task that must inspect a secret itself (for example, “why was this token
  rejected”) cannot work while the value is masked; allowlist that value or
  turn masking off for the task.
- A provider-held response (`previous_response_id`) combined with a runner
  restart can lose the placeholder registry for older text; the reply then
  shows the placeholder instead of the value.
- Memory extraction and summaries may rewrite a placeholder; it then stays
  visible rather than being restored.
- Local/self-hosted providers are masked too. A per-provider switch is
  planned with the next phase.

## Tests

```bash
pnpm --filter @linksense/runner exec vitest run test/privacy-masking.test.ts test/model-gateway-privacy-masking.test.ts
pnpm --filter @linksense/api exec vitest run test/privacy-masking-settings.test.ts test/privacy-masking-routes.test.ts
pnpm --filter @linksense/web exec vitest run src/features/privacy-masking/privacy-masking-settings.test.tsx
```
