import { desktopLoginAuthorizeInputSchema } from "@linksense/shared"
import { z } from "zod"

const storageKey = "linksense.desktop-login-return"
const savedReturnSchema = z.strictObject({
  destination: z.string().max(2_000),
  expiresAt: z.number().int().positive(),
})

export function readDesktopLoginRequest(search: string) {
  const params = new URLSearchParams(search)
  if (
    search.length > 2_000 ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1)
  ) {
    return null
  }
  const parsed = desktopLoginAuthorizeInputSchema.safeParse(
    Object.fromEntries(params)
  )
  return parsed.success ? parsed.data : null
}

export function rememberDesktopLoginReturn(search: string): void {
  if (!readDesktopLoginRequest(search)) return
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        destination: `/desktop/authorize${search}`,
        expiresAt: Date.now() + 5 * 60_000,
      })
    )
  } catch {
    // Router state still supports password login when browser storage is disabled.
  }
}

export function desktopLoginReturn(): string | null {
  try {
    const parsed = savedReturnSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey) ?? "null")
    )
    if (parsed.success && parsed.data.expiresAt > Date.now()) {
      const url = new URL(parsed.data.destination, window.location.origin)
      if (
        url.origin === window.location.origin &&
        url.pathname === "/desktop/authorize" &&
        url.hash === "" &&
        readDesktopLoginRequest(url.search)
      ) {
        return `${url.pathname}${url.search}`
      }
    }
    clearDesktopLoginReturn()
  } catch {
    // An unavailable browser store does not prevent ordinary sign-in.
  }
  return null
}

export function clearDesktopLoginReturn(): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // Browser storage may be disabled.
  }
}
