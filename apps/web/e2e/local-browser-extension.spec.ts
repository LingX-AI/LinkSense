import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"
import JSZip from "jszip"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createBrowserExtensionFixture } from "../../api/test/fixtures/local-browser-extension.js"
import type { LocalBrowserRequest, LocalBrowserResult } from "@linksense/shared"

test("an isolated Chrome extension pairs over non-localhost HTTP, reconnects, controls and revokes a real tab", async ({
  playwright,
}, testInfo) => {
  test.setTimeout(60_000)
  const owner = "10000000-0000-4000-8000-000000000001"
  const task = "20000000-0000-4000-8000-000000000001"
  const otherTask = "20000000-0000-4000-8000-000000000002"
  const date = new Date("2026-01-01T00:00:00.000Z")
  const target = createServer((request, response) => {
    response.setHeader("content-type", "text/html")
    response.setHeader(
      "content-security-policy",
      "require-trusted-types-for 'script'; trusted-types 'none'"
    )
    const signedIn = request.headers.cookie?.includes(
      "fixture_session=signed-in"
    )
    setTimeout(
      () =>
        response.end(
          '<!doctype html><html lang="en"><head><title>Local browser fixture</title><style>html{font-size:10px}body{margin:0;background:#f6f8fc;color:#252b49;font:16px system-ui}header{padding:28px 64px;background:#fff;border-bottom:1px solid #e5e8f0}main{max-width:680px;margin:72px auto;padding:32px;border:1px solid #e5e8f0;border-radius:16px;background:white;box-shadow:0 12px 36px #252b4908}h1{font-size:28px;margin:0 0 12px}label{display:block;margin:28px 0 18px}input{display:block;margin-top:8px;padding:10px 12px;border:1px solid #d8deea;border-radius:8px;font:inherit;width:92%}button{padding:10px 16px;border:1px solid #d8deea;border-radius:8px;background:#fff;color:#252b49;font:14px system-ui;cursor:pointer}button+button{margin-left:8px}p{color:#657089}#upper-action{position:fixed;left:50%;top:22px;transform:translateX(-50%)}#cancel-target{position:fixed;right:40px;bottom:70px}</style></head><body><header>Reference workspace</header><main><h1>Browser control</h1><p>A shared page with clear, visible assistant actions.</p><label>Name<input aria-label="Name" value="before"></label><button onclick="this.textContent=\'Clicked\'">Click me</button><button onclick="this.textContent=\'Coordinate clicked\'">Coordinates</button><p>' +
            (signedIn ? "Signed in" : "Guest") +
            '</p></main><button id="upper-action" onclick="this.textContent=\'Upper action clicked\'">Upper page action</button><button id="cancel-target" onclick="this.textContent=\'Wrong click\'">Do not click</button><div style="height:2000px;padding:0 64px">Fixture content</div></body></html>'
        ),
      150
    )
  })
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve))
  const targetAddress = target.address()
  if (!targetAddress || typeof targetAddress === "string")
    throw new Error("fixture port missing")
  const targetUrl = `http://127.0.0.1:${targetAddress.port}/`
  const {
    api,
    service,
    address: fixtureAddress,
    dropBrowserTransport,
  } = await createBrowserExtensionFixture(owner, date)
  const address = fixtureAddress.replace("127.0.0.1", "linksense-http.test")
  const directory = await mkdtemp(
    path.join(tmpdir(), "linksense-browser-extension-")
  )
  const extension = path.resolve(
    import.meta.dirname,
    "../../api/dist/browser-extension"
  )
  const browser = await playwright.chromium.launchPersistentContext(directory, {
    channel: "chromium",
    headless: true,
    args: [
      "--no-proxy-server",
      "--host-resolver-rules=MAP linksense-http.test 127.0.0.1",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  })
  const execute = async (
    input: LocalBrowserRequest,
    conversation = task
  ): Promise<Extract<LocalBrowserResult, { ok: true }>> => {
    const result = await service.execute(owner, conversation, input)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error(result.code)
    return result
  }
  try {
    const archiveResponse = await browser.request.get(
      `${fixtureAddress}/api/v1/local-browser/extension`
    )
    expect(archiveResponse.status()).toBe(200)
    const archive = await JSZip.loadAsync(await archiveResponse.body())
    expect(
      JSON.parse(await archive.file("manifest.json")!.async("string"))
    ).toMatchObject({
      manifest_version: 3,
      default_locale: "en",
      version: "0.4.5",
    })
    expect(archive.file("background.js")).not.toBeNull()
    expect(archive.file("ZOD-LICENSE")).not.toBeNull()
    expect(archive.file("LUCIDE-LICENSE")).not.toBeNull()
    for (const size of [16, 32, 48, 128]) {
      const icon = await archive
        .file(`icons/icon-${size}.png`)!
        .async("nodebuffer")
      expect(icon.readUInt32BE(16)).toBe(size)
      expect(icon.readUInt32BE(20)).toBe(size)
    }
    const localeKeys = Object.keys(
      JSON.parse(
        await archive.file("_locales/en/messages.json")!.async("string")
      )
    ).sort()
    for (const locale of ["en", "zh_CN", "es", "pt_BR", "fr", "ja"])
      expect(
        Object.keys(
          JSON.parse(
            await archive
              .file(`_locales/${locale}/messages.json`)!
              .async("string")
          )
        ).sort()
      ).toEqual(localeKeys)
    let [worker] = browser.serviceWorkers()
    if (!worker) worker = await browser.waitForEvent("serviceworker")
    const extensionId = new URL(worker.url()).host
    const page = await browser.newPage()
    await page.goto(`${address}/settings/general`)
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
    const pair = await service.pairing(owner, date.toISOString())
    await page.evaluate(
      (pairing) =>
        window.postMessage(
          { source: "linksense-web", type: "pair", id: "fixture", pairing },
          location.origin
        ),
      { code: pair.code, endpoint: `${address}/api/v1/local-browser` }
    )
    const popup = await browser.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(popup.locator("#connect")).toBeEnabled()
    await popup
      .locator("body")
      .screenshot({ path: testInfo.outputPath("popup-confirm.png") })
    await popup.locator("#new-tabs").check()
    await popup.locator("#connect").click()
    await expect
      .poll(async () => (await service.status(owner)).connected)
      .toBe(true)
    const managementTab = browser.waitForEvent("page")
    await page.evaluate(
      (owner) =>
        window.postMessage(
          {
            source: "linksense-web",
            type: "open_extensions",
            id: "open-manager",
            owner_id: owner,
          },
          location.origin
        ),
      owner
    )
    const management = await managementTab
    await expect(management).toHaveURL("chrome://extensions/")
    await management.close()
    await expect(popup.locator("#status")).toHaveText("Connected")
    await expect(popup.locator("#connect")).toBeHidden()
    const initialConnection = (await service.status(owner)).connection_id
    dropBrowserTransport()
    await expect
      .poll(
        async () => {
          const status = await service.status(owner)
          return (
            status.connected &&
            Boolean(status.connection_id) &&
            status.connection_id !== initialConnection
          )
        },
        { timeout: 10_000 }
      )
      .toBe(true)
    await page.goto(`${address}/conversations/new`)
    await worker.evaluate(async () => {
      await chrome.storage.session.remove("session")
    })
    const beforeRenewal = (await service.status(owner)).connection_id
    const renewal = await service.pairing(owner, date.toISOString())
    await page.evaluate(
      (pairing) =>
        window.postMessage(
          {
            source: "linksense-web",
            type: "pair",
            id: "renewal",
            automatic: true,
            owner_id: pairing.owner,
            pairing: { code: pairing.code, endpoint: pairing.endpoint },
          },
          location.origin
        ),
      { owner, code: renewal.code, endpoint: `${address}/api/v1/local-browser` }
    )
    await expect
      .poll(async () => {
        const status = await service.status(owner)
        return (
          status.connected &&
          Boolean(status.connection_id) &&
          status.connection_id !== beforeRenewal
        )
      })
      .toBe(true)
    await expect(popup.locator("#status")).toHaveText("Connected")
    await browser.addCookies([
      { name: "fixture_session", value: "signed-in", url: targetUrl },
    ])
    const pageCreated = browser.waitForEvent("page")
    const opened = await execute({ action: "open", url: targetUrl })
    const tabId = opened.data.tab_id!
    const targetPage = await pageCreated
    await targetPage.waitForURL(targetUrl)
    await targetPage.waitForLoadState()
    await expect(
      targetPage.getByText("Signed in", { exact: true })
    ).toBeVisible()
    const control = targetPage.locator("[data-linksense-control]")
    await expect(control).toBeVisible()
    await expect(control.locator("button")).toHaveCount(0)
    await expect(control.getByText("LinkSense", { exact: true })).toHaveCount(0)
    await expect(control.getByText("Page shared", { exact: true })).toHaveCount(
      0
    )
    await expect(control.locator("[data-linksense-frame]")).not.toHaveCSS(
      "box-shadow",
      "none"
    )
    await targetPage.evaluate(() => {
      document.addEventListener("mousemove", () => {
        document.body.dataset.controlMoves = String(
          Number(document.body.dataset.controlMoves ?? 0) + 1
        )
      })
      document.addEventListener("click", (event) => {
        if (!(event.target instanceof HTMLButtonElement)) return
        const cursor = document
          .querySelector("[data-linksense-control]")
          ?.shadowRoot?.querySelector<HTMLElement>("[data-linksense-cursor]")
        document.body.dataset.controlClick = JSON.stringify({
          x: event.clientX,
          y: event.clientY,
          cursorX: Number(cursor?.dataset.x),
          cursorY: Number(cursor?.dataset.y),
          trusted: event.isTrusted,
        })
      })
    })
    await expect(popup.locator("#page-title")).toHaveText(
      "Local browser fixture"
    )
    await expect(popup.locator("#page-shared")).toBeVisible()
    for (const colorScheme of ["light", "dark"] as const) {
      await popup.emulateMedia({ colorScheme })
      await popup.evaluate(() =>
        Promise.all(
          document.getAnimations().map((animation) => animation.finished)
        )
      )
      expect(
        (await new AxeBuilder({ page: popup }).analyze()).violations
      ).toEqual([])
      await popup
        .locator("body")
        .screenshot({ path: testInfo.outputPath(`popup-${colorScheme}.png`) })
    }
    await popup.emulateMedia({ colorScheme: "light" })
    await page.goto(`${address}/conversations/new`)
    await page.evaluate(
      (task) => history.pushState({}, "", `/conversations/${task}`),
      task
    )
    const previewRequest = async (
      type: "preview" | "activate",
      requestedTab = tabId
    ) =>
      page.evaluate(
        ({ type, owner, task, tab_id }) =>
          new Promise<unknown>((resolve) => {
            const id = `${type}-${Date.now()}`
            const receive = (event: MessageEvent) => {
              if (
                event.source === window &&
                event.data?.source === "linksense-extension" &&
                event.data.id === id
              ) {
                window.removeEventListener("message", receive)
                resolve(event.data.result)
              }
            }
            window.addEventListener("message", receive)
            window.postMessage(
              {
                source: "linksense-web",
                type,
                owner_id: owner,
                conversation_id: task,
                tab_id,
                id,
              },
              location.origin
            )
          }),
        { type, owner, task, tab_id: requestedTab }
      )
    expect(await previewRequest("preview")).toMatchObject({
      ok: true,
      preview: {
        tab_id: tabId,
        title: "Local browser fixture",
        url: targetUrl,
        image: expect.any(String),
      },
    })
    await page.bringToFront()
    expect(await previewRequest("activate")).toMatchObject({ ok: true })
    await expect
      .poll(() =>
        worker.evaluate(async () => {
          const [tab] = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
          })
          return tab?.id
        })
      )
      .toBe(tabId)
    expect(await previewRequest("activate", tabId + 999)).toMatchObject({
      ok: false,
    })
    const snapshot = await execute({ action: "snapshot", tab_id: tabId })
    expect(
      snapshot.data.elements?.some(
        (element) => element.name === "Stop sharing this page"
      )
    ).toBe(false)
    const button = snapshot.data.elements?.find(
      (element) => element.role === "button" && element.name === "Click me"
    )
    const input = snapshot.data.elements?.find(
      (element) => element.role === "textbox" && element.name === "Name"
    )
    expect(button).toBeTruthy()
    expect(input).toBeTruthy()
    const movingClick = execute({
      action: "click",
      tab_id: tabId,
      ref: button!.ref,
    })
    await expect(control.locator("[data-linksense-cursor]")).toHaveAttribute(
      "data-x",
      /\d+/
    )
    for (let frame = 0; frame < 8; frame++)
      await targetPage.screenshot({
        path: testInfo.outputPath(
          `cursor-motion-${String(frame).padStart(2, "0")}.png`
        ),
      })
    await movingClick
    await expect(
      targetPage.getByRole("button", { name: "Clicked" })
    ).toBeVisible()
    const clicked = await targetPage.evaluate(
      () =>
        JSON.parse(document.body.dataset.controlClick ?? "{}") as {
          x: number
          y: number
          cursorX: number
          cursorY: number
          trusted: boolean
        }
    )
    expect(clicked.trusted).toBe(true)
    expect(Math.abs(clicked.x - clicked.cursorX)).toBeLessThanOrEqual(1)
    expect(Math.abs(clicked.y - clicked.cursorY)).toBeLessThanOrEqual(1)
    expect(
      await targetPage.evaluate(() =>
        Number(document.body.dataset.controlMoves)
      )
    ).toBeGreaterThan(1)
    await targetPage.screenshot({
      path: testInfo.outputPath("controlled-page-pointer.png"),
    })
    for (const colorScheme of ["light", "dark"] as const) {
      await targetPage.emulateMedia({ colorScheme })
      expect(
        (
          await new AxeBuilder({ page: targetPage })
            .include("[data-linksense-control]")
            .analyze()
        ).violations
      ).toEqual([])
    }
    await targetPage.emulateMedia({ colorScheme: "light" })
    await targetPage.evaluate(() => {
      document.documentElement.style.transform = "translate(11px,7px)"
    })
    await expect
      .poll(async () => {
        const frame = (await control
          .locator("[data-linksense-frame]")
          .boundingBox())!
        return Math.abs(frame.x) < 1 && Math.abs(frame.y) < 1
      })
      .toBe(true)
    await targetPage.evaluate(() => {
      document.documentElement.style.transform = ""
    })
    const upper = (await targetPage
      .getByRole("button", { name: "Upper page action" })
      .boundingBox())!
    await execute({
      action: "click_at",
      tab_id: tabId,
      x: upper.x + upper.width / 2,
      y: upper.y + upper.height / 2,
    })
    await expect(
      targetPage.getByRole("button", { name: "Upper action clicked" })
    ).toBeVisible()
    const resetOrdinalTargets = () =>
      targetPage.evaluate(() => {
        document.querySelector("#ordinal-targets")?.remove()
        const row = document.createElement("div")
        row.id = "ordinal-targets"
        row.style.cssText =
          "position:fixed;left:286px;top:450px;display:flex;gap:8px"
        for (let ordinal = 1; ordinal <= 6; ordinal++) {
          const button = document.createElement("button")
          button.textContent = "Delete"
          button.dataset.ordinal = String(ordinal)
          button.style.cssText =
            "box-sizing:border-box;width:94px;height:40px;margin:0;padding:0"
          button.addEventListener("click", () => button.remove())
          row.append(button)
        }
        document.body.append(row)
      })
    const remainingOrdinals = () =>
      targetPage.locator("#ordinal-targets button").evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-ordinal"))
      )
    await resetOrdinalTargets()
    // Replay #68's wrong x=376: the first button spans 286..380, not the second.
    await execute({ action: "click_at", tab_id: tabId, x: 376, y: 470 })
    expect(await remainingOrdinals()).toEqual(["2", "3", "4", "5", "6"])
    await resetOrdinalTargets()
    const ordinalSnapshot = await execute({
      action: "snapshot",
      tab_id: tabId,
    })
    const deleteButtons = ordinalSnapshot.data.elements?.filter(
      (element) => element.role === "button" && element.name === "Delete"
    )
    expect(deleteButtons).toHaveLength(6)
    await execute({
      action: "click",
      tab_id: tabId,
      ref: deleteButtons![1]!.ref,
    })
    expect(await remainingOrdinals()).toEqual(["1", "3", "4", "5", "6"])
    const ordinalClick = await targetPage.evaluate(
      () =>
        JSON.parse(document.body.dataset.controlClick ?? "{}") as {
          x: number
          trusted: boolean
        }
    )
    expect(ordinalClick).toMatchObject({ x: 435, trusted: true })
    await targetPage.screenshot({
      path: testInfo.outputPath("ordinal-target-verified.png"),
    })
    await targetPage.evaluate(() =>
      document.querySelector("#ordinal-targets")?.remove()
    )
    await execute({ action: "click", tab_id: tabId, ref: input!.ref })
    await page.bringToFront()
    // Headless Chrome emulates page visibility; the browser's selected-tab state is authoritative.
    expect(
      await worker.evaluate(
        async (id) => (await chrome.tabs.get(id)).active,
        tabId
      )
    ).toBe(false)
    await execute({ action: "type", tab_id: tabId, text: "after", clear: true })
    await expect(targetPage.getByRole("textbox", { name: "Name" })).toHaveValue(
      "after"
    )
    expect(
      await worker.evaluate(
        async (id) => (await chrome.tabs.get(id)).active,
        tabId
      )
    ).toBe(false)
    await targetPage.bringToFront()
    await execute({ action: "type", tab_id: tabId, text: "", clear: true })
    await expect(targetPage.getByRole("textbox", { name: "Name" })).toHaveValue(
      ""
    )
    await execute({
      action: "type",
      tab_id: tabId,
      text: "after",
      clear: false,
    })
    await execute({ action: "key", tab_id: tabId, key: "SelectAll" })
    await execute({
      action: "type",
      tab_id: tabId,
      text: "浏览器输入",
      clear: false,
    })
    await expect(targetPage.getByRole("textbox", { name: "Name" })).toHaveValue(
      "浏览器输入"
    )
    const screenshot = await execute({ action: "screenshot", tab_id: tabId })
    expect(screenshot.data.image!.length).toBeGreaterThan(100)
    expect(screenshot.data.viewport!.width).toBeGreaterThan(0)
    const coordinateButton = await targetPage
      .getByRole("button", { name: "Coordinates" })
      .boundingBox()
    expect(coordinateButton).not.toBeNull()
    await targetPage.emulateMedia({ reducedMotion: "reduce" })
    const beforeReducedMove = await targetPage.evaluate(() =>
      Number(document.body.dataset.controlMoves)
    )
    await execute({
      action: "click_at",
      tab_id: tabId,
      x: coordinateButton!.x + coordinateButton!.width / 2,
      y: coordinateButton!.y + coordinateButton!.height / 2,
    })
    await expect(
      targetPage.getByRole("button", { name: "Coordinate clicked" })
    ).toBeVisible()
    expect(
      (await targetPage.evaluate(() =>
        Number(document.body.dataset.controlMoves)
      )) - beforeReducedMove
    ).toBe(1)
    await targetPage.emulateMedia({ reducedMotion: "no-preference" })
    await execute({
      action: "scroll",
      tab_id: tabId,
      x: 100,
      y: 200,
      delta_x: 0,
      delta_y: 400,
    })
    await expect
      .poll(() => targetPage.evaluate(() => scrollY))
      .toBeGreaterThan(0)
    expect(
      await service.execute(owner, otherTask, {
        action: "snapshot",
        tab_id: tabId,
      })
    ).toMatchObject({ ok: false, code: "LOCAL_BROWSER_TAB_BUSY" })
    await execute({ action: "release", tab_id: tabId })
    await execute({ action: "snapshot", tab_id: tabId }, otherTask)
    await execute({ action: "release", tab_id: tabId }, otherTask)
    expect(
      await service.execute(owner, task, { action: "snapshot", tab_id: 999999 })
    ).toMatchObject({ ok: false, code: "LOCAL_BROWSER_ACCESS_DENIED" })
    await execute({
      action: "navigate",
      tab_id: tabId,
      url: `${targetUrl}?next=1`,
    })
    await targetPage.waitForURL(`${targetUrl}?next=1`)
    expect(
      await service.execute(owner, task, {
        action: "click",
        tab_id: tabId,
        ref: button!.ref,
      })
    ).toMatchObject({ ok: false, code: "LOCAL_BROWSER_STALE_REF" })
    const cancelTarget = (await targetPage
      .getByRole("button", { name: "Do not click" })
      .boundingBox())!
    const cursor = control.locator("[data-linksense-cursor]")
    const previousX = Number(await cursor.getAttribute("data-x"))
    const stoppedClick = service.execute(owner, task, {
      action: "click_at",
      tab_id: tabId,
      x: cancelTarget.x + cancelTarget.width / 2,
      y: cancelTarget.y + cancelTarget.height / 2,
    })
    await expect
      .poll(async () => Number(await cursor.getAttribute("data-x")))
      .not.toBe(previousX)
    await popup.evaluate(() => document.getElementById("release")!.click())
    expect(await stoppedClick).toMatchObject({
      ok: false,
      code: "LOCAL_BROWSER_CANCELLED",
    })
    await expect(control).toBeHidden()
    await expect(
      targetPage.getByRole("button", { name: "Do not click" })
    ).toBeVisible()
    expect((await execute({ action: "tabs" })).data.tabs).toEqual([])
    expect((await service.status(owner)).connected).toBe(true)
    await popup.reload()
    await targetPage.bringToFront()
    await popup.evaluate(() => document.getElementById("allow")!.click())
    await expect
      .poll(async () => (await execute({ action: "tabs" })).data.tabs?.length)
      .toBe(1)
    await execute({ action: "snapshot", tab_id: tabId })
    expect(
      (
        await new AxeBuilder({ page: targetPage })
          .include("[data-linksense-control]")
          .analyze()
      ).violations
    ).toEqual([])
    await popup.reload()
    await targetPage.bringToFront()
    await popup.evaluate(() => document.getElementById("release")!.click())
    await expect
      .poll(async () => (await execute({ action: "tabs" })).data.tabs)
      .toEqual([])
    expect(
      await service.execute(owner, task, { action: "snapshot", tab_id: tabId })
    ).toMatchObject({ ok: false, code: "LOCAL_BROWSER_ACCESS_DENIED" })
    await service.revoke(owner)
    expect(await service.status(owner)).toEqual({ connected: false })
    expect(targetPage.isClosed()).toBe(false)
  } finally {
    await browser.close()
    await api.close()
    await new Promise<void>((resolve) => target.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
