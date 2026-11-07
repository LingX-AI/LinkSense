import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRightIcon, InfoIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"

import { apiRequest } from "@/api/client"
import welcomeBackground from "@/assets/home/welcome-background.svg"
import welcomeOrb from "@/assets/home/welcome-orb.svg"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { buttonVariants } from "@/components/ui/button"
import { publicConversationShareSchema } from "@/features/conversations/conversation-share-contracts"
import { projectConversationForSharing } from "@/features/conversations/conversation-share-content"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { cn } from "@/lib/utils"

export function SharedConversationPage() {
  const { shareId } = useParams()
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const shareQuery = useQuery({
    queryKey: ["public-conversation-share", shareId],
    enabled: Boolean(shareId),
    retry: false,
    queryFn: ({ signal }) => {
      if (!shareId) throw new Error("Share id is required")
      return apiRequest(`/shared-conversations/${shareId}`, {
        schema: publicConversationShareSchema,
        signal,
        skipRefresh: true,
      })
    },
  })

  useEffect(() => {
    if (!shareQuery.data) return
    const previousTitle = document.title
    document.title = `${shareQuery.data.title} · ${productName}`
    return () => {
      document.title = previousTitle
    }
  }, [productName, shareQuery.data])

  const header = (
    <header className="shared-conversation-header">
      <ProductLogo
        productName={productName}
        className="shared-conversation-brand"
      />
      <Link
        className={cn(
          buttonVariants({ variant: "outline" }),
          "shared-conversation-continue"
        )}
        to="/"
      >
        {t("conversation.share.continueInProduct", { productName })}
        <ArrowUpRightIcon aria-hidden="true" />
      </Link>
    </header>
  )

  if (shareQuery.isPending) {
    return (
      <div className="shared-conversation-page">
        {header}
        <main className="grid min-h-0 flex-1 place-items-center p-6">
          <LoadingState />
        </main>
        <PoweredByLinkSense placement="page" />
      </div>
    )
  }
  if (shareQuery.isError || !shareQuery.data) {
    return (
      <div className="shared-conversation-page">
        {header}
        <main className="grid min-h-0 flex-1 place-items-center p-6">
          <ErrorState
            message={t("conversation.share.unavailable")}
            onRetry={() => void shareQuery.refetch()}
          />
        </main>
        <PoweredByLinkSense placement="page" />
      </div>
    )
  }

  const share = shareQuery.data
  return (
    <div className="shared-conversation-page">
      {header}
      <main
        className="shared-conversation-main"
        data-conversation-scroll-viewport
      >
        <div className="mx-auto grid w-full max-w-4xl gap-8 px-5 pt-6 pb-10 sm:px-0 sm:pt-10">
          <section className="relative isolate flex min-h-42 items-center justify-between gap-6 overflow-hidden rounded-xl bg-card p-6 sm:px-8">
            <img
              src={welcomeBackground}
              alt=""
              className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-70 dark:brightness-25"
            />
            <div className="grid min-w-0 gap-2">
              <h1 className="text-2xl leading-8 font-semibold break-words text-heading">
                {share.title}
              </h1>
              <p className="text-sm leading-[var(--app-line-22)] text-muted-foreground">
                {t("conversation.share.snapshotDate", {
                  date: formatDateTime(
                    share.created_at,
                    normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
                  ),
                })}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{t("conversation.share.sharedConversation")}</span>
                <span className="rounded-md bg-card px-2 py-1">
                  {t("conversation.share.readOnly")}
                </span>
              </div>
            </div>
            <img
              src={welcomeOrb}
              alt=""
              width="120"
              height="120"
              className="pointer-events-none hidden size-30 shrink-0 sm:block"
            />
          </section>
          <ConversationThread
            conversation={projectConversationForSharing(share.snapshot)}
            onDownload={() => undefined}
            editingDisabled
            embedded
          />
          <p className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm leading-[var(--app-line-22)] text-muted-foreground">
            <InfoIcon aria-hidden="true" className="mt-px size-5 shrink-0" />
            {t("conversation.share.snapshotNotice")}
          </p>
        </div>
      </main>
      <PoweredByLinkSense placement="page" />
    </div>
  )
}
