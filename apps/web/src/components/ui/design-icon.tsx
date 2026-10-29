import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

const masks = {
  plus: "mask-[url(./assets/figma/icons/plus.svg)]",
  "composer-add": "mask-[url(./assets/figma/icons/composer-add.svg)]",
  search: "mask-[url(./assets/figma/icons/search.svg)]",
  automations: "mask-[url(./assets/figma/icons/automations.svg)]",
  plugins: "mask-[url(./assets/figma/icons/plugins.svg)]",
  library: "mask-[url(./assets/figma/icons/library.svg)]",
  "chevron-down": "mask-[url(./assets/figma/icons/chevron-down.svg)]",
  help: "mask-[url(./assets/figma/icons/help.svg)]",
  sidebar: "mask-[url(./assets/figma/icons/sidebar.svg)]",
  more: "mask-[url(./assets/figma/icons/more.svg)]",
  archive: "mask-[url(./assets/figma/icons/archive.svg)]",
  folder: "mask-[url(./assets/figma/icons/folder.svg)]",
  notification: "mask-[url(./assets/figma/icons/notification.svg)]",
  send: "mask-[url(./assets/figma/icons/send.svg)]",
  workspace: "mask-[url(./assets/figma/icons/workspace.svg)]",
  knowledge: "mask-[url(./assets/figma/icons/knowledge.svg)]",
  "image-generation": "mask-[url(./assets/figma/icons/image-generation.svg)]",
  microphone: "mask-[url(./assets/figma/icons/microphone.svg)]",
  "move-project": "mask-[url(./assets/figma/icons/move-project.svg)]",
  pin: "mask-[url(./assets/figma/icons/pin.svg)]",
  share: "mask-[url(./assets/figma/icons/share.svg)]",
  overview: "mask-[url(./assets/figma/icons/overview.svg)]",
  close: "mask-[url(./assets/figma/icons/close.svg)]",
  "sort-priority":
    "mask-[url(./assets/figma/icons/sort-priority.svg)] [mask-position:64.2857%_center] [mask-size:78.125%_84.375%]",
  "sort-updated":
    "mask-[url(./assets/figma/icons/sort-updated.svg)] [mask-size:84.375%]",
  "sort-manual": "mask-[url(./assets/figma/icons/sort-manual.svg)]",
} as const

export type DesignIconName = keyof typeof masks

export function DesignIcon({
  name,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  name: DesignIconName
  className?: string
}) {
  return (
    <span
      {...props}
      aria-hidden="true"
      data-design-icon={name}
      className={cn(
        "inline-block size-[calc(var(--app-ui-font-size)+2px)] shrink-0 bg-current [mask-size:contain] mask-center mask-no-repeat forced-colors:bg-[ButtonText] forced-colors:forced-color-adjust-none",
        name === "composer-add" && "[mask-size:88.35%]",
        masks[name],
        className
      )}
    />
  )
}
