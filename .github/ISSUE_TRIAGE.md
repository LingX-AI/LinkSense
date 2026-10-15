# Issue triage automation

LinkSense uses deterministic GitHub Actions for intake and information reminders, plus restricted GitHub Agentic Workflows for AI-assisted triage and implementation.

## Policy boundaries

- Every new issue receives `status:triage` and one bilingual acknowledgement.
- `needs-info` produces one reminder seven days after each application of the label. A response from the issue author removes `needs-info` and returns the issue to `status:triage`.
- No workflow closes an issue.
- AI may apply only high-confidence type, area, `needs-info`, and `needs-reproduction` labels. Medium- and low-confidence label changes wait for maintainer review.
- Duplicate candidates and priority are suggestions only. A maintainer applies `duplicate` or `priority:*` and decides whether to close an issue.
- Code generation starts only when a user with repository `write`, `maintain`, or `admin` access adds `agent-ready`. The only permitted output is one Draft PR targeting `main`.
- AI-created pull requests never merge, publish a release, or close the source issue automatically.

## Agent configuration

The AI workflows are disabled until the repository variable `LINKSENSE_ISSUE_AGENT_ENABLED` is set to `true`.

Configure these repository settings before enabling them:

| Kind | Name | Purpose |
|---|---|---|
| Secret | `LINKSENSE_ISSUE_AGENT_API_KEY` | Codex provider API key |
| Variable | `GH_AW_MODEL_AGENT_CODEX` | Codex model identifier; defaults to `GH_AW_DEFAULT_MODEL_CODEX`, then `gpt-5.4` |
| Variable | `LINKSENSE_ISSUE_AGENT_ENABLED` | Set to `true` only after the other values are configured |

The checked-in workflows use `https://codex-lb.lingx-ai.com/backend-api/codex`. To use another provider, update the literal `OPENAI_BASE_URL` under `engine.env`, update its hostname in `network.allowed`, and recompile the lock files. The provider must expose an OpenAI Responses API-compatible endpoint; never store its key in the workflow source.

Keep the repository's **Settings → Planning → Agent suggestions for issues → Automation level** at **Cautious**. At this level GitHub applies only high-confidence issue intents automatically and holds medium- and low-confidence changes for review. If this preview setting is not available for the repository, keep the AI workflows disabled.

## Observation period

Review at least 30 issues and preferably 50 before increasing any automation authority. Record the following in a maintainer-only tracking issue:

- incorrect automatic labels and their corrected values;
- accepted and rejected label suggestions;
- unnecessary or missing `needs-info` decisions;
- incorrect duplicate candidates or priority recommendations;
- Draft PRs that were abandoned, substantially rewritten, or accepted with minor changes.

Do not add automatic closing, duplicate, priority, merge, or release permissions during this period. Any later expansion requires a maintainer decision based on the observed false-positive rate and the severity of mistakes, followed by a review of the workflow's safe-output permissions.

## Maintenance

Triage loads only the read-only `issues` toolset, rather than repository files, code search, and the full default GitHub toolset. Its declared `allowed` list is `issue_read` and `search_issues`; the prompt budgets three issue reads and one repository-scoped issue search. These per-call budgets are prompt instructions, not a hard runtime quota: the pinned v0.91.8 Codex compiler records `allowed` in the manifest but does not emit the individual allowlist or documented `max-calls` guards into this workflow's gateway config. Other read-only tools in the `issues` group may therefore remain available. Do not use `github.args` to work around this: the pinned compiler renders those Docker arguments with a trailing comma that breaks gateway JSON parsing, and they are not MCP server CLI arguments. Keep the existing ten-minute execution limit: a run that stalls after completing its reads requires gateway/model investigation, not an unconditional timeout increase. This reduces context amplification but does not establish the root cause of historical inference stalls. Verify the complete agent, detection, and safe-output chain on a new run of the changed revision before closing historical failure issues.

Edit the Markdown sources for agentic workflows, then compile and commit their generated lock files with the pinned GitHub Agentic Workflows CLI:

```bash
gh extension install github/gh-aw --pin v0.91.8
gh aw compile --strict --actionlint --validate
```

The `--actionlint` check requires Docker. The sources explicitly preserve the existing main model fallback and native `detection` model alias, and disable activation-stage blocked-version notification issues so that activation keeps read-only permissions. Compiler version validation still runs and blocks incompatible versions.

The canonical label definitions are stored in `.github/labels.yml`.
