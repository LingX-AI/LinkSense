import { useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"
import { copyTextToClipboard } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

export function SiteLink({
  url,
  copyLabel,
  displayText,
  multiline = false,
}: {
  url: string
  copyLabel: string
  displayText?: string
  multiline?: boolean
}) {
  const { t } = useTranslation()
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">(
    "idle"
  )
  const copying = useRef(false)

  useEffect(() => {
    if (copyState !== "copied") return
    const timer = window.setTimeout(() => setCopyState("idle"), 2_000)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const copy = async () => {
    if (copying.current) return
    copying.current = true
    setCopyState("copying")
    try {
      await copyTextToClipboard(url)
      setCopyState("copied")
    } catch {
      setCopyState("idle")
      notify.error(t("webSites.copyFailed"))
    } finally {
      copying.current = false
    }
  }

  const label = copyState === "copied" ? t("webSites.copied") : copyLabel
  return (
    <div
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1",
        multiline ? "justify-between" : "w-fit"
      )}
    >
      <p
        className={cn(
          "min-w-0 text-sm text-muted-foreground",
          multiline ? "wrap-anywhere" : "truncate"
        )}
        title={url}
      >
        {displayText ?? url}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground/70 max-sm:min-h-11 max-sm:min-w-11"
        aria-label={label}
        title={label}
        aria-busy={copyState === "copying" || undefined}
        disabled={copyState === "copying"}
        data-copy-state={copyState}
        onClick={() => void copy()}
      >
        {copyState === "copied" ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </Button>
      <span className="sr-only" role="status">
        {copyState === "copied" ? t("webSites.copied") : ""}
      </span>
    </div>
  )
}
