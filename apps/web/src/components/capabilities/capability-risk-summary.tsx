import type { CapabilityRiskSummary as CapabilityRiskSummaryValue } from "@linksense/shared"
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
  const flags = riskFlagKeys.filter((key) => value[key] === true)
  const environmentKeys = value.declared_environment_keys
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

  if (flags.length === 0 && environmentKeys.length === 0) {
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
    </div>
  )
}
