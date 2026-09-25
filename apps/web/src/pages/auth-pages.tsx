import { SamlLoginButton } from "@/features/saml/login-button"
import { SocialLoginButtons } from "@/features/social-auth/social-login-buttons"
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { useMutation } from "@tanstack/react-query"
import { ArrowLeftIcon, LoaderCircleIcon } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { z } from "zod"

import { ApiError, apiRequest, buildApiUrl } from "@/api/client"
import { authSessionSchema } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import {
  detectTeamsHost,
  getTeamsSsoToken,
} from "@/adapters/teams/teams-adapter"
import { useAuth } from "@/app/auth-state"
import { useBootstrap } from "@/app/bootstrap-state"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { LoadingState } from "@/components/feedback/page-state"
import { FieldShell } from "@/components/forms/form-field"
import { PasswordInput } from "@/components/forms/password-input"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  hasStoredLanguagePreference,
  normalizeLanguage,
  setAppLanguage,
} from "@/i18n"
import { passwordSchema } from "@/lib/password"

const emailSchema = z.email()

function PublicPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <main className="public-panel">{children}</main>
    </div>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const location = useLocation()
  const { bootstrap } = useBootstrap()
  const { acceptSession, status } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [teamsState, setTeamsState] = useState<
    "idle" | "loading" | "not_configured" | "pending_approval" | "failed"
  >("idle")
  const [teamsError, setTeamsError] = useState<string | null>(null)
  const teamsAttempted = useRef(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const loginMutation = useMutation({
    mutationFn: () =>
      apiRequest("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
        schema: authSessionSchema,
        skipRefresh: true,
      }),
    onSuccess: async (session) => {
      await acceptSession(session)
    },
    onError: (error) =>
      setFormError(getErrorMessage(error, t, { productName })),
  })

  const exchangeTeamsToken = async () => {
    const token = await getTeamsSsoToken()
    const session = await apiRequest("/auth/teams/exchange", {
      method: "POST",
      body: { token },
      schema: authSessionSchema,
      skipRefresh: true,
    })
    await acceptSession(session)
  }

  const attemptTeamsSilentLogin = async () => {
    setTeamsError(null)
    const host = await detectTeamsHost()
    if (host.kind === "teams_error") {
      setTeamsState("failed")
      return
    }
    if (host.kind !== "teams") {
      setTeamsState("idle")
      return
    }
    const teamsLanguage = normalizeLanguage(host.locale)
    if (teamsLanguage && !hasStoredLanguagePreference()) {
      await setAppLanguage(teamsLanguage, { persist: false })
    }
    if (bootstrap?.teams_sso?.status === "not_configured") {
      setTeamsState("not_configured")
      return
    }
    if (
      !["available", "configured"].includes(bootstrap?.teams_sso?.status ?? "")
    ) {
      setTeamsState("failed")
      return
    }
    setTeamsState("loading")
    try {
      await exchangeTeamsToken()
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.errorCode === "EXTERNAL_ACCOUNT_PENDING_APPROVAL"
      ) {
        setTeamsState("pending_approval")
        return
      }
      setTeamsError(getErrorMessage(error, t, { productName }))
      setTeamsState("failed")
    }
  }

  useEffect(() => {
    if (status !== "anonymous" || !bootstrap || teamsAttempted.current) return
    teamsAttempted.current = true
    void attemptTeamsSilentLogin()
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const nextEmailError = emailSchema.safeParse(email.trim()).success
      ? null
      : t("validation.email")
    const nextPasswordError = password ? null : t("validation.required")
    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    if (nextEmailError) {
      emailRef.current?.focus()
      return
    }
    if (nextPasswordError) {
      passwordRef.current?.focus()
      return
    }
    loginMutation.mutate()
  }

  const startOidc = () => {
    setFormError(null)
    window.location.assign(buildApiUrl("/auth/oidc/start"))
  }

  if (status === "loading") return <LoadingState fullScreen />
  if (status === "authenticated") return null

  return (
    <PublicPanel>
      <ProductLogo productName={productName} className="public-brand-logo" />
      <header>
        <h1>{t("auth.loginTitle", { productName })}</h1>
        <p>{t("auth.loginDescription")}</p>
      </header>
      {teamsState === "loading" && (
        <StatusBanner>
          <span className="flex items-center gap-2">
            <LoaderCircleIcon
              className="size-3.5 animate-spin"
              aria-hidden="true"
            />
            {t("auth.teamsSigningIn")}
          </span>
        </StatusBanner>
      )}
      {teamsState === "not_configured" && (
        <StatusBanner variant="warning">
          {t("auth.teamsNotConfigured", { productName })}
        </StatusBanner>
      )}
      {teamsState === "pending_approval" && (
        <StatusBanner variant="warning">
          {t("auth.externalAccountPendingApproval")}
        </StatusBanner>
      )}
      {teamsState === "failed" && (
        <StatusBanner
          variant="error"
          actions={
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void attemptTeamsSilentLogin()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          {teamsError ?? t("auth.teamsFailed")}
        </StatusBanner>
      )}
      <NotificationToast
        id="password-changed"
        message={
          typeof location.state === "object" &&
          location.state !== null &&
          "passwordChanged" in location.state
            ? t("profile.passwordChanged")
            : undefined
        }
      />
      <NotificationToast
        id="password-reset"
        message={
          typeof location.state === "object" &&
          location.state !== null &&
          "passwordReset" in location.state
            ? t("auth.resetCompleted")
            : undefined
        }
      />
      <NotificationToast
        id="initialization-completed"
        message={
          typeof location.state === "object" &&
          location.state !== null &&
          "initialized" in location.state
            ? t("initialize.completed")
            : undefined
        }
      />
      {formError && <StatusBanner variant="error">{formError}</StatusBanner>}
      <form className="form-stack" onSubmit={submit} noValidate>
        <FieldShell
          id="login-email"
          label={t("common.email")}
          error={emailError ?? undefined}
        >
          <Input
            ref={emailRef}
            id="login-email"
            name="email"
            className="h-9"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError(null)
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "login-email-error" : undefined}
            required
          />
        </FieldShell>
        <FieldShell
          id="login-password"
          label={t("auth.password")}
          error={passwordError ?? undefined}
        >
          <PasswordInput
            ref={passwordRef}
            id="login-password"
            name="password"
            fieldLabel={t("auth.password")}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setPasswordError(null)
            }}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={
              passwordError ? "login-password-error" : undefined
            }
            required
          />
        </FieldShell>
        <div className="text-right">
          <Link className="public-link" to="/forgot-password">
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <Button
          type="submit"
          size="xl"
          disabled={loginMutation.isPending}
          aria-busy={loginMutation.isPending || undefined}
          className="w-full"
        >
          {loginMutation.isPending && <Spinner data-icon="inline-start" />}
          {t("auth.signIn")}
        </Button>
      </form>
      <SamlLoginButton />
      <SocialLoginButtons />
      {["available", "configured"].includes(bootstrap?.oidc?.status ?? "") && (
        <Button
          type="button"
          variant="secondary"
          size="xl"
          className="w-full"
          onClick={startOidc}
        >
          {t("auth.oidc")}
        </Button>
      )}
      {bootstrap?.registration?.enabled && (
        <p className="text-center text-sm text-muted-foreground">
          <Trans
            i18nKey="auth.registration.signUpPrompt"
            components={{
              register: <Link className="public-link" to="/register" />,
            }}
          />
        </p>
      )}
    </PublicPanel>
  )
}

export function RegistrationPage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { bootstrap } = useBootstrap()
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const registrationEnabled = bootstrap?.registration?.enabled === true
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/auth/registration/request", {
        method: "POST",
        body: { email: email.trim() },
        schema: z.unknown(),
        skipRefresh: true,
      }),
    onSuccess: () => {
      setError(null)
      setMessage(t("auth.registration.requestAccepted"))
    },
    onError: (nextError) => {
      setMessage(null)
      setError(getErrorMessage(nextError, t, { productName }))
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setEmailError(null)
    if (!registrationEnabled) {
      setError(t("auth.registration.closed"))
      return
    }
    if (!emailSchema.safeParse(email.trim()).success) {
      setEmailError(t("validation.email"))
      emailRef.current?.focus()
      return
    }
    mutation.mutate()
  }

  return (
    <PublicPanel>
      <Link className="public-back-link" to="/login">
        <ArrowLeftIcon aria-hidden="true" /> {t("common.back")}
      </Link>
      <ProductLogo productName={productName} className="public-brand-logo" />
      <header>
        <h1>{t("auth.registration.title", { productName })}</h1>
        <p>{t("auth.registration.description")}</p>
      </header>
      {!registrationEnabled && (
        <StatusBanner variant="warning">
          {t("auth.registration.closed")}
        </StatusBanner>
      )}
      {registrationEnabled && <SocialLoginButtons />}
      {message && (
        <StatusBanner
          variant="success"
          title={t("auth.registration.requestSubmitted")}
        >
          {message}
        </StatusBanner>
      )}
      {error && (
        <StatusBanner
          variant="error"
          title={t("auth.registration.requestFailed")}
        >
          {error}
        </StatusBanner>
      )}
      {registrationEnabled && !message && (
        <form className="form-stack" onSubmit={submit} noValidate>
          <FieldShell
            id="registration-email"
            label={t("common.email")}
            error={emailError ?? undefined}
          >
            <Input
              ref={emailRef}
              id="registration-email"
              name="email"
              className="h-9"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setEmailError(null)
              }}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={
                emailError ? "registration-email-error" : undefined
              }
              required
            />
          </FieldShell>
          <Button
            type="submit"
            size="xl"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending || undefined}
            className="w-full"
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t("auth.registration.sendActivationLink")}
          </Button>
        </form>
      )}
    </PublicPanel>
  )
}

export function CompleteRegistrationPage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { bootstrap } = useBootstrap()
  const { acceptSession } = useAuth()
  const [token] = useState(readPasswordResetToken)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null
  )
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const registrationEnabled = bootstrap?.registration?.enabled === true

  useLayoutEffect(() => {
    clearPasswordResetTokenFromLocation()
  }, [])

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/auth/registration/complete", {
        method: "POST",
        body: { token, new_password: password },
        schema: authSessionSchema,
        skipRefresh: true,
      }),
    onSuccess: async (session) => {
      await acceptSession(session)
    },
    onError: (nextError) =>
      setError(getErrorMessage(nextError, t, { productName })),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!registrationEnabled) {
      setError(t("auth.registration.closed"))
      return
    }
    if (!token) {
      setError(t("auth.registration.invalidOrExpired"))
      return
    }
    const nextPasswordError = passwordSchema.safeParse(password).success
      ? null
      : t("errors.passwordPolicy")
    const nextConfirmationError = !confirmation
      ? t("validation.required")
      : password === confirmation
        ? null
        : t("validation.passwordMismatch")
    setPasswordError(nextPasswordError)
    setConfirmationError(nextConfirmationError)
    if (nextPasswordError) {
      passwordRef.current?.focus()
      return
    }
    if (nextConfirmationError) {
      confirmationRef.current?.focus()
      return
    }
    mutation.mutate()
  }

  return (
    <PublicPanel>
      <ProductLogo productName={productName} className="public-brand-logo" />
      <header>
        <h1>{t("auth.registration.activateTitle")}</h1>
        <p>{t("auth.registration.activateDescription")}</p>
      </header>
      {!registrationEnabled && !error && (
        <StatusBanner variant="warning">
          {t("auth.registration.closed")}
        </StatusBanner>
      )}
      {!token && !error && registrationEnabled && (
        <StatusBanner variant="error">
          {t("auth.registration.invalidOrExpired")}
        </StatusBanner>
      )}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form className="form-stack" onSubmit={submit} noValidate>
        <FieldShell
          id="registration-password"
          label={t("auth.newPassword")}
          hint={t("auth.passwordPolicy")}
          error={passwordError ?? undefined}
        >
          <PasswordInput
            ref={passwordRef}
            id="registration-password"
            name="new-password"
            fieldLabel={t("auth.newPassword")}
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setPasswordError(null)
            }}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={
              passwordError ? "registration-password-error" : undefined
            }
            required
          />
        </FieldShell>
        <FieldShell
          id="registration-password-confirmation"
          label={t("auth.confirmPassword")}
          error={confirmationError ?? undefined}
        >
          <PasswordInput
            ref={confirmationRef}
            id="registration-password-confirmation"
            name="new-password-confirmation"
            fieldLabel={t("auth.confirmPassword")}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              setConfirmationError(null)
            }}
            aria-invalid={confirmationError ? true : undefined}
            aria-describedby={
              confirmationError
                ? "registration-password-confirmation-error"
                : undefined
            }
            required
          />
        </FieldShell>
        <Button
          type="submit"
          size="xl"
          disabled={!registrationEnabled || !token || mutation.isPending}
          aria-busy={mutation.isPending || undefined}
          className="w-full"
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("auth.registration.activate")}
        </Button>
      </form>
      <Link className="public-link" to="/login">
        {t("auth.backToLogin")}
      </Link>
    </PublicPanel>
  )
}

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
        schema: z.unknown(),
        skipRefresh: true,
      }),
    onSuccess: () => {
      setError(null)
      setMessage(t("auth.resetAccepted"))
    },
    onError: (nextError) => {
      setMessage(null)
      setError(getErrorMessage(nextError, t))
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setError(null)
    setEmailError(null)
    if (!emailSchema.safeParse(email.trim()).success) {
      setEmailError(t("validation.email"))
      emailRef.current?.focus()
      return
    }
    mutation.mutate()
  }

  return (
    <PublicPanel>
      <Link className="public-back-link" to="/login">
        <ArrowLeftIcon aria-hidden="true" /> {t("common.back")}
      </Link>
      <header>
        <h1>{t("auth.forgotTitle")}</h1>
        <p>{t("auth.forgotDescription")}</p>
      </header>
      <NotificationToast
        id="password-reset-request-submitted"
        message={message ? t("auth.resetRequestSubmitted") : undefined}
        description={message ?? undefined}
      />
      {error && (
        <StatusBanner variant="error" title={t("auth.resetRequestFailed")}>
          {error}
        </StatusBanner>
      )}
      <form className="form-stack" onSubmit={submit} noValidate>
        <FieldShell
          id="forgot-email"
          label={t("common.email")}
          error={emailError ?? undefined}
        >
          <Input
            ref={emailRef}
            id="forgot-email"
            name="email"
            className="h-9"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setEmailError(null)
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "forgot-email-error" : undefined}
            required
          />
        </FieldShell>
        <Button
          type="submit"
          size="xl"
          disabled={mutation.isPending}
          aria-busy={mutation.isPending || undefined}
          className="w-full"
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("auth.sendResetLink")}
        </Button>
      </form>
    </PublicPanel>
  )
}

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const navigate = useNavigate()
  // This initializer must stay pure. React StrictMode intentionally invokes it
  // twice in development, so clearing the URL here would make the second read
  // lose a valid fragment token.
  const [token] = useState(readPasswordResetToken)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null
  )
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    clearPasswordResetTokenFromLocation()
  }, [])

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/auth/reset-password", {
        method: "POST",
        body: { token, new_password: password },
        schema: z.unknown(),
        skipRefresh: true,
      }),
    onSuccess: () =>
      navigate("/login", { replace: true, state: { passwordReset: true } }),
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!token) {
      setError(t("errors.passwordResetInvalid"))
      return
    }
    const nextPasswordError = passwordSchema.safeParse(password).success
      ? null
      : t("errors.passwordPolicy")
    const nextConfirmationError = !confirmation
      ? t("validation.required")
      : password === confirmation
        ? null
        : t("validation.passwordMismatch")
    setPasswordError(nextPasswordError)
    setConfirmationError(nextConfirmationError)
    if (nextPasswordError) {
      passwordRef.current?.focus()
      return
    }
    if (nextConfirmationError) {
      confirmationRef.current?.focus()
      return
    }
    mutation.mutate()
  }

  return (
    <PublicPanel>
      <ProductLogo productName={productName} className="public-brand-logo" />
      <header>
        <h1>{t("auth.resetTitle")}</h1>
        <p>{t("auth.resetDescription")}</p>
      </header>
      {!token && !error && (
        <StatusBanner variant="error">
          {t("errors.passwordResetInvalid")}
        </StatusBanner>
      )}
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form className="form-stack" onSubmit={submit} noValidate>
        <FieldShell
          id="new-password"
          label={t("auth.newPassword")}
          hint={t("auth.passwordPolicy")}
          error={passwordError ?? undefined}
        >
          <Input
            ref={passwordRef}
            id="new-password"
            name="new-password"
            className="h-9"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setPasswordError(null)
            }}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "new-password-error" : undefined}
            required
          />
        </FieldShell>
        <FieldShell
          id="confirm-password"
          label={t("auth.confirmPassword")}
          error={confirmationError ?? undefined}
        >
          <Input
            ref={confirmationRef}
            id="confirm-password"
            name="new-password-confirmation"
            className="h-9"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value)
              setConfirmationError(null)
            }}
            aria-invalid={confirmationError ? true : undefined}
            aria-describedby={
              confirmationError ? "confirm-password-error" : undefined
            }
            required
          />
        </FieldShell>
        <Button
          type="submit"
          size="xl"
          disabled={!token || mutation.isPending}
          aria-busy={mutation.isPending || undefined}
          className="w-full"
        >
          {mutation.isPending && <Spinner data-icon="inline-start" />}
          {t("auth.resetPassword")}
        </Button>
      </form>
    </PublicPanel>
  )
}

function readPasswordResetToken(): string | null {
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  )
  // Reset tokens are accepted only from the fragment. A query token has
  // already crossed the HTTP boundary and must never be treated as valid.
  return fragment.get("token")
}

function clearPasswordResetTokenFromLocation() {
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
  )
  if (fragment.has("token") || url.searchParams.has("token")) {
    fragment.delete("token")
    url.searchParams.delete("token")
    const cleanFragment = fragment.toString()
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${cleanFragment ? `#${cleanFragment}` : ""}`
    )
  }
}

export function EnterpriseCallbackPage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const navigate = useNavigate()
  const [callbackResult] = useState(readEnterpriseCallbackResult)
  const { status } = useAuth()

  useLayoutEffect(() => {
    clearEnterpriseCallbackParameters()
  }, [])

  useEffect(() => {
    if (callbackResult === "success" && status === "authenticated") {
      navigate("/conversations/new", { replace: true })
    }
  }, [callbackResult, navigate, status])

  const error =
    callbackResult === "pending_approval"
      ? t("auth.oidcAccountPendingApproval")
      : callbackResult === "disabled"
        ? t("errors.userDisabled")
        : callbackResult === "failed"
          ? t("auth.oidcCallbackFailed")
          : callbackResult === "success" && status === "anonymous"
            ? t("auth.oidcCallbackSessionFailed", { productName })
            : null

  return (
    <PublicPanel>
      <header>
        <h1>{t("auth.callbackTitle")}</h1>
      </header>
      {error ? (
        <>
          <StatusBanner variant="error">{error}</StatusBanner>
          <Link className="public-link" to="/login">
            {t("auth.backToLogin")}
          </Link>
        </>
      ) : (
        <LoaderCircleIcon
          className="mx-auto size-5 animate-spin"
          aria-hidden="true"
        />
      )}
    </PublicPanel>
  )
}

type EnterpriseCallbackResult =
  "success" | "pending_approval" | "disabled" | "failed"

function readEnterpriseCallbackResult(): EnterpriseCallbackResult {
  const url = new URL(window.location.href)
  const parsed = z
    .enum(["success", "pending_approval", "disabled", "failed"])
    .safeParse(url.searchParams.get("result"))
  return parsed.success ? parsed.data : "failed"
}

function clearEnterpriseCallbackParameters() {
  const url = new URL(window.location.href)
  if (url.search) {
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.hash}`
    )
  }
}
