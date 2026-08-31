type StableOperation = { fingerprint: string; id: string }

export function operationAttemptId(reference: {
  current: string | null
}): string {
  reference.current ??= crypto.randomUUID()
  return reference.current
}

export async function stableOperationId(
  reference: { current: StableOperation | null },
  payload: Record<string, unknown>
): Promise<string> {
  const fingerprint = JSON.stringify(payload)
  if (reference.current?.fingerprint === fingerprint)
    return reference.current.id
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint))
  )
  digest[6] = (digest[6]! & 0x0f) | 0x50
  digest[8] = (digest[8]! & 0x3f) | 0x80
  const hex = Array.from(digest.subarray(0, 16), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("")
  const operation = {
    fingerprint,
    id: [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-"),
  }
  reference.current = operation
  return operation.id
}
