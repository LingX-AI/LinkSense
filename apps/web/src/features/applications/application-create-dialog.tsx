import { useId, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowRightIcon,
  FileArchiveIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  BookOpenIcon,
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
import { cn } from "@/lib/utils"

export type ApplicationCreationMethod =
  "development" | "standard" | "interactive" | "public_knowledge"

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
  const titleRef = useRef<HTMLHeadingElement>(null)
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
    {
      method: "public_knowledge",
      title: t("publicKnowledge.title"),
      description: t("publicKnowledge.description"),
      icon: BookOpenIcon,
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
        initialFocus={titleRef}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
            {t("applications.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("applications.createTypeDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className={dialogBodyStyles("flex flex-col gap-2")}>
          <ApplicationCreationChoice
            id={id}
            method="development"
            title={t("applications.creation.interactiveTitle")}
            description={t("applications.creation.interactiveDescription")}
            icon={SparklesIcon}
            onChoose={onChoose}
          />
          <div
            data-slot="application-creation-alternatives"
            className="flex shrink-0 flex-col gap-2"
          >
            {alternatives.map((alternative) => (
              <ApplicationCreationChoice
                key={alternative.method}
                id={id}
                {...alternative}
                onChoose={onChoose}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ApplicationCreationChoice({
  id,
  method,
  title,
  description,
  icon: Icon,
  onChoose,
}: {
  id: string
  method: ApplicationCreationMethod
  title: string
  description: string
  icon: typeof SlidersHorizontalIcon
  onChoose: (method: ApplicationCreationMethod) => void
}) {
  return (
    <Button
      type="button"
      variant="plain"
      className="group/creation-choice h-auto min-h-18 w-full shrink-0 justify-start gap-3 rounded-lg border-border bg-card p-3 text-left whitespace-normal hover:border-input-hover hover:bg-(--app-hover-subtle) focus-visible:ring-2 focus-visible:ring-ring/20 active:bg-accent active:not-aria-[haspopup]:translate-y-0"
      aria-labelledby={`${id}-${method}-title`}
      aria-describedby={`${id}-${method}-description`}
      onClick={() => onChoose(method)}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          method === "development"
            ? "bg-accent text-primary"
            : "bg-(--app-control-surface) text-(--app-control-foreground)"
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          id={`${id}-${method}-title`}
          className="text-sm leading-5 font-medium"
        >
          {title}
        </span>
        <span
          id={`${id}-${method}-description`}
          className="text-[length:var(--app-font-13)] leading-5 font-normal text-muted-foreground"
        >
          {description}
        </span>
      </span>
      <ArrowRightIcon
        className="size-4 text-muted-foreground transition-colors group-hover/creation-choice:text-foreground"
        aria-hidden="true"
      />
    </Button>
  )
}
