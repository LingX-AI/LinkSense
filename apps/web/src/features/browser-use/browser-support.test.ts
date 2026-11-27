// @vitest-environment node
import { expect, it } from "vitest"
import { browserUseBrowser } from "./browser-support"

const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36"
it.each([
  [chrome, "chrome"],
  [chrome + " Edg/154.0.0.0", "edge"],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15",
    null,
  ],
  ["Mozilla/5.0 Gecko/20100101 Firefox/154.0", null],
  [chrome + " OPR/100.0", null],
  [chrome + " Vivaldi/7.0", null],
  [chrome + " Android Mobile", null],
  [chrome + " EdgA/154.0", null],
  [
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/154.0 Mobile Safari/604.1",
    null,
  ],
  ["Mozilla/5.0 (iPad) EdgiOS/154.0", null],
])(
  "detects desktop Chrome/Edge and rejects unsupported user agent %s",
  (userAgent, expected) => {
    expect(browserUseBrowser({ userAgent })).toBe(expected)
  }
)

it("uses unordered low-entropy brands and rejects other Chromium browsers", () => {
  expect(
    browserUseBrowser({
      userAgent: chrome,
      userAgentData: {
        brands: [{ brand: "Not A Brand" }, { brand: "Google Chrome" }],
        mobile: false,
      },
    })
  ).toBe("chrome")
  expect(
    browserUseBrowser({
      userAgent: chrome,
      userAgentData: {
        brands: [{ brand: "Chromium" }, { brand: "Microsoft Edge" }],
        mobile: false,
      },
    })
  ).toBe("edge")
  expect(
    browserUseBrowser({
      userAgent: chrome,
      userAgentData: {
        brands: [{ brand: "Chromium" }, { brand: "Brave" }],
        mobile: false,
      },
    })
  ).toBeNull()
  expect(
    browserUseBrowser({
      userAgent: chrome,
      userAgentData: { brands: [{ brand: "Google Chrome" }], mobile: true },
    })
  ).toBeNull()
})
