import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import dayjs from "dayjs"
import { DownloadIcon, EyeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  billingStatementDetailSchema,
  billingStatementListSchema,
  type BillingStatementDetail,
  type BillingStatementList,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { downloadBlob } from "@/lib/download-blob"
import { dayjsLocaleFor, longMonthYearFormatFor } from "@/i18n/date"
import {
  formatCnyCost,
  formatIntegerCount,
  formatTokenCount,
  type UsageNumberLanguage,
} from "@/lib/usage-number"
import {
  createBillingStatementPdf,
  type BillingPdfLabels,
} from "./billing-statement-pdf"

export function BillingStatementsPanel(props: {
  productName: string
  language: UsageNumberLanguage
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const listQuery = useQuery({
    queryKey: ["admin", "usage", "bills"],
    queryFn: ({ signal }) =>
      apiRequest("/admin/usage/bills", {
        schema: billingStatementListSchema,
        signal,
      }),
  })
  const detailQuery = useQuery({
    queryKey: ["admin", "usage", "bills", selectedId],
    enabled: selectedId !== null,
    queryFn: ({ signal }) =>
      apiRequest(`/admin/usage/bills/${selectedId}`, {
        schema: billingStatementDetailSchema,
        signal,
      }),
  })

  const exportStatement = async (summary: { id: string }) => {
    if (exportingId) return
    setExportingId(summary.id)
    try {
      const statement = await apiRequest(
        `/admin/usage/bills/${summary.id}/export`,
        {
          method: "POST",
          query: { locale: props.language },
          schema: billingStatementDetailSchema,
        }
      )
      const blob = await createBillingStatementPdf({
        statement,
        productName: props.productName,
        language: props.language,
        labels: billingPdfLabels(t),
      })
      downloadBlob(
        blob,
        t("usage.billing.export.filename", {
          statementNumber: statement.statement_number,
        })
      )
      notify.success(t("usage.billing.export.success"), {
        id: "billing-statement-export-success",
      })
    } catch (error) {
      notify.error(getErrorMessage(error, t), {
        id: "billing-statement-export-error",
      })
    } finally {
      setExportingId(null)
    }
  }

  if (listQuery.isLoading) return <LoadingState />
  if (listQuery.isError || !listQuery.data) {
    return (
      <ErrorState
        message={getErrorMessage(listQuery.error, t)}
        onRetry={() => void listQuery.refetch()}
      />
    )
  }

  return (
    <div className="space-y-5">
      <CurrentPeriodCard data={listQuery.data} language={props.language} />

      <Card>
        <CardHeader>
          <CardTitle>{t("usage.billing.history.title")}</CardTitle>
          <CardDescription>
            {t("usage.billing.history.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listQuery.data.statements.length === 0 ? (
            <EmptyState title={t("usage.billing.history.empty")} />
          ) : (
            <div className="divide-y divide-border">
              {listQuery.data.statements.map((statement) => (
                <div
                  key={statement.id}
                  className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 justify-start px-0 py-0 text-left hover:bg-transparent"
                    onClick={() => setSelectedId(statement.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {formatBillMonth(
                          statement.period.month,
                          props.language
                        )}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {statement.statement_number} ·{" "}
                        {t("usage.billing.generatedAt")}{" "}
                        {formatDateTime(statement.generated_at, props.language)}
                      </span>
                    </span>
                  </Button>
                  <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatCnyCost(statement.total_cost, props.language)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        onClick={() => setSelectedId(statement.id)}
                      >
                        <EyeIcon data-icon="inline-start" />
                        {t("usage.billing.preview.action")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        disabled={exportingId !== null}
                        onClick={() => void exportStatement(statement)}
                      >
                        {exportingId === statement.id ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <DownloadIcon data-icon="inline-start" />
                        )}
                        {t("usage.billing.export.action")}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent
          className="flex max-h-[88dvh] flex-col overflow-hidden sm:max-w-5xl"
          closeLabel={t("common.close")}
        >
          <DialogHeader className="shrink-0 pr-8">
            <DialogTitle>{t("usage.billing.detail.title")}</DialogTitle>
            <DialogDescription>
              {detailQuery.data
                ? `${detailQuery.data.statement_number} · ${formatBillMonth(
                    detailQuery.data.period.month,
                    props.language
                  )}`
                : t("usage.billing.detail.description")}
            </DialogDescription>
          </DialogHeader>
          <div
            role="region"
            aria-label={t("usage.billing.detail.title")}
            tabIndex={0}
            className={dialogBodyStyles(
              "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            {detailQuery.isLoading && <LoadingState />}
            {detailQuery.isError && (
              <ErrorState
                message={getErrorMessage(detailQuery.error, t)}
                onRetry={() => void detailQuery.refetch()}
              />
            )}
            {detailQuery.data && (
              <StatementDetail
                statement={detailQuery.data}
                language={props.language}
              />
            )}
          </div>
          {detailQuery.data && (
            <DialogFooter className="shrink-0 flex-col gap-4 sm:flex-col">
              <Separator />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">
                    {t("usage.billing.total")}
                  </div>
                  <div className="text-xl font-semibold tabular-nums">
                    {formatCnyCost(detailQuery.data.total_cost, props.language)}
                  </div>
                </div>
                <Button
                  disabled={exportingId !== null}
                  onClick={() => void exportStatement(detailQuery.data)}
                >
                  {exportingId === detailQuery.data.id ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <DownloadIcon data-icon="inline-start" />
                  )}
                  {t("usage.billing.export.action")}
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CurrentPeriodCard(props: {
  data: BillingStatementList
  language: UsageNumberLanguage
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("usage.billing.current.title")}</CardTitle>
            <CardDescription>
              {t("usage.billing.current.description")}
            </CardDescription>
          </div>
          <Badge variant="outline">{t("usage.billing.current.open")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <BillingFact
          label={t("usage.billing.period")}
          value={formatBillMonth(
            props.data.current_period.period.month,
            props.language
          )}
        />
        <BillingFact
          label={t("usage.billing.current.expectedGeneration")}
          value={formatDateTime(
            props.data.current_period.expected_generation_at,
            props.language
          )}
        />
      </CardContent>
    </Card>
  )
}

function StatementDetail(props: {
  statement: BillingStatementDetail
  language: UsageNumberLanguage
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <BillingFact
          label={t("usage.billing.period")}
          value={formatBillMonth(props.statement.period.month, props.language)}
        />
        <BillingFact
          label={t("usage.billing.total")}
          value={formatCnyCost(props.statement.total_cost, props.language)}
        />
        <BillingFact
          label={t("usage.billing.modelCount")}
          value={formatIntegerCount(
            props.statement.models.length,
            props.language
          )}
        />
      </div>

      <div className="hidden md:block">
        <Table
          className="table-fixed border-collapse text-[13px]"
          scrollable={false}
        >
          <TableHeader>
            <TableRow className="border-y border-border text-muted-foreground hover:bg-transparent">
              {[
                t("usage.billing.columns.model"),
                t("usage.billing.columns.input"),
                t("usage.billing.columns.cached"),
                t("usage.billing.columns.output"),
                t("usage.billing.columns.totalTokens"),
                t("usage.billing.columns.pricing"),
                t("usage.billing.columns.amount"),
              ].map((label, index) => (
                <TableHead
                  key={label}
                  className={`h-auto px-2 py-2 font-medium whitespace-normal ${
                    index === 0 ? "w-[23%] text-left" : "text-right"
                  }`}
                >
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.statement.models.map((model) => (
              <TableRow
                key={model.model_id}
                className="border-b border-border hover:bg-transparent"
              >
                <TableCell className="px-2 py-2 align-middle break-words whitespace-normal">
                  <span className="block font-medium">
                    {model.display_name ?? model.model_id}
                  </span>
                  {model.display_name && (
                    <span className="block break-all text-muted-foreground">
                      {model.model_id}
                    </span>
                  )}
                </TableCell>
                {[
                  model.token_usage.input_tokens,
                  model.token_usage.cached_input_tokens,
                  model.token_usage.output_tokens,
                  model.token_usage.total_tokens,
                ].map((value, index) => (
                  <TableCell
                    key={index}
                    className="px-2 py-2 text-right align-middle break-words whitespace-normal tabular-nums"
                  >
                    {formatTokenCount(value, props.language)}
                  </TableCell>
                ))}
                <TableCell className="px-2 py-2 text-right align-middle break-words whitespace-normal text-muted-foreground">
                  {model.pricing.mode === "mixed"
                    ? t("usage.billing.mixedPricing")
                    : t("usage.billing.uniformPricing")}
                </TableCell>
                <TableCell className="px-2 py-2 text-right align-middle font-medium break-words whitespace-normal tabular-nums">
                  {formatCnyCost(model.cost.total_cost, props.language)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:hidden">
        {props.statement.models.map((model) => (
          <Card key={model.model_id} size="sm">
            <CardContent className="space-y-2 text-xs">
              <div className="font-medium break-all">
                {model.display_name ?? model.model_id}
              </div>
              <div className="flex justify-between gap-4 text-muted-foreground">
                <span>{t("usage.billing.columns.totalTokens")}</span>
                <span className="tabular-nums">
                  {formatTokenCount(
                    model.token_usage.total_tokens,
                    props.language
                  )}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span>{t("usage.billing.columns.amount")}</span>
                <span className="font-medium tabular-nums">
                  {formatCnyCost(model.cost.total_cost, props.language)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function BillingFact(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="mt-1 text-sm font-medium break-words">{props.value}</div>
    </div>
  )
}

function formatBillMonth(month: string, language: UsageNumberLanguage) {
  return dayjs(`${month}-01`)
    .locale(dayjsLocaleFor(language))
    .format(longMonthYearFormatFor(language))
}

function formatDateTime(value: string, language: UsageNumberLanguage) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function billingPdfLabels(
  t: ReturnType<typeof useTranslation>["t"]
): BillingPdfLabels {
  return {
    statement: t("usage.billing.pdf.statement"),
    accountStatement: t("usage.billing.pdf.accountStatement"),
    statementNumber: t("usage.billing.pdf.statementNumber"),
    billingPeriod: t("usage.billing.pdf.billingPeriod"),
    generatedAt: t("usage.billing.pdf.generatedAt"),
    currency: t("usage.billing.pdf.currency"),
    model: t("usage.billing.columns.model"),
    inputTokens: t("usage.billing.columns.input"),
    cachedTokens: t("usage.billing.columns.cached"),
    outputTokens: t("usage.billing.columns.output"),
    totalTokens: t("usage.billing.columns.totalTokens"),
    pricePerMillion: t("usage.billing.pdf.pricePerMillion"),
    amount: t("usage.billing.columns.amount"),
    mixedPricing: t("usage.billing.mixedPricing"),
    inputShort: t("usage.billing.pdf.inputShort"),
    cachedShort: t("usage.billing.pdf.cachedShort"),
    outputShort: t("usage.billing.pdf.outputShort"),
    totalAmount: t("usage.billing.pdf.totalAmount"),
    unpricedNote: t("usage.billing.pdf.unpricedNote"),
    page: t("usage.billing.pdf.page"),
    footer: t("usage.billing.pdf.footer"),
  }
}
