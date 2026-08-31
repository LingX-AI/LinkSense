const readOnlyMethods = new Set(["GET", "HEAD", "OPTIONS"])

type BrowserRoute = {
  request: () => { method: () => string }
  continue: () => Promise<void>
  abort: (errorCode: "blockedbyclient") => Promise<void>
}

type BrowserWebSocketRoute = {
  close: (options: { code: number; reason: string }) => Promise<void>
}

export type InitializableBrowserPage = {
  route: (
    url: string,
    handler: (route: BrowserRoute) => Promise<void>,
  ) => Promise<void>
  routeWebSocket: (
    url: string,
    handler: (route: BrowserWebSocketRoute) => Promise<void>,
  ) => Promise<void>
}

export function isReadOnlyBrowserRequestMethod(method: string): boolean {
  return readOnlyMethods.has(method.toUpperCase())
}

export async function installReadOnlyBrowserRequestPolicy(
  page: InitializableBrowserPage,
): Promise<void> {
  await page.route("**/*", async (route) => {
    if (isReadOnlyBrowserRequestMethod(route.request().method())) {
      await route.continue()
      return
    }
    await route.abort("blockedbyclient")
  })
  await page.routeWebSocket("**/*", async (route) => {
    await route.close({
      code: 1008,
      reason: "WebSocket is unavailable in LinkSense Plan mode",
    })
  })
}

export default async function initializePage(input: {
  page: InitializableBrowserPage
}): Promise<void> {
  if (process.env.LINKSENSE_BROWSER_READ_ONLY !== "1") return
  await installReadOnlyBrowserRequestPolicy(input.page)
}
