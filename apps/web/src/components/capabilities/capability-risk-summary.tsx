import type { CapabilityRiskSummary as CapabilityRiskSummaryValue } from "@linksense/shared"
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react"
import { useId } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const riskFlagKeys = [
  "contains_mcp_server",
  "contains_scripts",
  "contains_external_connections",
  "requires_environment_variables",
  "requires_credentials",
  "contains_dependency_download_commands",
] as const

export function CapabilityRiskSummary({
  value,
  compact = false,
}: {
  value: CapabilityRiskSummaryValue
  compact?: boolean
}) {
  const { t } = useTranslation()
  const reviewHeadingId = useId()
  const flags = riskFlagKeys.filter((key) => value[key] === true)
  const environmentKeys = value.declared_environment_keys
  const review = value.supply_chain_review
  const referenceEnvironmentKeys = [
    ...new Set(
      value.mcp_environment_references.map((reference) => reference.env_key)
    ),
  ]
  const referencesByEnvironmentKey = new Map(
    referenceEnvironmentKeys.map((environmentKey) => [
      environmentKey,
      value.mcp_environment_references.filter(
        (reference) => reference.env_key === environmentKey
      ),
    ])
  )

  if (flags.length === 0 && environmentKeys.length === 0 && !review) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("marketplace.noKnownRisks")}
      </p>
    )
  }

  return (
    <div
      className={cn("capability-risk-summary space-y-3", !compact && "mt-2")}
    >
      <div className="flex flex-wrap gap-2">
        {flags.map((flag) => (
          <Badge key={flag} variant="outline">
            {t(`marketplace.risks.${flag}`)}
          </Badge>
        ))}
        {environmentKeys.length > 0 && (
          <Badge variant="outline">
            {t("marketplace.risks.declaredEnvironmentKeys", {
              values: environmentKeys.join(", "),
            })}
          </Badge>
        )}
      </div>
      {!compact && value.mcp_environment_references.length > 0 && (
        <div className="capability-risk-summary-mcp-references">
          <p className="capability-risk-summary-mcp-heading">
            {t("marketplace.risks.mcpEnvironmentReferences")}
          </p>
          <ul className="capability-risk-summary-mcp-list">
            {[...referencesByEnvironmentKey].map(
              ([environmentKey, references]) => (
                <li
                  key={environmentKey}
                  className="capability-risk-summary-mcp-row"
                >
                  <code className="capability-risk-summary-mcp-key">
                    {environmentKey}
                  </code>
                  <div className="capability-risk-summary-mcp-source-list">
                    {references.map((reference, index) => (
                      <span
                        key={`${reference.mcp_server}-${reference.usage}-${reference.http_header ?? ""}-${index}`}
                        className="capability-risk-summary-mcp-source"
                      >
                        {t("marketplace.risks.mcpEnvironmentReference", {
                          server: reference.mcp_server,
                          source: t(
                            `marketplace.risks.environmentSource.${reference.source}`
                          ),
                        })}
                      </span>
                    ))}
                  </div>
                </li>
              )
            )}
          </ul>
        </div>
      )}
      {review && (
        <section
          aria-labelledby={reviewHeadingId}
          className={cn(
            "space-y-3 rounded-xl border p-3",
            review.verdict === "blocked" &&
              "border-destructive/40 bg-destructive/5"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {review.verdict === "passed" ? (
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
            ) : (
              <ShieldAlertIcon
                className={cn(
                  "size-4",
                  review.verdict === "blocked"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              />
            )}
            <h4 id={reviewHeadingId} className="font-medium">
              {t("marketplace.securityReview.title")}
            </h4>
            <Badge
              variant={
                review.verdict === "blocked"
                  ? "destructive"
                  : review.verdict === "passed"
                    ? "secondary"
                    : "outline"
              }
            >
              {t(`marketplace.securityReview.verdict.${review.verdict}`)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("marketplace.securityReview.summary", {
              version: review.scanner_version,
              count: review.finding_count,
            })}
          </p>
          {!compact && review.findings.length > 0 && (
            <ul className="space-y-2">
              {review.findings.map((finding) => (
                <li
                  key={`${finding.rule_id}-${finding.path}-${finding.line ?? "file"}`}
                  className="space-y-1 rounded-lg bg-muted/40 p-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        finding.severity === "critical"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {t(
                        `marketplace.securityReview.severity.${finding.severity}`
                      )}
                    </Badge>
                    <span className="font-medium">
                      {t(
                        `marketplace.securityReview.rules.${finding.rule_id}`
                      )}
                    </span>
                  </div>
                  <code className="block text-xs break-all text-muted-foreground">
                    {finding.line === null
                      ? finding.path
                      : `${finding.path}:${finding.line}`}
                  </code>
                </li>
              ))}
            </ul>
          )}
          {!compact && review.findings_truncated && (
            <p className="text-xs text-muted-foreground">
              {t("marketplace.securityReview.findingsTruncated")}
            </p>
          )}
          {!compact && (
            <code className="block text-xs break-all text-muted-foreground">
              {t("marketplace.securityReview.contentHash", {
                hash: review.content_sha256,
              })}
            </code>
          )}
        </section>
      )}
    </div>
  )
}
