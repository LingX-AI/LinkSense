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
| Variable | `GH_AW_MODEL_AGENT_CODEX` | Codex model identifier |
| Variable | `LINKSENSE_ISSUE_AGENT_ENABLED` | Set to `true` only after the other values are configured |

The checked-in workflow uses OpenAI's standard API endpoint. To use Azure OpenAI or another provider, add a literal `OPENAI_BASE_URL` under `engine.env`, add that endpoint's hostname to `network.allowed`, and recompile the lock files. The provider must expose an OpenAI Responses API-compatible endpoint; never store its key in the workflow source.

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

Edit the Markdown sources for agentic workflows, then compile and commit their generated lock files with the pinned GitHub Agentic Workflows CLI:

```bash
gh extension install github/gh-aw --pin v0.87.10
gh aw compile --strict --actionlint --validate
```

The canonical label definitions are stored in `.github/labels.yml`.
