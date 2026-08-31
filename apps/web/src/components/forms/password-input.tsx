import { useState, type ComponentProps } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

type PasswordInputProps = Omit<
  ComponentProps<typeof InputGroupInput>,
  "id" | "type"
> & {
  id: string
  fieldLabel: string
}

export function PasswordInput({
  id,
  fieldLabel,
  disabled,
  ...props
}: PasswordInputProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const visibilityLabel = t(
    visible ? "auth.hidePassword" : "auth.showPassword",
    { field: fieldLabel }
  )

  return (
    <InputGroup className="h-9" data-disabled={disabled ? "true" : undefined}>
      <InputGroupInput
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        disabled={disabled}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={visibilityLabel}
          aria-controls={id}
          aria-pressed={visible}
          title={visibilityLabel}
          disabled={disabled}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? (
            <EyeOffIcon aria-hidden="true" />
          ) : (
            <EyeIcon aria-hidden="true" />
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
