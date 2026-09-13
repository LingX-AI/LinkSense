import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { AssistantWaitingSnake } from "@/features/conversations/assistant-waiting-snake"
import { cn } from "@/lib/utils"

export function AssistantHtmlPreviewLoading({
  label,
  className,
}: Readonly<{
  label: string
  className?: string
}>) {
  const { t } = useTranslation()
  const [playing, setPlaying] = useState(false)
  const playButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className={cn(
        "assistant-html-preview-loading-surface relative min-h-80 w-full overflow-hidden rounded-2xl",
        className
      )}
      role={playing ? "group" : "status"}
      aria-label={label}
      aria-busy={playing ? undefined : true}
      aria-live={playing ? undefined : "polite"}
    >
      <div className="assistant-html-preview-loading-canvas" aria-hidden="true">
        <span
          className="assistant-html-preview-loading-dots"
          aria-hidden="true"
        />
        {!playing && (
          <span
            className="assistant-html-preview-loading-glow"
            aria-hidden="true"
          />
        )}
      </div>
      {playing ? (
        <>
          <span
            className="sr-only"
            role="status"
            aria-label={label}
            aria-busy="true"
          />
          <AssistantWaitingSnake
            onExit={() => {
              setPlaying(false)
              requestAnimationFrame(() =>
                playButtonRef.current?.focus({ preventScroll: true })
              )
            }}
          />
        </>
      ) : (
        <Button
          ref={playButtonRef}
          type="button"
          variant="ghost"
          size="xs"
          className="absolute right-3 bottom-3"
          onClick={() => setPlaying(true)}
        >
          {t("conversation.waitingGame.playWhileWaiting")}
        </Button>
      )}
    </div>
  )
}
