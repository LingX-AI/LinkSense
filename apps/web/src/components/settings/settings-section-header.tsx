import type { ReactNode } from "react"

export function SettingsSectionHeader({
  id,
  title,
  description,
  descriptionId,
  status,
  action,
}: {
  id: string
  title: string
  description?: string
  descriptionId?: string
  status?: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      data-slot="settings-section-header"
      className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 space-y-1">
        <div
          data-slot="settings-section-title-row"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
        >
          <h2
            id={id}
            className="text-sm leading-5 font-semibold text-pretty text-foreground"
          >
            {title}
          </h2>
          {status ? (
            <div
              data-slot="settings-section-status"
              className="flex shrink-0 items-center"
            >
              {status}
            </div>
          ) : null}
        </div>
        {description ? (
          <p id={descriptionId} className="form-hint max-w-3xl text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center pt-0.5">{action}</div>
      ) : null}
    </div>
  )
}
