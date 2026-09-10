import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CapabilityRiskSummary } from "@/components/capabilities/capability-risk-summary"
import i18n from "@/i18n"
import appStyles from "@/index.css?raw"

function cssRule(selectorPattern: string) {
  const matches = Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)${selectorPattern}\\s*\\{([^}]*)\\}`, "gu")
    )
  )

  return matches[matches.length - 1]?.[1]
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => cleanup())

describe("CapabilityRiskSummary", () => {
  it("shows MCP environment references grouped by key before installation", () => {
    render(
      <CapabilityRiskSummary
        value={{
          contains_mcp_server: true,
          contains_scripts: false,
          contains_external_connections: true,
          requires_environment_variables: true,
          requires_credentials: true,
          contains_dependency_download_commands: false,
          declared_environment_keys: ["SHARED_TOKEN"],
          mcp_environment_references: [
            {
              mcp_server: "local-search",
              env_key: "SHARED_TOKEN",
              source: "local",
              usage: "stdio_env_var",
              http_header: null,
            },
            {
              mcp_server: "remote-search",
              env_key: "SHARED_TOKEN",
              source: "remote",
              usage: "bearer_token",
              http_header: null,
            },
          ],
          dependency_commands: [],
        }}
      />
    )

    expect(screen.getByText("MCP 环境变量")).toBeVisible()
    expect(screen.getByText("MCP 环境变量")).toHaveClass(
      "capability-risk-summary-mcp-heading"
    )

    const environmentKey = screen.getByText("SHARED_TOKEN", {
      selector: "code",
    })

    expect(environmentKey).toBeVisible()
    expect(environmentKey).toHaveClass("capability-risk-summary-mcp-key")
    expect(environmentKey.closest("li")).toHaveClass(
      "capability-risk-summary-mcp-row"
    )
    expect(screen.getByText("local-search · 由个人凭据提供")).toHaveClass(
      "capability-risk-summary-mcp-source"
    )
    expect(screen.getByText("remote-search · 由远程环境提供")).toHaveClass(
      "capability-risk-summary-mcp-source"
    )
  })

  it("uses compact borderless rows for MCP environment references", () => {
    const listRule = cssRule("\\.capability-risk-summary-mcp-list")
    const sourceRule = cssRule("\\.capability-risk-summary-mcp-source")

    expect(listRule).toContain("padding: 0 0 0 16px;")
    expect(listRule).not.toContain("border:")
    expect(listRule).not.toContain("background:")
    expect(cssRule("\\.capability-risk-summary-mcp-row")).toContain(
      "grid-template-columns: minmax(14rem, 0.9fr) minmax(0, 1fr);"
    )
    expect(cssRule("\\.capability-risk-summary-mcp-heading")).toContain(
      "font-size: inherit;"
    )
    expect(cssRule("\\.capability-risk-summary-mcp-heading")).toContain(
      "font-weight: 500;"
    )
    expect(cssRule("\\.capability-risk-summary-mcp-key")).toContain(
      "font-size: var(--app-font-12);"
    )
    expect(cssRule("\\.capability-risk-summary-mcp-key")).toContain(
      "font-weight: 500;"
    )
    expect(sourceRule).toContain("font-size: var(--app-font-12);")
    expect(sourceRule).not.toContain("border:")
    expect(sourceRule).not.toContain("background:")
  })

  it("shows content-bound findings without exposing matched secret values", () => {
    const secret = `github_pat_${"A".repeat(30)}`
    render(
      <CapabilityRiskSummary
        value={{
          contains_mcp_server: false,
          contains_scripts: false,
          contains_external_connections: false,
          requires_environment_variables: false,
          requires_credentials: false,
          contains_dependency_download_commands: false,
          declared_environment_keys: [],
          mcp_environment_references: [],
          dependency_commands: [],
          supply_chain_review: {
            scanner_version: "1.0.0",
            ruleset_version: "2026-09-10",
            content_digest_algorithm: "linksense-capability-package-v1",
            content_sha256: "a".repeat(64),
            verdict: "blocked",
            highest_severity: "critical",
            finding_count: 1,
            findings: [
              {
                rule_id: "embedded_access_token",
                severity: "critical",
                path: "SKILL.md",
                line: 5,
              },
            ],
            findings_truncated: false,
            scanned_file_count: 1,
            skipped_file_count: 0,
          },
        }}
      />
    )

    expect(screen.getByText("供应链安全扫描")).toBeVisible()
    expect(screen.getByText("已阻止")).toBeVisible()
    expect(screen.getByText("包含高置信访问令牌")).toBeVisible()
    expect(screen.getByText("SKILL.md:5")).toBeVisible()
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })
})
