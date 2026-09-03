import type { ComponentPropsWithoutRef } from "react"
import type { Streamdown } from "streamdown"

import { assistantMarkdownCjkPlugin } from "@/features/conversations/assistant-markdown-cjk"
import { assistantMathPlugin } from "@/features/conversations/assistant-markdown-math"

export const assistantMarkdownPlugins = {
  cjk: assistantMarkdownCjkPlugin,
  math: assistantMathPlugin,
} satisfies NonNullable<ComponentPropsWithoutRef<typeof Streamdown>["plugins"]>
