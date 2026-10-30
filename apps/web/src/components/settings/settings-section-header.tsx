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
      className="@container/settings-section w-full min-w-0"
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-3 @2xl/settings-section:flex-row @2xl/settings-section:items-start @2xl/settings-section:justify-between",
          actionAlignment === "center" && "@2xl/settings-section:items-center"
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
              "flex w-full min-w-0 shrink-0 items-center @2xl/settings-section:w-auto",
              actionAlignment === "center" ? "pt-0" : "pt-0.5"
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
    </div>
  )
}
