import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"
import { ArrowLeftIcon } from "lucide-react"
import dayjs from "dayjs"
import { publicKnowledgeTurnStatusSchema } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageLayout } from "@/components/shell/page-layout"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { getErrorMessage } from "@/api/error-message"
import { normalizeLanguage } from "@/i18n"
import {
  getPublicKnowledgeManagement,
  getPublicKnowledgeUsage,
  publicKnowledgeKeys,
} from "./api"

export function PublicKnowledgeUsagePage() {
  const { applicationId = "" } = useParams(),
    { t, i18n } = useTranslation(),
    id = useId()
  const [from, setFrom] = useState(() =>
      dayjs().subtract(29, "day").format("YYYY-MM-DD")
    ),
    [to, setTo] = useState(() => dayjs().format("YYYY-MM-DD"))
  const invalid = Boolean(from && to && from > to)
  const management = useQuery({
    queryKey: publicKnowledgeKeys.management(applicationId),
    queryFn: ({ signal }) =>
      getPublicKnowledgeManagement(applicationId, signal),
    enabled: Boolean(applicationId),
  })
  const usage = useQuery({
    queryKey: publicKnowledgeKeys.usage(applicationId, from, to),
    queryFn: ({ signal }) =>
      getPublicKnowledgeUsage(
        applicationId,
        {
          from: from ? dayjs(from).startOf("day").toISOString() : undefined,
          to: to ? dayjs(to).endOf("day").toISOString() : undefined,
        },
        signal
      ),
    enabled: Boolean(applicationId) && !invalid,
  })
  const number = new Intl.NumberFormat(
    normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN",
    { maximumFractionDigits: 2 }
  )
  const report = usage.data,
    finished = report
      ? report.statuses.completed +
        report.statuses.failed +
        report.statuses.interrupted
      : 0
  const metrics = report
    ? [
        { key: "usageVisitors", value: number.format(report.visitors) },
        {
          key: "usageConversations",
          value: number.format(report.conversations),
        },
        { key: "usageQuestions", value: number.format(report.questions) },
        {
          key: "usageSuccessRate",
          value: finished
            ? new Intl.NumberFormat(
                normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN",
                { style: "percent", maximumFractionDigits: 1 }
              ).format(report.statuses.completed / finished)
            : "—",
        },
        {
          key: "usageAverageDuration",
          value:
            report.average_duration_ms === null
              ? "—"
              : t("publicKnowledge.secondsValue", {
                  value: number.format(report.average_duration_ms / 1000),
                }),
        },
      ]
    : []
  return (
    <PageLayout
      title={management.data?.settings.name ?? t("applications.usage.action")}
      description={t("publicKnowledge.usageDescription")}
      actions={
        <Button
          variant="ghost"
          size="sm"
          render={
            <Link to="/capabilities?section=application&scope=personal" />
          }
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {t("applications.usage.backToApplications")}
        </Button>
      }
    >
      <FieldGroup className="grid max-w-xl grid-cols-1 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-from`}>
            {t("publicKnowledge.from")}
          </FieldLabel>
          <Input
            id={`${id}-from`}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-to`}>
            {t("publicKnowledge.to")}
          </FieldLabel>
          <Input
            id={`${id}-to`}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </Field>
      </FieldGroup>
      {invalid ? (
        <StatusBanner variant="error">
          {t("publicKnowledge.invalidDates")}
        </StatusBanner>
      ) : management.isPending || usage.isPending ? (
        <LoadingState />
      ) : management.error || usage.error ? (
        <ErrorState
          message={getErrorMessage(management.error ?? usage.error, t)}
          onRetry={() => {
            void management.refetch()
            void usage.refetch()
          }}
        />
      ) : (
        report && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map((metric) => (
                <Card key={metric.key}>
                  <CardHeader>
                    <CardTitle>
                      <h2>{t(`publicKnowledge.${metric.key}`)}</h2>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{metric.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("publicKnowledge.status")}</TableHead>
                  <TableHead className="text-right">
                    {t("publicKnowledge.usageQuestions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {publicKnowledgeTurnStatusSchema.options.map((status) => (
                  <TableRow key={status}>
                    <TableCell>{t(`publicKnowledge.${status}`)}</TableCell>
                    <TableCell className="text-right">
                      {number.format(report.statuses[status])}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )
      )}
    </PageLayout>
  )
}
