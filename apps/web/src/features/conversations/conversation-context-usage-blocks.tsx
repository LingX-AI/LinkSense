import { cn } from "@/lib/utils"
import type { ConversationContextRow } from "@/features/conversations/conversation-context-usage"

export type ConversationContextDisplayRow = ConversationContextRow &
  Readonly<{ label: string }>

export function ConversationContextUsageBar({
  rows,
  usedTokens,
  totalTokens,
  label,
}: {
  rows: readonly ConversationContextDisplayRow[]
  usedTokens: number
  totalTokens: number
  label: string
}) {
  const segments =
    rows.length > 0
      ? rows.filter((row) => row.colorClass !== null && row.tokens > 0)
      : [
          {
            key: "used" as const,
            tokens: usedTokens,
            colorClass: "bg-[var(--chart-1)]",
          },
        ]
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          className={cn("h-full", segment.colorClass)}
          style={{ width: `${(segment.tokens / totalTokens) * 100}%` }}
        />
      ))}
    </div>
  )
}

export function ConversationContextBreakdownRows({
  rows,
  totalTokens,
  formatTokens,
}: {
  rows: readonly ConversationContextDisplayRow[]
  totalTokens: number
  formatTokens: (tokens: number) => string
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <span
              className={cn(
                "size-2 shrink-0 rounded-[2px]",
                row.colorClass ?? "bg-muted-foreground/30"
              )}
            />
            <span className="truncate">{row.label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3 text-muted-foreground tabular-nums">
            <span>{formatTokens(row.tokens)}</span>
            <span className="w-10 text-right">
              {row.showPercent
                ? `${Math.round((row.tokens / totalTokens) * 100)}%`
                : "—"}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
