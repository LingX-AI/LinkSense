import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"

/**
 * Base UI renders aria-hidden focus guards at the edges of popups. Axe 4.14
 * reports them as aria-hidden-focus artifacts even though they are library
 * internals, so every scan excludes them.
 */
export function createAxeBuilder(page: Page) {
  return new AxeBuilder({ page }).exclude("[data-base-ui-focus-guard]")
}
