import { describe, expect, it } from "vitest"
import { supportedLocales } from "@linksense/shared"

import { desktopComputerPermissionMessages } from "./messages"

const source = desktopComputerPermissionMessages["zh-CN"]
const sourceKeys = Object.keys(source).sort()

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token).sort()
}

describe("desktop computer permission messages", () => {
  it.each(supportedLocales)(
    "defines every non-empty message in %s with the same interpolation",
    (locale) => {
      const messages = desktopComputerPermissionMessages[locale]
      expect(Object.keys(messages).sort()).toEqual(sourceKeys)
      for (const key of sourceKeys) {
        const value = messages[key as keyof typeof messages]
        expect(value.trim()).not.toBe("")
        expect(interpolationTokens(value)).toEqual(
          interpolationTokens(source[key as keyof typeof source])
        )
        if (locale !== "zh-CN") {
          expect(value).not.toBe(source[key as keyof typeof source])
        }
      }
    }
  )
})
