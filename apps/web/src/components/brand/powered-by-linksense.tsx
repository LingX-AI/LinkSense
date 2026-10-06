import { useTranslation } from "react-i18next"

import { useResolvedTheme } from "@/app/use-resolved-theme"
import { cn } from "@/lib/utils"

export function PoweredByLinkSense({ className }: { className?: string }) {
  const { t } = useTranslation()
  const resolvedTheme = useResolvedTheme()

  return (
    <a
      href="https://linksense.org"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("common.poweredByLinkSense")}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 text-xs leading-none whitespace-nowrap text-foreground no-underline visited:text-foreground hover:text-foreground hover:no-underline",
        className
      )}
    >
      <span>{t("common.poweredBy")}</span>
      <img
        src={
          resolvedTheme === "dark"
            ? "/attribution/linksense-mark-light.svg"
            : "/attribution/linksense-mark.svg"
        }
        alt="LinkSense"
        className="h-[18px] w-auto max-w-none"
        width="348"
        height="94"
        decoding="async"
      />
    </a>
  )
}

export function PoweredByLinkSenseFooter() {
  return (
    <footer className="flex h-12 shrink-0 items-center justify-center px-4 md:h-16 md:justify-end md:px-7">
      <PoweredByLinkSense />
    </footer>
  )
}
