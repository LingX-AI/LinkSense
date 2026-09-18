import type { ComponentProps } from "react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"

export function ApplicationVersionNumberInput({
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof InputGroupInput>, "onChange"> & {
  onValueChange?: (value: string) => void
}) {
  return (
    <InputGroup>
      <InputGroupInput
        maxLength={80}
        {...props}
        onChange={(event) =>
          onValueChange?.(event.target.value.replace(/^v/i, ""))
        }
      />
      <InputGroupAddon>
        <InputGroupText aria-hidden>v</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}
