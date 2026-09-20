import { useState } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import dayjs from "dayjs"
import {
  type PersonalQuotaAnalytics,
  type PersonalQuotaOverview,
} from "@linksense/shared"
import { useAuth } from "@/app/auth-state"
import { getErrorMessage } from "@/api/error-message"
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/components/feedback/page-state"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { ChevronRightIcon } from "lucide-react"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { usePersonalQuota } from "@/features/usage/personal-quota-query"
import { PersonalQuotaChart } from "@/features/usage/personal-quota-chart"
import {
  formatQuotaAmount,
  quotaPercentage,
} from "@/features/usage/personal-quota-data"
import { cn } from "@/lib/utils"

export default function PersonalQuotaPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [range, setRange] = useState<"7d" | "30d">("7d")
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  )
  const query = usePersonalQuota(user?.id, { range, time_zone: timeZone })
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1>{t("personalQuota.title")}</h1>
        <p>{t("personalQuota.description")}</p>
      </header>
      <Tabs defaultValue="overview">
        <TabsList aria-label={t("personalQuota.title")}>
          <TabsTrigger value="overview">
            {t("personalQuota.overview")}
          </TabsTrigger>
          <TabsTrigger value="analytics">
            {t("personalQuota.analytics")}
          </TabsTrigger>
        </TabsList>
        {query.isLoading && <LoadingState />}
        {query.error && (
          <ErrorState
            message={getErrorMessage(query.error, t)}
            onRetry={() => {
              void query.refetch()
            }}
          />
        )}
        {!query.error && query.data && (
          <>
            <TabsContent value="overview">
              <QuotaOverview overview={query.data.overview} />
            </TabsContent>
            <TabsContent
              value="analytics"
              className="flex min-w-0 flex-col gap-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {t("personalQuota.updated", {
                    time: dayjs(query.data.analytics.generated_at).format(
                      "YYYY-MM-DD HH:mm"
                    ),
                    zone: timeZone,
                  })}
                </p>
                <ToggleGroup
                  value={[range]}
                  onValueChange={(values) => {
                    if (values[0] === "7d" || values[0] === "30d")
                      setRange(values[0])
                  }}
                  aria-label={t("personalQuota.range")}
                >
                  <ToggleGroupItem value="7d">
                    {t("personalQuota.days", { count: 7 })}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="30d">
                    {t("personalQuota.days", { count: 30 })}
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              <QuotaAnalytics key={range} analytics={query.data.analytics} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}

export function QuotaOverview({
  overview,
}: {
  overview: PersonalQuotaOverview
}) {
  const { t, i18n } = useTranslation()
  const percentage = quotaPercentage(overview.used, overview.limit)
  const amount = (value: string | null) =>
    value === null
      ? t("personalQuota.unlimited")
      : formatQuotaAmount(value, i18n.language)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("personalQuota.weekly")}</CardTitle>
        <CardDescription>
          {t("personalQuota.weeklyDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <div>
          <p className="text-sm text-muted-foreground">
            {t("personalQuota.remaining")}
          </p>
          <p
            className={cn(
              "mt-2 font-semibold tabular-nums",
              overview.remaining === null ? "text-2xl" : "text-4xl"
            )}
          >
            {amount(overview.remaining)}
            {overview.remaining !== null && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {t("personalQuota.unit")}
              </span>
            )}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-6">
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("personalQuota.used")}
            </dt>
            <dd className="mt-1 text-xl tabular-nums">
              {amount(overview.used)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("personalQuota.limit")}
            </dt>
            <dd className="mt-1 text-xl tabular-nums">
              {amount(overview.limit)}
            </dd>
          </div>
        </dl>
        {percentage !== null && (
          <div className="flex flex-col gap-2">
            <Progress
              value={Math.min(percentage, 100)}
              aria-label={t("personalQuota.used")}
            />
            <p className="text-sm text-muted-foreground">
              {t("personalQuota.percentage", { value: percentage })}
            </p>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          {t("personalQuota.reset", {
            time: new Intl.DateTimeFormat(i18n.language, {
              timeZone: overview.time_zone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(dayjs(overview.reset_at).toDate()),
            zone: overview.time_zone,
          })}
        </p>
      </CardContent>
    </Card>
  )
}

function QuotaAnalytics({ analytics }: { analytics: PersonalQuotaAnalytics }) {
  const { t } = useTranslation()
  const [group, setGroup] = useState("workload")
  const name = (value: string) =>
    value === "__unknown__" ? t("personalQuota.unknown") : value
  return (
    <>
      <PersonalQuotaChart
        title={t("personalQuota.history")}
        description={t("personalQuota.historyDescription")}
        dates={analytics.dates}
        kind="bar"
        rows={analytics.credits.map((row) => ({
          date: row.date,
          name:
            group === "model"
              ? name(row.model)
              : t(`usage.workloads.${row.workload}`),
          amount: row.credits,
        }))}
        controls={
          <ToggleGroup
            appearance="segmented"
            size="sm"
            value={[group]}
            onValueChange={(values) => {
              if (values[0]) setGroup(values[0])
            }}
            aria-label={t("personalQuota.group")}
          >
            <ToggleGroupItem value="workload">
              {t("personalQuota.byWorkload")}
            </ToggleGroupItem>
            <ToggleGroupItem value="model">
              {t("personalQuota.byModel")}
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />
      <QuotaTaskRanking tasks={analytics.tasks} />
      <section
        className="flex flex-col gap-4"
        aria-label={t("personalQuota.tools")}
      >
        <PersonalQuotaChart
          title={t("personalQuota.tools")}
          description={t("personalQuota.toolsDescription")}
          dates={analytics.dates}
          rows={analytics.tools.map((row) => ({
            date: row.date,
            name: name(row.name),
            amount: String(row.count),
          }))}
        />
        <PersonalQuotaChart
          title={t("personalQuota.skills")}
          description={t("personalQuota.skillsDescription")}
          dates={analytics.dates}
          rows={analytics.skills.map((row) => ({
            date: row.date,
            name: name(row.name),
            amount: String(row.count),
          }))}
        />
      </section>
      <PersonalQuotaChart
        title={t("personalQuota.messages")}
        description={t("personalQuota.messagesDescription")}
        dates={analytics.dates}
        rows={analytics.messages.map((row) => ({
          date: row.date,
          name: name(row.name),
          amount: String(row.count),
        }))}
      />
    </>
  )
}

function QuotaTaskRanking({
  tasks,
}: {
  tasks: PersonalQuotaAnalytics["tasks"]
}) {
  const { t, i18n } = useTranslation()
  const [limit, setLimit] = useState(10)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("personalQuota.ranking")}</CardTitle>
        <CardDescription>
          {t("personalQuota.rankingDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {tasks.length === 0 ? (
          <EmptyState title={t("personalQuota.empty")} />
        ) : (
          <Table className="border-separate border-spacing-0">
            <TableHeader>
              <TableRow>
                <TableHead>{t("personalQuota.task")}</TableHead>
                <TableHead className="text-right">
                  {t("personalQuota.credits")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.slice(0, limit).map((task) => (
                <TableRow key={task.id ?? "unattributed"} appearance="rounded">
                  <TableCell className="w-full max-w-0 whitespace-normal">
                    <Collapsible>
                      <CollapsibleTrigger
                        render={
                          <Button
                            variant="plain"
                            className="group w-full justify-start"
                          />
                        }
                        title={task.title ?? t("personalQuota.unattributed")}
                      >
                        <ChevronRightIcon
                          data-icon="inline-start"
                          className="text-muted-foreground transition-transform group-aria-expanded:rotate-90"
                        />
                        <span className="truncate">
                          {task.title ?? t("personalQuota.unattributed")}
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="flex flex-col items-start gap-3 py-3 pl-8">
                        {task.id && (
                          <Button
                            variant="link"
                            className="px-0"
                            role="link"
                            nativeButton={false}
                            render={<Link to={`/conversations/${task.id}`} />}
                          >
                            {t("personalQuota.openTask")}
                          </Button>
                        )}
                        {task.breakdown.map((row) => (
                          <p
                            key={`${row.model}:${row.workload}`}
                            className="text-sm text-muted-foreground"
                          >
                            {row.model} · {t(`usage.workloads.${row.workload}`)}{" "}
                            · {formatQuotaAmount(row.credits, i18n.language)}{" "}
                            {t("personalQuota.unit")}
                          </p>
                        ))}
                      </CollapsibleContent>
                    </Collapsible>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuotaAmount(task.credits, i18n.language)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {tasks.length > limit && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => setLimit((value) => value + 10)}
          >
            {t("personalQuota.more")}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
