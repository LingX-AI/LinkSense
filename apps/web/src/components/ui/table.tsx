"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  containerClassName,
  containerProps,
  containerRef,
  scrollable = true,
  appearance = "plain",
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string
  containerProps?: Omit<
    React.ComponentProps<"div">,
    "children" | "className" | "ref"
  >
  containerRef?: React.Ref<HTMLDivElement>
  scrollable?: boolean
  appearance?: "plain" | "card"
}) {
  return (
    <div
      {...containerProps}
      ref={containerRef}
      data-slot="table-container"
      data-appearance={appearance}
      className={cn(
        "relative w-full",
        scrollable ? "overflow-x-auto" : "overflow-visible",
        appearance === "card" &&
          "rounded-card border border-[color:var(--app-border)] bg-card",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={className} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t-[0.5px] border-divider bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "transition-colors hover:bg-hover has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted last:[&>td]:after:hidden",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "relative h-10 px-2 text-left align-middle text-sm font-medium whitespace-nowrap text-foreground after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-divider after:content-[''] [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "relative p-2 align-middle whitespace-nowrap after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-divider after:content-[''] [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
