import { useTranslation } from "react-i18next"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { z } from "zod"
import { publicKnowledgeTurnSchema } from "@linksense/shared"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PublicKnowledgeSources } from "./sources"

export function PublicKnowledgeTurnView({
  turn,
  review = false,
}: {
  turn: z.infer<typeof publicKnowledgeTurnSchema>
  review?: boolean
}) {
  const { t, i18n } = useTranslation()
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>{t("publicKnowledge.query")}</CardTitle>
        <p className="wrap-anywhere whitespace-pre-wrap">{turn.input_text}</p>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <Separator />
        <div className="flex items-center justify-between gap-2">
          <span>{t("publicKnowledge.answer")}</span>
          <Badge variant="secondary">
            {t(`publicKnowledge.${turn.status}`)}
          </Badge>
        </div>
        <div className="assistant-markdown min-w-0 wrap-anywhere">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              img: () => null,
              a: ({ children, href }) =>
                href && /^https?:\/\//iu.test(href) ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {turn.output_text}
          </ReactMarkdown>
        </div>
        {turn.status === "failed" && (
          <p role="alert">{t("publicKnowledge.unavailable")}</p>
        )}
        <PublicKnowledgeSources
          sources={turn.citations}
          showExcerpts={review}
        />
      </CardContent>
      {review && (
        <CardFooter className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>
            {t("publicKnowledge.version")}: {turn.application_version}
          </span>
          <span>{turn.model}</span>
          {turn.duration_ms !== null && (
            <span>
              {t("publicKnowledge.duration")}:{" "}
              {new Intl.NumberFormat(i18n.resolvedLanguage, {
                style: "unit",
                unit: "second",
                maximumFractionDigits: 1,
              }).format(turn.duration_ms / 1000)}
            </span>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
