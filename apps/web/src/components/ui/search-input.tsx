import { useState, type ComponentProps } from "react"
import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

type SearchInputProps = Omit<
  ComponentProps<typeof InputGroupInput>,
  | "value"
  | "defaultValue"
  | "onChange"
  | "onCompositionStart"
  | "onCompositionEnd"
> & {
  value: string
  onValueChange: (value: string) => void
}

export function SearchInput({
  value,
  onValueChange,
  ...props
}: SearchInputProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  const [previousValue, setPreviousValue] = useState(value)
  const [composing, setComposing] = useState(false)

  // URL navigation can be deferred. Keep keystrokes synchronous, while still
  // accepting external changes such as browser back/forward and filter resets.
  if (value !== previousValue) {
    setPreviousValue(value)
    setDraft(value)
  }

  return (
    <>
      <InputGroupInput
        {...props}
        value={draft}
        onChange={(event) => {
          const next = event.currentTarget.value
          setDraft(next)
          if (!composing) onValueChange(next)
        }}
        onCompositionStart={() => {
          setComposing(true)
        }}
        onCompositionEnd={(event) => {
          setComposing(false)
          const next = event.currentTarget.value
          setDraft(next)
          onValueChange(next)
        }}
      />
      {draft.length > 0 && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={t("common.clear")}
            disabled={props.disabled || props.readOnly || composing}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              setDraft("")
              onValueChange("")
              event.currentTarget
                .closest('[data-slot="input-group"]')
                ?.querySelector("input")
                ?.focus()
            }}
          >
            <XIcon aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </>
  )
}
