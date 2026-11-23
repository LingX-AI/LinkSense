import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  browserUsePairingSchema,
  browserUseStatusSchema,
} from "@linksense/shared"
import { chromium, expect } from "@playwright/test"
import { z } from "zod"
import type { AttachDesktopBrowserExtension } from "../../../api/test/integration/desktop-package-roundtrip.js"

const title = "Shared Chromium fixture tab"
const unsharedTitle = "Unshared Chromium fixture tab"
const button = "Click fixture"

export const attachDesktopBrowserExtension: AttachDesktopBrowserExtension =
  async (input) => {
    const extension = fileURLToPath(
      new URL("../../../api/dist/browser-extension/", import.meta.url)
    )
    const target = createServer((request, response) => {
      if (request.url !== "/" && request.url !== "/unshared") {
        response.writeHead(404).end()
        return
      }
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><title>${request.url === "/" ? title : unsharedTitle}</title><button id="action">${button}</button><output id="count">0</output>
      <script>document.getElementById("action").addEventListener("click", () => {
        const count = document.getElementById("count");
        count.textContent = String(Number(count.textContent) + 1);
      });</script>`
        )
    })
    const closeTarget = () =>
      new Promise<void>((resolve, reject) =>
        target.close((error) => (error ? reject(error) : resolve()))
      )
    let closeBrowser: (() => Promise<void>) | undefined
    try {
      const listening = once(target, "listening", {
        signal: AbortSignal.timeout(5_000),
      })
      target.listen(0, "127.0.0.1")
      await listening
      const address = target.address()
      assert(
        address && typeof address === "object",
        "missing Chromium fixture address"
      )
      const url = `http://127.0.0.1:${address.port}/`
      const browser = await chromium.launchPersistentContext(
        join(input.scratch, "chromium-profile"),
        {
          channel: "chromium",
          headless: true,
          timeout: 15_000,
          args: [
            "--no-proxy-server",
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
          ],
        }
      )
      closeBrowser = () => browser.close()
      browser.setDefaultTimeout(5_000)
      const worker =
        browser.serviceWorkers()[0] ??
        (await browser.waitForEvent("serviceworker"))
      const extensionId = new URL(worker.url()).hostname
      const settings = await browser.newPage()
      assert((await settings.goto(`${input.address}/settings/general`))?.ok())
      const endpoint = `${input.address}/api/v1/browser-use`
      const response = await browser.request.post(`${endpoint}/pairing`, {
        headers: { origin: input.address },
        data: {},
        timeout: 5_000,
      })
      assert.equal(response.status(), 200, "browser pairing request failed")
      const { data: pairing } = z
        .object({ data: browserUsePairingSchema })
        .parse(await response.json())
      assert(
        pairing.endpoint === endpoint,
        "pairing must advertise the bound gateway"
      )
      await settings.evaluate(
        ({ pairing, ownerId }) => {
          window.postMessage(
            {
              source: "linksense-web",
              type: "pair",
              id: "joined",
              owner_id: ownerId,
              pairing,
            },
            location.origin
          )
        },
        { pairing, ownerId: input.ownerId }
      )
      const popup = await browser.newPage()
      await popup.goto(`chrome-extension://${extensionId}/popup.html`)
      await expect(popup.locator("#connection-badge")).toHaveAttribute(
        "data-state",
        "pending"
      )
      await expect(popup.locator("#new-tabs")).not.toBeChecked()
      await popup.locator("#connect").click()
      await expect(popup.locator("#connection-badge")).toHaveAttribute(
        "data-state",
        "connected"
      )
      const page = await browser.newPage()
      assert((await page.goto(url))?.ok())
      await page.bringToFront()
      await expect(popup.locator("#page-title")).toHaveText(title)
      await expect(popup.locator("#allow")).toBeEnabled()
      // The popup is a test tab; keep the fixture page active as a real toolbar popup would.
      await popup.locator("#allow").evaluate((control) => {
        if (!(control instanceof HTMLButtonElement))
          throw new Error("Share page button missing")
        control.click()
      })
      await expect(popup.locator("#page-shared")).toBeVisible()
      const unsharedPage = await browser.newPage()
      assert((await unsharedPage.goto(new URL("/unshared", url).href))?.ok())
      await unsharedPage.bringToFront()
      await expect(popup.locator("#page-title")).toHaveText(unsharedTitle)
      await expect(popup.locator("#allow")).toBeVisible()
      await expect(popup.locator("#allow")).toBeEnabled()
      await expect(popup.locator("#page-shared")).toBeHidden()
      await expect(popup.locator("#new-tabs")).not.toBeChecked()
      return {
        title,
        button,
        url,
        assertClickCounts: async (shared) => {
          await expect(page.locator("#count")).toHaveText(String(shared))
          await expect(unsharedPage.locator("#count")).toHaveText("0")
        },
        revoke: async () => {
          assert.equal(
            (
              await browser.request.delete(endpoint, { timeout: 5_000 })
            ).status(),
            200
          )
          const status = await browser.request.get(endpoint, { timeout: 5_000 })
          assert.equal(status.status(), 200)
          assert.deepEqual(
            z
              .object({ data: browserUseStatusSchema })
              .parse(await status.json()).data,
            { connected: false }
          )
        },
        close: () => browser.close().finally(closeTarget),
      }
    } catch (error) {
      try {
        await closeBrowser?.()
      } finally {
        if (target.listening) await closeTarget()
      }
      throw error
    }
  }
