export type WorkerHttpResponse = {
  statusCode: number
  headers: Record<string, string>
  body: Buffer
}

export interface WorkerTransport {
  request(
    baseUrl: string,
    path: string,
    method: string,
    headers: Record<string, string>,
    body?: Buffer,
    timeoutMs?: number,
  ): Promise<WorkerHttpResponse>
}

export class FetchWorkerTransport implements WorkerTransport {
  constructor(private readonly timeoutMs = 60_000) {}

  async request(
    baseUrl: string,
    requestPath: string,
    method: string,
    headers: Record<string, string>,
    body?: Buffer,
    timeoutMs?: number,
  ): Promise<WorkerHttpResponse> {
    const response = await fetch(new URL(requestPath, baseUrl), {
      method,
      headers,
      ...(body && body.byteLength > 0 ? { body: body.toString("utf8") } : {}),
      signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
    })
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer()),
    }
  }
}
