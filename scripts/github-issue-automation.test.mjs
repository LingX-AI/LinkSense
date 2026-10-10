import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => readFile(path.join(root, file), "utf8")

test("issue forms remain available", async () => {
  const files = await Promise.all([
    read(".github/ISSUE_TEMPLATE/bug-report.yml"),
    read(".github/ISSUE_TEMPLATE/feature-request.yml"),
    read(".github/ISSUE_TEMPLATE/config.yml"),
  ])
  assert.equal(files.length, 3)
  assert.match(files[0], /name: Bug report/u)
  assert.match(files[1], /name: Feature request/u)
  assert.match(files[2], /blank_issues_enabled: false/u)
})

test("deterministic issue workflows pin actions and never close issues", async () => {
  const workflows = await Promise.all([
    read(".github/workflows/issue-intake.yml"),
    read(".github/workflows/needs-info.yml"),
  ])
  for (const workflow of workflows) {
    assert.match(
      workflow,
      /actions\/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3/u,
    )
    assert.doesNotMatch(workflow, /state:\s*["']?closed/u)
    assert.doesNotMatch(workflow, /close-issue/u)
  }
  assert.match(workflows[0], /status:triage/u)
  assert.match(workflows[1], /sevenDays/u)
  assert.match(workflows[1], /This reminder does not close the issue/u)
  assert.match(
    workflows[0],
    /^ {12}Thank you for opening this issue\./mu,
    "the intake comment must remain inside the YAML script block",
  )
  assert.match(
    workflows[1],
    /^ {12}This issue is waiting for the requested information\./mu,
    "the reminder comment must remain inside the YAML script block",
  )
})

test("AI triage can only apply low-risk labels with issue intents", async () => {
  const workflow = await read(".github/workflows/issue-triage.md")
  assert.match(workflow, /roles: all/u)
  assert.match(workflow, /LINKSENSE_ISSUE_AGENT_ENABLED/u)
  assert.match(workflow, /min-integrity: none/u)
  assert.match(workflow, /issue-intent: true/u)
  assert.match(workflow, /- area:\*/u)
  assert.match(workflow, /blocked:[\s\S]*- duplicate/u)
  assert.match(workflow, /blocked:[\s\S]*- priority:\*/u)
  assert.match(workflow, /blocked:[\s\S]*- agent-ready/u)
  assert.doesNotMatch(workflow, /^\s+close-issue:/mu)
})

test("agent-ready is maintainer-gated and creates only a draft PR", async () => {
  const workflow = await read(".github/workflows/agent-ready.md")
  assert.match(workflow, /roles: \[admin, maintain, write\]/u)
  assert.match(workflow, /github\.event\.label\.name == 'agent-ready'/u)
  assert.match(workflow, /create-pull-request:/u)
  assert.match(workflow, /draft: true/u)
  assert.match(workflow, /base-branch: main/u)
  assert.match(workflow, /auto-close-issue: false/u)
  assert.match(workflow, /allowed-branches:[\s\S]*- agent\/\*/u)
  assert.doesNotMatch(workflow, /^\s+(close-issue|merge-pull-request):/mu)
})

for (const workflow of ["issue-triage", "agent-ready"]) {
  test(`${workflow} supplies GPT-6.1 Sol pricing to both guarded API proxies`, async () => {
    const lock = await read(`.github/workflows/${workflow}.lock.yml`)
    const configs = [
      ...lock.matchAll(/printf '%s\\n' "(\{.+)" > "\$\{RUNNER_TEMP\}\/gh-aw\/awf-config\.json"/gu),
    ]
    assert.equal(configs.length, 2, "both the agent and detection proxy must be covered")

    for (const [, escaped] of configs) {
      const config = JSON.parse(
        escaped
          .replaceAll('\\"', '"')
          .replaceAll('\\$', '$')
          .replaceAll('${GH_AW_MAX_AI_CREDITS}', '1000'),
      )
      assert.deepEqual(config.apiProxy.providers?.openai?.models?.["gpt-6.1-sol"]?.cost, {
        input: "2e-06",
        output: "1e-05",
        cache_read: "1e-07",
        cache_write: "2.5e-06",
      })
      assert.ok(config.apiProxy.maxAiCredits > 0, "the spend guard must stay enabled")
      assert.equal(config.apiProxy.modelFallback.enabled, false)
      assert.equal(
        config.apiProxy.defaultAiCreditsPricing,
        undefined,
        "unknown models must still fail closed",
      )
    }
    const agentModel = lock.match(/^\s+GH_AW_MODEL_AGENT_CODEX: (.+)$/mu)?.[1]
    const detectionModel = lock.match(/^\s+GH_AW_MODEL_DETECTION_CODEX: (.+)$/mu)?.[1]
    assert.match(agentModel, /^\$\{\{ vars\.GH_AW_MODEL_AGENT_CODEX/u)
    assert.equal(detectionModel, agentModel, "detection must use the priced model, not an unresolved alias")
  })
}

test("label manifest includes status, area, priority, and approval labels", async () => {
  const labels = await read(".github/labels.yml")
  for (const label of [
    "status:triage",
    "needs-info",
    "agent-ready",
    "agent-generated",
    "area:web",
    "area:api",
    "area:runner",
    "priority:p0",
    "priority:p3",
  ]) {
    assert.match(labels, new RegExp(`name: "${label}"`))
  }
})
