import { z } from "zod"
import { createRandomUuid } from "@/lib/random-uuid"
import {
  localBrowserPreviewSchema,
  type localBrowserPairingSchema,
} from "@linksense/shared"

const responseSchema = z.object({
  source: z.literal("linksense-extension"),
  id: z.string(),
  result: z.object({
    detected: z.boolean().optional(),
    ok: z.boolean().optional(),
    pairing_mode: z
      .enum([
        "connected",
        "reconnecting",
        "automatic",
        "confirmation",
        "pending",
        "blocked",
      ])
      .optional(),
    preview: localBrowserPreviewSchema.optional(),
  }),
})
export function browserExtensionRequest(
  type: "detect" | "pair" | "preview" | "activate" | "open_extensions",
  pairing?: z.infer<typeof localBrowserPairingSchema>,
  options?: {
    owner_id: string
    automatic?: boolean
    resume?: boolean
    conversation_id?: string
    tab_id?: number
  }
): Promise<z.infer<typeof responseSchema>["result"]> {
  return new Promise((resolve) => {
    const id = createRandomUuid()
    const finish = (result: z.infer<typeof responseSchema>["result"]) => {
      clearTimeout(timer)
      window.removeEventListener("message", receive)
      resolve(result)
    }
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== location.origin) return
      const response = responseSchema.safeParse(event.data)
      if (response.success && response.data.id === id)
        finish(response.data.result)
    }
    const timer = setTimeout(
      () => finish({ detected: false }),
      type === "pair" ? 15_000 : type === "activate" ? 5000 : 1500
    )
    window.addEventListener("message", receive)
    window.postMessage(
      {
        source: "linksense-web",
        type,
        id,
        ...(pairing ? { pairing } : {}),
        ...options,
      },
      location.origin
    )
  })
}
