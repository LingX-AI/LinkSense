import { useState } from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  SparklesIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useProductName } from "@/app/product-branding"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { cn } from "@/lib/utils"

type ConversationThreadProps = {
  isRunning: boolean
}

export function ConversationThread({ isRunning }: ConversationThreadProps) {
  const { t } = useTranslation()
  const productName = useProductName()
  const [activityOpen, setActivityOpen] = useState(false)

  return (
    <div className="conversation-scroll" role="log" aria-live="polite">
      <div className="conversation-column">
        <article
          aria-label={t("conversation.userMessageLabel")}
          className="flex justify-end pt-10 sm:pt-14"
        >
          <div className="user-message max-w-[min(82%,700px)] px-4 py-3.5 sm:max-w-[76%] sm:px-5 sm:py-4">
            <p className="text-[length:var(--app-font-13)] leading-5.5 text-[var(--app-text)] sm:text-sm">
              {t("conversation.userMessage")}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="attachment-tile mt-3 h-auto w-full justify-start gap-3 border-0 px-3 py-2.5 text-left shadow-none"
              aria-label={t("conversation.attachmentName")}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--app-file-icon)] text-[var(--app-file-icon-foreground)]">
                <FileTextIcon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-[var(--app-text)]">
                  {t("conversation.attachmentName")}
                </span>
                <span className="block pt-0.5 text-[length:var(--app-font-10)] text-[var(--app-muted)]">
                  {t("conversation.attachmentMeta")}
                </span>
              </span>
            </Button>
          </div>
        </article>

        <article
          aria-label={t("conversation.agentMessageLabel")}
          className="agent-message mt-10 sm:mt-14"
        >
          <div className="mb-4 flex items-center gap-2 text-[length:var(--app-font-11)] font-medium text-[var(--app-muted)]">
            <span className="flex size-5 items-center justify-center rounded-full bg-[var(--app-agent-mark)] text-[var(--app-agent-mark-foreground)]">
              <SparklesIcon className="size-3" aria-hidden="true" />
            </span>
            <span>{productName}</span>
          </div>

          <p className="max-w-[68ch] text-[length:var(--app-ui-font-size)] leading-6.5 text-[var(--app-text)] sm:text-[length:var(--app-font-15)]">
            {t("conversation.agentIntro")}
          </p>

          <Collapsible
            className="mt-5"
            open={activityOpen}
            onOpenChange={setActivityOpen}
          >
            <CollapsibleTrigger className="activity-trigger group flex items-center gap-2 rounded-lg px-2 py-1.5 text-[length:var(--app-font-11)] font-medium text-[var(--app-muted)] transition-colors outline-none hover:bg-[var(--app-hover)] focus-visible:ring-2 focus-visible:ring-[var(--app-ring)]">
              <Marker
                render={<span />}
                className="w-fit max-w-full text-inherit"
                aria-busy={isRunning || undefined}
                role={isRunning ? "status" : undefined}
              >
                <MarkerIcon>
                  <LoaderCircleIcon
                    className={cn("size-3.5", isRunning && "animate-spin")}
                  />
                </MarkerIcon>
                <MarkerContent className={cn(isRunning && "shimmer")}>
                  {t("conversation.workSummary")}
                </MarkerContent>
                <MarkerIcon>
                  <ChevronRightIcon className="size-3 transition-transform group-data-panel-open:rotate-90" />
                </MarkerIcon>
              </Marker>
              <span className="sr-only">
                {t("conversation.workSummaryDescription")}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="activity-panel mt-2 grid gap-1.5 rounded-2xl px-3 py-2.5 text-[length:var(--app-font-11)] text-[var(--app-muted)]">
              {["stepRead", "stepSkill", "stepDraft"].map((step) => (
                <Marker key={step} className="py-1 text-inherit">
                  <MarkerIcon>
                    <CheckIcon className="size-3.5 rounded-full bg-[var(--app-control-surface)] p-0.5 text-[var(--app-muted)]" />
                  </MarkerIcon>
                  <MarkerContent>{t(`conversation.${step}`)}</MarkerContent>
                </Marker>
              ))}
            </CollapsibleContent>
          </Collapsible>

          <div className="mt-6 space-y-4 text-[length:var(--app-ui-font-size)] leading-6.5 text-[var(--app-text)] sm:text-[length:var(--app-font-15)]">
            <p>{t("conversation.agentBody")}</p>
          </div>

          <Button
            type="button"
            variant="ghost"
            className="artifact-tile mt-6 h-auto w-full max-w-md justify-start gap-3 px-3.5 py-3 text-left shadow-none"
            aria-label={t("conversation.downloadArtifact")}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--app-artifact-icon)] text-[var(--app-artifact-icon-foreground)]">
              <FileTextIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[length:var(--app-font-10)] font-medium text-[var(--app-muted)]">
                {t("conversation.artifactReady")}
              </span>
              <span className="mt-0.5 block truncate text-xs font-medium text-[var(--app-text)]">
                {t("conversation.artifactName")}
              </span>
              <span className="block pt-0.5 text-[length:var(--app-font-10)] text-[var(--app-muted)]">
                {t("conversation.artifactMeta")}
              </span>
            </span>
            <DownloadIcon
              className="size-4 text-[var(--app-muted)]"
              aria-hidden="true"
            />
          </Button>
        </article>
      </div>
    </div>
  )
}
