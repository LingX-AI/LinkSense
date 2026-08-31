import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

type RouteHandler = (route: {
  request: () => { method: () => string }
  continue: () => Promise<void>
  abort: (errorCode: "blockedbyclient") => Promise<void>
}) => Promise<void>

type WebSocketRouteHandler = (route: {
  close: (options: { code: number; reason: string }) => Promise<void>
}) => Promise<void>

type InitializableBrowserPage = {
  route: (url: string, handler: RouteHandler) => Promise<void>
  routeWebSocket: (
    url: string,
    handler: WebSocketRouteHandler,
  ) => Promise<void>
}

type BrowserInitPageModule = {
  default: (input: { page: InitializableBrowserPage }) => Promise<void>
  installReadOnlyBrowserRequestPolicy: (
    page: InitializableBrowserPage,
  ) => Promise<void>
  isReadOnlyBrowserRequestMethod: (method: string) => boolean
}

let browserInitPage: BrowserInitPageModule

beforeAll(async () => {
  const modulePath = new URL(
    "../../../deploy/runtime/browser/init-page.ts",
    import.meta.url,
  )
  browserInitPage = (await import(modulePath.href)) as BrowserInitPageModule
})

afterEach(() => vi.unstubAllEnvs())

describe("managed browser Plan request policy", () => {
  it("allows only read-oriented HTTP methods", () => {
    for (const method of ["GET", "head", "Options"]) {
      expect(browserInitPage.isReadOnlyBrowserRequestMethod(method)).toBe(true)
    }
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "CONNECT"]) {
      expect(browserInitPage.isReadOnlyBrowserRequestMethod(method)).toBe(false)
    }
  })

  it("continues read requests and aborts write requests", async () => {
    let handler: RouteHandler | undefined
    const page = {
      route: vi.fn(async (_url, next) => {
        handler = next
      }),
      routeWebSocket: vi.fn(async () => undefined),
    } satisfies InitializableBrowserPage
    await browserInitPage.installReadOnlyBrowserRequestPolicy(page)
    expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function))
    if (!handler) throw new Error("route handler was not installed")

    const continueRequest = vi.fn(async () => undefined)
    const abortRequest = vi.fn(async () => undefined)
    await handler({
      request: () => ({ method: () => "GET" }),
      continue: continueRequest,
      abort: abortRequest,
    })
    expect(continueRequest).toHaveBeenCalledOnce()
    expect(abortRequest).not.toHaveBeenCalled()

    continueRequest.mockClear()
    await handler({
      request: () => ({ method: () => "POST" }),
      continue: continueRequest,
      abort: abortRequest,
    })
    expect(continueRequest).not.toHaveBeenCalled()
    expect(abortRequest).toHaveBeenCalledWith("blockedbyclient")
  })

  it("closes WebSocket routes without connecting to the external server", async () => {
    let handler: WebSocketRouteHandler | undefined
    const page = {
      route: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async (_url, next) => {
        handler = next
      }),
    } satisfies InitializableBrowserPage
    await browserInitPage.installReadOnlyBrowserRequestPolicy(page)
    expect(page.routeWebSocket).toHaveBeenCalledWith(
      "**/*",
      expect.any(Function),
    )
    if (!handler) throw new Error("WebSocket route handler was not installed")

    const close = vi.fn(async () => undefined)
    await handler({ close })
    expect(close).toHaveBeenCalledWith({
      code: 1008,
      reason: "WebSocket is unavailable in LinkSense Plan mode",
    })
  })

  it("installs the route only for the Plan browser subprocess", async () => {
    const page = {
      route: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async () => undefined),
    } satisfies InitializableBrowserPage

    vi.stubEnv("LINKSENSE_BROWSER_READ_ONLY", "0")
    await browserInitPage.default({ page })
    expect(page.route).not.toHaveBeenCalled()
    expect(page.routeWebSocket).not.toHaveBeenCalled()

    vi.stubEnv("LINKSENSE_BROWSER_READ_ONLY", "1")
    await browserInitPage.default({ page })
    expect(page.route).toHaveBeenCalledWith("**/*", expect.any(Function))
    expect(page.routeWebSocket).toHaveBeenCalledWith(
      "**/*",
      expect.any(Function),
    )
  })
})
