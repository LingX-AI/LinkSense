import { useState } from "react"
import type { CredentialPluginConfiguration } from "@linksense/shared"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  MoreHorizontalIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { CredentialBinding } from "@/api/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

export function CredentialPluginAssociation({
  name,
  bindings,
  configuration,
  disabled,
  loading,
  failed,
  pending,
  onManage,
  onEnable,
  onRemove,
  onRemoveField,
  onRetry,
}: {
  name: string
  bindings: CredentialBinding[]
  configuration: CredentialPluginConfiguration | undefined
  disabled: boolean
  loading: boolean
  failed: boolean
  pending: boolean
  onManage: () => void
  onEnable: () => void
  onRemove: () => void
  onRemoveField: (binding: CredentialBinding) => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const status = loading
    ? "loading"
    : failed || !configuration
      ? "failed"
      : !configuration.available
        ? "unavailable"
        : disabled
          ? "disabled"
          : configuration.fields.some((field) => field.status === "conflict")
            ? "conflict"
            : configuration.fields.some((field) => field.status === "invalid")
              ? "invalid"
              : configuration.fields.some(
                    (field) => field.status === "disabled"
                  )
                ? "disabledElsewhere"
                : configuration.fields.some(
                      (field) => field.status === "missing"
                    )
                  ? "missing"
                  : "configured"
  const canManage = configuration?.available && !disabled && !loading && !failed
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="min-w-0 rounded-lg p-3"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="min-w-0 text-sm font-medium wrap-anywhere">{name}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge variant={status === "configured" ? "secondary" : "outline"}>
              {status !== "configured" && status !== "loading" && (
                <CircleAlertIcon aria-hidden="true" />
              )}
              {t(`credential.configurationStatus.${status}`)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("credential.associatedFields", { count: bindings.length })}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {status === "disabled" && (
            <Button
              variant="secondary"
              size="xs"
              disabled={pending}
              onClick={onEnable}
            >
              {t("credential.enableAction")}
            </Button>
          )}
          {status === "failed" && (
            <Button variant="secondary" size="xs" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          )}
          <CollapsibleTrigger
            render={<Button variant="ghost" size="xs" />}
            aria-label={t("credential.detailsNamed", { name })}
          >
            {t(open ? "credential.hideDetails" : "credential.showDetails")}
            <ChevronDownIcon
              data-icon="inline-end"
              aria-hidden="true"
              className={open ? "rotate-180" : undefined}
            />
          </CollapsibleTrigger>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("credential.pluginActionsNamed", { name })}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {canManage && (
                  <DropdownMenuItem disabled={pending} onClick={onManage}>
                    {t(
                      status === "missing"
                        ? "credential.completeConfiguration"
                        : status === "conflict" || status === "invalid"
                          ? "credential.fixAssociation"
                          : "credential.manageAssociation"
                    )}
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem
                  variant="destructive"
                  disabled={pending}
                  onClick={onRemove}
                >
                  {t("credential.removeAssociation")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {status !== "configured" && status !== "loading" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(`credential.configurationHelp.${status}`)}
        </p>
      )}
      <CollapsibleContent>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("credential.configurationNote")}
        </p>
        <ul className="mt-2 flex min-w-0 flex-col gap-2">
          {(configuration?.fields ?? []).map((field) => {
            const sources = bindings.filter(
              (binding) => binding.env_key === field.env_key
            )
            return (
              <li
                key={field.env_key}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[color:var(--app-border)] pt-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <code translate="no" className="wrap-anywhere">
                    {field.env_key}
                  </code>
                  <p className="text-muted-foreground">
                    {t(`credential.fieldStatus.${field.status}`)}
                  </p>
                  {sources.map((binding) => (
                    <div
                      key={binding.id}
                      className="mt-1 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="min-w-0 text-muted-foreground">
                        {t("credential.usesField")}{" "}
                        <code translate="no" className="wrap-anywhere">
                          {binding.credential_key}
                        </code>
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={pending}
                        onClick={() => onRemoveField(binding)}
                        aria-label={t("credential.removeFieldNamed", {
                          name: field.env_key,
                        })}
                      >
                        {t("credential.removeField")}
                      </Button>
                    </div>
                  ))}
                  {sources.length === 0 && field.status === "configured" && (
                    <p className="text-muted-foreground">
                      {t("credential.otherCredential")}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
