import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CopyIcon } from "lucide-react"

import { notify } from "@/components/feedback/notification"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"

export function CallbackUrlInput({
  id,
  value,
  disabled,
  "aria-describedby": describedBy,
}: {
  id: string
  value: string
  disabled?: boolean
  "aria-describedby"?: string
}) {
  const { t } = useTranslation()
  const [copying, setCopying] = useState(false)

  const copy = async () => {
    if (copying || disabled || !value) return
    setCopying(true)
    try {
      await navigator.clipboard.writeText(value)
      notify.success(t("admin.authSettings.callbackCopied"))
    } catch {
      notify.error(t("admin.authSettings.copyFailed"))
    } finally {
      setCopying(false)
    }
  }

  return (
    <InputGroup className="h-9">
      <InputGroupInput
        id={id}
        value={value}
        readOnly
        disabled={disabled}
        aria-describedby={describedBy}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-sm"
          aria-label={t("admin.authSettings.copyCallback")}
          title={t("admin.authSettings.copyCallback")}
          disabled={disabled || copying || !value}
          aria-busy={copying || undefined}
          onClick={() => void copy()}
        >
          {copying ? <Spinner /> : <CopyIcon aria-hidden="true" />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
