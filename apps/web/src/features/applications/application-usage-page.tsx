import { useId, useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import dayjs from "dayjs"
import "dayjs/locale/en"
import "dayjs/locale/zh-cn"
import { ArrowLeftIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { apiRequest } from "@/api/client"
import {
  applicationUsageReportSchema,
  type ApplicationUsageReport,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { DatePicker } from "@/components/forms/date-picker"
import { FieldShell } from "@/components/forms/form-field"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { PageLayout } from "@/components/shell/page-layout"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { FieldGroup } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { normalizeLanguage, type SupportedLanguage } from "@/i18n"
import {
  calendarDateFormatFor,
  compactDateFormatFor,
  dayjsLocaleFor,
  monthYearFormatFor,
} from "@/i18n/date"
import {
  formatCnyCost,
  formatIntegerCount,
  formatTokenCount,
} from "@/lib/usage-number"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"

type UsageRange = ApplicationUsageReport["range"]
type UsageTrend = ApplicationUsageReport["token_trend"]
type UsageMetric = "tokens" | "cost"

const applicationCenterReturnTo =
  "/capabilities?section=application&scope=personal"

export function ApplicationUsagePage() {
  const { t, i18n } = useTranslation()
  const { applicationId = "" } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [timeZone] = useState(resolveBrowserTimeZone)
  const [defaultDates] = useState(defaultCustomDates)
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const range = readUrlEnum<UsageRange>(
    searchParams,
    "range",
    ["all", "7d", "30d", "custom"],
    "all"
  )
  const customDates = {
    from: validDateParam(searchParams.get("from")) ?? defaultDates.from,
    to: validDateParam(searchParams.get("to")) ?? defaultDates.to,
  }
  const queryParams = useMemo(
    () => ({
      range,
      time_zone: timeZone,
      ...(range === "custom"
        ? { date_from: customDates.from, date_to: customDates.to }
        : {}),
    }),
    [customDates.from, customDates.to, range, timeZone]
  )
  const reportQuery = useQuery({
    queryKey: ["applications", applicationId, "usage", queryParams],
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${applicationId}/usage`, {
        query: queryParams,
        schema: applicationUsageReportSchema,
        signal,
      }),
    enabled: applicationId.length > 0,
    retry: false,
  })
  const updateParams = (updates: Readonly<Record<string, string | null>>) => {
    setSearchParams((current) => updateUrlSearchParams(current, updates), {
      replace: true,
    })
  }
  const report = reportQuery.data

  return (
    <PageLayout
      title={t("applications.usage.title")}
      description={
        report
          ? t("applications.usage.description", {
              name: report.application.name,
            })
          : undefined
      }
      beforeHeader={
        <Link
          to={applicationCenterReturnTo}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {t("applications.usage.backToApplications")}
        </Link>
      }
      afterHeader={
        <UsagePeriodFilter
          range={range}
          customDates={customDates}
          onChange={updateParams}
        />
      }
    >
      {reportQuery.isLoading && <LoadingState />}
      {reportQuery.isError && !report && (
        <ErrorState
          message={getErrorMessage(reportQuery.error, t)}
          onRetry={() => void reportQuery.refetch()}
        />
      )}
      {report && (
        <div className="flex flex-col gap-5">
          {!report.token_coverage.complete_for_period && (
            <StatusBanner
              variant="info"
              title={t("applications.usage.coverageTitle")}
            >
              {t("applications.usage.coverageDescription", {
                date: formatCoverageDate(
                  report.token_coverage.started_at,
                  report.period.time_zone,
                  language
                ),
              })}
            </StatusBanner>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label={t("applications.usage.activeUsers")}
              value={formatIntegerCount(report.active_user_count, language)}
              detail={t("applications.usage.activeUsersHint")}
            />
            <MetricCard
              label={t("usage.tasks")}
              value={formatIntegerCount(report.totals.task_count, language)}
              detail={t("usage.tasksHint")}
            />
            <MetricCard
              label={t("usage.turns")}
              value={formatIntegerCount(report.totals.turn_count, language)}
              detail={t("usage.turnsHint")}
            />
            <MetricCard
              label={t("usage.modelCalls")}
              value={formatIntegerCount(report.totals.request_count, language)}
              detail={t("applications.usage.workloadBreakdownDescription")}
            />
            <MetricCard
              label={t("usage.totalTokens")}
              value={formatTokenCount(
                report.totals.token_usage.total_tokens,
                language
              )}
              detail={t("usage.tokensHint")}
            />
            <MetricCard
              label={t("usage.totalCost")}
              value={formatCnyCost(report.totals.cost.total_cost, language)}
              detail={
                report.totals.cost.unpriced_tokens === "0"
                  ? t("usage.costHint")
                  : t("usage.unpricedTokensHint", {
                      tokens: formatTokenCount(
                        report.totals.cost.unpriced_tokens,
                        language
                      ),
                    })
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <UsageTrendCard trend={report.token_trend} metric="tokens" />
            <UsageTrendCard trend={report.token_trend} metric="cost" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <CompositionCard
              title={t("applications.usage.tokenBreakdownTitle")}
              note={t("usage.tokenCompositionNote")}
              items={[
                {
                  label: t("usage.inputTokens"),
                  value: formatTokenCount(
                    report.totals.token_usage.input_tokens,
                    language
                  ),
                },
                {
                  label: t("usage.cachedInputTokens"),
                  value: formatTokenCount(
                    report.totals.token_usage.cached_input_tokens,
                    language
                  ),
                },
                {
                  label: t("usage.outputTokens"),
                  value: formatTokenCount(
                    report.totals.token_usage.output_tokens,
                    language
                  ),
                },
                {
                  label: t("usage.reasoningOutputTokens"),
                  value: formatTokenCount(
                    report.totals.token_usage.reasoning_output_tokens,
                    language
                  ),
                },
              ]}
            />
            <CompositionCard
              title={t("applications.usage.costBreakdownTitle")}
              note={t("usage.costCompositionNote")}
              items={[
                {
                  label: t("usage.inputCost"),
                  value: formatCnyCost(report.totals.cost.input_cost, language),
                },
                {
                  label: t("usage.cachedInputCost"),
                  value: formatCnyCost(
                    report.totals.cost.cached_input_cost,
                    language
                  ),
                },
                {
                  label: t("usage.outputCost"),
                  value: formatCnyCost(
                    report.totals.cost.output_cost,
                    language
                  ),
                },
                {
                  label: t("applications.usage.unpricedTokens"),
                  value: formatTokenCount(
                    report.totals.cost.unpriced_tokens,
                    language
                  ),
                },
              ]}
            />
          </div>

          <Tabs defaultValue="models">
            <TabsList aria-label={t("usage.tabsLabel")}>
              <TabsTrigger value="models">{t("usage.tabs.models")}</TabsTrigger>
              <TabsTrigger value="workloads">
                {t("usage.tabs.workloads")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="models">
              <BreakdownCard
                title={t("usage.modelsTitle")}
                description={t("applications.usage.modelBreakdownDescription")}
              >
                <ModelUsageTable report={report} />
              </BreakdownCard>
            </TabsContent>
            <TabsContent value="workloads">
              <BreakdownCard
                title={t("usage.workloadsTitle")}
                description={t(
                  "applications.usage.workloadBreakdownDescription"
                )}
              >
                <WorkloadUsageTable report={report} />
              </BreakdownCard>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </PageLayout>
  )
}

function UsagePeriodFilter({
  range,
  customDates,
  onChange,
}: {
  range: UsageRange
  customDates: { from: string; to: string }
  onChange: (updates: Readonly<Record<string, string | null>>) => void
}) {
  const { t } = useTranslation()
  const rangeItems = [
    { value: "all", label: t("usage.ranges.all") },
    { value: "7d", label: t("usage.ranges.sevenDays") },
    { value: "30d", label: t("usage.ranges.thirtyDays") },
    { value: "custom", label: t("usage.ranges.custom") },
  ]

  return (
    <Card>
      <CardContent>
        <FieldGroup className="grid gap-3 md:grid-cols-3">
          <FieldShell
            id="application-usage-range"
            label={t("usage.rangeLabel")}
          >
            <Select
              items={rangeItems}
              value={range}
              onValueChange={(value) =>
                onChange({ range: value === "all" ? null : value })
              }
            >
              <SelectTrigger
                id="application-usage-range"
                aria-label={t("usage.rangeLabel")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {rangeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldShell>
          {range === "custom" && (
            <>
              <FieldShell
                id="application-usage-date-from"
                label={t("usage.customRange.dateFrom")}
              >
                <DatePicker
                  id="application-usage-date-from"
                  value={customDates.from}
                  max={customDates.to}
                  placeholder={t("usage.customRange.selectDate")}
                  clearLabel={t("usage.customRange.clearDate")}
                  clearable={false}
                  onValueChange={(value) => onChange({ from: value })}
                />
              </FieldShell>
              <FieldShell
                id="application-usage-date-to"
                label={t("usage.customRange.dateTo")}
              >
                <DatePicker
                  id="application-usage-date-to"
                  value={customDates.to}
                  min={customDates.from}
                  max={dayjs().format("YYYY-MM-DD")}
                  placeholder={t("usage.customRange.selectDate")}
                  clearLabel={t("usage.customRange.clearDate")}
                  clearable={false}
                  onValueChange={(value) => onChange({ to: value })}
                />
              </FieldShell>
            </>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail: string
}) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function UsageTrendCard({
  trend,
  metric,
}: {
  trend: UsageTrend
  metric: UsageMetric
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const isTokens = metric === "tokens"
  const chartData = useMemo(
    () =>
      trend.points.map((point) => ({
        period: point.period_start,
        value: Number(
          isTokens ? point.token_usage.total_tokens : point.cost.total_cost
        ),
      })),
    [isTokens, trend.points]
  )
  const chartId = useId().replace(/:/gu, "")
  const chartConfig = {
    value: {
      label: t(isTokens ? "usage.totalTokens" : "usage.totalCost"),
      color: isTokens
        ? "var(--app-usage-token-assistant)"
        : "var(--app-usage-cost-assistant)",
    },
  } satisfies ChartConfig

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t(isTokens ? "usage.trend.title" : "usage.costTrend.title")}
          <Badge variant="outline">
            {t(`usage.trend.granularity.${trend.granularity}`)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyState
            title={t(isTokens ? "usage.trend.empty" : "usage.costTrend.empty")}
          />
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[280px] w-full"
            role="img"
            aria-label={t(
              isTokens ? "usage.trend.ariaLabel" : "usage.costTrend.ariaLabel"
            )}
          >
            <AreaChart
              accessibilityLayer
              data={chartData}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id={`application-usage-${metric}-${chartId}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="var(--color-value)"
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-value)"
                    stopOpacity={0.03}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 5" />
              <XAxis
                dataKey="period"
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                minTickGap={32}
                tickFormatter={(value: string) =>
                  formatTrendPeriod(value, trend.granularity, language)
                }
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={isTokens ? 56 : 72}
                tickFormatter={(value: number) =>
                  isTokens
                    ? formatTokenCount(value, language)
                    : formatCnyCost(value, language)
                }
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
                content={({ active, label }) => {
                  const point = trend.points.find(
                    (candidate) => candidate.period_start === String(label)
                  )
                  if (!active || !point) return null
                  const value = isTokens
                    ? formatTokenCount(point.token_usage.total_tokens, language)
                    : formatCnyCost(point.cost.total_cost, language)
                  return (
                    <div className="grid gap-1 rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5">
                      <span className="font-medium">
                        {formatTrendPeriod(
                          point.period_start,
                          trend.granularity,
                          language,
                          false
                        )}
                      </span>
                      <span className="font-mono tabular-nums">{value}</span>
                    </div>
                  )
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                fill={`url(#application-usage-${metric}-${chartId})`}
                strokeWidth={2.25}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function CompositionCard({
  title,
  note,
  items,
}: {
  title: string
  note: string
  items: Array<{ label: string; value: string }>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.label} className="rounded-xl bg-muted/50 p-3">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 font-mono text-lg font-medium tabular-nums">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}

function BreakdownCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description} {t("usage.tableCostUnit")}
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function ModelUsageTable({ report }: { report: ApplicationUsageReport }) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  if (report.models.length === 0) {
    return <EmptyState title={t("usage.modelsEmpty")} />
  }

  return (
    <div className="data-table-scroll">
      <Table aria-label={t("usage.modelBreakdown")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.model")}</TableHead>
            <TableHead className="text-right">
              {t("usage.modelCalls")}
            </TableHead>
            <TableHead className="text-right">{t("usage.turns")}</TableHead>
            <TableHead className="text-right">
              {t("usage.totalTokens")}
            </TableHead>
            <TableHead className="text-right">{t("usage.totalCost")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.models.map((model) => (
            <TableRow key={`${model.model_kind}:${model.model_id}`}>
              <TableCell>
                <span className="block font-medium">
                  {model.display_name ??
                    (model.model_id === "__unknown__"
                      ? t("usage.unknownModel")
                      : model.model_id)}
                </span>
                {model.display_name &&
                  model.display_name !== model.model_id && (
                    <span className="block text-xs text-muted-foreground">
                      {model.model_id}
                    </span>
                  )}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`usage.modelKinds.${model.model_kind}`)} ·{" "}
                  {model.workload_types
                    .map((workload) => t(`usage.workloads.${workload}`))
                    .join(", ")}
                </span>
              </TableCell>
              <NumberCell value={model.request_count} language={language} />
              <NumberCell value={model.turn_count} language={language} />
              <NumberCell
                value={model.token_usage.total_tokens}
                language={language}
                tokens
              />
              <TableCell className="text-right font-mono tabular-nums">
                {formatCnyCost(model.cost.total_cost, language)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function WorkloadUsageTable({ report }: { report: ApplicationUsageReport }) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  if (report.workloads.length === 0) {
    return <EmptyState title={t("usage.workloadsEmpty")} />
  }

  return (
    <div className="data-table-scroll">
      <Table aria-label={t("usage.workloadsTitle")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.workload")}</TableHead>
            <TableHead>{t("usage.measurementMethod")}</TableHead>
            <TableHead className="text-right">
              {t("usage.modelCalls")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.totalTokens")}
            </TableHead>
            <TableHead className="text-right">{t("usage.totalCost")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.workloads.map((workload) => (
            <TableRow key={workload.workload}>
              <TableCell>{t(`usage.workloads.${workload.workload}`)}</TableCell>
              <TableCell className="text-muted-foreground">
                {workload.measurement_methods
                  .map((method) => t(`usage.measurementMethods.${method}`))
                  .join(", ")}
              </TableCell>
              <NumberCell value={workload.request_count} language={language} />
              <NumberCell
                value={workload.token_usage.total_tokens}
                language={language}
                tokens
              />
              <TableCell className="text-right font-mono tabular-nums">
                {formatCnyCost(workload.cost.total_cost, language)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function NumberCell({
  value,
  language,
  tokens = false,
}: {
  value: number | string
  language: SupportedLanguage
  tokens?: boolean
}) {
  return (
    <TableCell className="text-right font-mono tabular-nums">
      {tokens
        ? formatTokenCount(value, language)
        : formatIntegerCount(value, language)}
    </TableCell>
  )
}

function formatTrendPeriod(
  value: string,
  granularity: UsageTrend["granularity"],
  language: SupportedLanguage,
  compact = true
): string {
  const parsed = dayjs(value).locale(dayjsLocaleFor(language))
  if (!parsed.isValid()) return value
  if (granularity === "year") return parsed.format("YYYY")
  if (granularity === "month") {
    return parsed.format(monthYearFormatFor(language))
  }
  if (compact) return parsed.format(compactDateFormatFor(language))
  return parsed.format(calendarDateFormatFor(language))
}

function formatCoverageDate(
  value: string,
  timeZone: string,
  language: SupportedLanguage
): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date)
}

function defaultCustomDates(): { from: string; to: string } {
  const today = dayjs()
  return {
    from: today.subtract(29, "day").format("YYYY-MM-DD"),
    to: today.format("YYYY-MM-DD"),
  }
}

function validDateParam(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined
  return dayjs(value).isValid() ? value : undefined
}

function resolveBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}
