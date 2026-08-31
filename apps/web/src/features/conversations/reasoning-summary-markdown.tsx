import { memo, type ComponentProps } from "react"
import { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Streamdown } from "streamdown"

import {
  assistantMarkdownUrlTransform,
  getSafeAssistantMarkdownLinkUrl,
} from "@/features/conversations/assistant-markdown-image-utils"
import { assistantMarkdownPlugins } from "@/features/conversations/assistant-markdown-math"
import { normalizeAssistantMarkdown } from "@/features/conversations/streaming-markdown"
import { cn } from "@/lib/utils"

const reasoningMarkdownComponents: Components = {
  strong: ({ node, ...props }) => {
    void node
    return <strong {...props} />
  },
  a: ({ node, href, ...props }) => {
    void node
    const safeHref = getSafeAssistantMarkdownLinkUrl(href)
    if (!safeHref) return <span>{props.children}</span>
    const external = /^https?:\/\//iu.test(safeHref)
    return (
      <a
        {...props}
        href={safeHref}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      />
    )
  },
  img: ({ node, alt }) => {
    void node
    return alt ? <span>{alt}</span> : null
  },
}

const reasoningRemarkPlugins = [remarkGfm]
const reasoningRehypePlugins: NonNullable<
  ComponentProps<typeof Streamdown>["rehypePlugins"]
> = []

export const ReasoningSummaryMarkdown = memo(function ReasoningSummaryMarkdown({
  content,
  className,
  streaming = false,
}: Readonly<{
  content: string
  className?: ComponentProps<"div">["className"]
  streaming?: boolean
}>) {
  void streaming
  return (
    <Streamdown
      className={cn("assistant-markdown reasoning-summary-markdown", className)}
      mode="streaming"
      animated={false}
      isAnimating={false}
      plugins={assistantMarkdownPlugins}
      remarkPlugins={reasoningRemarkPlugins}
      components={reasoningMarkdownComponents}
      rehypePlugins={reasoningRehypePlugins}
      skipHtml
      urlTransform={assistantMarkdownUrlTransform}
    >
      {normalizeAssistantMarkdown(content)}
    </Streamdown>
  )
})
