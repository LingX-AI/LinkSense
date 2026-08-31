export type SearchParamUpdate = string | null | undefined

export function updateUrlSearchParams(
  current: URLSearchParams,
  updates: Readonly<Record<string, SearchParamUpdate>>
) {
  const next = new URLSearchParams(current)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value.length === 0) {
      next.delete(key)
    } else {
      next.set(key, value)
    }
  }
  return next
}

export function readUrlEnum<Value extends string>(
  searchParams: URLSearchParams,
  key: string,
  values: readonly Value[],
  fallback: Value
) {
  const value = searchParams.get(key)
  return value !== null && values.includes(value as Value)
    ? (value as Value)
    : fallback
}
