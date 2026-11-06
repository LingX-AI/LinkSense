import { useTranslation } from "react-i18next"
import type { PublicQaCitation } from "@linksense/shared"
import { cn } from "@/lib/utils"
import { getKnowledgeSourceAnchorId } from "@/features/conversations/knowledge-citation-markdown"

export function PublicKnowledgeSources({
  sources,
  turnId,
  showExcerpts = false,
}: {
  sources: readonly PublicQaCitation[]
  turnId?: string
  showExcerpts?: boolean
}) {
  const { t } = useTranslation()
  if (!sources.length) return null
  return (
    <section
      aria-label={t("publicKnowledge.sources")}
      className={cn(
        "flex min-w-0 flex-col",
        showExcerpts ? "gap-2" : "gap-1 text-xs text-muted-foreground"
      )}
    >
      <h3
        className={showExcerpts ? "text-sm font-medium" : "text-xs font-normal"}
      >
        {t("publicKnowledge.sources")}
      </h3>
      <ol className={cn("flex flex-col", showExcerpts ? "gap-3" : "gap-1")}>
        {sources.map((source) => (
          <li
            key={source.number}
            id={
              turnId
                ? getKnowledgeSourceAnchorId(turnId, source.number)
                : undefined
            }
            className={cn("min-w-0", showExcerpts && "text-sm")}
          >
            <p className={cn("wrap-anywhere", showExcerpts && "font-medium")}>
              [{source.number}] {source.title}
            </p>
            {showExcerpts && (
              <p className="wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {source.excerpt}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
