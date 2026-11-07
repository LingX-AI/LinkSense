import { useState, type ComponentProps } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "id" | "type"> & {
  id: string
  fieldLabel: string
  variant?: ComponentProps<typeof Input>["variant"]
}

export function PasswordInput({
  id,
  fieldLabel,
  disabled,
  className,
  variant = "outlined",
  ...props
}: PasswordInputProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const visibilityLabel = t(
    visible ? "auth.hidePassword" : "auth.showPassword",
    { field: fieldLabel }
  )

  return (
    <div className="relative isolate w-full min-w-0">
      <Input
        {...props}
        id={id}
        type={visible ? "text" : "password"}
        disabled={disabled}
        variant={variant}
        className={cn(variant === "default" && "h-9", "pr-10", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute inset-y-0 right-2 z-10 my-auto rounded-md text-muted-foreground"
        aria-label={visibilityLabel}
        aria-controls={id}
        aria-pressed={visible}
        title={visibilityLabel}
        disabled={disabled}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden="true" />
        ) : (
          <EyeIcon className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}
