import type { CSSProperties } from "react"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTranslation } from "react-i18next"

import { useTheme } from "@/app/theme-state"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme()
  const { t } = useTranslation()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      containerAriaLabel={t("common.notifications")}
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
        ),
        info: <InfoIcon className="size-4" aria-hidden="true" />,
        warning: <TriangleAlertIcon className="size-4" aria-hidden="true" />,
        error: (
          <OctagonXIcon
            className="size-4 text-destructive"
            aria-hidden="true"
          />
        ),
        loading: (
          <Loader2Icon
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--app-border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: t("common.close"),
        classNames: {
          toast:
            "cn-toast left-1/2! right-auto! w-max! max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 py-3!",
          content: "min-w-0",
          closeButton:
            "static! order-last ml-auto! shrink-0 self-center transform-none! border-0! focus-visible:ring-2 focus-visible:ring-ring",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
