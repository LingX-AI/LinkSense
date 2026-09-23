import { creditMicrosToDecimal, decimalToCreditMicros } from "@linksense/shared"
import { formatCreditAmount } from "@/lib/credit-quota"

export type QuotaChartInput = { date: string; name: string; amount: string }
export const personalQuotaChartColors = [
  "var(--app-usage-cost-assistant)",
  "var(--app-usage-cost-document)",
  "var(--app-usage-token-rerank)",
  "var(--app-usage-cost-memory)",
  "var(--app-usage-cost-query)",
] as const

export function quotaChartData(
  dates: string[],
  rows: QuotaChartInput[],
  otherLabel: string
) {
  const totals = new Map<string, bigint>()
  for (const row of rows)
    totals.set(
      row.name,
      (totals.get(row.name) ?? 0n) + decimalToCreditMicros(row.amount)
    )
  const sorted = [...totals].sort((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1
  )
  const groups =
    sorted.length > 5
      ? [
          ...sorted.slice(0, 4).map(([name]) => [name]),
          sorted.slice(4).map(([name]) => name),
        ]
      : sorted.map(([name]) => [name])
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0n)
  const series = groups.map((names, index) => {
    const micros = names.reduce(
      (sum, name) => sum + (totals.get(name) ?? 0n),
      0n
    )
    return {
      key: `series_${index}`,
      label: names.length === 1 ? names[0] : otherLabel,
      amount: creditMicrosToDecimal(micros),
      share: total === 0n ? 0 : Number((micros * 10000n) / total) / 100,
      names,
    }
  })
  const membership = new Map(
    series.flatMap((s) => s.names.map((name) => [name, s.key] as const))
  )
  const daily = new Map<string, Map<string, bigint>>()
  for (const row of rows) {
    const key = membership.get(row.name)
    if (!key) continue
    const values = daily.get(row.date) ?? new Map<string, bigint>()
    values.set(key, (values.get(key) ?? 0n) + decimalToCreditMicros(row.amount))
    daily.set(row.date, values)
  }
  return {
    total: creditMicrosToDecimal(total),
    series,
    points: dates.map((date) => {
      const values: Record<string, number | string> = { date }
      for (const s of series) {
        const amount = creditMicrosToDecimal(daily.get(date)?.get(s.key) ?? 0n)
        values[s.key] = Number(amount)
        values[`${s.key}_amount`] = amount
      }
      return values
    }),
  }
}

export function quotaPercentage(
  used: string,
  limit: string | null
): number | null {
  if (limit === null || decimalToCreditMicros(limit) === 0n) return null
  return (
    Number(
      (decimalToCreditMicros(used) * 10000n) / decimalToCreditMicros(limit)
    ) / 100
  )
}

export function formatQuotaAmount(amount: string, language: string): string {
  return formatCreditAmount(amount, language)
}
