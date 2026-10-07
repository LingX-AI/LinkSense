import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import {
  socialCallbackResultSchema,
  socialEmailInputSchema,
  type SocialCallbackResult,
} from "@linksense/shared"
import { z } from "zod"
import { apiRequest, refreshSession } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function SocialCallbackPage() {
  const { t } = useTranslation()
  const { acceptSession } = useAuth()
  const navigate = useNavigate()
  const [initial] = useState(() => {
    const url = new URL(window.location.href)
    const parsed = socialCallbackResultSchema.safeParse(
      url.searchParams.get("result")
    )
    return {
      result: parsed.success ? parsed.data : ("failed" as const),
      token: new URLSearchParams(url.hash.slice(1)).get("token"),
    }
  })
  const [result, setResult] = useState<SocialCallbackResult>(initial.result)
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const attempted = useRef(false)
  const finish = useCallback(async () => {
    await acceptSession(await refreshSession())
    navigate("/conversations/new", { replace: true })
  }, [acceptSession, navigate])
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname
    )
    if (result !== "success" || initial.token || attempted.current) return
    attempted.current = true
    void finish().catch(() => setError(t("social.errors.failed")))
    // This callback is a one-time session exchange, not a response to auth updates.
  }, [result, initial.token, finish, t])
  const send = useMutation({
    mutationFn: () =>
      apiRequest("/auth/social/registration/email", {
        method: "POST",
        body: socialEmailInputSchema.parse({ email: email.trim() }),
        schema: z.unknown(),
        skipRefresh: true,
      }),
  })
  const verify = useMutation({
    mutationFn: () =>
      apiRequest("/auth/social/registration/complete", {
        method: "POST",
        body: { token: initial.token },
        schema: z.object({ result: socialCallbackResultSchema }),
        skipRefresh: true,
      }),
    onSuccess: async (data) => {
      setResult(data.result)
      if (data.result === "success") await finish()
    },
  })
  const failure = !["success", "linked", "verify_email"].includes(result)
  const showResultError = failure && (!initial.token || verify.isSuccess)
  return (
    <div className="public-shell">
      <main className="public-panel">
        <header>
          <h1>
            {t(
              result === "verify_email" || initial.token
                ? "social.verifyTitle"
                : "social.callbackTitle"
            )}
          </h1>
        </header>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        {showResultError && (
          <StatusBanner variant="error">
            {t(`social.errors.${result}`)}
          </StatusBanner>
        )}
        {(send.error || verify.error) && (
          <StatusBanner variant="error">
            {getErrorMessage(send.error ?? verify.error, t)}
          </StatusBanner>
        )}
        {initial.token && !verify.isSuccess && (
          <Button disabled={verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending && <Spinner data-icon="inline-start" />}
            {t("social.finish")}
          </Button>
        )}
        {result === "verify_email" && !initial.token && (
          <>
            <p className="text-sm text-muted-foreground">
              {t("social.verifyDescription")}
            </p>
            {send.isSuccess ? (
              <StatusBanner variant="success">
                {t("social.emailSent")}
              </StatusBanner>
            ) : (
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  send.mutate()
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="social-email" required>
                      {t("common.email")}
                    </FieldLabel>
                    <Input
                      id="social-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      maxLength={320}
                      disabled={send.isPending}
                    />
                  </Field>
                </FieldGroup>
                <Button type="submit" disabled={send.isPending}>
                  {send.isPending && <Spinner data-icon="inline-start" />}
                  {t("social.sendEmail")}
                </Button>
              </form>
            )}
          </>
        )}
        {result === "success" && !error && <Spinner className="mx-auto" />}
        {result === "linked" && (
          <StatusBanner variant="success">{t("social.linked")}</StatusBanner>
        )}
        <Link className="public-link" to="/login">
          {t("auth.backToLogin")}
        </Link>
        <Link className="public-link" to="/settings/security">
          {t("social.returnSettings")}
        </Link>
      </main>
    </div>
  )
}
