import * as React from "react"

import { cn } from "@/lib/utils"

function Pagination({
  className,
  ...props
}: React.ComponentProps<"nav"> & { "aria-label": string }) {
  return (
    <nav
      role="navigation"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

export { Pagination, PaginationContent, PaginationItem }
