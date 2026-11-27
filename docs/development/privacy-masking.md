# Privacy masking

Privacy masking replaces or blocks recognized sensitive values in text that
leaves the runner's model gateway. Replacement uses stable placeholders; known
placeholders in the reply are restored before Codex sees them.

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
- `POST /api/v1/me/privacy-masking-settings/preview` masks sample text for
  the settings page's try-it box. It accepts the unsaved draft settings, is
  never stored, and uses the user's own placeholder key so the placeholders
  match a real turn.
- `GET /api/v1/me/privacy-masking-activity?days=7|30` lists recent requests
  and totals. To continue, pass `before=next_before` and `before_id` from
  the last row; a time-only cursor remains accepted for older clients.
  The runner reports activity through `POST /internal/runner/privacy-masking`.
  Rows older than 30 days are pruned when the next row for that user is written.
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

The original rules still cover:

- private-key blocks, common API-key shapes (OpenAI, Anthropic, GitHub,
  GitLab, Google, Slack, AWS, Stripe, Hugging Face, Groq, xAI, npm, PyPI,
  DigitalOcean, SendGrid), JWT-shaped tokens;
- passwords in URLs, `Authorization`/`Cookie` values, and
  `password = ...` / `api_key: ...` assignments;
- Chinese, Japanese, and Korean “password/key/token is …” phrases;
- words the user adds on Settings → Privacy masking (`/settings/mask`).

Personal information detection is opt-in by category:

| Category | What the built-in detector recognizes |
| --- | --- |
| Email | Common ASCII addresses with a dotted domain. |
| Phone | Valid international numbers with `+`; optionally also local numbers for the selected region (CN, US, ES, BR, FR, JP). |
| ID card | 18-character mainland China resident ID format with a valid birth date and check character; not a check of actual issuance. |
| Bank card | 13–19 digits with a valid Luhn checksum and a recognized card label or tool argument field; a bare number is not enough. |

The literal word list is unchanged. Custom rules add up to 16 named entries:

- **ID template:** a case-sensitive literal prefix plus 1–19 decimal digits,
  with identifier boundaries (`CUS-` and `6`, for example).
- **Regular expression:** RE2 syntax, up to 160 characters and 256 compiled
  instructions. The full match is protected, not just a capture group.
  Lookarounds and backreferences are not enabled. The engine rejects patterns
  matching the empty input, and fails closed on contextual zero-length matches.

Each new category or custom rule can replace and restore a match or block
the entire request. A blocking match cannot be hidden by an overlapping
replacement; overlapping replacements cover the whole matched span.

The allowlist exempts a detected value from masking or blocking only when the
entire value matches an entry, including letter case. The case setting for
custom words does not affect the allowlist.

The request walker keeps structural values intact: model ids, message and
tool-call ids, tool names and schemas, tool-choice, `prompt_cache_key`,
encrypted reasoning/signatures, and image data URLs. Tool descriptions are
masked; tool names and parameter schemas are not.

JSON tool arguments are matched on decoded strings, not JSON escapes.
If masking would require renaming an argument key or changing a number,
boolean, or null into a string, the gateway blocks the request rather than
sending the original value or changing the argument type.

## Placeholders

A placeholder is `{{KIND_<16 lowercase hex>}}`, produced by HMAC-SHA256 over
the kind and value with the user's placeholder key. The same value gets the
same placeholder every turn, so the provider's prompt cache prefix stays
valid. Values live only in the runner process's memory, bounded and evicted
oldest-first; a value evicted before its reply arrives stays a placeholder
rather than leaking.

The literal list respects the user's “any case” and “whole word” choices.
The replacement format is not configurable: each distinct value needs its
own placeholder to be restored.

## Settings page

`/settings/mask` (Personal settings group) holds the enable switch, rules,
allowlist, and a try-it box. The try-it uses the unsaved settings, highlights
outbound text replacements, and names the matched categories and custom
rules. A blocking match shows that nothing would be sent. Preview tests
sample text, not the structure of a full model request. It works while
masking is off, and the page saves all settings with one revisioned request.

The masking rules and the masker live in
`packages/shared/src/privacy-masking-engine`, so the API preview and the
runner use the same engine.

The activity tab shows totals and recent requests over 7 or 30 days. Each
row records count, kind, length, and location, never the value or the
placeholder. Older count-only rows still display, without details. A failed
report is logged and does not change the provider request.

## Streaming restore

The gateway restores:

- whole JSON responses, before usage capture and before writing the reply;
- every SSE event in native, tool-compatible, and Chat Completions bridge
  paths;
- placeholders split between deltas, without reordering interleaved events;
- function and MCP argument strings, with one extra JSON escaping layer so values
  containing quotes, backslashes, or newlines remain valid JSON.

An unknown placeholder is left as it is; the gateway never guesses a value.

## Failure behavior

- Masking enabled and the engine throws → `503 privacy_masking_unavailable`,
  and no request is sent.
- Advanced rules enforce text, match count, and processing budgets. An
  over-budget request fails closed rather than skipping any rules.
- A kind set to `block` is found, or replacement would change the structure
  of JSON arguments → `422 privacy_masking_blocked`, and no request is sent.
- Settings that cannot be decrypted or validated →
  `PRIVACY_MASKING_SETTINGS_UNAVAILABLE`; the turn fails closed instead of
  treating the user as opted out.
- Masking enabled for a conversation disables the Codex Responses WebSocket;
  the gateway rejects an upgrade attempt with 426, and Codex falls back to
  HTTP SSE.

## Operational notes

- Apply all three existing Mask migrations before serving the new API:
  `20261116090000_add_user_privacy_masking_settings`,
  `20261117190000_add_user_privacy_masking_records`, and
  `20261120110000_add_privacy_masking_record_hints`. Old activity rows receive
  empty hints; no data rewrite is needed.
- Upgrade API, Controller/Workers, and Web together before enabling masking.
  Drain old API instances that predate Mask: they do not read the settings
  and can send unmasked traffic. Runners that predate Mask cannot accept
  enabled settings. Do not roll protected traffic back to those builds.
- Advanced rules add optional fields to the existing encrypted settings.
  No new migration is required. Old rows remain valid and new
  categories stay off until explicitly enabled. An update omitting the new
  fields does not erase them. Upgrade all three layers and refresh old Web
  tabs before saving advanced rules; older strict schemas do not understand
  the new fields or preview results.
- Existing allowlist entries remain usable without a migration. Older saves
  kept only the first spelling among case variants. Add each spelling that
  should still be allowed as a separate entry.
- A newer API accepts count-only captures. If an API that supports activity
  but predates hints rejects a capture, the newer Runner submits its counts
  once without hints. New Web reads count-only rows and can fall back to
  date-only paging on old APIs; exact-timestamp paging requires the updated
  API and Web. Refresh old Web tabs and update bundled clients that predate
  hints; their strict response schema does not understand hints.
- Changing settings increments a revision that is part of the runner's
  runtime fingerprint, so the next turn rebuilds the conversation process
  with the new configuration.
- Turning masking on (or changing the words) changes the wire text once, so
  the provider's prompt cache prefix is rebuilt on that turn.
- Keep `LINKSENSE_CREDENTIAL_MASTER_KEY` unchanged during this rollout.
  Replacing it without re-encrypting existing settings makes those settings
  unreadable and blocks their turns; it also changes placeholders.
- In a shared conversation, model calls use the conversation owner's
  settings, because the owner's runtime performs the turn.
- Public-knowledge runtimes, title generation, web search, image prompts,
  and knowledge embeddings do not use these settings.

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
pnpm --filter @linksense/shared exec vitest run tests/privacy-masking-rules.test.ts
pnpm --filter @linksense/runner exec vitest run test/privacy-masking.test.ts test/model-gateway-privacy-masking.test.ts
pnpm --filter @linksense/api exec vitest run test/privacy-masking-settings.test.ts test/privacy-masking-routes.test.ts
pnpm --filter @linksense/web exec vitest run src/features/privacy-masking/privacy-masking-settings.test.tsx
```
