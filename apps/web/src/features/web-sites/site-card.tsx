import { useEffect, useRef, useState, type ReactNode } from "react"
import type { WebSite } from "@linksense/shared"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { notify } from "@/components/feedback/notification"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription } from "@/components/ui/card"
import { cardSpotlightProps } from "@/components/ui/card-spotlight"
import { copyConversationShareUrl } from "@/features/conversations/conversation-share-contracts"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"
import { cn } from "@/lib/utils"

export function SiteCard({
  site,
  actions,
}: {
  site: WebSite
  actions: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const url = new URL(site.url_path, window.location.origin).href

  return (
    <Card
      {...cardSpotlightProps}
      size="sm"
      className={cn(
        cardSpotlightProps.className,
        "min-h-15 min-w-0 flex-row flex-wrap items-center gap-3 rounded-none border-0 border-b border-divider bg-transparent px-3 py-2.5 shadow-none hover:bg-hover"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 font-medium [overflow-wrap:anywhere]">
            {site.name}
          </h2>
          <Badge
            variant={site.status === "published" ? "secondary" : "outline"}
          >
            {t(`webSites.status.${site.status}`)}
          </Badge>
        </div>
        {site.description && (
          <CardDescription className="line-clamp-2 text-sm leading-[var(--app-line-22)] [overflow-wrap:anywhere]">
            {site.description}
          </CardDescription>
        )}
        <SiteLink key={url} url={url} name={site.name} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-[var(--app-line-18)] text-muted-foreground">
          {site.conversation_id ? (
            <Link
              className="max-w-full min-w-0 truncate underline-offset-4 hover:underline"
              to={`/conversations/${site.conversation_id}`}
            >
              {t("webSites.sourceTask", { title: site.source_task_title })}
            </Link>
          ) : (
            <span>{t("webSites.sourceDeleted")}</span>
          )}
          <span>
            {t("webSites.publishedAt", {
              date: formatDateTime(site.published_at, language),
            })}
          </span>
          <span>
            {t("webSites.resources", {
              count: site.file_count,
              size: formatFileSize(site.size_bytes, language),
            })}
          </span>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    </Card>
  )
}

function SiteLink({ url, name }: { url: string; name: string }) {
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
      await copyConversationShareUrl(url)
      setCopyState("copied")
    } catch {
      setCopyState("idle")
      notify.error(t("webSites.copyFailed"))
    } finally {
      copying.current = false
    }
  }

  const label =
    copyState === "copied"
      ? t("webSites.copied")
      : t("webSites.copyNamed", { name })
  return (
    <div className="flex w-fit max-w-full min-w-0 items-center gap-1">
      <p className="min-w-0 truncate text-sm text-muted-foreground" title={url}>
        {url}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground/70"
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
