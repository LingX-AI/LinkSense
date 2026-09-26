import { useRef, useState, type FormEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import { bootstrapSchema, initializeSystemResultSchema } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useBootstrap } from "@/app/bootstrap-state"
import { useProductName } from "@/app/product-branding"
import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import { ProductLogo } from "@/components/brand/product-logo"
import { FieldShell } from "@/components/forms/form-field"
import { PasswordInput } from "@/components/forms/password-input"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { passwordSchema } from "@/lib/password"

type InitializationField =
  "credential" | "name" | "email" | "password" | "confirmation"

type InitializationFieldErrors = Partial<Record<InitializationField, string>>

export function InitializePage() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { bootstrap } = useBootstrap()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [initializationCredential, setInitializationCredential] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<InitializationFieldErrors>({})
  const credentialRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)

  const clearFieldError = (field: InitializationField) => {
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("/system/initialize", {
        method: "POST",
        body: {
          name: name.trim(),
          email: email.trim(),
          password,
          ...(bootstrap?.initialization_credential_required
            ? { initialization_credential: initializationCredential.trim() }
            : {}),
        },
        schema: initializeSystemResultSchema,
        skipRefresh: true,
      }),
    onSuccess: async () => {
      await queryClient.fetchQuery({
        queryKey: ["system", "bootstrap"],
        queryFn: () =>
          apiRequest("/system/bootstrap", { schema: bootstrapSchema }),
      })
      navigate("/login", { replace: true, state: { initialized: true } })
    },
    onError: (nextError) => setError(getErrorMessage(nextError, t)),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const nextErrors: InitializationFieldErrors = {}
    if (
      bootstrap?.initialization_credential_required &&
      !initializationCredential.trim()
    ) {
      nextErrors.credential = t("validation.required")
    }
    if (!name.trim()) nextErrors.name = t("validation.required")
    if (!email.trim()) {
      nextErrors.email = t("validation.required")
    } else if (!z.email().safeParse(email.trim()).success) {
      nextErrors.email = t("validation.email")
    }
    if (!password) {
      nextErrors.password = t("validation.required")
    } else if (!passwordSchema.safeParse(password).success) {
      nextErrors.password = t("errors.passwordPolicy")
    }
    if (!confirmation) {
      nextErrors.confirmation = t("validation.required")
    } else if (password !== confirmation) {
      nextErrors.confirmation = t("validation.passwordMismatch")
    }
    setFieldErrors(nextErrors)
    const firstInvalidField = (
      [
        ["credential", credentialRef],
        ["name", nameRef],
        ["email", emailRef],
        ["password", passwordRef],
        ["confirmation", confirmationRef],
      ] as const
    ).find(([field]) => nextErrors[field])
    if (firstInvalidField) {
      firstInvalidField[1].current?.focus()
      return
    }
    mutation.mutate()
  }

  return (
    <div className="public-shell flex flex-col">
      <main className="public-panel public-panel-wide shrink-0">
        <ProductLogo productName={productName} className="public-brand-logo" />
        <header>
          <h1>{t("initialize.title", { productName })}</h1>
          <p>{t("initialize.description")}</p>
        </header>
        {error && <StatusBanner variant="error">{error}</StatusBanner>}
        <form className="form-stack" onSubmit={submit} noValidate>
          {bootstrap?.initialization_credential_required && (
            <FieldShell
              id="initialization-credential"
              label={t("initialize.credential")}
              hint={t("initialize.credentialHint")}
              error={fieldErrors.credential}
            >
              <PasswordInput
                ref={credentialRef}
                id="initialization-credential"
                name="initialization-credential"
                fieldLabel={t("initialize.credential")}
                autoComplete="off"
                value={initializationCredential}
                onChange={(event) => {
                  setInitializationCredential(event.target.value)
                  clearFieldError("credential")
                }}
                aria-invalid={fieldErrors.credential ? true : undefined}
                aria-describedby={
                  fieldErrors.credential
                    ? "initialization-credential-error"
                    : undefined
                }
                required
              />
            </FieldShell>
          )}
          <FieldShell
            id="admin-name"
            label={t("initialize.adminName")}
            error={fieldErrors.name}
          >
            <Input
              ref={nameRef}
              id="admin-name"
              name="name"
              className="h-9"
              autoComplete="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                clearFieldError("name")
              }}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={
                fieldErrors.name ? "admin-name-error" : undefined
              }
              required
            />
          </FieldShell>
          <FieldShell
            id="admin-email"
            label={t("common.email")}
            error={fieldErrors.email}
          >
            <Input
              ref={emailRef}
              id="admin-email"
              name="email"
              className="h-9"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                clearFieldError("email")
              }}
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={
                fieldErrors.email ? "admin-email-error" : undefined
              }
              required
            />
          </FieldShell>
          <FieldShell
            id="admin-password"
            label={t("auth.newPassword")}
            hint={t("auth.passwordPolicy")}
            error={fieldErrors.password}
          >
            <PasswordInput
              ref={passwordRef}
              id="admin-password"
              name="new-password"
              fieldLabel={t("auth.newPassword")}
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                clearFieldError("password")
              }}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={
                fieldErrors.password ? "admin-password-error" : undefined
              }
              required
            />
          </FieldShell>
          <FieldShell
            id="admin-password-confirm"
            label={t("auth.confirmPassword")}
            error={fieldErrors.confirmation}
          >
            <PasswordInput
              ref={confirmationRef}
              id="admin-password-confirm"
              name="new-password-confirmation"
              fieldLabel={t("auth.confirmPassword")}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value)
                clearFieldError("confirmation")
              }}
              aria-invalid={fieldErrors.confirmation ? true : undefined}
              aria-describedby={
                fieldErrors.confirmation
                  ? "admin-password-confirm-error"
                  : undefined
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
            {t("initialize.submit")}
          </Button>
        </form>
      </main>
      <PoweredByLinkSense className="mt-auto mr-3 -mb-2.5 self-end max-md:mr-1 max-md:mb-1" />
    </div>
  )
}
