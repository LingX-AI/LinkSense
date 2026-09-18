import { useId } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  FileArchiveIcon,
  MessageSquareTextIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import { Separator } from "@/components/ui/separator"

export type ApplicationCreationMethod =
  "development" | "standard" | "interactive"

// Decorative conversation and preview shapes; the action's label carries its meaning.
function ApplicationCreationIllustration() {
  return (
    <span
      aria-hidden="true"
      data-slot="application-creation-illustration"
      className="pointer-events-none relative hidden h-32 w-36 shrink-0 sm:block"
    >
      <span className="absolute top-2 right-0 flex h-24 w-32 rotate-3 flex-col overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-application-create-accent/15">
        <span className="flex h-5 shrink-0 items-center gap-1 border-b border-divider px-2">
          <span className="size-1 rounded-full bg-application-create-accent/45" />
          <span className="size-1 rounded-full bg-application-create-accent/25" />
          <span className="size-1 rounded-full bg-application-create-accent/15" />
        </span>
        <span className="flex flex-1 gap-2 p-2">
          <span className="w-5 rounded bg-application-create-accent/8" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-2 w-10 rounded-full bg-application-create-accent/35" />
            <span className="grid flex-1 grid-cols-2 gap-1.5">
              <span className="rounded bg-application-create-accent/15" />
              <span className="rounded bg-application-create-accent/8" />
            </span>
            <span className="h-1 w-14 rounded-full bg-muted" />
          </span>
        </span>
      </span>
      <span className="absolute bottom-1 left-0 flex -rotate-3 items-center gap-2 rounded-xl bg-card p-3 shadow-sm ring-1 ring-application-create-accent/15">
        <MessageSquareTextIcon className="size-4 text-application-create-accent" />
        <span className="flex flex-col gap-1.5">
          <span className="h-1.5 w-12 rounded-full bg-application-create-accent/25" />
          <span className="h-1.5 w-8 rounded-full bg-application-create-accent/10" />
        </span>
      </span>
    </span>
  )
}

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
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 shadow-lg sm:max-w-xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader className="shrink-0 pr-7">
          <DialogTitle>{t("applications.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("applications.createTypeDescription")}
          </DialogDescription>
        </DialogHeader>
        <div
          className={dialogBodyStyles("-ml-1 flex flex-col gap-3 py-1 pl-1")}
        >
          <Button
            type="button"
            variant="ghost"
            className="group/creation h-auto w-full shrink-0 justify-start overflow-hidden rounded-2xl p-0 text-left whitespace-normal"
            aria-labelledby={`${id}-development-title`}
            aria-describedby={`${id}-development-description`}
            onClick={() => onChoose("development")}
          >
            <span className="flex w-full items-center gap-5 rounded-2xl bg-linear-to-br from-application-create-accent/12 via-application-create-accent/6 to-card p-5 ring-1 ring-application-create-accent/15 ring-inset">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-3">
                <span className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-application-create-accent/12 text-application-create-accent">
                    <SparklesIcon data-icon="inline-start" aria-hidden="true" />
                  </span>
                  <Badge variant="tag">
                    {t("applications.creation.recommended")}
                  </Badge>
                </span>
                <span className="flex flex-col gap-1.5">
                  <span
                    id={`${id}-development-title`}
                    className="text-base font-medium text-balance"
                  >
                    {t("applications.creation.interactiveTitle")}
                  </span>
                  <span
                    id={`${id}-development-description`}
                    className="text-sm leading-relaxed font-normal text-muted-foreground"
                  >
                    {t("applications.creation.interactiveDescription")}
                  </span>
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-application-create-accent">
                  {t("applications.creation.start")}
                  <ArrowRightIcon
                    data-icon="inline-end"
                    aria-hidden="true"
                    className="motion-safe:transition-transform motion-safe:group-hover/creation:translate-x-0.5"
                  />
                </span>
              </span>
              <ApplicationCreationIllustration />
            </span>
          </Button>
          <div
            data-slot="application-creation-alternatives"
            className="flex shrink-0 flex-col gap-1"
          >
            {alternatives.map(
              ({ method, title, description, icon: Icon }, index) => (
                <div key={method}>
                  {index > 0 && <Separator className="mx-3 w-auto" />}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 rounded-xl p-3 text-left whitespace-normal"
                    aria-labelledby={`${id}-${method}-title`}
                    aria-describedby={`${id}-${method}-description`}
                    onClick={() => onChoose(method)}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
                      <Icon data-icon="inline-start" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span id={`${id}-${method}-title`}>{title}</span>
                      <span
                        id={`${id}-${method}-description`}
                        className="text-xs leading-relaxed font-normal text-muted-foreground"
                      >
                        {description}
                      </span>
                    </span>
                    <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
