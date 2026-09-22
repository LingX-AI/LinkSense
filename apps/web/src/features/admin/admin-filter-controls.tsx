import type { ComponentProps, ReactNode } from "react"
import { SearchIcon, type LucideIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function AdminFilterField({
  id,
  label,
  children,
  className,
}: {
  id: string
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div data-slot="admin-filter-field" className={cn("min-w-0", className)}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function AdminFilterInput({
  icon: Icon = SearchIcon,
  className,
  ...props
}: ComponentProps<typeof InputGroupInput> & { icon?: LucideIcon }) {
  return (
    <InputGroup className={cn("h-9", className)}>
      <InputGroupAddon>
        <Icon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput {...props} />
    </InputGroup>
  )
}
