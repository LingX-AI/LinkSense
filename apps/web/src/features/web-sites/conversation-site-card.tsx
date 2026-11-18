import { useEffect, useState } from "react"
import { ArrowUpRightIcon, CheckIcon, CopyIcon, GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import type { ConversationWebSite } from "@linksense/shared"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { copyTextToClipboard } from "@/lib/clipboard"
import { webSiteManagementPath } from "./site-navigation"

export function ConversationSiteCard({ site }: { site: ConversationWebSite }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<{ result: "copied" | "failed" }>()
  const published = site.status === "published"
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    new URL(site.url).hostname
  )
  useEffect(() => {
    if (feedback?.result !== "copied") return
    const timer = window.setTimeout(() => setFeedback(undefined), 2_000)
    return () => window.clearTimeout(timer)
  }, [feedback])

  return (
    <Card size="sm" className="my-3 flex max-w-xl flex-col gap-3 p-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <GlobeIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 font-medium wrap-anywhere">{site.name}</p>
            <Badge variant="outline">
              {t(`webSites.status.${site.status}`)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              site.backend_id ? "webSites.dataConnected" : "webSites.pageOnly"
            )}
          </p>
          {published && (
            <a
              className="block truncate rounded-sm text-sm text-link-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              title={site.url}
            >
              {site.url}
            </a>
          )}
          {published && local && (
            <p className="text-xs text-muted-foreground">
              {t("webSites.localOnly")}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {published && (
          <>
            <a
              className={buttonVariants({ size: "sm" })}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("webSites.openSite")}
              <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await copyTextToClipboard(site.url)
                  setFeedback({ result: "copied" })
                } catch {
                  setFeedback({ result: "failed" })
                }
              }}
            >
              {feedback?.result === "copied" ? (
                <CheckIcon data-icon="inline-start" aria-hidden="true" />
              ) : (
                <CopyIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {t("webSites.copy")}
            </Button>
          </>
        )}
        <Link
          className={buttonVariants({ variant: "ghost", size: "sm" })}
          to={webSiteManagementPath()}
        >
          {t("webSites.title")}
        </Link>
      </div>
      {published && (
        <p
          role="status"
          className={feedback ? "text-xs text-muted-foreground" : "sr-only"}
        >
          {feedback?.result === "copied"
            ? t("webSites.copied")
            : feedback?.result === "failed"
              ? t("webSites.copyFailed")
              : ""}
        </p>
      )}
    </Card>
  )
}
