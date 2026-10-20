import { useTranslation } from "react-i18next"

import { useResolvedTheme } from "@/app/use-resolved-theme"
import { cn } from "@/lib/utils"

type AttributionPlacement = "shell" | "page" | "public" | "conversation"

const placementClasses: Record<AttributionPlacement, string> = {
  shell: "shell-attribution",
  page: "",
  public: "-mx-[var(--public-shell-horizontal-padding)] mt-auto",
  // The bottom stack already has its own insets. Subtract them so the mark
  // keeps the same distance from the workspace edge in both grid and gutter.
  // Margins also work when the requested inset is smaller than the stack gutter.
  conversation:
    "conversation-attribution mr-[calc(var(--attribution-inset)-var(--conversation-horizontal-gutter))] mb-[calc(var(--attribution-inset)-var(--conversation-bottom-inset))] hidden justify-self-end md:flex @min-[76rem]/conversation-workspace:absolute @min-[76rem]/conversation-workspace:right-[calc(var(--attribution-inset)-var(--conversation-horizontal-gutter))] @min-[76rem]/conversation-workspace:bottom-[calc(var(--attribution-inset)-var(--conversation-bottom-inset))] @min-[76rem]/conversation-workspace:m-0",
}

export function PoweredByLinkSense({
  placement = "shell",
}: {
  placement?: AttributionPlacement
}) {
  const { t } = useTranslation()
  const resolvedTheme = useResolvedTheme()
  const Frame = placement === "conversation" ? "div" : "footer"

  return (
    <Frame
      data-slot="powered-by-linksense"
      data-placement={placement}
      className={cn(
        "shrink-0 items-center [--attribution-inset:18px]",
        placement !== "conversation" &&
          "right-[var(--attribution-inset)] bottom-[var(--attribution-inset)] flex justify-end px-[var(--attribution-inset)] pt-2 pb-[var(--attribution-inset)]",
        placementClasses[placement]
      )}
    >
      <a
        href="https://linksense.org"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("common.poweredByLinkSense")}
        className="inline-flex h-5 shrink-0 items-center gap-1.5 text-xs leading-none whitespace-nowrap text-foreground no-underline visited:text-foreground hover:text-foreground hover:no-underline"
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
    </Frame>
  )
}
