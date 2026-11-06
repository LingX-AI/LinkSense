import { useId } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  FileArchiveIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"

export type ApplicationCreationMethod =
  "development" | "standard" | "interactive"

export function ApplicationCreateDialog({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (method: ApplicationCreationMethod) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const alternatives = [
    {
      method: "standard",
      title: t("applications.createStandardApp"),
      description: t("applications.createStandardAppDescription"),
      icon: SlidersHorizontalIcon,
    },
    {
      method: "interactive",
      title: t("applications.importInteractiveApp"),
      description: t("applications.importInteractiveAppDescription"),
      icon: FileArchiveIcon,
    },
  ] satisfies {
    method: ApplicationCreationMethod
    title: string
    description: string
    icon: typeof SlidersHorizontalIcon
  }[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="workspace"
        className="flex flex-col"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("applications.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("applications.createTypeDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyStyles("flex flex-col gap-2")}>
          <Button
            type="button"
            variant="plain"
            className="h-auto min-h-22 w-full shrink-0 justify-start gap-3 rounded-lg border border-primary/20 bg-accent p-4 text-left whitespace-normal hover:bg-accent"
            aria-labelledby={`${id}-development-title`}
            aria-describedby={`${id}-development-description`}
            onClick={() => onChoose("development")}
          >
            <span className="flex size-9 shrink-0 items-center justify-center text-primary">
              <SparklesIcon data-icon="inline-start" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                id={`${id}-development-title`}
                className="text-sm leading-[var(--app-line-22)] font-medium"
              >
                {t("applications.creation.interactiveTitle")}
              </span>
              <span
                id={`${id}-development-description`}
                className="text-sm leading-[var(--app-line-22)] font-normal text-muted-foreground"
              >
                {t("applications.creation.interactiveDescription")}
              </span>
            </span>
          </Button>
          <div
            data-slot="application-creation-alternatives"
            className="flex shrink-0 flex-col gap-2"
          >
            {alternatives.map(({ method, title, description, icon: Icon }) => (
              <div key={method}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-22 w-full justify-start gap-3 rounded-lg p-4 text-left whitespace-normal"
                  aria-labelledby={`${id}-${method}-title`}
                  aria-describedby={`${id}-${method}-description`}
                  onClick={() => onChoose(method)}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center text-muted-foreground">
                    <Icon data-icon="inline-start" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span id={`${id}-${method}-title`}>{title}</span>
                    <span
                      id={`${id}-${method}-description`}
                      className="text-sm leading-[var(--app-line-22)] font-normal text-muted-foreground"
                    >
                      {description}
                    </span>
                  </span>
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
