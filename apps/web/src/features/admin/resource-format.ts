import type { Locale } from "@linksense/shared"

export function formatResourceBytes(
  value: number | null | undefined,
  language: Locale,
  maximumFractionDigits?: number
): string {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < 0
  )
    return "—"
  const units = [
    "byte",
    "kilobyte",
    "megabyte",
    "gigabyte",
    "terabyte",
    "petabyte",
  ] as const
  const index =
    value === 0
      ? 0
      : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: units[index],
    unitDisplay: "short",
    maximumFractionDigits: maximumFractionDigits ?? (scaled >= 10 ? 0 : 1),
  }).format(scaled)
}
