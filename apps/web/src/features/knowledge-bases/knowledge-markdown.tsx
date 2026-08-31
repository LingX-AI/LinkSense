import { useEffect, useState } from "react"
import { ImageOffIcon, LoaderCircleIcon } from "lucide-react"
import ReactMarkdown, { type UrlTransform } from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkGfm from "remark-gfm"
import { useTranslation } from "react-i18next"

import { loadKnowledgeDocumentAsset } from "@/features/knowledge-bases/knowledge-base-api"

const knowledgeMarkdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
    src: ["kb-asset", "http", "https"],
  },
}

const safeKnowledgeUrlTransform: UrlTransform = (url, key, node) => {
  if (node.tagName === "img" && key === "src") {
    return /^(?:kb-asset:\/\/[a-zA-Z0-9_-]+|https?:\/\/[^\s]+)$/iu.test(url)
      ? url
      : ""
  }
  if (node.tagName === "a" && key === "href") {
    return /^(https?:|mailto:)/iu.test(url) ? url : ""
  }
  return ""
}

export function KnowledgeMarkdown({
  knowledgeBaseId,
  documentId,
  documentVersionId,
  markdown,
}: {
  knowledgeBaseId: string
  documentId: string
  documentVersionId: string
  markdown: string
}) {
  return (
    <article className="knowledge-markdown assistant-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, knowledgeMarkdownSanitizeSchema],
        ]}
        urlTransform={safeKnowledgeUrlTransform}
        components={{
          a: ({ children, href }) =>
            href && /^(https?:|mailto:)/iu.test(href) ? (
              <a href={href} rel="noopener noreferrer" target="_blank">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ src, alt }) =>
            src && /^https?:\/\/[^\s]+$/iu.test(src) ? (
              <RemoteKnowledgeMarkdownImage
                key={`${documentVersionId}:${src}`}
                source={src}
                alt={alt ?? ""}
              />
            ) : (
              <KnowledgeMarkdownImage
                key={`${documentVersionId}:${src ?? "invalid"}`}
                knowledgeBaseId={knowledgeBaseId}
                documentId={documentId}
                documentVersionId={documentVersionId}
                source={src}
                alt={alt ?? ""}
              />
            ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}

/** Citation excerpts intentionally contain no source identifiers or asset
 * handles. Images are rendered as their server-projected alt text only. */
export function KnowledgeCitationExcerpt({
  excerpt,
  className,
}: {
  excerpt: string
  className?: string
}) {
  return (
    <article
      className={[
        "knowledge-citation-excerpt knowledge-markdown assistant-markdown",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, knowledgeMarkdownSanitizeSchema],
        ]}
        urlTransform={safeKnowledgeUrlTransform}
        components={{
          a: ({ children, href }) =>
            href && /^(https?:|mailto:)/iu.test(href) ? (
              <a href={href} rel="noopener noreferrer" target="_blank">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt ?? ""}</span>,
        }}
      >
        {excerpt}
      </ReactMarkdown>
    </article>
  )
}

function KnowledgeMarkdownImage({
  knowledgeBaseId,
  documentId,
  documentVersionId,
  source,
  alt,
}: {
  knowledgeBaseId: string
  documentId: string
  documentVersionId: string
  source?: string
  alt: string
}) {
  const { t } = useTranslation()
  const assetReferenceId = source?.match(
    /^kb-asset:\/\/([a-zA-Z0-9_-]+)$/u
  )?.[1]
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; url: string }
    | { status: "error" }
  >({ status: assetReferenceId ? "loading" : "error" })

  useEffect(() => {
    if (!assetReferenceId) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    void loadKnowledgeDocumentAsset(
      knowledgeBaseId,
      documentId,
      documentVersionId,
      assetReferenceId,
      controller.signal
    )
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setState({ status: "ready", url: objectUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [assetReferenceId, documentId, documentVersionId, knowledgeBaseId])

  if (state.status === "ready") {
    return (
      <img
        src={state.url}
        alt={alt}
        width="800"
        height="450"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setState({ status: "error" })}
      />
    )
  }

  const stateLabel = t(
    state.status === "loading"
      ? alt
        ? "knowledge.preview.assetLoadingNamed"
        : "knowledge.preview.assetLoading"
      : alt
        ? "knowledge.preview.assetUnavailableNamed"
        : "knowledge.preview.assetUnavailable",
    alt ? { name: alt } : undefined
  )

  return (
    <span
      className="knowledge-markdown-asset-state"
      role={state.status === "loading" ? "status" : "img"}
      aria-label={stateLabel}
    >
      {state.status === "loading" ? (
        <LoaderCircleIcon aria-hidden="true" />
      ) : (
        <ImageOffIcon aria-hidden="true" />
      )}
      <span>{stateLabel}</span>
    </span>
  )
}

function RemoteKnowledgeMarkdownImage({
  source,
  alt,
}: {
  source: string
  alt: string
}) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  if (!failed) {
    return (
      <img
        src={source}
        alt={alt}
        width="800"
        height="450"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }

  const label = t(
    alt
      ? "knowledge.preview.assetUnavailableNamed"
      : "knowledge.preview.assetUnavailable",
    alt ? { name: alt } : undefined
  )
  return (
    <span
      className="knowledge-markdown-asset-state"
      role="img"
      aria-label={label}
    >
      <ImageOffIcon aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
