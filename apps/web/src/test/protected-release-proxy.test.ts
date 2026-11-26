// @vitest-environment node
import { createLogger, resolveConfig } from "vite"
import { expect, it, vi } from "vitest"

it("redacts protected public-site URLs from Vite proxy errors", async () => {
  const logger = createLogger()
  const error = vi.spyOn(logger, "error").mockImplementation(() => {})
  const config = await resolveConfig({ customLogger: logger }, "serve")
  config.logger.error(
    "\u001b[31mhttp proxy error: /web/_protected/site/release/test-grant/index.js?private=fixture\u001b[39m\nConnection closed"
  )
  config.logger.error("http proxy error: /web/sample\nConnection closed")

  expect(error).toHaveBeenNthCalledWith(
    1,
    "http proxy error: /web/_protected/[redacted]\nConnection closed",
    undefined
  )
  expect(error).toHaveBeenNthCalledWith(
    2,
    "http proxy error: /web/sample\nConnection closed",
    undefined
  )
})
