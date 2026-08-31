import { createMathPlugin } from "@streamdown/math"
import type { ComponentPropsWithoutRef } from "react"
import type { Streamdown } from "streamdown"

const assistantMathPlugin = createMathPlugin({
  singleDollarTextMath: true,
})

export const assistantMarkdownPlugins = {
  math: assistantMathPlugin,
} satisfies NonNullable<ComponentPropsWithoutRef<typeof Streamdown>["plugins"]>
