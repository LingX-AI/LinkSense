import type { KeyboardEvent, ReactNode } from "react"
import { XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ImagePreviewSurface({
  name,
  actions,
  children,
  onKeyDown,
}: Readonly<{
  name: string
  actions?: ReactNode
  children: ReactNode
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
}>) {
  const { t } = useTranslation()
  return (
    <DialogContent
      showCloseButton={false}
      overlayClassName="image-preview-overlay"
      className="image-preview-dialog top-0 left-0 translate-x-0 translate-y-0"
      onKeyDown={onKeyDown}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>
          {t("conversation.imagePreviewTitle", { name })}
        </DialogTitle>
        <DialogDescription>
          {t("conversation.imagePreviewDescription", { name })}
        </DialogDescription>
      </DialogHeader>
      <div className="image-preview-toolbar">
        {actions}
        <DialogClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="image-preview-control"
              aria-label={t("common.close")}
            />
          }
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
      </div>
      {children}
    </DialogContent>
  )
}
