import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Optical adjustments are drawn on the final 20px grid, without scaling a 24px icon.
const headerIcons = {
  search: (
    <g strokeWidth={1.7}>
      <circle cx="8.65" cy="8.65" r="5.9" />
      <path d="m13.05 13.05 4.2 4.2" />
    </g>
  ),
  sidebar: <path d="m9.25 5-5 5 5 5m6.5-10-5 5 5 5" />,
  sidebarExpand: <path d="m4.25 5 5 5-5 5m6.5-10 5 5-5 5" />,
  share: (
    <>
      <path d="M10 12V2.5m-3.5 3.5L10 2.5 13.5 6" />
      <path d="M3 9.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  overview: (
    <>
      <path d="M7.25 4h10M7.25 10h10M7.25 16h10" />
      <g fill="currentColor" stroke="none">
        <circle cx="3" cy="4" r="1" />
        <circle cx="3" cy="10" r="1" />
        <circle cx="3" cy="16" r="1" />
      </g>
    </>
  ),
  notification: (
    <>
      <path d="M17 14.5H3c1.35-1.2 2-2.9 2-4.7V8a5 5 0 0 1 10 0v1.8c0 1.8.65 3.5 2 4.7Z" />
      <path d="M10 2v1M8.5 17a1.75 1.75 0 0 0 3 0" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h12v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7Z" />
      <path d="M3 3h14v4H3zM8 10h4" />
    </>
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="4" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="16" cy="10" r="1.4" />
    </g>
  ),
  help: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M7.5 7.5a2.5 2.5 0 0 1 5 0c0 1.8-2.5 1.8-2.5 4.2M10 15h.01" />
    </>
  ),
}

export function HeaderIcon({
  name,
  className,
}: {
  name: keyof typeof headerIcons
  className?: string
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-design-icon={name}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
    >
      {headerIcons[name]}
    </svg>
  )
}

export function HeaderIconButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button
      {...props}
      variant="plain"
      size="icon-sm"
      className={cn(
        "rounded-md border-0 bg-transparent text-[color:var(--app-header-icon)] shadow-none transition-[background-color,box-shadow] duration-150 hover:bg-muted focus-visible:ring-2 active:bg-muted active:not-aria-[haspopup]:translate-y-0 data-popup-open:bg-muted motion-reduce:transition-none",
        className
      )}
    />
  )
}
