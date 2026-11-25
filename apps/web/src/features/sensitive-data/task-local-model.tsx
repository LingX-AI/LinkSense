import { useEffect, useId, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  sensitiveDataChoiceSchema,
  sensitiveDataModelSwitchSchema,
  sensitiveDataTaskStatusSchema,
  type SensitiveDataModelSwitch,
  type SensitiveDataTaskStatus,
} from "@linksense/shared"
import { ChevronDownIcon, ShieldCheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
import { personalizationQueryKey } from "@/features/personalization/use-personalization"
import {
  sensitiveDataTaskQueryKey,
  sensitiveDataUserQueries,
} from "./query-keys"

type WaitingStatus = Extract<SensitiveDataTaskStatus, { status: "waiting" }>
type LocalStatus = Extract<SensitiveDataTaskStatus, { status: "local" }>

export function TaskLocalModelBadge({ modelName }: { modelName: string }) {
  const { t } = useTranslation()
  return (
    <Badge
      role="status"
      variant="secondary"
      className="h-auto max-w-full min-w-0 shrink whitespace-normal"
    >
      <ShieldCheckIcon aria-hidden="true" />
      {t("sensitiveData.processingLocally", { model: modelName })}
    </Badge>
  )
}

export function TaskLocalModelControl({
  ownerId,
  conversationId,
  status,
}: {
  ownerId: string
  conversationId: string
  status: LocalStatus
}) {
  const { t } = useTranslation()
  const cache = useQueryClient()
  const queryKey = sensitiveDataTaskQueryKey(ownerId, conversationId)
  const change = useMutation({
    mutationFn: (selection: SensitiveDataModelSwitch) =>
      apiRequest(`/conversations/${conversationId}/sensitive-data`, {
        method: "PATCH",
        body: sensitiveDataModelSwitchSchema.parse(selection),
        schema: sensitiveDataTaskStatusSchema,
      }),
    onSuccess: async (saved) => {
      await cache.cancelQueries({ queryKey, exact: true })
      cache.setQueryData(queryKey, saved)
      if (saved.status === "local" && saved.next_model) {
        notify.success(t("sensitiveData.nextTurnLocalModel", {
          model: saved.next_model.name,
        }))
      }
    },
    onError: async (error) => {
      notify.error(getErrorMessage(error, t))
      await cache.invalidateQueries({ queryKey, exact: true })
    },
  })

  if (status.local_models.length < 2) {
    return <TaskLocalModelBadge modelName={status.model.name} />
  }

  const selectedId = status.next_model?.id ?? status.model.id
  const description = status.next_model
    ? t("sensitiveData.nextTurnLocalModel", { model: status.next_model.name })
    : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="max-w-60 min-w-0 shrink rounded-full"
            aria-label={t("sensitiveData.switchLocalModel", { model: status.model.name })}
            aria-description={description}
            title={description ?? status.model.name}
            disabled={change.isPending}
          />
        }
      >
        <ShieldCheckIcon data-icon="inline-start" aria-hidden="true" />
        <span className="truncate">
          {t("sensitiveData.processingLocally", { model: status.model.name })}
        </span>
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {description ?? t("sensitiveData.localModels")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={selectedId}
            onValueChange={(modelId) => {
              if (change.isPending || modelId === selectedId) return
              const model = status.local_models.find(({ id }) => id === modelId)
              if (model) change.mutate({ model_id: model.id, expected_model_id: selectedId })
            }}
          >
            {status.local_models.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id}>
                {model.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TaskLocalModel({
  ownerId,
  conversationId,
  status,
  active,
  showBadge,
}: {
  ownerId: string
  conversationId: string
  status: SensitiveDataTaskStatus | undefined
  active: boolean
  showBadge: boolean
}) {
  return (
    <>
      <TaskLocalModelSwitchNotice
        key={`${ownerId}:${conversationId}`}
        ownerId={ownerId}
        conversationId={conversationId}
        status={status}
        active={active}
      />
      {showBadge && status?.status === "local" && (
        <div className="flex min-w-0 justify-center px-3 py-1">
          <TaskLocalModelControl
            key={`${ownerId}:${conversationId}`}
            ownerId={ownerId}
            conversationId={conversationId}
            status={status}
          />
        </div>
      )}
      {status?.status === "waiting" && status.local_models.length > 0 && (
        <ChooseLocalModel
          key={status.turn_id}
          status={status}
          path={`/conversations/${conversationId}/sensitive-data`}
          queryKey={sensitiveDataTaskQueryKey(ownerId, conversationId)}
        />
      )}
    </>
  )
}

function TaskLocalModelSwitchNotice({
  ownerId,
  conversationId,
  status,
  active,
}: {
  ownerId: string
  conversationId: string
  status: SensitiveDataTaskStatus | undefined
  active: boolean
}) {
  const { t } = useTranslation()
  const observedRoute = useRef<"initial" | "before-switch" | "local">("initial")

  useEffect(() => {
    if (status?.status !== "local") {
      if (observedRoute.current === "initial" && (status || active)) {
        observedRoute.current = "before-switch"
      }
      return
    }
    const switched = observedRoute.current === "before-switch"
    observedRoute.current = "local"
    if (!switched) return

    const preferenceKey = `linksense.sensitive-data.local-switch-notice.${ownerId}`
    try {
      if (window.localStorage.getItem(preferenceKey) === "dismissed") return
    } catch {
      // The notice is still available when browser storage is disabled.
    }

    notify.info(t("sensitiveData.localModelNoticeTitle"), {
      id: `sensitive-data.local-model-switch.${ownerId}.${conversationId}`,
      description: t("sensitiveData.switchedToLocalModel", {
        model: status.model.name,
      }),
      position: "top-right",
      closeButton: true,
      classNames: {
        toast: "grid! grid-cols-[auto_minmax(0,1fr)_auto]",
        icon: "col-start-1 row-start-1",
        content: "col-[2/-1] row-start-1",
        actionButton: "col-start-2 row-start-2 justify-self-end",
        closeButton: "col-start-3 row-start-2",
      },
      action: {
        label: t("sensitiveData.hideLocalModelNotice"),
        onClick: () => {
          try {
            window.localStorage.setItem(preferenceKey, "dismissed")
          } catch {
            // Sonner still dismisses the current notice.
          }
        },
      },
    })
  }, [active, conversationId, ownerId, status, t])

  return null
}

function ChooseLocalModel({
  status,
  path,
  queryKey,
}: {
  status: WaitingStatus
  path: string
  queryKey: ReturnType<typeof sensitiveDataTaskQueryKey>
}) {
  const { t } = useTranslation()
  const id = useId()
  const cache = useQueryClient()
  const [open, setOpen] = useState(true)
  const [remember, setRemember] = useState(false)
  const [modelId, setModelId] = useState(
    status.local_models.find(({ id }) => id === status.default_model_id)?.id ??
      status.local_models[0]?.id ??
      ""
  )
  const choice = useMutation({
    mutationFn: () =>
      apiRequest(path, {
        method: "PUT",
        body: sensitiveDataChoiceSchema.parse({
          turn_id: status.turn_id,
          model_id: modelId,
          remember,
        }),
        schema: sensitiveDataTaskStatusSchema,
      }),
    onSuccess: async (result) => {
      await cache.cancelQueries({ queryKey })
      cache.setQueryData(queryKey, result)
      if (remember) {
        await Promise.all([
          cache.invalidateQueries({ queryKey: personalizationQueryKey }),
          cache.invalidateQueries({ queryKey: sensitiveDataUserQueries }),
        ])
      }
    },
  })

  return (
    <>
      {!open && (
        <div className="flex justify-center px-3 py-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            <ShieldCheckIcon data-icon="inline-start" />
            {t("sensitiveData.dialogTitle")}
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!choice.isPending) setOpen(next)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sensitiveData.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("sensitiveData.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (
                !choice.isPending &&
                status.local_models.some(({ id }) => id === modelId)
              )
                choice.mutate()
            }}
          >
            <FieldGroup>
              <RadioGroup
                aria-label={t("sensitiveData.localModels")}
                className="max-h-48 flex-col flex-nowrap overflow-y-auto p-1"
                value={modelId}
                disabled={choice.isPending}
                onValueChange={(value) => {
                  if (typeof value === "string") setModelId(value)
                }}
              >
                {status.local_models.map(({ id, name }) => (
                  <RadioGroupOption key={id} className="w-full wrap-anywhere">
                    <RadioGroupItem value={id} />
                    {name}
                  </RadioGroupOption>
                ))}
              </RadioGroup>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-remember`}
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                />
                <FieldLabel htmlFor={`${id}-remember`}>
                  {t("sensitiveData.remember")}
                </FieldLabel>
              </Field>
              {choice.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {getErrorMessage(choice.error, t)}
                  </AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={choice.isPending}
                  onClick={() => setOpen(false)}
                >
                  {t("sensitiveData.later")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    choice.isPending ||
                    !status.local_models.some(({ id }) => id === modelId)
                  }
                >
                  {t("sensitiveData.choose")}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
