import { useContext, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { apiRequest } from "@/api/client"
import { userSchema } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { AuthContext } from "@/app/auth-state"
import { notify } from "@/components/feedback/notification"
import {
  normalizeLanguage,
  setAppLanguage,
  type SupportedLanguage,
} from "@/i18n"

export type LanguageSelection = {
  t: TFunction
  language: SupportedLanguage
  pending: boolean
  error: string | null
  change: (value: string | null) => Promise<void>
}

export function useLanguageSelection({
  notifyErrors = true,
}: { notifyErrors?: boolean } = {}): LanguageSelection {
  const { t, i18n } = useTranslation()
  const auth = useContext(AuthContext)
  const scope = `${auth?.status ?? "public"}:${auth?.user?.id ?? "public"}`
  const [pendingScope, setPendingScope] = useState<string | null>(null)
  const [failure, setFailure] = useState<{
    scope: string
    message: string
  } | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  useLayoutEffect(
    () => () => {
      requestRef.current?.abort()
      requestRef.current = null
    },
    [scope]
  )
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const change = async (value: string | null) => {
    const next = normalizeLanguage(value)
    if (!next || next === language || requestRef.current) return
    const request = new AbortController()
    requestRef.current = request
    setPendingScope(scope)
    setFailure(null)
    try {
      if (auth?.status === "authenticated") {
        await apiRequest("/me", {
          method: "PATCH",
          body: { preferred_locale: next },
          schema: userSchema,
          signal: request.signal,
        })
      }
      if (request.signal.aborted) return
      await setAppLanguage(next)
      if (auth?.status === "authenticated" && !request.signal.aborted) {
        // The language is already saved. A profile refresh failure must not roll it back.
        try {
          await auth.refreshUser({ signal: request.signal })
        } catch {
          /* A later profile request can refresh it. */
        }
      }
    } catch (error) {
      if (request.signal.aborted) return
      const message = getErrorMessage(error, i18n.getFixedT(language))
      setFailure({ scope, message })
      if (notifyErrors) notify.error(message)
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null
        setPendingScope(null)
      }
    }
  }
  return {
    t,
    language,
    pending: pendingScope === scope,
    error: failure?.scope === scope ? failure.message : null,
    change,
  }
}
