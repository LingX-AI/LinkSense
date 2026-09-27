import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useParams } from "react-router-dom"

import { apiRequest } from "@/api/client"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { buttonVariants } from "@/components/ui/button"
import { publicConversationShareSchema } from "@/features/conversations/conversation-share-contracts"
import { projectConversationForSharing } from "@/features/conversations/conversation-share-content"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import { cn } from "@/lib/utils"

function SharedConversationFooter() {
  return (
    <footer className="flex shrink-0 justify-end px-7 pt-2 pb-[22px] max-md:justify-center max-md:px-3.5 max-md:pb-3.5">
      <PoweredByLinkSense />
    </footer>
  )
}

export function SharedConversationPage() {
  const { shareId } = useParams()
  const { t } = useTranslation()
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

  if (shareQuery.isPending) {
    return (
      <div className="shared-conversation-page">
        <main className="grid min-h-0 flex-1 place-items-center p-6">
          <LoadingState />
        </main>
        <SharedConversationFooter />
      </div>
    )
  }
  if (shareQuery.isError || !shareQuery.data) {
    return (
      <div className="shared-conversation-page">
        <main className="grid min-h-0 flex-1 place-items-center p-6">
          <ErrorState
            message={t("conversation.share.unavailable")}
            onRetry={() => void shareQuery.refetch()}
          />
        </main>
        <SharedConversationFooter />
      </div>
    )
  }

  const share = shareQuery.data
  return (
    <div className="shared-conversation-page">
      <header className="shared-conversation-header">
        <ProductLogo
          productName={productName}
          className="shared-conversation-brand"
        />
        <h1>{share.title}</h1>
        <Link
          className={cn(
            buttonVariants({ variant: "secondary" }),
            "shared-conversation-continue"
          )}
          to="/"
        >
          {t("conversation.share.continueInProduct", { productName })}
          <ArrowUpRightIcon aria-hidden="true" />
        </Link>
      </header>
      <main className="shared-conversation-main">
        <ConversationThread
          conversation={projectConversationForSharing(share.snapshot)}
          onDownload={() => undefined}
          editingDisabled
          embedded
        />
      </main>
      <SharedConversationFooter />
    </div>
  )
}
