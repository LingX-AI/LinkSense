import { fireEvent, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import source from "../../../../../examples/interactive-dependency-check/app.js?raw"
import markup from "../../../../../examples/interactive-dependency-check/index.html?raw"

async function setup() {
  document.body.innerHTML = markup
  const sdk = {
    ready: vi.fn(async () => undefined),
    tasks: { run: vi.fn(async () => ({ turn_id: "test" })) },
    chat: { show: vi.fn(async () => undefined) },
    events: { on: vi.fn() },
  }
  new Function("window", "document", source)({ LinkSense: sdk }, document)
  await waitFor(() => expect(document.querySelector("#run")).not.toBeDisabled())
  return sdk
}
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
describe("resource matching test example", () => {
  it.each(["zh-CN", "en-US", "de-DE"])(
    "uses localized text with fallback and submits only after explicit user action (%s)",
    async (language) => {
      const sdk = await setup()
      fireEvent.change(document.querySelector("#language")!, {
        target: { value: language },
      })
      expect(document.querySelector("h1")?.textContent).toBe(
        language === "en-US"
          ? "Interactive resource matching test"
          : "交互式资源匹配测试"
      )
      expect(sdk.tasks.run).not.toHaveBeenCalled()
      const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!
      fireEvent.change(prompt, { target: { value: "Read the test policy." } })
      fireEvent.submit(document.querySelector("#test-form")!)
      await waitFor(() =>
        expect(sdk.tasks.run).toHaveBeenCalledWith({
          prompt: "Read the test policy.",
        })
      )
      expect(document.querySelector("#status")?.textContent).toContain(
        language === "en-US" ? "accepted" : "已受理"
      )
    }
  )
  it("reports task submission errors without claiming success and renders event data as text", async () => {
    const sdk = await setup()
    sdk.tasks.run.mockRejectedValueOnce(new Error("Unavailable"))
    fireEvent.submit(document.querySelector("#test-form")!)
    await waitFor(() =>
      expect(document.querySelector("#status")?.textContent).toContain(
        "操作失败"
      )
    )
    const callback = sdk.events.on.mock.calls[0]?.[1]
    if (typeof callback !== "function")
      throw new Error("Missing event subscription")
    callback({ payload: { message: "<img src=x onerror=alert(1)>" } })
    expect(document.querySelector("#result img")).toBeNull()
    expect(document.querySelector("#result")?.textContent).toContain("<img")
  })
})
