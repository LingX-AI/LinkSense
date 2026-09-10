import { expect, it } from "vitest"
import { errorCatalog, pendingRequestBlockCodeSchema } from "@linksense/shared"
import i18n from "@/i18n"

it("shows a localized deployment stop reason and falls back to Chinese", () => {
  const entry = errorCatalog.DEPLOYMENT_STOPPED
  expect(pendingRequestBlockCodeSchema.parse("deployment_stopped")).toBe("deployment_stopped")
  for (const lng of ["zh-CN", "en-US"] as const) {
    expect(i18n.t(entry.message_key, { lng })).toBe(entry.messages[lng])
    const key = "conversation.pendingBlockCodes.deployment_stopped"
    expect(i18n.t(key, { lng })).not.toBe(key)
  }
  const fallback = i18n.cloneInstance({ forkResourceStore: true })
  fallback.removeResourceBundle("en-US", "translation")
  expect(fallback.t(entry.message_key, { lng: "en-US" })).toBe(entry.messages["zh-CN"])
})
