import { useId, useState } from "react"
import { conversationExecutionTargetSchema } from "@linksense/shared"
import { useTranslation } from "react-i18next"

import {
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field"
import { FieldError } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import {
  readDesktopExecutionDefaultTarget,
  saveDesktopExecutionDefaultTarget,
} from "./desktop-execution-default-target"

export function DesktopExecutionDefaultTargetSettings({
  preferenceKey,
  anchorId,
}: Readonly<{ preferenceKey: string; anchorId?: string }>) {
  const { t } = useTranslation()
  const generatedId = useId()
  const id = anchorId ?? generatedId
  const [target, setTarget] = useState(() =>
    readDesktopExecutionDefaultTarget(preferenceKey)
  )
  const [saveFailed, setSaveFailed] = useState(false)
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  return (
    <SettingsFieldGroup>
      <SettingsFieldRow
        id={id}
        label={t("desktopExecution.defaultTarget")}
        hint={t("desktopExecution.defaultTargetDescription")}
        controlWidth="medium"
      >
        <Select
          value={target}
          onValueChange={(next) => {
            const saved = saveDesktopExecutionDefaultTarget(preferenceKey, next)
            setSaveFailed(saved === null)
            if (saved) setTarget(saved)
          }}
        >
          <SelectTrigger
            id={id}
            aria-describedby={saveFailed ? `${hintId} ${errorId}` : hintId}
            className="w-full"
          >
            <SelectValue>{t(`desktopExecution.${target}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {conversationExecutionTargetSchema.options.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`desktopExecution.${value}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {saveFailed && (
          <FieldError id={errorId}>
            {t("desktopExecution.defaultTargetSaveFailed")}
          </FieldError>
        )}
      </SettingsFieldRow>
    </SettingsFieldGroup>
  )
}
