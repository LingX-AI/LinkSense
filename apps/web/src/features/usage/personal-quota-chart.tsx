import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { EmptyState } from "@/components/feedback/page-state"
import { cn } from "@/lib/utils"
import {
  quotaChartData,
  formatQuotaAmount,
  personalQuotaChartColors,
  type QuotaChartInput,
} from "./personal-quota-data"

export function PersonalQuotaChart({
  title,
  description,
  dates,
  rows,
  kind = "line",
  controls,
}: {
  title: string
  description: string
  dates: string[]
  rows: QuotaChartInput[]
  kind?: "line" | "bar"
  controls?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const data = quotaChartData(dates, rows, t("personalQuota.other"))
  const config = Object.fromEntries(
    data.series.map((series, index) => [
      series.key,
      { label: series.label, color: personalQuotaChartColors[index] },
    ])
  )
  const chartChildren = (
    <>
      <CartesianGrid vertical={false} stroke="var(--app-usage-chart-grid)" />
      <XAxis
        dataKey="date"
        tickLine={false}
        axisLine={false}
        minTickGap={36}
        tickFormatter={(value) => String(value).slice(5).replace("-", "/")}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={48}
        allowDecimals={false}
        tickFormatter={(value: number) =>
          new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: 0,
          }).format(value)
        }
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            formatter={(_value, name, item) => {
              const series = data.series.find((entry) => entry.key === name)
              const amount: unknown = item.payload?.[`${String(name)}_amount`]
              return (
                <div className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{series?.label}</span>
                  <span className="font-mono tabular-nums">
                    {typeof amount === "string"
                      ? formatQuotaAmount(amount, i18n.language)
                      : "—"}
                  </span>
                </div>
              )
            }}
          />
        }
      />
      {kind === "bar" ? (
        // Clip the entire stack so tiny top segments cannot flatten its corners.
        <BarStack radius={[8, 8, 0, 0]}>
          {data.series.map((series) => (
            <Bar
              key={series.key}
              dataKey={series.key}
              fill={`var(--color-${series.key})`}
              maxBarSize={48}
              isAnimationActive={false}
            />
          ))}
        </BarStack>
      ) : (
        data.series.map((series) => (
          <Line
            key={series.key}
            dataKey={series.key}
            stroke={`var(--color-${series.key})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))
      )}
    </>
  )
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {controls}
        </div>
        <p
          className={cn(
            "font-semibold tabular-nums",
            kind === "line" ? "text-2xl" : "text-3xl"
          )}
        >
          {formatQuotaAmount(data.total, i18n.language)}
          {kind === "bar" && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {t("personalQuota.unit")}
            </span>
          )}
        </p>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-6">
        {rows.length === 0 ? (
          <EmptyState title={t("personalQuota.empty")} />
        ) : (
          <>
            <ChartContainer
              config={config}
              className="h-64 w-full"
              aria-label={title}
            >
              {kind === "bar" ? (
                <BarChart accessibilityLayer data={data.points}>
                  {chartChildren}
                </BarChart>
              ) : (
                <LineChart accessibilityLayer data={data.points}>
                  {chartChildren}
                </LineChart>
              )}
            </ChartContainer>
            {kind === "line" ? (
              <ul
                aria-label={title}
                className="flex flex-wrap items-center gap-x-6 gap-y-2"
              >
                {data.series.map((series, index) => (
                  <li
                    key={series.key}
                    className="flex max-w-full min-w-0 items-center gap-2 text-sm text-muted-foreground"
                  >
                    <svg
                      viewBox="0 0 12 12"
                      className="size-3 shrink-0"
                      aria-hidden="true"
                    >
                      <circle
                        cx="6"
                        cy="6"
                        r="6"
                        fill={personalQuotaChartColors[index]}
                      />
                    </svg>
                    <span className="truncate" title={series.label}>
                      {series.label}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.series.map((series, index) => (
                  <div key={series.key} className="flex min-w-0 gap-3">
                    <svg
                      width="4"
                      height="44"
                      className="shrink-0"
                      aria-hidden="true"
                    >
                      <rect
                        width="4"
                        height="44"
                        rx="2"
                        fill={personalQuotaChartColors[index]}
                      />
                    </svg>
                    <div className="min-w-0">
                      <dt
                        className="truncate text-sm text-muted-foreground"
                        title={series.label}
                      >
                        {series.label}
                      </dt>
                      <dd className="text-lg tabular-nums">
                        {formatQuotaAmount(series.amount, i18n.language)}
                        {kind === "bar" && (
                          <span className="ml-2 text-sm text-muted-foreground">
                            {series.share}%
                          </span>
                        )}
                      </dd>
                    </div>
                  </div>
                ))}
              </dl>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
