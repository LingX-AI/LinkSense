import {
  CNY,
  add,
  allocate,
  dinero,
  equal,
  halfUp,
  toDecimal,
  toSnapshot,
  transformScale,
} from "dinero.js/bigint"

export type UsageNumberLanguage = "zh-CN" | "en-US"

const cnyTransportScale = 12n
const cnyDisplayScale = 2n
const cnyTransportFactor = 10n ** cnyTransportScale

const tokenScales = [
  { divisor: 1_000_000_000n, suffix: "B" },
  { divisor: 1_000_000n, suffix: "M" },
  { divisor: 1_000n, suffix: "K" },
] as const

export function formatIntegerCount(
  value: number | string,
  language: UsageNumberLanguage
): string {
  const parsed = parseNonNegativeInteger(value)
  return parsed === null ? "—" : parsed.toLocaleString(language)
}

export function formatTokenCount(
  value: number | string,
  language: UsageNumberLanguage
): string {
  const parsed = parseNonNegativeInteger(value)
  if (parsed === null) return "—"
  const scaleIndex = tokenScales.findIndex((scale) => parsed >= scale.divisor)
  if (scaleIndex === -1) return parsed.toLocaleString(language)

  return formatScaledTokenCount(parsed, scaleIndex, language)
}

export function formatCnyCost(
  value: number | string,
  language: UsageNumberLanguage
): string {
  const precise = parseCnyCost(value)
  if (!precise) return "—"
  const rounded = transformScale(precise, cnyDisplayScale, halfUp)
  return formatCnyMinorUnits(toSnapshot(rounded).amount, language)
}

export function formatCnyMinorUnits(
  value: bigint,
  language: UsageNumberLanguage
): string {
  if (value < 0n) return "—"
  const decimal = toDecimal(dinero({ amount: value, currency: CNY }))
  const [whole = "0", fraction = "00"] = decimal.split(".")
  return `¥${BigInt(whole).toLocaleString(language)}${decimalSeparator(language)}${fraction}`
}

export function allocateCnyMinorUnits(
  values: readonly string[],
  expectedTotal: string,
  targetMinorUnits?: bigint
): bigint[] | null {
  if (targetMinorUnits !== undefined && targetMinorUnits < 0n) return null
  const parts = values.map(parseCnyCost)
  const total = parseCnyCost(expectedTotal)
  if (!total || parts.some((part) => part === null)) return null

  const preciseParts = parts.filter((part) => part !== null)
  const preciseSum = preciseParts.reduce(
    (sum, part) => add(sum, part),
    dinero({ amount: 0n, currency: CNY, scale: cnyTransportScale })
  )
  if (!equal(preciseSum, total)) return null

  const roundedTotal =
    targetMinorUnits === undefined
      ? transformScale(total, cnyDisplayScale, halfUp)
      : dinero({ amount: targetMinorUnits, currency: CNY })
  if (preciseParts.length === 0) {
    return toSnapshot(roundedTotal).amount === 0n ? [] : null
  }

  const ratios = preciseParts.map((part) => toSnapshot(part).amount)
  if (ratios.every((ratio) => ratio === 0n)) {
    return toSnapshot(roundedTotal).amount === 0n ? ratios.map(() => 0n) : null
  }

  return allocate(roundedTotal, ratios).map(
    (allocated) => toSnapshot(allocated).amount
  )
}

function parseCnyCost(value: number | string) {
  const serialized =
    typeof value === "number"
      ? Number.isFinite(value) && value >= 0
        ? value.toLocaleString("en-US", {
            useGrouping: false,
            maximumFractionDigits: Number(cnyTransportScale),
          })
        : null
      : value
  if (serialized === null) return null

  const match = /^(\d+)(?:\.(\d{1,12}))?$/u.exec(serialized)
  if (!match) return null
  const whole = match[1] ?? "0"
  const fraction = match[2] ?? ""
  return dinero({
    amount:
      BigInt(whole) * cnyTransportFactor +
      BigInt(fraction.padEnd(Number(cnyTransportScale), "0")),
    currency: CNY,
    scale: cnyTransportScale,
  })
}

function formatScaledTokenCount(
  value: bigint,
  scaleIndex: number,
  language: UsageNumberLanguage
): string {
  const scale = tokenScales[scaleIndex]
  if (!scale) return "—"

  const roundedTenths = (value * 10n + scale.divisor / 2n) / scale.divisor
  if (roundedTenths >= 10_000n && scaleIndex > 0) {
    return formatScaledTokenCount(value, scaleIndex - 1, language)
  }

  const whole = roundedTenths / 10n
  const fraction = roundedTenths % 10n
  const wholeLabel = whole.toLocaleString(language)
  if (fraction === 0n) return `${wholeLabel}${scale.suffix}`

  return `${wholeLabel}${decimalSeparator(language)}${fraction.toString()}${scale.suffix}`
}

function parseNonNegativeInteger(value: number | string): bigint | null {
  try {
    const parsed =
      typeof value === "number"
        ? Number.isFinite(value) && value >= 0
          ? BigInt(Math.round(value))
          : null
        : BigInt(value)
    return parsed !== null && parsed >= 0n ? parsed : null
  } catch {
    return null
  }
}

function decimalSeparator(language: UsageNumberLanguage): string {
  return (
    new Intl.NumberFormat(language)
      .formatToParts(1.1)
      .find((part) => part.type === "decimal")?.value ?? "."
  )
}
