import { WrenchIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// Decorative character fields echo the reference's texture, without displaying
// application data or adding content to the dialog's accessible description.
const characterTexture = [
  "[]<>/:: +++ ::: .. []<>/:: +++ ::: .. []<>/:: +++ ::: ..",
  "++[]:: // <> .. :: ++[]:: // <> .. :: ++[]:: // <> .. ::",
  ":: /<> [] +++ .. / :: /<> [] +++ .. / :: /<> [] +++ .. /",
  "<> ... ++ [] :: // <> ... ++ [] :: // <> ... ++ [] :: //",
]
  .join("\n")
  .repeat(7)

const dotTexture = [
  ". ' : . ' : . ' : . ' : . ' : . ' : . ' : . ' : . ' :",
  " : . ' : . ' : . ' : . ' : . ' : . ' : . ' : . ' : . '",
]
  .join("\n")
  .repeat(14)

const palettes = {
  default: {
    base: "bg-maintenance-hero-base",
    topLeft: "from-maintenance-hero-cyan via-maintenance-hero-cyan/40",
    topRight: "from-maintenance-hero-peach via-maintenance-hero-peach/65",
    bottom: "from-maintenance-hero-base/75 via-maintenance-hero-base/10",
  },
  blue: {
    base: "bg-blue-300",
    topLeft: "from-sky-400 via-sky-400/40",
    topRight: "from-blue-100 via-blue-100/65",
    bottom: "from-blue-300/65 via-blue-300/5",
  },
} as const

export function MaintenanceNoticeHero({
  icon,
  size = "default",
  palette = "default",
}: {
  icon?: ReactNode
  size?: "default" | "compact"
  palette?: keyof typeof palettes
}) {
  const colors = palettes[palette]
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative isolate flex w-full shrink-0 items-center justify-center overflow-hidden text-maintenance-hero-ink select-none",
        colors.base,
        size === "compact" ? "h-28 sm:h-32" : "aspect-[3/1] min-h-36"
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-radial-[at_0%_0%] via-30% to-transparent to-70%",
          colors.topLeft
        )}
      />
      <div
        className={cn(
          "absolute inset-0 bg-radial-[at_100%_0%] via-15% to-transparent to-60%",
          colors.topRight
        )}
      />
      <pre
        className={cn(
          "absolute -top-8 -left-8 origin-top-left -rotate-8 mask-linear-140 mask-linear-from-black mask-linear-to-transparent mask-linear-to-75% font-mono tracking-wider whitespace-pre",
          palette === "blue"
            ? "text-[10px] leading-3.5 font-medium opacity-50 sm:text-[11px]"
            : "text-[9px] leading-3 opacity-20 sm:text-[10px]"
        )}
      >
        {characterTexture}
      </pre>
      <pre
        className={cn(
          "absolute -top-10 -right-8 origin-top-right rotate-12 mask-linear-220 mask-linear-from-black mask-linear-to-transparent mask-linear-to-90% font-mono text-[10px] leading-3 tracking-[0.3em] whitespace-pre",
          palette === "blue" ? "font-medium opacity-55" : "opacity-30"
        )}
      >
        {dotTexture}
      </pre>
      <div
        className={cn(
          "absolute inset-0 bg-linear-to-t to-transparent",
          colors.bottom
        )}
      />
      <div className="absolute h-48 w-64 rounded-full bg-radial from-maintenance-hero-ink/20 to-transparent to-70%" />
      <div
        className={cn(
          "relative aspect-square shrink-0",
          size === "compact" ? "size-16 sm:size-20" : "size-20 sm:size-24"
        )}
      >
        {icon ?? (
          <>
            <WrenchIcon
              className="absolute inset-0 size-full translate-x-1.5 translate-y-2 fill-maintenance-hero-ink/20 text-transparent"
              preserveAspectRatio="xMidYMid meet"
              strokeWidth={0}
            />
            <WrenchIcon
              className="relative size-full fill-maintenance-hero-ink/20 text-maintenance-hero-ink/85"
              preserveAspectRatio="xMidYMid meet"
              strokeWidth={0.65}
            />
          </>
        )}
      </div>
    </div>
  )
}
