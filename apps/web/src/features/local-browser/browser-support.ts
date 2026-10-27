import { z } from "zod"

const hintsSchema = z.object({
  brands: z.array(z.object({ brand: z.string() })),
  mobile: z.boolean().optional(),
})

export function browserUseBrowser(
  browser: { userAgent: string; userAgentData?: unknown } = navigator
): "chrome" | "edge" | null {
  if (
    /Android|iPhone|iPad|iPod|Mobile|EdgiOS|EdgA|CriOS|OPR\/|Opera|SamsungBrowser|Vivaldi|YaBrowser/iu.test(
      browser.userAgent
    )
  )
    return null
  const hints = hintsSchema.safeParse(browser.userAgentData)
  if (hints.success) {
    if (hints.data.mobile) return null
    if (hints.data.brands.some(({ brand }) => brand === "Microsoft Edge"))
      return "edge"
    if (hints.data.brands.some(({ brand }) => brand === "Google Chrome"))
      return "chrome"
    return null
  }
  if (/Edg\//u.test(browser.userAgent)) return "edge"
  if (/(?:Headless)?Chrome\//u.test(browser.userAgent)) return "chrome"
  return null
}
