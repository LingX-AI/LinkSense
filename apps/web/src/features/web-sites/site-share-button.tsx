import { useState } from "react"
import { GlobeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ConversationFile } from "@/api/contracts"
import { useOfficePreviewPortalContainer } from "@/components/media/office-preview/office-preview-fullscreen-context"
import { Button } from "@/components/ui/button"
import { SiteDialog } from "./site-dialog"

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
  if (file.kind !== "artifact" || !/\.html?$/iu.test(file.name)) return null
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
        />
      )}
    </>
  )
}
