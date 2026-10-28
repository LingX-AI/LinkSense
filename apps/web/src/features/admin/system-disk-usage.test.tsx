import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  supportedLocales,
  unavailableDiskUsage,
  type DiskUsage,
} from "@linksense/shared"
import i18n from "@/i18n"
import { SystemDiskUsage } from "./system-disk-usage"
import { diskUsageMessages } from "./system-disk-usage-messages"
import { formatResourceBytes } from "./resource-format"

afterEach(() => cleanup())
const usage: DiskUsage = {
  status: "available",
  checked_at: "2026-10-28T08:00:00.000Z",
  refreshing: false,
  total_bytes: 3 * 1024 ** 3,
  categories: [
    { key: "user_data", used_bytes: 2 * 1024 ** 3, status: "available" },
    { key: "file_storage", used_bytes: 1024 ** 3, status: "available" },
  ],
}

describe("compact disk usage indicator", () => {
  it.each(supportedLocales)(
    "shows only a localized label and a complete total in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      render(<SystemDiskUsage usage={usage} language={language} />)
      const group = screen.getByRole("group", {
        name: diskUsageMessages[language].title,
      })
      expect(
        within(group).getByText(
          formatResourceBytes(usage.total_bytes, language),
          { normalizer: (value) => value }
        )
      ).toBeInTheDocument()
      expect(group.querySelector("dl")).toBeNull()
      expect(group.querySelector("p")).toBeNull()
      expect(group.textContent).not.toMatch(/health\.disk\.|2026-10-28/u)
    }
  )

  it("does not display a tiny subtotal as the disk total when the user space is missing", async () => {
    await i18n.changeLanguage("zh-CN")
    render(
      <SystemDiskUsage
        language="zh-CN"
        usage={{
          ...usage,
          status: "partial",
          total_bytes: 12288,
          categories: [
            { key: "user_data", used_bytes: null, status: "unavailable" },
            { key: "other", used_bytes: 12288, status: "partial" },
          ],
        }}
      />
    )
    expect(screen.queryByRole("group")).not.toBeInTheDocument()
    expect(
      screen.queryByText(formatResourceBytes(12288, "zh-CN"))
    ).not.toBeInTheDocument()
  })

  it.each(["unavailable", "collecting"] as const)(
    "keeps the %s disk indicator hidden without an invented zero",
    async (status) => {
      await i18n.changeLanguage("zh-CN")
      render(
        <SystemDiskUsage
          language="zh-CN"
          usage={{ ...unavailableDiskUsage(), status }}
        />
      )
      expect(screen.queryByRole("group")).not.toBeInTheDocument()
      expect(screen.queryByText("0 B")).not.toBeInTheDocument()
    }
  )

  it("updates the total when a complete sample arrives", async () => {
    await i18n.changeLanguage("zh-CN")
    const { rerender } = render(
      <SystemDiskUsage
        language="zh-CN"
        usage={{ ...unavailableDiskUsage(), status: "collecting" }}
      />
    )
    rerender(<SystemDiskUsage language="zh-CN" usage={usage} />)
    expect(
      screen.getByText(formatResourceBytes(usage.total_bytes, "zh-CN"))
    ).toBeInTheDocument()
    expect(
      screen.getByRole("group", { name: diskUsageMessages["zh-CN"].title })
    ).toBeInTheDocument()
  })

  it("preserves six locale key sets, interpolation and Chinese fallback", () => {
    const baseline = diskUsageMessages["zh-CN"]
    for (const locale of supportedLocales) {
      const messages = diskUsageMessages[locale]
      expect(Object.keys(messages).sort()).toEqual(Object.keys(baseline).sort())
      expect(messages.checkedAt.match(/\{\{[^}]+\}\}/gu)).toEqual(["{{time}}"])
      const fallback = i18n.cloneInstance({ forkResourceStore: true })
      if (locale !== "zh-CN")
        fallback.removeResourceBundle(locale, "translation")
      expect(fallback.t("health.disk.title", { lng: locale })).toBe(
        baseline.title
      )
    }
  })

  it("keeps one decimal place for a large disk total", async () => {
    await i18n.changeLanguage("zh-CN")
    render(
      <SystemDiskUsage
        language="zh-CN"
        usage={{ ...usage, total_bytes: 40430346240 }}
      />
    )
    expect(screen.getByText("37.7 GB")).toBeInTheDocument()
  })

  it.each([
    [0, "0 byte"],
    [1024, "1 kB"],
    [1024 ** 3, "1 GB"],
    [2 * 1024 ** 4, "2 TB"],
    [null, "—"],
    [-1, "—"],
  ] as const)("formats %s bytes as %s", (bytes, expected) => {
    expect(formatResourceBytes(bytes, "en-US")).toBe(expected)
  })
})
