import { useId, type ReactNode, type Ref } from "react"
import { LoaderCircleIcon, MessagesSquareIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { SideChat, SideChatSelection } from "@linksense/shared"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

export function SideChatPanel({
  data,
  pending,
  failed,
  onClose,
  onRetry,
  onSelectionChange,
  children,
  containerRef,
}: Readonly<{
  data?: SideChat | null
  pending: boolean
  failed: boolean
  onClose: () => void
  onRetry: () => void
  onSelectionChange: (selection: SideChatSelection) => void
  children?: ReactNode
  containerRef?: Ref<HTMLElement>
}>) {
  const { t } = useTranslation()
  const titleId = useId()
  const contextId = useId()
  const checkboxId = useId()
  const reference = data?.reference
  return (
    <aside
      ref={containerRef}
      className="office-preview-pane"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <MessagesSquareIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 id={titleId} className="min-w-0 flex-1 text-sm font-medium">
          {t("sideChat.title")}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          autoFocus
          aria-label={t("sideChat.close")}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </header>
      <div className="max-h-64 shrink-0 overflow-y-auto border-b border-border bg-muted/30 p-4 text-xs">
        <p className="mb-2 text-muted-foreground">
          {t("sideChat.independent")}
        </p>
        {reference && (
          <>
            <p
              className="mb-2 truncate font-medium"
              title={reference.source_title}
            >
              {t("sideChat.source", { title: reference.source_title })}
            </p>
            <blockquote className="max-h-28 overflow-y-auto border-l-2 border-primary/40 pl-3 leading-relaxed break-words whitespace-pre-wrap">
              {reference.selection_text}
            </blockquote>
            <Label
              htmlFor={checkboxId}
              className="mt-3 cursor-pointer items-start text-xs leading-relaxed font-normal"
            >
              <Checkbox
                id={checkboxId}
                disabled={pending}
                checked={reference.include_recent_messages}
                onCheckedChange={(checked) =>
                  onSelectionChange({
                    source_message_id: reference.source_message_id,
                    selection_text: reference.selection_text,
                    include_recent_messages: checked === true,
                  })
                }
                aria-describedby={contextId}
              />
              <span>{t("sideChat.includeRecent")}</span>
            </Label>
            <p
              id={contextId}
              className="mt-2 leading-relaxed text-muted-foreground"
            >
              {t("sideChat.context")}
            </p>
            {reference.recent_messages.length ? (
              <Collapsible className="mt-2">
                <CollapsibleTrigger className="min-h-6 cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
                  {t("sideChat.recent", {
                    count: reference.recent_messages.length,
                  })}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-2 space-y-2">
                    {reference.recent_messages.map((message) => (
                      <li
                        key={message.id}
                        className="rounded-md bg-muted p-2 leading-relaxed break-words whitespace-pre-wrap"
                      >
                        {message.text}
                      </li>
                    ))}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <p className="mt-2 text-muted-foreground">
                {t("sideChat.noRecent")}
              </p>
            )}
          </>
        )}
        {pending && (
          <p className="mt-2 flex items-center gap-2 text-muted-foreground">
            <LoaderCircleIcon
              className="size-3 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            {t("sideChat.opening")}
          </p>
        )}
        {failed && (
          <div
            role="alert"
            className="mt-2 flex items-center gap-2 text-destructive"
          >
            <span>{t("sideChat.error")}</span>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t("sideChat.retry")}
            </Button>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  )
}
