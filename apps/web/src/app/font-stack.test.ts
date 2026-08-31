import appStyles from "@/index.css?raw"
import notoSansScStyles from "@fontsource-variable/noto-sans-sc/wght.css?raw"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const fontLicense = readFileSync(
  resolve(process.cwd(), "public/licenses/fonts-OFL-1.1.txt"),
  "utf8"
)

describe("application font stack", () => {
  it("loads the Chinese variable font from local package assets", () => {
    expect(appStyles).toContain(
      '@import "@fontsource-variable/noto-sans-sc/wght.css";'
    )
    expect(notoSansScStyles).toContain("font-family: 'Noto Sans SC Variable';")
    expect(notoSansScStyles).toContain("font-weight: 100 900;")
    expect(notoSansScStyles).toMatch(
      /src:\s*url\(\.\/files\/noto-sans-sc-[^)]+\.woff2\)/u
    )
    expect(notoSansScStyles).not.toMatch(/https?:\/\//u)
  })

  it("ships the required copyright notices and open font license", () => {
    expect(fontLicense).toContain("Copyright 2016 The Inter Project Authors")
    expect(fontLicense).toContain("Noto Sans SC Variable")
    expect(fontLicense).toContain("Google Inc.")
    expect(fontLicense).toContain("SIL OPEN FONT LICENSE Version 1.1")
  })

  it("prefers PingFang for Chinese on Apple systems before the bundled fallback", () => {
    const fontStack = appStyles
      .match(/--font-sans:\s*([^;]+);/u)?.[1]
      ?.replace(/\s+/gu, " ")
      .trim()

    expect(fontStack).toBe(
      '"Inter Variable", "PingFang SC", "Noto Sans SC Variable", "Microsoft YaHei", sans-serif'
    )
  })
})
