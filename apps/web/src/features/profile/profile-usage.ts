export function activityLevel(
  totalTokens: string,
  peakDailyTokens: string
): 0 | 1 | 2 | 3 | 4 {
  const total = tokenValue(totalTokens)
  const peak = tokenValue(peakDailyTokens)
  if (total === 0n || peak === 0n) return 0
  const scaled = (total * 4n + peak - 1n) / peak
  if (scaled <= 1n) return 1
  if (scaled === 2n) return 2
  if (scaled === 3n) return 3
  return 4
}

export function averageTokensPerTurn(
  totalTokens: string,
  turnCount: number
): string {
  if (!/^\d+$/u.test(totalTokens) || turnCount <= 0) return "0"
  const turns = BigInt(turnCount)
  return ((BigInt(totalTokens) + turns / 2n) / turns).toString()
}

export function usageSharePercentage(
  modelTokens: string,
  totalTokens: string
): number {
  if (!/^\d+$/u.test(modelTokens) || !/^\d+$/u.test(totalTokens)) return 0
  const total = BigInt(totalTokens)
  if (total === 0n) return 0
  const tenths = (BigInt(modelTokens) * 1_000n) / total
  return Math.min(100, Number(tenths) / 10)
}

function tokenValue(value: unknown): bigint {
  return typeof value === "string" && /^\d+$/u.test(value) ? BigInt(value) : 0n
}
