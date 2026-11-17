import { useId, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { builtInCapabilityId, PUBLIC_SITE_SKILL_NAME } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { apiRequest } from "@/api/client"
import { conversationSchema } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { requestTurnStart } from "@/features/conversations/turn-start-request"
import {
  stableOperationId,
  type OperationReference,
} from "@/features/conversations/operation-id"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

export function ApplicationPublicSiteCreateDialog({
  onClose,
  mode = "web",
}: {
  onClose: () => void
  mode?: "auto" | "web"
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const client = useQueryClient()
  const id = useId()
  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [openInBrowser, setOpenInBrowser] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const operation = useRef<OperationReference["current"]>(null)
  const submitting = useRef(false)
  const automatic = mode === "auto"
  const messages = automatic
    ? "applications.conversationCreation"
    : "applications.publicSiteCreation"
  const valid = automatic ? goal.trim().length > 0 : name.trim().length > 0
  const start = useMutation({
    retry: false,
    mutationFn: async (inputText: string) => {
      const target =
        conversationId ??
        (
          await apiRequest("/conversations", {
            method: "POST",
            body: { collaboration_mode: "default" },
            schema: conversationSchema,
          })
        ).id
      setConversationId(target)
      const body = {
        input_text: inputText,
        collaboration_mode: "default",
        ...(!automatic
          ? {
              priority_capability_ids: [
                builtInCapabilityId(PUBLIC_SITE_SKILL_NAME),
              ],
            }
          : {}),
      }
      await requestTurnStart(operation, `/conversations/${target}/turns`, {
        ...body,
        idempotency_key: await stableOperationId(operation, {
          conversation_id: target,
          ...body,
        }),
      })
      return target
    },
    onSuccess: (target) => {
      void client.invalidateQueries({ queryKey: ["conversations"] })
      onClose()
      void navigate(`/conversations/${target}`)
    },
    onSettled: () => {
      submitting.current = false
    },
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose()
      }}
    >
      <DialogContent variant="workspace" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t(`${messages}.title`)}</DialogTitle>
          <DialogDescription>{t(`${messages}.description`)}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!valid || !user || submitting.current) return
            submitting.current = true
            start.mutate(
              [
                t(`${messages}.prompt`, {
                  name: name.trim(),
                  goal: goal.trim() || t(`${messages}.defaultGoal`),
                }),
                ...(openInBrowser
                  ? [t("applications.publicSiteCreation.openInstruction")]
                  : []),
              ].join("\n\n")
            )
          }}
        >
          <FieldGroup>
            {!automatic && (
              <Field>
                <FieldLabel htmlFor={`${id}-name`} required>
                  {t("applications.publicSiteCreation.name")}
                </FieldLabel>
                <Input
                  id={`${id}-name`}
                  aria-required="true"
                  value={name}
                  disabled={start.isPending || Boolean(conversationId)}
                  maxLength={160}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor={`${id}-goal`} required={automatic}>
                {t(`${messages}.goal`)}
              </FieldLabel>
              <Textarea
                id={`${id}-goal`}
                value={goal}
                aria-required={automatic || undefined}
                disabled={start.isPending || Boolean(conversationId)}
                maxLength={2_000}
                rows={4}
                placeholder={t(`${messages}.goalPlaceholder`)}
                autoFocus={automatic}
                onChange={(event) => setGoal(event.target.value)}
              />
            </Field>
            {!automatic && (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-open`}
                  checked={openInBrowser}
                  disabled={start.isPending || Boolean(conversationId)}
                  onCheckedChange={setOpenInBrowser}
                />
                <FieldLabel htmlFor={`${id}-open`}>
                  {t("applications.publicSiteCreation.openLocally")}
                </FieldLabel>
              </Field>
            )}
          </FieldGroup>
          {start.error && (
            <StatusBanner variant="error">
              {getErrorMessage(start.error, t)}
            </StatusBanner>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={start.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!valid || !user || start.isPending}>
              {t(
                start.isPending
                  ? "applicationDevelopment.creating"
                  : `${messages}.start`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
