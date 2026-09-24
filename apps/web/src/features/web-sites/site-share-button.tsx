import { useState } from "react"
import { GlobeIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { ConversationFile } from "@/api/contracts"
import { useOfficePreviewPortalContainer } from "@/components/media/office-preview/office-preview-fullscreen-context"
import { Button } from "@/components/ui/button"
import { listWebSites, webSiteKeys } from "./api"
import { SiteDialog, type SiteLookup } from "./site-dialog"

export function SiteShareButton({
  file,
  conversationId,
}: {
  file: ConversationFile
  conversationId: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const portalContainer = useOfficePreviewPortalContainer()
  const publishable = file.kind === "artifact" && /\.html?$/iu.test(file.name)
  const query = useQuery({
    queryKey: webSiteKeys.list({ originFileId: file.id }),
    enabled: open && publishable,
    retry: false,
    queryFn: ({ signal }) => listWebSites({ originFileId: file.id, signal }),
  })
  const lookup: SiteLookup =
    query.isPending || query.isFetching
      ? { kind: "loading" }
      : query.error
        ? {
            kind: "error",
            error: query.error,
            retry: () => {
              void query.refetch()
            },
          }
        : { kind: "ready", site: query.data?.items[0] ?? null }
  if (!publishable) return null
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <GlobeIcon data-icon="inline-start" aria-hidden="true" />
        {t("webSites.share")}
      </Button>
      {open && (
        <SiteDialog
          action={{
            kind: "share",
            source: { conversationId, fileId: file.id, name: file.name },
          }}
          portalContainer={portalContainer}
          onClose={() => setOpen(false)}
          lookup={lookup}
        />
      )}
    </>
  )
}
