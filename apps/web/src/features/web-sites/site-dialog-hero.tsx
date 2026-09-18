import { CheckIcon, GlobeIcon, PencilIcon, UploadIcon } from "lucide-react"
import { MaintenanceNoticeHero } from "@/components/shell/maintenance-notice-hero"

export function SiteDialogHero({
  mode,
}: {
  mode: "share" | "edit" | "publish" | "success"
}) {
  const Icon =
    mode === "success"
      ? CheckIcon
      : mode === "edit"
        ? PencilIcon
        : mode === "publish"
          ? UploadIcon
          : GlobeIcon

  return (
    <div aria-hidden="true" data-slot="site-dialog-hero" className="shrink-0">
      <MaintenanceNoticeHero
        size="compact"
        palette="blue"
        icon={
          <>
            <Icon
              className="absolute inset-0 size-full translate-x-1.5 translate-y-2 text-maintenance-hero-ink/20"
              preserveAspectRatio="xMidYMid meet"
              strokeWidth={2}
            />
            <Icon
              className="relative size-full text-maintenance-hero-ink/85"
              preserveAspectRatio="xMidYMid meet"
              strokeWidth={2}
            />
          </>
        }
      />
    </div>
  )
}
