/** Only change the trailing API version, preserving the origin and proxy prefix. */
export function modelProviderFallbackUrl(baseUrl: string, requestUrl: URL): URL | null {
  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/+$/u, "")
  if (requestUrl.origin !== base.origin || !requestUrl.pathname.startsWith(`${basePath}/`)) {
    return null
  }
  const alternatePath = basePath.endsWith("/v1") ? basePath.slice(0, -3) : `${basePath}/v1`
  const alternate = new URL(requestUrl)
  alternate.pathname = `${alternatePath}${requestUrl.pathname.slice(basePath.length)}`
  return alternate
}

export function isModelProviderEndpointMissing(status: number | null): boolean {
  return status === 404 || status === 405
}

/** Resolve a missing endpoint once, without retrying inference or stream errors. */
export function createModelProviderFetch(baseUrl: string, fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    signal?.throwIfAborted()
    const response = await fetcher(input, init)
    if (!isModelProviderEndpointMissing(response.status)) return response
    // shortcut: stream-backed requests are not replayed; extend if SDKs stop sending URL + JSON.
    if (input instanceof Request || init?.body instanceof ReadableStream) return response
    const alternate = modelProviderFallbackUrl(baseUrl, new URL(input))
    if (!alternate) return response
    signal?.throwIfAborted()
    // Some transports never settle cancellation; cleanup must not outlive the request deadline.
    void response.body?.cancel().catch(() => undefined)
    return fetcher(alternate, init)
  }
}
