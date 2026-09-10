import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SettingsSectionHeader({
  id,
  title,
  description,
  descriptionId,
  status,
  action,
  titleAction,
  actionAlignment = "start",
}: {
  id: string
  title: string
  description?: string
  descriptionId?: string
  status?: ReactNode
  action?: ReactNode
  titleAction?: ReactNode
  actionAlignment?: "start" | "center"
}) {
  return (
    <div
      data-slot="settings-section-header"
      className={cn(
        "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        actionAlignment === "center" &&
          "flex-row items-center justify-between sm:items-center"
      )}
    >
      <div className={cn("min-w-0 space-y-1", titleAction && "flex-1")}>
        <div
          data-slot="settings-section-title-row"
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1",
            titleAction && "flex-nowrap"
          )}
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
          {titleAction ? (
            <div
              data-slot="settings-section-title-action"
              className="ml-auto flex shrink-0 items-center"
            >
              {titleAction}
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
        <div
          data-slot="settings-section-action"
          className={cn(
            "flex shrink-0 items-center",
            actionAlignment === "center" ? "pt-0" : "pt-0.5"
          )}
        >
          {action}
        </div>
      ) : null}
    </div>
  )
}
