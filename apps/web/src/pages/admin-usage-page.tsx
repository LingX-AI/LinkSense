import { useId, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import dayjs from "dayjs"
import "dayjs/locale/en"
import "dayjs/locale/zh-cn"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  SearchIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { apiRequest, downloadApiFile } from "@/api/client"
import {
  usageAnalyticsReportSchema,
  type UsageAnalyticsReport,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { productFilenamePrefix, useProductName } from "@/app/product-branding"
import { notify } from "@/components/feedback/notification"
import { DatePicker } from "@/components/forms/date-picker"
import { FieldShell } from "@/components/forms/form-field"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { PageLayout } from "@/components/shell/page-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group"
import { SearchInput } from "@/components/ui/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { normalizeLanguage } from "@/i18n"
import {
  allocateCnyMinorUnits,
  formatCnyCost,
  formatCnyMinorUnits,
  formatIntegerCount,
  formatTokenCount,
} from "@/lib/usage-number"
import { downloadBlob } from "@/lib/download-blob"
import { cn } from "@/lib/utils"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"
import { BillingStatementsPanel } from "@/features/usage/billing-statements-panel"

type UsageRange = UsageAnalyticsReport["range"]
type ModelUsage = UsageAnalyticsReport["models"][number]
type ApplicationUsage = UsageAnalyticsReport["applications"][number]
type GroupUsage = UsageAnalyticsReport["groups"][number]
type UserUsage = UsageAnalyticsReport["users"][number]
type TokenTrend = UsageAnalyticsReport["token_trend"]
type TokenTrendPoint = TokenTrend["points"][number]
type WorkloadUsage = UsageAnalyticsReport["workloads"][number]
type UsageWorkload = WorkloadUsage["workload"]
type UsageChartMetric = "tokens" | "cost"
type SortDirection = "asc" | "desc"
type SortState<Key extends string> = {
  key: Key
  direction: SortDirection
}
type SortValue =
  | { type: "decimal"; value: string }
  | { type: "integer"; value: number | string }
  | { type: "text"; value: string }
type ModelSortKey =
  | "model"
  | "modelCalls"
  | "totalTokens"
  | "totalCost"
  | "turns"
  | "inputTokens"
  | "inputCost"
  | "cachedInputTokens"
  | "cachedInputCost"
  | "outputTokens"
  | "outputCost"
  | "reasoningOutputTokens"
type WorkloadSortKey =
  | "workload"
  | "measurementMethod"
  | "modelCalls"
  | "totalTokens"
  | "inputTokens"
  | "cachedInputTokens"
  | "outputTokens"
  | "totalCost"
type ApplicationSortKey =
  "application" | "tasks" | "turns" | "modelCalls" | "totalTokens" | "totalCost"
type GroupSortKey =
  "group" | "members" | "tasks" | "turns" | "totalTokens" | "totalCost"
type UserSortKey =
  "user" | "group" | "tasks" | "turns" | "totalTokens" | "totalCost"

const ungroupedSelectionKey = "__ungrouped__"
const unattributedApplicationSelectionKey = "__unattributed__"
const unknownModelId = "__unknown__"
const usageWorkloads: UsageWorkload[] = [
  "assistant_response",
  "memory_generation",
  "task_title_generation",
  "document_embedding",
  "query_embedding",
  "rerank",
  "image_generation",
]
const usageChartColors: Record<
  UsageChartMetric,
  Record<UsageWorkload, string>
> = {
  tokens: {
    assistant_response: "var(--app-usage-token-assistant)",
    memory_generation: "var(--app-usage-token-memory)",
    task_title_generation: "var(--app-usage-token-memory)",
    document_embedding: "var(--app-usage-token-document)",
    query_embedding: "var(--app-usage-token-query)",
    rerank: "var(--app-usage-token-rerank)",
    image_generation: "var(--app-usage-token-image)",
  },
  cost: {
    assistant_response: "var(--app-usage-cost-assistant)",
    memory_generation: "var(--app-usage-cost-memory)",
    task_title_generation: "var(--app-usage-cost-memory)",
    document_embedding: "var(--app-usage-cost-document)",
    query_embedding: "var(--app-usage-cost-query)",
    rerank: "var(--app-usage-cost-rerank)",
    image_generation: "var(--app-usage-cost-image)",
  },
}

const usageChartDotClasses: Record<
  UsageChartMetric,
  Record<UsageWorkload, string>
> = {
  tokens: {
    assistant_response: "bg-[var(--app-usage-token-assistant)]",
    memory_generation: "bg-[var(--app-usage-token-memory)]",
    task_title_generation: "bg-[var(--app-usage-token-memory)]",
    document_embedding: "bg-[var(--app-usage-token-document)]",
    query_embedding: "bg-[var(--app-usage-token-query)]",
    rerank: "bg-[var(--app-usage-token-rerank)]",
    image_generation: "bg-[var(--app-usage-token-image)]",
  },
  cost: {
    assistant_response: "bg-[var(--app-usage-cost-assistant)]",
    memory_generation: "bg-[var(--app-usage-cost-memory)]",
    task_title_generation: "bg-[var(--app-usage-cost-memory)]",
    document_embedding: "bg-[var(--app-usage-cost-document)]",
    query_embedding: "bg-[var(--app-usage-cost-query)]",
    rerank: "bg-[var(--app-usage-cost-rerank)]",
    image_generation: "bg-[var(--app-usage-cost-image)]",
  },
}

export function UsageAnalyticsPage() {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [searchParams, setSearchParams] = useSearchParams()
  const range = readUrlEnum<UsageRange>(
    searchParams,
    "range",
    ["all", "7d", "30d", "custom"],
    "all"
  )
  const [timeZone] = useState(resolveBrowserTimeZone)
  const [defaultDates] = useState(defaultCustomDates)
  const customDates = {
    from: validDateParam(searchParams.get("from")) ?? defaultDates.from,
    to: validDateParam(searchParams.get("to")) ?? defaultDates.to,
  }
  const selectedGroupKey = searchParams.get("group")
  const selectedApplicationKey = searchParams.get("application")
  const selectedUserId = searchParams.get("user")
  const userSearch = searchParams.get("user_search") ?? ""
  const [exporting, setExporting] = useState(false)
  const section = readUrlEnum(
    searchParams,
    "section",
    ["analytics", "billing"],
    "analytics"
  )
  const detailTab = readUrlEnum(
    searchParams,
    "tab",
    ["models", "workloads", "applications", "groups", "users"],
    "models"
  )
  const updateUsageParams = (
    updates: Readonly<Record<string, string | null>>
  ) => {
    setSearchParams((current) => updateUrlSearchParams(current, updates), {
      replace: true,
    })
  }
  const exportingRef = useRef(false)
  const reportQueryParams = useMemo(
    () => ({
      range,
      time_zone: timeZone,
      ...(range === "custom"
        ? {
            date_from: customDates.from,
            date_to: customDates.to,
          }
        : {}),
    }),
    [customDates.from, customDates.to, range, timeZone]
  )
  const reportQuery = useQuery({
    queryKey: ["admin", "usage", reportQueryParams],
    queryFn: ({ signal }) =>
      apiRequest("/admin/usage", {
        schema: usageAnalyticsReportSchema,
        query: reportQueryParams,
        signal,
      }),
    enabled: section === "analytics",
  })

  const report = reportQuery.data
  const selectedGroup = report
    ? (report.groups.find(
        (group) => groupSelectionKey(group) === selectedGroupKey
      ) ?? report.groups[0])
    : undefined
  const selectedApplication = report
    ? (report.applications.find(
        (application) =>
          applicationSelectionKey(application) === selectedApplicationKey
      ) ?? report.applications[0])
    : undefined
  const normalizedUserSearch = userSearch.trim().toLocaleLowerCase()
  const visibleUsers = useMemo(
    () =>
      (report?.users ?? []).filter((user) =>
        `${user.name} ${user.email}`
          .toLocaleLowerCase()
          .includes(normalizedUserSearch)
      ),
    [normalizedUserSearch, report?.users]
  )
  const selectedUser = report
    ? (visibleUsers.find((user) => user.user_id === selectedUserId) ??
      visibleUsers[0])
    : undefined
  const userCostMinorUnitsById = report
    ? allocateUserCostMinorUnits(report)
    : new Map<string, bigint>()
  const rangeLabel =
    range === "all"
      ? t("usage.ranges.all")
      : range === "7d"
        ? t("usage.ranges.sevenDays")
        : range === "30d"
          ? t("usage.ranges.thirtyDays")
          : t("usage.ranges.custom")

  const exportUsage = async () => {
    if (exportingRef.current) return
    exportingRef.current = true
    setExporting(true)
    try {
      const source = await downloadApiFile(
        "/admin/usage/export.xlsx",
        reportQueryParams
      )
      downloadBlob(
        source,
        t("usage.export.filename", {
          productPrefix: productFilenamePrefix(productName),
          date: dayjs().format("YYYY-MM-DD"),
        })
      )
      notify.success(t("usage.export.success"), {
        id: "usage-export-success",
      })
    } catch (error) {
      notify.error(getErrorMessage(error, t), { id: "usage-export-error" })
    } finally {
      exportingRef.current = false
      setExporting(false)
    }
  }

  return (
    <PageLayout
      title={t("usage.title")}
      description={
        section === "billing"
          ? t("usage.billing.pageDescription")
          : t("usage.description")
      }
      actions={
        section === "analytics" ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={exporting}
              onClick={() => void exportUsage()}
            >
              {exporting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              {t(exporting ? "usage.export.exporting" : "usage.export.action")}
            </Button>
            <Select
              value={range}
              onValueChange={(value) => {
                if (
                  value === "all" ||
                  value === "7d" ||
                  value === "30d" ||
                  value === "custom"
                ) {
                  updateUsageParams({
                    range: value === "all" ? null : value,
                    from: value === "custom" ? customDates.from : null,
                    to: value === "custom" ? customDates.to : null,
                  })
                }
              }}
            >
              <SelectTrigger
                aria-label={t("usage.rangeLabel")}
                className="min-w-36"
              >
                <SelectValue>
                  <span className="truncate">{rangeLabel}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  <SelectItem value="all">{t("usage.ranges.all")}</SelectItem>
                  <SelectItem value="7d">
                    {t("usage.ranges.sevenDays")}
                  </SelectItem>
                  <SelectItem value="30d">
                    {t("usage.ranges.thirtyDays")}
                  </SelectItem>
                  <SelectItem value="custom">
                    {t("usage.ranges.custom")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : undefined
      }
      afterHeader={
        <div className="space-y-4">
          <Tabs
            value={section}
            onValueChange={(value) => {
              if (value === "analytics" || value === "billing") {
                updateUsageParams({
                  section: value === "analytics" ? null : value,
                })
              }
            }}
          >
            <TabsList aria-label={t("usage.sectionLabel")}>
              <TabsTrigger value="analytics">
                {t("usage.sections.analytics")}
              </TabsTrigger>
              <TabsTrigger value="billing">
                {t("usage.sections.billing")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {section === "analytics" && range === "custom" ? (
            <Card size="sm" className="max-w-2xl">
              <CardContent>
                <FieldGroup className="grid gap-3 sm:grid-cols-2">
                  <FieldShell
                    id="usage-date-from"
                    label={t("usage.customRange.dateFrom")}
                  >
                    <DatePicker
                      id="usage-date-from"
                      value={customDates.from}
                      max={customDates.to}
                      placeholder={t("usage.customRange.selectDate")}
                      clearLabel={t("usage.customRange.clearDate")}
                      clearable={false}
                      onValueChange={(value) =>
                        updateUsageParams({ from: value })
                      }
                    />
                  </FieldShell>
                  <FieldShell
                    id="usage-date-to"
                    label={t("usage.customRange.dateTo")}
                  >
                    <DatePicker
                      id="usage-date-to"
                      value={customDates.to}
                      min={customDates.from}
                      max={dayjs().format("YYYY-MM-DD")}
                      placeholder={t("usage.customRange.selectDate")}
                      clearLabel={t("usage.customRange.clearDate")}
                      clearable={false}
                      onValueChange={(value) =>
                        updateUsageParams({ to: value })
                      }
                    />
                  </FieldShell>
                </FieldGroup>
              </CardContent>
            </Card>
          ) : null}
        </div>
      }
    >
      {section === "billing" && (
        <BillingStatementsPanel productName={productName} language={language} />
      )}
      {section === "analytics" && reportQuery.isLoading && <LoadingState />}
      {section === "analytics" && reportQuery.isError && !report && (
        <ErrorState
          message={getErrorMessage(reportQuery.error, t)}
          onRetry={() => void reportQuery.refetch()}
        />
      )}
      {section === "analytics" && report && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
              currency
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
            <TokenTrendChart trend={report.token_trend} />
            <CostTrendChart trend={report.token_trend} />
          </div>

          <Tabs
            value={detailTab}
            onValueChange={(value) =>
              updateUsageParams({ tab: value === "models" ? null : value })
            }
          >
            <TabsList aria-label={t("usage.tabsLabel")} variant="line">
              <TabsTrigger value="models">{t("usage.tabs.models")}</TabsTrigger>
              <TabsTrigger value="workloads">
                {t("usage.tabs.workloads")}
              </TabsTrigger>
              <TabsTrigger value="applications">
                {t("usage.tabs.applications")}
              </TabsTrigger>
              <TabsTrigger value="groups">{t("usage.tabs.groups")}</TabsTrigger>
              <TabsTrigger value="users">{t("usage.tabs.users")}</TabsTrigger>
            </TabsList>

            <TabsContent value="models">
              <section className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <CardTitle>{t("usage.modelsTitle")}</CardTitle>
                  <CardDescription>
                    {t("usage.modelsDescription")} {t("usage.tableCostUnit")}
                  </CardDescription>
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                  <ModelUsageTable
                    models={report.models}
                    totalCost={report.totals.cost.total_cost}
                  />
                </div>
              </section>
            </TabsContent>

            <TabsContent value="workloads">
              <section className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <CardTitle>{t("usage.workloadsTitle")}</CardTitle>
                  <CardDescription>
                    {t("usage.workloadsDescription")} {t("usage.tableCostUnit")}
                  </CardDescription>
                </div>
                <div className="flex min-w-0 flex-col gap-3">
                  <WorkloadUsageTable
                    workloads={report.workloads}
                    totalCost={report.totals.cost.total_cost}
                  />
                </div>
              </section>
            </TabsContent>

            <TabsContent value="applications">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
                <section className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <CardTitle>{t("usage.applicationsTitle")}</CardTitle>
                    <CardDescription>
                      {t("usage.applicationsDescription")}{" "}
                      {t("usage.tableCostUnit")}
                    </CardDescription>
                  </div>
                  <div className="flex min-w-0 flex-col gap-3">
                    <ApplicationUsageTable
                      applications={report.applications}
                      selectedKey={applicationSelectionKey(selectedApplication)}
                      onSelect={(application) =>
                        updateUsageParams({
                          application: applicationSelectionKey(application),
                        })
                      }
                    />
                  </div>
                </section>
                <UsageDetailCard
                  title={
                    selectedApplication
                      ? displayApplicationName(selectedApplication, t)
                      : t("usage.noSelection")
                  }
                  description={
                    selectedApplication
                      ? t("usage.applicationDetailDescription")
                      : t("usage.noSelection")
                  }
                  metrics={selectedApplication?.metrics}
                  models={selectedApplication?.models ?? []}
                />
              </div>
            </TabsContent>

            <TabsContent value="groups">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
                <section className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {t("usage.groupsTitle")}
                      <Badge variant="outline">
                        {t("usage.currentMembership")}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {t("usage.groupsDescription")} {t("usage.tableCostUnit")}
                    </CardDescription>
                  </div>
                  <div className="flex min-w-0 flex-col gap-3">
                    <GroupUsageTable
                      groups={report.groups}
                      selectedKey={groupSelectionKey(selectedGroup)}
                      onSelect={(group) =>
                        updateUsageParams({ group: groupSelectionKey(group) })
                      }
                    />
                  </div>
                </section>
                <UsageDetailCard
                  title={
                    selectedGroup
                      ? displayGroupName(selectedGroup, t)
                      : t("usage.noSelection")
                  }
                  description={
                    selectedGroup
                      ? t("usage.groupDetailDescription", {
                          count: selectedGroup.member_count,
                        })
                      : t("usage.noSelection")
                  }
                  metrics={selectedGroup?.metrics}
                  models={selectedGroup?.models ?? []}
                />
              </div>
            </TabsContent>

            <TabsContent value="users">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(24rem,0.8fr)]">
                <section className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <CardTitle>{t("usage.usersTitle")}</CardTitle>
                    <CardDescription>
                      {t("usage.usersDescription")} {t("usage.tableCostUnit")}
                    </CardDescription>
                  </div>
                  <div className="flex min-w-0 flex-col gap-3">
                    <InputGroup className="max-w-sm">
                      <InputGroupAddon>
                        <SearchIcon aria-hidden="true" />
                      </InputGroupAddon>
                      <SearchInput
                        value={userSearch}
                        onValueChange={(value) =>
                          updateUsageParams({
                            user_search: value,
                          })
                        }
                        aria-label={t("usage.searchUsers")}
                        placeholder={t("usage.searchUsers")}
                      />
                    </InputGroup>
                    <UserUsageTable
                      users={visibleUsers}
                      selectedUserId={selectedUser?.user_id ?? null}
                      costMinorUnitsByUserId={userCostMinorUnitsById}
                      onSelect={(user) =>
                        updateUsageParams({ user: user.user_id })
                      }
                    />
                  </div>
                </section>
                <UsageDetailCard
                  title={selectedUser?.name ?? t("usage.noSelection")}
                  description={
                    selectedUser
                      ? `${selectedUser.email} · ${displayUserGroups(
                          selectedUser,
                          t
                        )}`
                      : t("usage.noSelection")
                  }
                  metrics={selectedUser?.metrics}
                  models={selectedUser?.models ?? []}
                  totalCostMinorUnits={
                    selectedUser
                      ? userCostMinorUnitsById.get(selectedUser.user_id)
                      : undefined
                  }
                />
              </div>
            </TabsContent>
          </Tabs>

          <p className="text-xs leading-5 text-muted-foreground">
            {t("usage.tokenCompositionNote")} {t("usage.costCompositionNote")}
          </p>
        </div>
      )}
    </PageLayout>
  )
}

function TokenTrendChart({ trend }: { trend: TokenTrend }) {
  return <UsageTrendChart trend={trend} metric="tokens" />
}

function CostTrendChart({ trend }: { trend: TokenTrend }) {
  return <UsageTrendChart trend={trend} metric="cost" />
}

function UsageTrendChart({
  trend,
  metric,
}: {
  trend: TokenTrend
  metric: UsageChartMetric
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const chartData = useMemo(
    () =>
      trend.points.map((point) => ({
        period_start: point.period_start,
        ...Object.fromEntries(
          usageWorkloads.map((workload) => [
            workload,
            Number(trendWorkloadValue(point, workload, metric)),
          ])
        ),
      })),
    [metric, trend.points]
  )
  const visibleWorkloads = useMemo(
    () =>
      new Set(
        usageWorkloads.filter((workload) =>
          trend.points.some(
            (point) => Number(trendWorkloadValue(point, workload, metric)) > 0
          )
        )
      ),
    [metric, trend.points]
  )
  const chartConfig = Object.fromEntries(
    usageWorkloads.map((workload) => [
      workload,
      {
        label: t(`usage.workloads.${workload}`),
        color: usageChartColors[metric][workload],
      },
    ])
  ) as ChartConfig
  const granularityLabel = t(`usage.trend.granularity.${trend.granularity}`)
  const isTokenChart = metric === "tokens"
  const chartId = useId().replace(/:/gu, "")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t(isTokenChart ? "usage.trend.title" : "usage.costTrend.title")}
          <Badge variant="outline">{granularityLabel}</Badge>
        </CardTitle>
        <CardDescription>
          {t(
            isTokenChart
              ? "usage.trend.description"
              : "usage.costTrend.description",
            { granularity: granularityLabel }
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <TrendLegend metric={metric} visibleWorkloads={visibleWorkloads} />
        {chartData.length === 0 ? (
          <div className="grid h-64 place-items-center text-sm text-muted-foreground">
            {t(isTokenChart ? "usage.trend.empty" : "usage.costTrend.empty")}
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[280px] w-full"
            role="img"
            aria-label={t(
              isTokenChart
                ? "usage.trend.ariaLabel"
                : "usage.costTrend.ariaLabel"
            )}
          >
            <AreaChart
              accessibilityLayer
              data={chartData}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            >
              <defs>
                {usageWorkloads.map((workload) => (
                  <linearGradient
                    key={workload}
                    id={usageGradientId(chartId, metric, workload)}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={`var(--color-${workload})`}
                      stopOpacity={0.34}
                    />
                    <stop
                      offset="100%"
                      stopColor={`var(--color-${workload})`}
                      stopOpacity={0.03}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                vertical={false}
                stroke="var(--app-usage-chart-grid)"
                strokeDasharray="3 5"
              />
              <XAxis
                dataKey="period_start"
                axisLine={false}
                tickLine={false}
                tickMargin={10}
                minTickGap={32}
                tickFormatter={(value: string) =>
                  formatTrendPeriod(value, trend.granularity, language, true)
                }
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={isTokenChart ? 56 : 76}
                tick={
                  isTokenChart ? undefined : (
                    <CurrencyYAxisTick language={language} />
                  )
                }
                tickFormatter={
                  isTokenChart
                    ? (value: number) => formatTokenCount(value, language)
                    : undefined
                }
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }}
                content={({ active, label }) => (
                  <UsageTrendTooltip
                    active={active}
                    language={language}
                    granularity={trend.granularity}
                    metric={metric}
                    point={trend.points.find(
                      (candidate) => candidate.period_start === String(label)
                    )}
                  />
                )}
              />
              {usageWorkloads.map((workload) => {
                const isVisible = visibleWorkloads.has(workload)
                return (
                  <Area
                    key={workload}
                    type="monotone"
                    dataKey={workload}
                    stackId="usage"
                    stroke={
                      isVisible ? `var(--color-${workload})` : "transparent"
                    }
                    fill={
                      isVisible
                        ? `url(#${usageGradientId(chartId, metric, workload)})`
                        : "transparent"
                    }
                    strokeWidth={2.25}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={false}
                    activeDot={
                      isVisible
                        ? {
                            r: 4,
                            stroke: "var(--card)",
                            strokeWidth: 2,
                          }
                        : false
                    }
                    isAnimationActive={false}
                  />
                )
              })}
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function TrendLegend({
  metric,
  visibleWorkloads,
}: {
  metric: UsageChartMetric
  visibleWorkloads: ReadonlySet<UsageWorkload>
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {usageWorkloads.map((workload) => (
        <span key={workload} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            data-metric={metric}
            data-workload={workload}
            data-has-values={visibleWorkloads.has(workload)}
            className={cn(
              "size-2 rounded-[2px]",
              workloadDotClass(metric, workload)
            )}
          />
          {t(`usage.workloads.${workload}`)}
        </span>
      ))}
    </div>
  )
}

function UsageTrendTooltip({
  active,
  point,
  granularity,
  language,
  metric,
}: {
  active: boolean | undefined
  point: TokenTrendPoint | undefined
  granularity: TokenTrend["granularity"]
  language: "zh-CN" | "en-US"
  metric: UsageChartMetric
}) {
  const { t } = useTranslation()
  if (!active || !point) return null

  const rows = usageWorkloads.map((workload) => ({
    workload,
    label: t(`usage.workloads.${workload}`),
    value: trendWorkloadValue(point, workload, metric),
  }))
  const total =
    metric === "tokens" ? point.token_usage.total_tokens : point.cost.total_cost
  const allocatedCostMinorUnits =
    metric === "cost"
      ? allocateCnyMinorUnits(
          rows.map((row) => row.value),
          point.cost.total_cost
        )
      : null

  return (
    <div className="grid min-w-56 gap-2 rounded-xl bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/5 dark:ring-foreground/10">
      <p className="font-medium">
        {formatTrendPeriod(point.period_start, granularity, language, false)}
      </p>
      <dl className="grid gap-1.5">
        <div className="flex items-center justify-between gap-5 font-medium">
          <dt>
            {t(metric === "tokens" ? "usage.totalTokens" : "usage.totalCost")}
          </dt>
          <dd className="font-mono tabular-nums">
            {metric === "tokens" ? (
              formatTokenCount(total, language)
            ) : (
              <CurrencyAmount value={formatCnyCost(total, language)} />
            )}
          </dd>
        </div>
        {rows.map(({ workload, label, value }, index) => (
          <div
            key={workload}
            className="flex items-center justify-between gap-5"
          >
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden="true"
                data-metric={metric}
                data-workload={workload}
                className={cn(
                  "size-2 rounded-[2px]",
                  workloadDotClass(metric, workload)
                )}
              />
              {label}
            </dt>
            <dd className="font-mono font-medium tabular-nums">
              {metric === "tokens" ? (
                formatTokenCount(value, language)
              ) : (
                <CurrencyAmount
                  value={
                    allocatedCostMinorUnits?.[index] === undefined
                      ? formatCnyCost(value, language)
                      : formatCnyMinorUnits(
                          allocatedCostMinorUnits[index],
                          language
                        )
                  }
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {metric === "cost" && point.cost.unpriced_tokens !== "0" && (
        <div className="grid max-w-64 gap-2">
          <Separator />
          <p className="text-muted-foreground">
            {t("usage.unpricedTokensHint", {
              tokens: formatTokenCount(point.cost.unpriced_tokens, language),
            })}
          </p>
        </div>
      )}
    </div>
  )
}

function trendWorkload(
  point: TokenTrendPoint,
  workload: UsageWorkload
): TokenTrendPoint["workloads"][number] | undefined {
  return point.workloads.find((item) => item.workload === workload)
}

function trendWorkloadValue(
  point: TokenTrendPoint,
  workload: UsageWorkload,
  metric: UsageChartMetric
): string {
  const workloadUsage = trendWorkload(point, workload)
  return metric === "tokens"
    ? (workloadUsage?.token_usage.total_tokens ?? "0")
    : (workloadUsage?.cost.total_cost ?? "0")
}

function workloadDotClass(
  metric: UsageChartMetric,
  workload: UsageWorkload
): string {
  return usageChartDotClasses[metric][workload]
}

function usageGradientId(
  chartId: string,
  metric: UsageChartMetric,
  workload: UsageWorkload
): string {
  return `usage-${chartId}-${metric}-${workload}`
}

function MetricCard({
  label,
  value,
  detail,
  currency = false,
}: {
  label: string
  value: string
  detail: string
  currency?: boolean
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
          {currency ? <CurrencyAmount value={value} /> : value}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  )
}

function UsageDetailCard({
  title,
  description,
  metrics,
  models,
  totalCostMinorUnits,
}: {
  title: string
  description: string
  metrics?: UsageAnalyticsReport["totals"]
  models: ModelUsage[]
  totalCostMinorUnits?: bigint
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  return (
    <Card className="self-start xl:sticky xl:top-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description} {t("usage.tableCostUnit")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics && (
          <dl className="grid grid-cols-2 gap-3 rounded-card bg-card-soft p-3 sm:grid-cols-3">
            <CompactMetric
              label={t("usage.tasks")}
              value={formatIntegerCount(metrics.task_count, language)}
            />
            <CompactMetric
              label={t("usage.turns")}
              value={formatIntegerCount(metrics.turn_count, language)}
            />
            <CompactMetric
              label={t("usage.modelCalls")}
              value={formatIntegerCount(metrics.request_count, language)}
            />
            <CompactMetric
              label={t("usage.totalTokens")}
              value={formatTokenCount(
                metrics.token_usage.total_tokens,
                language
              )}
            />
            <CompactMetric
              label={t("usage.totalCost")}
              value={
                totalCostMinorUnits === undefined
                  ? formatCnyCost(metrics.cost.total_cost, language)
                  : formatCnyMinorUnits(totalCostMinorUnits, language)
              }
              currency
            />
          </dl>
        )}
        <div>
          <h3 className="mb-2 font-medium">{t("usage.modelBreakdown")}</h3>
          <ModelUsageTable
            models={models}
            totalCost={metrics?.cost.total_cost}
            totalCostMinorUnits={totalCostMinorUnits}
            compact
          />
        </div>
      </CardContent>
    </Card>
  )
}

function CompactMetric({
  label,
  value,
  currency = false,
}: {
  label: string
  value: string
  currency?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-base font-semibold tabular-nums">
        {currency ? <CurrencyAmount value={value} /> : value}
      </dd>
    </div>
  )
}

function ModelUsageTable({
  models,
  totalCost,
  totalCostMinorUnits,
  compact = false,
}: {
  models: ModelUsage[]
  totalCost?: string
  totalCostMinorUnits?: bigint
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [sort, setSort] = useState<SortState<ModelSortKey> | null>(null)
  const sortedModels = useMemo(
    () =>
      sortItems(
        models,
        sort,
        (model, key) => modelSortValue(model, key, t),
        language
      ),
    [language, models, sort, t]
  )
  const allocatedModelCostMinorUnits = totalCost
    ? allocateCnyMinorUnits(
        sortedModels.map((model) => model.cost.total_cost),
        totalCost,
        totalCostMinorUnits
      )
    : null
  if (models.length === 0) {
    return <EmptyState title={t("usage.modelsEmpty")} />
  }
  return (
    <div className="data-table-scroll">
      <Table
        appearance={compact ? "plain" : "card"}
        aria-label={t("usage.modelBreakdown")}
      >
        <TableHeader>
          <TableRow>
            <SortableTableHead
              columnKey="model"
              label={t("usage.model")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="modelCalls"
              label={t("usage.modelCalls")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalTokens"
              label={t("usage.totalTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalCost"
              label={t("usage.totalCost")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            {!compact && (
              <>
                <SortableTableHead
                  columnKey="turns"
                  label={t("usage.turns")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="inputTokens"
                  label={t("usage.inputTokens")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="inputCost"
                  label={t("usage.inputCost")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="cachedInputTokens"
                  label={t("usage.cachedInputTokens")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="cachedInputCost"
                  label={t("usage.cachedInputCost")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="outputTokens"
                  label={t("usage.outputTokens")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="outputCost"
                  label={t("usage.outputCost")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
                <SortableTableHead
                  columnKey="reasoningOutputTokens"
                  label={t("usage.reasoningOutputTokens")}
                  sort={sort}
                  align="right"
                  onSort={(key) =>
                    setSort((current) => nextSortState(current, key))
                  }
                />
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedModels.map((model, index) => {
            const displayedTotalCost = allocatedModelCostMinorUnits?.[index]
            const allocatedComponentCostMinorUnits = allocateCnyMinorUnits(
              [
                model.cost.input_cost,
                model.cost.cached_input_cost,
                model.cost.output_cost,
              ],
              model.cost.total_cost,
              displayedTotalCost
            )
            return (
              <TableRow key={`${model.model_kind}:${model.model_id}`}>
                <TableCell>
                  <span className="block font-normal">
                    {modelDisplayName(model, t)}
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
                    {model.measurement_methods.includes("estimated")
                      ? ` · ${t("usage.measurementMethods.estimated")}`
                      : ""}
                  </span>
                </TableCell>
                <NumericCell
                  value={model.request_count}
                  language={language}
                  className="font-normal"
                />
                <NumericCell
                  value={model.token_usage.total_tokens}
                  language={language}
                  token
                  className="font-normal"
                />
                <CostCell
                  value={model.cost.total_cost}
                  minorUnits={displayedTotalCost}
                  unpricedTokens={model.cost.unpriced_tokens}
                  language={language}
                  className="font-normal"
                />
                {!compact && (
                  <>
                    <NumericCell
                      value={model.turn_count}
                      language={language}
                      className="font-normal"
                    />
                    <NumericCell
                      value={model.token_usage.input_tokens}
                      language={language}
                      token
                      className="font-normal"
                    />
                    <CostCell
                      value={model.cost.input_cost}
                      minorUnits={allocatedComponentCostMinorUnits?.[0]}
                      language={language}
                      className="font-normal"
                    />
                    <NumericCell
                      value={model.token_usage.cached_input_tokens}
                      language={language}
                      token
                      className="font-normal"
                    />
                    <CostCell
                      value={model.cost.cached_input_cost}
                      minorUnits={allocatedComponentCostMinorUnits?.[1]}
                      language={language}
                      className="font-normal"
                    />
                    <NumericCell
                      value={model.token_usage.output_tokens}
                      language={language}
                      token
                      className="font-normal"
                    />
                    <CostCell
                      value={model.cost.output_cost}
                      minorUnits={allocatedComponentCostMinorUnits?.[2]}
                      language={language}
                      className="font-normal"
                    />
                    <NumericCell
                      value={model.token_usage.reasoning_output_tokens}
                      language={language}
                      token
                      className="font-normal"
                    />
                  </>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function GroupUsageTable({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: GroupUsage[]
  selectedKey: string
  onSelect: (group: GroupUsage) => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [sort, setSort] = useState<SortState<GroupSortKey> | null>(null)
  const sortedGroups = useMemo(
    () =>
      sortItems(
        groups,
        sort,
        (group, key) => groupSortValue(group, key, t),
        language
      ),
    [groups, language, sort, t]
  )
  return (
    <div className="data-table-scroll">
      <Table appearance="card" aria-label={t("usage.groupsTitle")}>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              columnKey="group"
              label={t("usage.group")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="members"
              label={t("usage.members")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="tasks"
              label={t("usage.tasks")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="turns"
              label={t("usage.turns")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalTokens"
              label={t("usage.totalTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalCost"
              label={t("usage.totalCost")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedGroups.map((group) => {
            const selected = groupSelectionKey(group) === selectedKey
            return (
              <TableRow
                key={groupSelectionKey(group)}
                className={cn(selected && "bg-muted/50")}
              >
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="justify-start px-0 text-foreground"
                    aria-pressed={selected}
                    onClick={() => onSelect(group)}
                  >
                    {displayGroupName(group, t)}
                  </Button>
                </TableCell>
                <NumericCell value={group.member_count} language={language} />
                <NumericCell
                  value={group.metrics.task_count}
                  language={language}
                />
                <NumericCell
                  value={group.metrics.turn_count}
                  language={language}
                />
                <NumericCell
                  value={group.metrics.token_usage.total_tokens}
                  language={language}
                  token
                />
                <CostCell
                  value={group.metrics.cost.total_cost}
                  unpricedTokens={group.metrics.cost.unpriced_tokens}
                  language={language}
                />
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ApplicationUsageTable({
  applications,
  selectedKey,
  onSelect,
}: {
  applications: ApplicationUsage[]
  selectedKey: string
  onSelect: (application: ApplicationUsage) => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [sort, setSort] = useState<SortState<ApplicationSortKey> | null>(null)
  const sortedApplications = useMemo(
    () =>
      sortItems(
        applications,
        sort,
        (application, key) => applicationSortValue(application, key, t),
        language
      ),
    [applications, language, sort, t]
  )
  if (applications.length === 0) {
    return <EmptyState title={t("usage.applicationsEmpty")} />
  }
  return (
    <div className="data-table-scroll">
      <Table appearance="card" aria-label={t("usage.applicationsTitle")}>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              columnKey="application"
              label={t("usage.application")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="tasks"
              label={t("usage.tasks")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="turns"
              label={t("usage.turns")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="modelCalls"
              label={t("usage.modelCalls")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalTokens"
              label={t("usage.totalTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalCost"
              label={t("usage.totalCost")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedApplications.map((application) => {
            const selected =
              applicationSelectionKey(application) === selectedKey
            return (
              <TableRow
                key={applicationSelectionKey(application)}
                className={cn(selected && "bg-muted/50")}
              >
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    className="justify-start px-0 text-foreground"
                    aria-pressed={selected}
                    onClick={() => onSelect(application)}
                  >
                    {displayApplicationName(application, t)}
                  </Button>
                </TableCell>
                <NumericCell
                  value={application.metrics.task_count}
                  language={language}
                />
                <NumericCell
                  value={application.metrics.turn_count}
                  language={language}
                />
                <NumericCell
                  value={application.metrics.request_count}
                  language={language}
                />
                <NumericCell
                  value={application.metrics.token_usage.total_tokens}
                  language={language}
                  token
                />
                <CostCell
                  value={application.metrics.cost.total_cost}
                  unpricedTokens={application.metrics.cost.unpriced_tokens}
                  language={language}
                />
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function UserUsageTable({
  users,
  selectedUserId,
  costMinorUnitsByUserId,
  onSelect,
}: {
  users: UserUsage[]
  selectedUserId: string | null
  costMinorUnitsByUserId: ReadonlyMap<string, bigint>
  onSelect: (user: UserUsage) => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [sort, setSort] = useState<SortState<UserSortKey> | null>(null)
  const sortedUsers = useMemo(
    () =>
      sortItems(
        users,
        sort,
        (user, key) => userSortValue(user, key, t),
        language
      ),
    [language, sort, t, users]
  )
  if (users.length === 0) {
    return <EmptyState title={t("usage.usersEmpty")} />
  }
  return (
    <div className="data-table-scroll">
      <Table appearance="card" aria-label={t("usage.usersTitle")}>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              columnKey="user"
              label={t("common.user")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="group"
              label={t("usage.group")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="tasks"
              label={t("usage.tasks")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="turns"
              label={t("usage.turns")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalTokens"
              label={t("usage.totalTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalCost"
              label={t("usage.totalCost")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedUsers.map((user) => {
            const selected = user.user_id === selectedUserId
            return (
              <TableRow
                key={user.user_id}
                className={cn(selected && "bg-muted/50")}
              >
                <TableCell>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto min-h-8 flex-col items-start px-0 py-1 text-left whitespace-normal text-foreground"
                    aria-pressed={selected}
                    onClick={() => onSelect(user)}
                  >
                    <span className="block">{user.name}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {user.email}
                    </span>
                  </Button>
                </TableCell>
                <TableCell>{displayUserGroups(user, t)}</TableCell>
                <NumericCell
                  value={user.metrics.task_count}
                  language={language}
                />
                <NumericCell
                  value={user.metrics.turn_count}
                  language={language}
                />
                <NumericCell
                  value={user.metrics.token_usage.total_tokens}
                  language={language}
                  token
                />
                <CostCell
                  value={user.metrics.cost.total_cost}
                  minorUnits={costMinorUnitsByUserId.get(user.user_id)}
                  unpricedTokens={user.metrics.cost.unpriced_tokens}
                  language={language}
                />
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function WorkloadUsageTable({
  workloads,
  totalCost,
}: {
  workloads: WorkloadUsage[]
  totalCost: string
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [sort, setSort] = useState<SortState<WorkloadSortKey> | null>(null)
  const sortedWorkloads = useMemo(
    () =>
      sortItems(
        workloads,
        sort,
        (workload, key) => workloadSortValue(workload, key, t),
        language
      ),
    [language, sort, t, workloads]
  )
  const allocatedCostMinorUnits = allocateCnyMinorUnits(
    sortedWorkloads.map((workload) => workload.cost.total_cost),
    totalCost
  )
  if (workloads.length === 0) {
    return <EmptyState title={t("usage.workloadsEmpty")} />
  }
  return (
    <div className="data-table-scroll">
      <Table appearance="card" aria-label={t("usage.workloadsTitle")}>
        <TableHeader>
          <TableRow>
            <SortableTableHead
              columnKey="workload"
              label={t("usage.workload")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="measurementMethod"
              label={t("usage.measurementMethod")}
              sort={sort}
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="modelCalls"
              label={t("usage.modelCalls")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalTokens"
              label={t("usage.totalTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="inputTokens"
              label={t("usage.inputTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="cachedInputTokens"
              label={t("usage.cachedInputTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="outputTokens"
              label={t("usage.outputTokens")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
            <SortableTableHead
              columnKey="totalCost"
              label={t("usage.totalCost")}
              sort={sort}
              align="right"
              onSort={(key) =>
                setSort((current) => nextSortState(current, key))
              }
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedWorkloads.map((workload, index) => (
            <TableRow key={workload.workload}>
              <TableCell className="font-medium">
                {t(`usage.workloads.${workload.workload}`)}
              </TableCell>
              <TableCell>{displayMeasurementMethods(workload, t)}</TableCell>
              <NumericCell value={workload.request_count} language={language} />
              <NumericCell
                value={workload.token_usage.total_tokens}
                language={language}
                token
              />
              <NumericCell
                value={workload.token_usage.input_tokens}
                language={language}
                token
              />
              <NumericCell
                value={workload.token_usage.cached_input_tokens}
                language={language}
                token
              />
              <NumericCell
                value={workload.token_usage.output_tokens}
                language={language}
                token
              />
              <CostCell
                value={workload.cost.total_cost}
                minorUnits={allocatedCostMinorUnits?.[index]}
                unpricedTokens={workload.cost.unpriced_tokens}
                language={language}
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SortableTableHead<Key extends string>({
  columnKey,
  label,
  sort,
  onSort,
  align = "left",
}: {
  columnKey: Key
  label: string
  sort: SortState<Key> | null
  onSort: (key: Key) => void
  align?: "left" | "right"
}) {
  const { t } = useTranslation()
  const active = sort?.key === columnKey
  const currentDirection = active ? sort.direction : null
  const nextDirection: SortDirection =
    currentDirection === "asc" ? "desc" : "asc"
  const SortIcon =
    currentDirection === "asc"
      ? ArrowUpIcon
      : currentDirection === "desc"
        ? ArrowDownIcon
        : ChevronsUpDownIcon

  return (
    <TableHead
      aria-sort={
        currentDirection === "asc"
          ? "ascending"
          : currentDirection === "desc"
            ? "descending"
            : "none"
      }
      className={cn(align === "right" && "text-right")}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className={cn(
          "-mx-2 h-7 px-2 text-sm font-medium",
          align === "right" && "-mr-2 ml-auto"
        )}
        aria-label={t(`usage.sort.${nextDirection}`, { field: label })}
        onClick={() => onSort(columnKey)}
      >
        <span>{label}</span>
        <SortIcon data-icon="inline-end" aria-hidden="true" />
      </Button>
    </TableHead>
  )
}

function nextSortState<Key extends string>(
  current: SortState<Key> | null,
  key: Key
): SortState<Key> {
  return {
    key,
    direction:
      current?.key === key && current.direction === "asc" ? "desc" : "asc",
  }
}

function sortItems<Item, Key extends string>(
  items: readonly Item[],
  sort: SortState<Key> | null,
  getValue: (item: Item, key: Key) => SortValue,
  language: "zh-CN" | "en-US"
): Item[] {
  if (!sort) return [...items]

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compareSortValues(
        getValue(left.item, sort.key),
        getValue(right.item, sort.key),
        language
      )
      if (result !== 0) return sort.direction === "asc" ? result : -result
      return left.index - right.index
    })
    .map(({ item }) => item)
}

function modelSortValue(
  model: ModelUsage,
  key: ModelSortKey,
  t: ReturnType<typeof useTranslation>["t"]
): SortValue {
  switch (key) {
    case "model":
      return textSortValue(modelDisplayName(model, t))
    case "modelCalls":
      return integerSortValue(model.request_count)
    case "totalTokens":
      return integerSortValue(model.token_usage.total_tokens)
    case "totalCost":
      return decimalSortValue(model.cost.total_cost)
    case "turns":
      return integerSortValue(model.turn_count)
    case "inputTokens":
      return integerSortValue(model.token_usage.input_tokens)
    case "inputCost":
      return decimalSortValue(model.cost.input_cost)
    case "cachedInputTokens":
      return integerSortValue(model.token_usage.cached_input_tokens)
    case "cachedInputCost":
      return decimalSortValue(model.cost.cached_input_cost)
    case "outputTokens":
      return integerSortValue(model.token_usage.output_tokens)
    case "outputCost":
      return decimalSortValue(model.cost.output_cost)
    case "reasoningOutputTokens":
      return integerSortValue(model.token_usage.reasoning_output_tokens)
  }
}

function workloadSortValue(
  workload: WorkloadUsage,
  key: WorkloadSortKey,
  t: ReturnType<typeof useTranslation>["t"]
): SortValue {
  switch (key) {
    case "workload":
      return textSortValue(t(`usage.workloads.${workload.workload}`))
    case "measurementMethod":
      return textSortValue(displayMeasurementMethods(workload, t))
    case "modelCalls":
      return integerSortValue(workload.request_count)
    case "totalTokens":
      return integerSortValue(workload.token_usage.total_tokens)
    case "inputTokens":
      return integerSortValue(workload.token_usage.input_tokens)
    case "cachedInputTokens":
      return integerSortValue(workload.token_usage.cached_input_tokens)
    case "outputTokens":
      return integerSortValue(workload.token_usage.output_tokens)
    case "totalCost":
      return decimalSortValue(workload.cost.total_cost)
  }
}

function groupSortValue(
  group: GroupUsage,
  key: GroupSortKey,
  t: ReturnType<typeof useTranslation>["t"]
): SortValue {
  switch (key) {
    case "group":
      return textSortValue(displayGroupName(group, t))
    case "members":
      return integerSortValue(group.member_count)
    case "tasks":
      return integerSortValue(group.metrics.task_count)
    case "turns":
      return integerSortValue(group.metrics.turn_count)
    case "totalTokens":
      return integerSortValue(group.metrics.token_usage.total_tokens)
    case "totalCost":
      return decimalSortValue(group.metrics.cost.total_cost)
  }
}

function applicationSortValue(
  application: ApplicationUsage,
  key: ApplicationSortKey,
  t: ReturnType<typeof useTranslation>["t"]
): SortValue {
  switch (key) {
    case "application":
      return textSortValue(displayApplicationName(application, t))
    case "tasks":
      return integerSortValue(application.metrics.task_count)
    case "turns":
      return integerSortValue(application.metrics.turn_count)
    case "modelCalls":
      return integerSortValue(application.metrics.request_count)
    case "totalTokens":
      return integerSortValue(application.metrics.token_usage.total_tokens)
    case "totalCost":
      return decimalSortValue(application.metrics.cost.total_cost)
  }
}

function userSortValue(
  user: UserUsage,
  key: UserSortKey,
  t: ReturnType<typeof useTranslation>["t"]
): SortValue {
  switch (key) {
    case "user":
      return textSortValue(`${user.name} ${user.email}`)
    case "group":
      return textSortValue(displayUserGroups(user, t))
    case "tasks":
      return integerSortValue(user.metrics.task_count)
    case "turns":
      return integerSortValue(user.metrics.turn_count)
    case "totalTokens":
      return integerSortValue(user.metrics.token_usage.total_tokens)
    case "totalCost":
      return decimalSortValue(user.metrics.cost.total_cost)
  }
}

function textSortValue(value: string): SortValue {
  return { type: "text", value }
}

function integerSortValue(value: number | string): SortValue {
  return { type: "integer", value }
}

function decimalSortValue(value: string): SortValue {
  return { type: "decimal", value }
}

function compareSortValues(
  left: SortValue,
  right: SortValue,
  language: "zh-CN" | "en-US"
): number {
  if (left.type === "integer" && right.type === "integer") {
    return compareIntegers(left.value, right.value, language)
  }
  if (left.type === "decimal" && right.type === "decimal") {
    return compareDecimals(left.value, right.value, language)
  }
  if (left.type === "text" && right.type === "text") {
    return compareText(left.value, right.value, language)
  }
  return compareText(String(left.value), String(right.value), language)
}

function compareText(
  left: string,
  right: string,
  language: "zh-CN" | "en-US"
): number {
  return new Intl.Collator(language, {
    numeric: true,
    sensitivity: "base",
  }).compare(left, right)
}

function compareIntegers(
  left: number | string,
  right: number | string,
  language: "zh-CN" | "en-US"
): number {
  const leftNumber = parseSortableInteger(left)
  const rightNumber = parseSortableInteger(right)
  if (leftNumber === null || rightNumber === null) {
    return compareText(String(left), String(right), language)
  }
  return compareBigInts(leftNumber, rightNumber)
}

function compareDecimals(
  left: string,
  right: string,
  language: "zh-CN" | "en-US"
): number {
  const leftNumber = parseSortableDecimal(left)
  const rightNumber = parseSortableDecimal(right)
  if (leftNumber === null || rightNumber === null) {
    return compareText(left, right, language)
  }
  return compareBigInts(leftNumber, rightNumber)
}

function compareBigInts(left: bigint, right: bigint): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function parseSortableInteger(value: number | string): bigint | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? BigInt(Math.round(value)) : null
  }
  if (!/^\d+$/u.test(value)) return null
  return BigInt(value)
}

function parseSortableDecimal(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/u.exec(value)
  if (!match) return null
  const whole = match[1] ?? "0"
  const fraction = match[2] ?? ""
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"))
}

function modelDisplayName(
  model: ModelUsage,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return model.model_id === unknownModelId
    ? t("usage.unknownModel")
    : (model.display_name ?? model.model_id)
}

function displayMeasurementMethods(
  usage: Pick<WorkloadUsage, "measurement_methods">,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return usage.measurement_methods
    .map((method) => t(`usage.measurementMethods.${method}`))
    .join(", ")
}

function CostCell({
  value,
  minorUnits,
  unpricedTokens = "0",
  language,
  className,
}: {
  value: string
  minorUnits?: bigint
  unpricedTokens?: string
  language: "zh-CN" | "en-US"
  className?: string
}) {
  const { t } = useTranslation()
  const formattedValue =
    minorUnits === undefined
      ? formatCnyCost(value, language)
      : formatCnyMinorUnits(minorUnits, language)
  return (
    <TableCell className={cn("text-right font-medium tabular-nums", className)}>
      <span className="block">{formattedValue.replace(/^¥/u, "")}</span>
      {unpricedTokens !== "0" && (
        <span className="block text-[11px] font-normal text-muted-foreground">
          {t("usage.unpricedShort", {
            tokens: formatTokenCount(unpricedTokens, language),
          })}
        </span>
      )}
    </TableCell>
  )
}

function CurrencyAmount({ value }: { value: string }) {
  if (!value.startsWith("¥")) return value

  return (
    <span data-slot="currency-amount" aria-label={value}>
      <span
        aria-hidden="true"
        data-slot="currency-symbol"
        className="mr-px text-[0.72em] font-light text-muted-foreground/75"
      >
        ¥
      </span>
      <span aria-hidden="true">{value.slice(1)}</span>
    </span>
  )
}

function CurrencyYAxisTick({
  x = 0,
  y = 0,
  payload,
  language,
}: {
  x?: number
  y?: number
  payload?: { value?: number | string }
  language: "zh-CN" | "en-US"
}) {
  const value = formatCnyCost(payload?.value ?? 0, language)
  if (!value.startsWith("¥")) {
    return (
      <text
        x={x}
        y={y}
        dy="0.32em"
        textAnchor="end"
        className="fill-muted-foreground text-xs"
      >
        {value}
      </text>
    )
  }

  return (
    <text
      x={x}
      y={y}
      dy="0.32em"
      textAnchor="end"
      className="fill-muted-foreground text-xs tabular-nums"
      aria-label={value}
    >
      <tspan
        aria-hidden="true"
        data-slot="currency-symbol"
        className="text-[9px] font-light opacity-75"
      >
        ¥
      </tspan>
      <tspan aria-hidden="true">{value.slice(1)}</tspan>
    </text>
  )
}

function NumericCell({
  value,
  language,
  token = false,
  className,
}: {
  value: number | string
  language: "zh-CN" | "en-US"
  token?: boolean
  className?: string
}) {
  return (
    <TableCell className={cn("text-right font-medium tabular-nums", className)}>
      {token
        ? formatTokenCount(value, language)
        : formatIntegerCount(value, language)}
    </TableCell>
  )
}

function formatTrendPeriod(
  value: string,
  granularity: TokenTrend["granularity"],
  language: "zh-CN" | "en-US",
  compact: boolean
): string {
  const parsed = dayjs(value).locale(language === "zh-CN" ? "zh-cn" : "en")
  if (!parsed.isValid()) return value
  if (granularity === "year") return parsed.format("YYYY")
  if (granularity === "month") {
    return parsed.format(language === "zh-CN" ? "YYYY年M月" : "MMM YYYY")
  }
  if (compact) return parsed.format(language === "zh-CN" ? "M/D" : "MMM D")
  return parsed.format(language === "zh-CN" ? "YYYY年M月D日" : "MMM D, YYYY")
}

function defaultCustomDates(): { from: string; to: string } {
  const today = dayjs()
  return {
    from: today.subtract(29, "day").format("YYYY-MM-DD"),
    to: today.format("YYYY-MM-DD"),
  }
}

function validDateParam(value: string | null) {
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

function allocateUserCostMinorUnits(
  report: UsageAnalyticsReport
): Map<string, bigint> {
  const result = new Map<string, bigint>()
  const allocated = allocateCnyMinorUnits(
    report.users.map((user) => user.metrics.cost.total_cost),
    report.totals.cost.total_cost
  )
  if (!allocated) return result

  for (const [index, user] of report.users.entries()) {
    const minorUnits = allocated[index]
    if (minorUnits !== undefined) result.set(user.user_id, minorUnits)
  }
  return result
}

function groupSelectionKey(group: GroupUsage | undefined): string {
  if (!group || group.is_ungrouped) return ungroupedSelectionKey
  return group.group_id ?? ungroupedSelectionKey
}

function applicationSelectionKey(
  application: ApplicationUsage | undefined
): string {
  return application?.application_id ?? unattributedApplicationSelectionKey
}

function displayApplicationName(
  application: ApplicationUsage,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return application.is_unattributed
    ? t("usage.unattributedApplication")
    : application.application_name
}

function displayGroupName(
  group: GroupUsage,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return group.is_ungrouped ? t("usage.ungrouped") : group.group_name
}

function displayUserGroups(
  user: UserUsage,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return user.groups.length > 0
    ? user.groups.map((group) => group.name).join(", ")
    : t("usage.ungrouped")
}
