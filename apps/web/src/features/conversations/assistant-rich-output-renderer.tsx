import {
  Children,
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
  richOutputChartData,
  richOutputComponents,
  type RichOutput,
  type RichOutputProps,
} from "@linksense/shared"
import dayjs from "dayjs"
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
import { Checkbox } from "@/components/ui/checkbox"
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
import { InputGroup } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { SearchInput } from "@/components/ui/search-input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { normalizeLanguage } from "@/i18n"
import { formatCalendarDate } from "@/i18n/date"
import { MediaGallery, ResourceList } from "./assistant-rich-output-resources"
import { RichOutputVisibilityContext } from "./rich-output-resource-context"

const CitationContext = createContext<
  ((number: number) => ReactNode) | undefined
>(undefined)
const catalog = defineCatalog(schema, {
  components: richOutputComponents,
  actions: {},
})

function KeyValue({ title, items }: RichOutputProps<"KeyValue">) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const numbers = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumSignificantDigits: 21,
  })
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-2">
      <h3 id={titleId} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <dl className="divide-y divide-border text-sm">
        {items.map((item) => (
          <div
            key={item.id}
            className="grid min-w-0 gap-1 py-2 @sm/rich:grid-cols-3 @sm/rich:gap-3"
          >
            <dt className="wrap-anywhere text-muted-foreground">
              {item.label}
            </dt>
            <dd className="min-w-0 wrap-anywhere whitespace-pre-wrap tabular-nums @sm/rich:col-span-2">
              {item.value === null
                ? t("richOutput.missing")
                : typeof item.value === "number"
                  ? numbers.format(item.value)
                  : item.value}
            </dd>
          </div>
        ))}
      </dl>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("richOutput.empty")}</p>
      )}
    </section>
  )
}

function Timeline({ title, items }: RichOutputProps<"Timeline">) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3">
      <h3 id={titleId} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <ol role="list" className="list-none text-sm">
        {items.map((item) => (
          <li
            key={item.id}
            className="relative ms-1 min-w-0 border-s border-border ps-4 pb-4 before:absolute before:start-0 before:top-1.5 before:size-2 before:-translate-x-1/2 before:rounded-full before:bg-primary last:pb-0"
          >
            {item.time && (
              <p className="mb-1 text-xs wrap-anywhere text-muted-foreground">
                {item.time}
              </p>
            )}
            <p className="font-medium wrap-anywhere">{item.title}</p>
            {item.detail && (
              <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {item.detail}
              </p>
            )}
          </li>
        ))}
      </ol>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("richOutput.empty")}</p>
      )}
    </section>
  )
}

function Steps({ title, items }: RichOutputProps<"Steps">) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3">
      <h3 id={titleId} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <ol className="list-decimal space-y-3 ps-5 text-sm marker:font-medium marker:text-muted-foreground">
        {items.map((item) => (
          <li key={item.id} className="ps-1">
            <p className="font-medium wrap-anywhere">{item.title}</p>
            {item.detail && (
              <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {item.detail}
              </p>
            )}
          </li>
        ))}
      </ol>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("richOutput.empty")}</p>
      )}
    </section>
  )
}

function ResultTabs({
  title,
  tabs,
  children,
}: RichOutputProps<"Tabs"> & { children?: ReactNode }) {
  const titleId = useId()
  const visible = useContext(RichOutputVisibilityContext)
  // Validation guarantees one child per tab, in tab order.
  const panels = Children.toArray(children)
  return (
    <div className="min-w-0 space-y-2">
      <h3 id={titleId} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <Tabs defaultValue={tabs[0]?.id}>
        <TabsList aria-labelledby={titleId} activateOnFocus={false}>
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="max-w-full flex-none text-start wrap-anywhere whitespace-normal"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab, index) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            keepMounted
            className="min-w-0 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            render={(props, { hidden }) => (
              <div {...props}>
                <RichOutputVisibilityContext.Provider value={visible && !hidden}>
                  {panels[index]}
                </RichOutputVisibilityContext.Provider>
              </div>
            )}
          />
        ))}
      </Tabs>
    </div>
  )
}

function ResultDisclosure({
  title,
  children,
  keepMounted,
}: {
  title: string
  children: ReactNode
  keepMounted?: boolean
}) {
  const visible = useContext(RichOutputVisibilityContext)
  return (
    <Collapsible className="min-w-0 border-t border-border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 py-3 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 wrap-anywhere">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent
        keepMounted={keepMounted}
        className="min-w-0 space-y-2 ps-6 pb-3 text-sm"
        render={(props, { open }) => (
          <div {...props}>
            <RichOutputVisibilityContext.Provider value={visible && open}>
              {children}
            </RichOutputVisibilityContext.Provider>
          </div>
        )}
      />
    </Collapsible>
  )
}

function Checklist({ title, items }: RichOutputProps<"Checklist">) {
  const { t } = useTranslation()
  const groupId = useId()
  return (
    <section
      aria-labelledby={`${groupId}-title`}
      aria-describedby={`${groupId}-hint`}
      className="min-w-0 space-y-2"
    >
      <h3 id={`${groupId}-title`} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <p id={`${groupId}-hint`} className="text-xs text-muted-foreground">
        {t("richOutput.temporaryChecks")}
      </p>
      <ul role="list" className="space-y-1">
        {items.map((item) => {
          const inputId = `${groupId}-check-${item.id}`
          const labelId = `${groupId}-label-${item.id}`
          const detailId = `${groupId}-detail-${item.id}`
          return (
            <li key={item.id}>
              <Label
                htmlFor={inputId}
                className="min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-border px-2.5 py-2 leading-5 font-normal hover:bg-muted/50 has-data-checked:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <Checkbox
                  id={inputId}
                  aria-labelledby={labelId}
                  aria-describedby={item.detail ? detailId : undefined}
                  className="mt-0.5 border-muted-foreground/60"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault()
                  }}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span id={labelId} className="wrap-anywhere">
                    {item.label}
                  </span>
                  {item.detail && (
                    <span
                      id={detailId}
                      className="text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground"
                    >
                      {item.detail}
                    </span>
                  )}
                </span>
              </Label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Evidence({ title, detail, citations }: RichOutputProps<"Evidence">) {
  const { t } = useTranslation()
  const renderCitation = useContext(CitationContext)
  const sources =
    citations?.flatMap((number) => {
      const source = renderCitation?.(number)
      return source ? [<li key={number}>{source}</li>] : []
    }) ?? []
  return (
    <ResultDisclosure title={title}>
      <p className="wrap-anywhere whitespace-pre-wrap">{detail}</p>
      {sources.length > 0 && (
        <ul
          role="list"
          aria-label={t("conversation.taskOverview.sources")}
          className="space-y-1.5"
        >
          {sources}
        </ul>
      )}
    </ResultDisclosure>
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

function DataTable({
  title,
  columns,
  rows,
  filterable,
}: RichOutputProps<"DataTable">) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<{
    column: number
    descending: boolean
  } | null>(null)
  const captionId = useId()
  const filterId = useId()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const collator = new Intl.Collator(i18n.resolvedLanguage, {
    numeric: true,
    sensitivity: "base",
  })
  const numberFormat = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumSignificantDigits: 21,
  })
  const formatCell = (
    value: string | number | null | undefined,
    column: (typeof columns)[number] | undefined
  ): string =>
    value == null
      ? t("richOutput.missing")
      : typeof value === "number"
        ? numberFormat.format(value)
        : column?.type === "date"
          ? formatCalendarDate(value, language)
          : value
  const search = filterable
    ? query.trim().toLocaleLowerCase(i18n.resolvedLanguage)
    : ""
  const filtered = search
    ? rows.filter((row) =>
        row.values.some(
          (value, index) =>
            value !== null &&
            `${value} ${formatCell(value, columns[index])}`
              .toLocaleLowerCase(i18n.resolvedLanguage)
              .includes(search)
        )
      )
    : rows
  const ordered = sort
    ? [...filtered].sort((a, b) => {
        const left = a.values[sort.column]
        const right = b.values[sort.column]
        // Missing values remain last in both directions, and never become zero.
        if (left == null) return right == null ? 0 : 1
        if (right == null) return -1
        const compared =
          columns[sort.column]?.type === "date" &&
          typeof left === "string" &&
          typeof right === "string"
            ? dayjs(left).valueOf() - dayjs(right).valueOf()
            : typeof left === "number"
              ? typeof right === "number"
                ? left - right
                : -1
              : typeof right === "number"
                ? 1
                : collator.compare(left, right)
        return sort.descending ? -compared : compared
      })
    : filtered
  return (
    <div className="min-w-0 space-y-2">
      {filterable && (
        <div className="space-y-1.5">
          <Label htmlFor={filterId} className="sr-only">
            {t("richOutput.filter", { title })}
          </Label>
          <InputGroup>
            <SearchInput
              id={filterId}
              type="search"
              value={query}
              onValueChange={setQuery}
              placeholder={t("richOutput.filter", { title })}
            />
          </InputGroup>
          <p role="status" className="text-xs text-muted-foreground">
            {t("richOutput.rowCount", {
              shown: filtered.length,
              total: rows.length,
            })}
          </p>
        </div>
      )}
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
                data-type={column.type}
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
                  {column.unit ? ` (${column.unit})` : ""}
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
                    {formatCell(value, column)}
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
      {rows.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("richOutput.noMatches")}
        </p>
      )}
      <span role="status" className="sr-only">
        {sort
          ? t("richOutput.sort", { column: columns[sort.column]?.label })
          : ""}
      </span>
    </div>
  )
}

function ResultChart(props: RichOutputProps<"Chart">) {
  const { title, kind, unit } = props
  const { series, points, stacked } = richOutputChartData(props)
  const { t, i18n } = useTranslation()
  const [table, setTable] = useState(false)
  const chartTitleId = useId()
  const numberFormat = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumSignificantDigits: 21,
  })
  const colors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--primary)",
  ]
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
        filterNull={false}
        content={
          <ChartTooltipContent
            formatter={(value, name) => (
              <span>
                {series.length > 1 ? `${name}: ` : ""}
                {typeof value === "number"
                  ? `${numberFormat.format(value)} ${unit}`
                  : t("richOutput.missing")}
              </span>
            )}
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
      {series.length > 1 && (
        <ul
          role="list"
          aria-label={t("richOutput.series")}
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {series.map((item, index) => (
            <li key={item.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-sm",
                  [
                    "bg-chart-1",
                    "bg-chart-2",
                    "bg-chart-3",
                    "bg-chart-4",
                    "bg-chart-5",
                    "bg-primary",
                  ][index]
                )}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {points.length === 0 ||
      points.every((point) => point.values.every((value) => value === null)) ? (
        <p className="text-sm text-muted-foreground">{t("richOutput.empty")}</p>
      ) : (
        !table && (
          <ChartContainer
            config={Object.fromEntries(
              series.map((item, index) => [
                `series${index}`,
                { label: item.label, color: colors[index] },
              ])
            )}
            className="h-56 w-full min-w-0"
            role="group"
            aria-label={`${title} (${unit})`}
          >
            {kind === "bar" ? (
              <BarChart data={points} accessibilityLayer>
                {axes}
                {series.map((item, index) => (
                  <Bar
                    key={item.id}
                    name={item.label}
                    dataKey={`values.${index}`}
                    fill={colors[index]}
                    stackId={stacked ? "values" : undefined}
                    radius={4}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart data={points} accessibilityLayer>
                {axes}
                {series.map((item, index) => (
                  <Line
                    key={item.id}
                    name={item.label}
                    dataKey={`values.${index}`}
                    stroke={colors[index]}
                    strokeWidth={2}
                    strokeDasharray={
                      ["", "6 3", "2 3", "8 3 2 3", "10 3", "3 2 1 2"][index]
                    }
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
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
            ...series.map((item) => ({
              id: `series-${item.id}`,
              label: "series" in props ? item.label : t("richOutput.value"),
              type: "number" as const,
              unit,
            })),
          ]}
          rows={points.map((point) => ({
            id: point.id,
            values: [point.label, ...point.values],
          }))}
        />
      )}
      {points.some((point) => point.values.some((value) => value === null)) && (
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
          props.columns === 3
            ? "@6xl/rich:grid-cols-3"
            : "@4xl/rich:grid-cols-2"
        )}
      >
        {children}
      </div>
    ),
    Tabs: ({ props, children }) => (
      <ResultTabs {...props}>{children}</ResultTabs>
    ),
    Details: ({ props, children }) => (
      <ResultDisclosure title={props.title} keepMounted>
        {children}
      </ResultDisclosure>
    ),
    Text: ({ props }) => (
      <p className="text-sm wrap-anywhere whitespace-pre-wrap">{props.text}</p>
    ),
    KeyValue: ({ props }) => <KeyValue {...props} />,
    Timeline: ({ props }) => <Timeline {...props} />,
    Steps: ({ props }) => <Steps {...props} />,
    Checklist: ({ props }) => <Checklist {...props} />,
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
    MediaGallery: ({ props }) => <MediaGallery {...props} />,
    ResourceList: ({ props }) => <ResourceList {...props} />,
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

function Metric({
  label,
  value,
  unit,
  detail,
  period,
  comparison,
}: RichOutputProps<"Metric">) {
  const { i18n } = useTranslation()
  return (
    <div className="min-w-0 space-y-1 rounded-lg bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {period && (
        <p className="text-xs wrap-anywhere text-muted-foreground">{period}</p>
      )}
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
      {comparison && (
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {comparison.label}{" "}
          <span className="tabular-nums">
            {new Intl.NumberFormat(i18n.resolvedLanguage, {
              maximumSignificantDigits: 21,
              signDisplay: "exceptZero",
            }).format(comparison.change)}
            {comparison.unit ? ` ${comparison.unit}` : ""}
          </span>
        </p>
      )}
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
      data-slot="rich-output"
      className="@container/rich my-3 w-full max-w-full min-w-0 text-foreground"
    >
      <CitationContext.Provider value={renderCitation}>
        <JSONUIProvider registry={registry}>
          <Renderer spec={output.spec} registry={registry} />
        </JSONUIProvider>
      </CitationContext.Provider>
    </div>
  )
}
