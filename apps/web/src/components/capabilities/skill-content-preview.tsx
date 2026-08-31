import { useId } from "react"
import { useTranslation } from "react-i18next"

type SkillContentPreviewProps = {
  type: "plugin" | "skill"
  content: string | null
  truncated: boolean
}

export function SkillContentPreview({
  type,
  content,
  truncated,
}: SkillContentPreviewProps) {
  const { t } = useTranslation()
  const headingId = useId()

  if (type !== "skill") return null
  const displayedContent =
    content === ""
      ? t("capability.skillContentEmpty")
      : (content ?? t("common.notAvailable"))

  return (
    <section className="min-w-0 space-y-2">
      <h3
        id={headingId}
        className="text-[length:var(--app-font-11)] leading-[var(--app-line-16)] font-semibold text-[var(--app-text)]"
      >
        {t("capability.skillContentPreview")}
      </h3>
      {truncated && (
        <p className="text-[length:var(--app-font-10-5)] leading-[var(--app-line-16)] text-[var(--app-muted)]">
          {t("capability.skillContentTruncated")}
        </p>
      )}
      <pre
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="max-h-80 w-full overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[length:var(--app-font-11)] leading-[var(--app-line-16)] break-words whitespace-pre-wrap text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        {displayedContent}
      </pre>
    </section>
  )
}
