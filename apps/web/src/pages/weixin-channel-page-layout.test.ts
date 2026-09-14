// @vitest-environment node

import appStyles from "@/index.css?raw"
import weixinChannelPageSource from "@/pages/weixin-channel-page.tsx?raw"
import { describe, expect, it } from "vitest"

function declarationFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = appStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "u")
  )

  return match?.groups?.body ?? ""
}

describe("weixin channel page layout", () => {
  it("uses flat channel rows inside a single card on desktop and mobile", () => {
    expect(declarationFor(".channel-access-list")).toMatch(/gap:\s*0;/u)
    expect(declarationFor(".channel-access-list")).toMatch(
      /padding-block:\s*0;/u
    )
    const row = declarationFor(".channel-access-card")
    expect(row).toMatch(/border:\s*0;/u)
    expect(row).toMatch(/border-radius:\s*0;/u)
    const rules = Array.from(
      appStyles.matchAll(/\.channel-access-card\s*\{([^}]*)\}/gu)
    )
    for (const rule of rules) {
      expect(rule[1]).toMatch(/padding:\s*16px 0;/u)
    }
  })
  it("keeps connected channel actions in the top-right of the card", () => {
    expect(weixinChannelPageSource).toContain(
      'className="channel-access-card channel-access-card-manageable"'
    )

    expect(declarationFor(".channel-access-card-manageable")).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) auto;/u
    )
    expect(
      declarationFor(".channel-access-card-manageable .channel-access-actions")
    ).toMatch(/grid-column:\s*2;[\s\S]*grid-row:\s*1;/u)
  })

  it("keeps the destructive compact action red on its tinted background", () => {
    expect(weixinChannelPageSource).toContain(
      'className="channel-access-action-destructive"'
    )
    expect(
      declarationFor(
        ".channel-access-actions .channel-access-action-destructive[aria-label],\n.channel-access-actions .channel-access-action-destructive[aria-label]:hover"
      )
    ).toMatch(/color:\s*var\(--destructive\);/u)
  })
})
