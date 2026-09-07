import remarkCjkFriendly from "remark-cjk-friendly/parseOnly"
import type { CjkPlugin } from "streamdown"

export const assistantMarkdownCjkPlugin = {
  name: "cjk",
  type: "cjk",
  remarkPlugins: [],
  remarkPluginsBefore: [remarkCjkFriendly],
  remarkPluginsAfter: [],
} satisfies CjkPlugin
