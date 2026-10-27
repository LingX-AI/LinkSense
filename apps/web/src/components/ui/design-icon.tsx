import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

const masks = {
  plus: "mask-[url(./assets/figma/icons/plus.svg)]",
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
  microphone: "mask-[url(./assets/figma/icons/microphone.svg)]",
  "move-project": "mask-[url(./assets/figma/icons/move-project.svg)]",
  pin: "mask-[url(./assets/figma/icons/pin.svg)]",
  share: "mask-[url(./assets/figma/icons/share.svg)]",
  overview: "mask-[url(./assets/figma/icons/overview.svg)]",
  close: "mask-[url(./assets/figma/icons/close.svg)]",
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
        "inline-block size-4 shrink-0 bg-current [mask-size:contain] mask-center mask-no-repeat forced-colors:bg-[ButtonText] forced-colors:forced-color-adjust-none",
        [
          "help",
          "sidebar",
          "notification",
          "send",
          "workspace",
          "knowledge",
          "microphone",
          "share",
          "overview",
        ].includes(name) && "size-5",
        masks[name],
        className
      )}
    />
  )
}
