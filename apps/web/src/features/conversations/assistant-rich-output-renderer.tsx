import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react"
import { defineCatalog } from "@json-render/core"
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  schema,
} from "@json-render/react"
import {
  richOutputComponents,
  type RichOutput,
  type RichOutputProps,
} from "@linksense/shared"
import { ChevronRightIcon, ArrowDownUpIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const CitationContext = createContext<
  ((number: number) => ReactNode) | undefined
>(undefined)
const catalog = defineCatalog(schema, {
  components: richOutputComponents,
  actions: {},
})

function Evidence({ title, detail, citations }: RichOutputProps<"Evidence">) {
  const renderCitation = useContext(CitationContext)
  return (
    <Collapsible className="min-w-0 border-t border-border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 py-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 wrap-anywhere">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-3 pl-6 text-sm">
        <p className="wrap-anywhere whitespace-pre-wrap">{detail}</p>
        {renderCitation && citations && (
          <div className="flex flex-wrap gap-2">
            {citations.map((number) => (
              <span key={number}>{renderCitation(number)}</span>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function Comparison({ title, options }: RichOutputProps<"Comparison">) {
  const { t } = useTranslation()
  const groupId = useId()
  const [selectedId, setSelectedId] = useState(options[0]?.id)
  const selected =
    options.find((option) => option.id === selectedId) ?? options[0]
  if (!selected) return null
  return (
    <section className="min-w-0 space-y-3" aria-labelledby={groupId}>
      <h3 id={groupId} className="text-sm font-medium">
        {title}
      </h3>
      <RadioGroup
        aria-labelledby={groupId}
        value={selected.id}
        onValueChange={(value) => {
          if (typeof value === "string") setSelectedId(value)
        }}
      >
        {options.map((option) => (
          <RadioGroupOption
            key={option.id}
            htmlFor={`${groupId}-${option.id}`}
            className="min-w-0 flex-1 rounded-lg"
          >
            <RadioGroupItem id={`${groupId}-${option.id}`} value={option.id} />
            <span className="wrap-anywhere">{option.title}</span>
          </RadioGroupOption>
        ))}
      </RadioGroup>
      <div
        className="space-y-3 rounded-lg bg-muted/50 p-3 text-sm"
        aria-live="polite"
      >
        <p className="wrap-anywhere whitespace-pre-wrap">
          {selected.description}
        </p>
        <div className="grid gap-3 @md/rich:grid-cols-2">
          {(
            [
              [t("richOutput.benefits"), selected.benefits],
              [t("richOutput.tradeoffs"), selected.tradeoffs],
            ] as const
          ).map(
            ([heading, items]) =>
              items.length > 0 && (
                <div key={heading} className="space-y-1">
                  <h4 className="font-medium">{heading}</h4>
                  <ul className="list-disc space-y-1 pl-5">
                    {items.map((item) => (
                      <li key={item} className="wrap-anywhere">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}
        </div>
      </div>
    </section>
  )
}

function DataTable({ title, columns, rows }: RichOutputProps<"DataTable">) {
  const { t, i18n } = useTranslation()
  const [sort, setSort] = useState<{
    column: number
    descending: boolean
  } | null>(null)
  const captionId = useId()
  const collator = new Intl.Collator(i18n.resolvedLanguage, {
    numeric: true,
    sensitivity: "base",
  })
  const ordered = sort
    ? [...rows].sort((a, b) => {
        const left = a.values[sort.column]
        const right = b.values[sort.column]
        // Missing values remain last in both directions, and never become zero.
        if (left == null) return right == null ? 0 : 1
        if (right == null) return -1
        const compared =
          typeof left === "number"
            ? typeof right === "number"
              ? left - right
              : -1
            : typeof right === "number"
              ? 1
              : collator.compare(left, right)
        return sort.descending ? -compared : compared
      })
    : rows
  const numberFormat = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumSignificantDigits: 21,
  })
  return (
    <div className="min-w-0 space-y-2">
      <Table
        className="min-w-80"
        containerClassName="max-w-full rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        containerProps={{
          role: "region",
          "aria-labelledby": captionId,
          tabIndex: 0,
        }}
      >
        <caption id={captionId} className="sr-only">
          {title}
        </caption>
        <TableHeader>
          <TableRow>
            {columns.map((column, index) => (
              <TableHead
                key={column.id}
                scope="col"
                className="px-2"
                aria-sort={
                  sort?.column === index
                    ? sort.descending
                      ? "descending"
                      : "ascending"
                    : undefined
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-8 w-full justify-start text-left font-normal whitespace-normal"
                  onClick={() =>
                    setSort({
                      column: index,
                      descending:
                        sort?.column === index ? !sort.descending : false,
                    })
                  }
                >
                  {column.label}
                  <ArrowDownUpIcon
                    aria-hidden="true"
                    className="size-3.5 shrink-0"
                  />
                </Button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((row) => (
            <TableRow key={row.id}>
              {columns.map((column, index) => {
                const value = row.values[index]
                return (
                  <TableCell
                    key={column.id}
                    className="max-w-64 px-3 wrap-anywhere whitespace-normal tabular-nums"
                  >
                    {value == null
                      ? t("richOutput.missing")
                      : typeof value === "number"
                        ? numberFormat.format(value)
                        : value}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("richOutput.empty")}</p>
      )}
      <span role="status" className="sr-only">
        {sort
          ? t("richOutput.sort", { column: columns[sort.column]?.label })
          : ""}
      </span>
    </div>
  )
}

function ResultChart({ title, kind, unit, points }: RichOutputProps<"Chart">) {
  const { t, i18n } = useTranslation()
  const [table, setTable] = useState(false)
  const chartTitleId = useId()
  const numberFormat = new Intl.NumberFormat(i18n.resolvedLanguage)
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={false}
        minTickGap={24}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(value: number) => numberFormat.format(value)}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            formatter={(value) =>
              `${typeof value === "number" ? numberFormat.format(value) : String(value)} ${unit}`
            }
          />
        }
      />
    </>
  )
  return (
    <section className="min-w-0 space-y-3" aria-labelledby={chartTitleId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={chartTitleId} className="text-sm font-medium wrap-anywhere">
          {title}{" "}
          <span className="font-normal text-muted-foreground">({unit})</span>
        </h3>
        <div className="flex gap-1" role="group" aria-label={title}>
          <Button
            type="button"
            size="xs"
            variant={table ? "ghost" : "secondary"}
            aria-pressed={!table}
            onClick={() => setTable(false)}
          >
            {t("richOutput.chart")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={table ? "secondary" : "ghost"}
            aria-pressed={table}
            onClick={() => setTable(true)}
          >
            {t("richOutput.table")}
          </Button>
        </div>
      </div>
      {points.length === 0 || points.every((point) => point.value === null) ? (
        <p className="text-sm text-muted-foreground">{t("richOutput.empty")}</p>
      ) : (
        !table && (
          <ChartContainer
            config={{ value: { label: unit, color: "var(--primary)" } }}
            className="h-56 w-full min-w-0"
            aria-label={`${title} (${unit})`}
          >
            {kind === "bar" ? (
              <BarChart data={points} accessibilityLayer>
                {axes}
                <Bar
                  dataKey="value"
                  fill="var(--color-value)"
                  radius={4}
                  isAnimationActive={false}
                />
              </BarChart>
            ) : (
              <LineChart data={points} accessibilityLayer>
                {axes}
                <Line
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            )}
          </ChartContainer>
        )
      )}
      {table && (
        <DataTable
          title={title}
          columns={[
            { id: "category", label: t("richOutput.category") },
            { id: "value", label: `${t("richOutput.value")} (${unit})` },
          ]}
          rows={points.map((point) => ({
            id: point.id,
            values: [point.label, point.value],
          }))}
        />
      )}
      {points.some((point) => point.value === null) && (
        <p className="text-xs text-muted-foreground">
          {t("richOutput.missingHint")}
        </p>
      )}
    </section>
  )
}

const { registry } = defineRegistry(catalog, {
  components: {
    Panel: ({ props, children }) => (
      <Card
        size="sm"
        role="region"
        aria-label={props.title}
        className="min-w-0 gap-4"
      >
        <CardHeader>
          <CardTitle
            role="heading"
            aria-level={2}
            className="text-base wrap-anywhere"
          >
            {props.title}
          </CardTitle>
          {props.description && (
            <CardDescription className="wrap-anywhere whitespace-pre-wrap">
              {props.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="min-w-0 space-y-4">{children}</CardContent>
      </Card>
    ),
    Grid: ({ props, children }) => (
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 gap-3",
          props.columns === 3 ? "@lg/rich:grid-cols-3" : "@md/rich:grid-cols-2"
        )}
      >
        {children}
      </div>
    ),
    Text: ({ props }) => (
      <p className="text-sm wrap-anywhere whitespace-pre-wrap">{props.text}</p>
    ),
    Callout: ({ props }) => (
      <Alert
        role="note"
        appearance="soft"
        className={cn(
          "rounded-lg",
          props.tone === "warning" && "border border-border"
        )}
      >
        <AlertTitle>{props.title}</AlertTitle>
        <AlertDescription className="wrap-anywhere whitespace-pre-wrap">
          {props.text}
        </AlertDescription>
      </Alert>
    ),
    Evidence: ({ props }) => <Evidence {...props} />,
    Comparison: ({ props }) => <Comparison {...props} />,
    Metric: ({ props }) => <Metric {...props} />,
    DataTable: ({ props }) => (
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium wrap-anywhere">{props.title}</h3>
        <DataTable {...props} />
      </div>
    ),
    Chart: ({ props }) => <ResultChart {...props} />,
  },
})

function Metric({ label, value, unit, detail }: RichOutputProps<"Metric">) {
  const { i18n } = useTranslation()
  return (
    <div className="min-w-0 space-y-1 rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-medium wrap-anywhere tabular-nums">
        {typeof value === "number"
          ? new Intl.NumberFormat(i18n.resolvedLanguage, {
              maximumSignificantDigits: 21,
            }).format(value)
          : value}{" "}
        {unit && (
          <span className="text-sm font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
      {detail && (
        <p className="text-xs wrap-anywhere text-muted-foreground">{detail}</p>
      )}
    </div>
  )
}

export default function AssistantRichOutputRenderer({
  output,
  renderCitation,
}: {
  output: RichOutput
  renderCitation?: (number: number) => ReactNode
}) {
  return (
    <div
      data-testid="assistant-rich-output"
      className="@container/rich my-3 max-w-full min-w-0 text-foreground"
    >
      <CitationContext.Provider value={renderCitation}>
        <JSONUIProvider registry={registry}>
          <Renderer spec={output.spec} registry={registry} />
        </JSONUIProvider>
      </CitationContext.Provider>
    </div>
  )
}
