import { expect, test } from "@playwright/test"
import { createSandboxBrowserFixture } from "../../api/test/web-site-sandbox-browser.fixture"

test("sandbox SDK preserves login and data through reload, file transfer and function calls", async ({
  page,
}) => {
  const fixture = await createSandboxBrowserFixture()
  try {
    await page.goto(
      `${fixture.origin}/app/s/40000000-0000-4000-8000-000000000001`
    )
    const frame = page.frameLocator("iframe")
    await expect(frame.locator("#status")).toHaveText("Ready")
    await frame
      .getByRole("button", { name: "Anonymous login", exact: true })
      .click()
    await expect(frame.locator("#result")).toContainText("ls-alpha-")
    const identity = await frame.locator("#result").textContent()
    expect(identity).not.toContain("secret")
    await frame.getByRole("button", { name: "Create row", exact: true }).click()
    await expect(frame.locator("#result")).toContainText("saved-note")
    await page.reload()
    await expect(frame.locator("#status")).toHaveText("Ready")
    await frame
      .getByRole("button", { name: "Current visitor", exact: true })
      .click()
    await expect(frame.locator("#result")).toContainText(
      JSON.parse(identity!).$id
    )
    await frame.getByRole("button", { name: "Load rows", exact: true }).click()
    await expect(frame.locator("#result")).toHaveText(
      '{"rows":[{"text":"saved-note"}]}'
    )
    await page.goto(`${fixture.origin}/app/beta`)
    await expect(page.frameLocator("iframe").locator("#status")).toHaveText(
      "Ready"
    )
    await page.goBack()
    await expect(frame.locator("#status")).toHaveText("Ready")
    await frame.getByRole("link", { name: "Next page", exact: true }).click()
    await expect(frame.locator("#status")).toHaveText("Ready")
    await frame
      .getByRole("button", { name: "Current visitor", exact: true })
      .click()
    await expect(frame.locator("#result")).toContainText(
      JSON.parse(identity!).$id
    )
    await frame
      .getByRole("button", { name: "Upload file", exact: true })
      .click()
    await expect(frame.locator("#result")).toHaveText('{"$id":"file"}')
    await frame
      .getByRole("button", { name: "Download file", exact: true })
      .click()
    await expect(frame.locator("#result")).toHaveText('{"text":"file-content"}')
    await frame
      .getByRole("button", { name: "Upload JSON file", exact: true })
      .click()
    await expect(frame.locator("#result")).toHaveText('{"$id":"file"}')
    await frame
      .getByRole("button", { name: "Download file", exact: true })
      .click()
    await expect(frame.locator("#result")).toHaveText(
      JSON.stringify({ text: ' { "a": 1 } ' })
    )
    await frame
      .getByRole("button", { name: "Run function", exact: true })
      .click()
    await expect(frame.locator("#result")).toContainText("responseStatusCode")
    await expect(page).toHaveURL(
      `${fixture.origin}/app/s/40000000-0000-4000-8000-000000000001`
    )
    await frame.getByRole("button", { name: "Logout", exact: true }).click()
    await expect(frame.locator("#result")).toHaveText("done")
    await frame
      .getByRole("button", { name: "Current visitor", exact: true })
      .click()
    await expect(frame.locator("#result")).toHaveText("AUTH_REQUIRED")
  } finally {
    await fixture.app.close()
  }
})

test("apps in the same browser keep separate visitors, data and logout", async ({
  page,
  context,
}) => {
  const fixture = await createSandboxBrowserFixture()
  try {
    await page.goto(`${fixture.origin}/app/alpha`)
    const alpha = page.frameLocator("iframe")
    await expect(alpha.locator("#status")).toHaveText("Ready")
    await alpha
      .getByRole("button", { name: "Anonymous login", exact: true })
      .click()
    await expect(alpha.locator("#result")).toContainText("ls-alpha-")
    const identity = JSON.parse(
      (await alpha.locator("#result").textContent())!
    ).$id
    const otherPage = await context.newPage()
    await otherPage.goto(`${fixture.origin}/app/beta`)
    const beta = otherPage.frameLocator("iframe")
    await expect(beta.locator("#status")).toHaveText("Ready")
    await beta
      .getByRole("button", { name: "Current visitor", exact: true })
      .click()
    await expect(beta.locator("#result")).toHaveText("AUTH_REQUIRED")
    await beta
      .getByRole("button", { name: "Anonymous login", exact: true })
      .click()
    await expect(beta.locator("#result")).toContainText("ls-beta-")
    await beta.getByRole("button", { name: "Load rows", exact: true }).click()
    await expect(beta.locator("#result")).toHaveText('{"rows":[]}')
    await beta.getByRole("button", { name: "Logout", exact: true }).click()
    await expect(beta.locator("#result")).toHaveText("done")
    await alpha
      .getByRole("button", { name: "Current visitor", exact: true })
      .click()
    await expect(alpha.locator("#result")).toContainText(identity)
    fixture.disable("alpha")
    await alpha.getByRole("button", { name: "Load rows", exact: true }).click()
    await expect(alpha.locator("#result")).toHaveText("WEB_SITE_NOT_FOUND")
    await otherPage.close()
  } finally {
    await fixture.app.close()
  }
})

test("raw and framed app code cannot acquire the console origin or bootstrap another app", async ({
  page,
}) => {
  const fixture = await createSandboxBrowserFixture()
  try {
    await page.goto(`${fixture.origin}/app/alpha`)
    await expect(page.frameLocator("iframe").locator("#status")).toHaveText(
      "Ready"
    )
    const child = page.frames().find((frame) => frame !== page.mainFrame())!
    const blocked = await child.evaluate(() => {
      const result: string[] = []
      for (const read of [
        () => parent.document.body,
        () => parent.localStorage,
        () => document.cookie,
        () => localStorage,
      ]) {
        try {
          read()
          result.push("allowed")
        } catch (error) {
          result.push(error instanceof DOMException ? error.name : "blocked")
        }
      }
      return result
    })
    expect(blocked).toEqual([
      "SecurityError",
      "SecurityError",
      "SecurityError",
      "SecurityError",
    ])
    const fetchResult = await child.evaluate(async (url) => {
      try {
        return await (await fetch(url, { credentials: "include" })).text()
      } catch {
        return "blocked"
      }
    }, `${fixture.origin}/app/beta`)
    expect(fetchResult).toBe("blocked")
    const raw = child.url()
    await page
      .frameLocator("iframe")
      .getByRole("link", {
        name: "Other application release",
        exact: true,
      })
      .click()
    await expect
      .poll(() => child.url())
      .toMatch(/^(?:chrome-error:\/\/|.*\/web\/alpha\/)/)
    expect(child.url()).not.toContain("/web/beta/")
    await page.goto(raw)
    const rawStorage = await page.evaluate(() => {
      try {
        return localStorage.length
      } catch (error) {
        return error instanceof DOMException ? error.name : "blocked"
      }
    })
    expect(rawStorage).toBe("SecurityError")
  } finally {
    await fixture.app.close()
  }
})
