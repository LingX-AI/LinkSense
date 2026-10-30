import { expect, type Locator } from "@playwright/test"

export async function expectPopupPadding(
  popup: Locator,
  itemSelector: string
): Promise<void> {
  await expect(popup).toBeVisible()
  await expect(popup.locator(itemSelector).first()).toBeVisible()
  await expect
    .poll(async () =>
      popup.locator(itemSelector).evaluateAll((items) =>
        items.flatMap((item) => {
          const bounds = item.getBoundingClientRect()
          const padding = parseFloat(getComputedStyle(item).paddingRight)
          const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
          const violations: string[] = []
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (
              !node.textContent?.trim() ||
              node.parentElement?.closest(
                '.truncate, .sr-only, [aria-hidden="true"]'
              )
            )
              continue
            const range = document.createRange()
            range.selectNodeContents(node)
            for (const rect of range.getClientRects()) {
              if (rect.width > 0 && bounds.right - rect.right < padding - 0.5) {
                violations.push(
                  `${node.textContent.trim()}: right spacing ${bounds.right - rect.right}px, expected ${padding}px`
                )
              }
            }
          }
          return violations
        })
      )
    )
    .toEqual([])
  const bounds = await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewport: window.innerWidth }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
}
