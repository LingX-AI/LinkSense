import { createLucideIcon, type IconNode } from "lucide-react"

const selectionFrame: IconNode = [
  ["path", { d: "M4 4v12.5A2.5 2.5 0 0 0 6.5 19h9", key: "start-boundary" }],
  ["path", { d: "M8.5 5h9A2.5 2.5 0 0 1 20 7.5V20", key: "end-boundary" }],
  [
    "circle",
    {
      cx: "4",
      cy: "4",
      r: "1.9",
      fill: "currentColor",
      stroke: "none",
      key: "start-handle",
    },
  ],
  [
    "circle",
    {
      cx: "20",
      cy: "20",
      r: "1.9",
      fill: "currentColor",
      stroke: "none",
      key: "end-handle",
    },
  ],
]

export const ContextCompactionIcon = createLucideIcon("ContextCompaction", [
  ...selectionFrame,
  ["path", { d: "M9 9.5h6M9 14h4", key: "text" }],
])

export const ContextCompactedIcon = createLucideIcon("ContextCompacted", [
  ...selectionFrame,
  ["path", { d: "m8.5 12 2.5 2.5 5-5", key: "check" }],
])
