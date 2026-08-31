import type { ComponentProps } from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"

export function ModelTokenPriceInput({
  unitLabel,
  disabled,
  ...props
}: ComponentProps<typeof InputGroupInput> & { unitLabel: string }) {
  return (
    <InputGroup data-disabled={disabled ? "true" : undefined}>
      <InputGroupInput disabled={disabled} {...props} />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="text-xs whitespace-nowrap">
          {unitLabel}
        </InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}
