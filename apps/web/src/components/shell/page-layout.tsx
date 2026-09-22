import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function PageLayout({
  title,
  description,
  descriptionAccessory,
  actions,
  beforeHeader,
  afterHeader,
  className,
  contentWidth = "standard",
  children,
}: {
  title: string
  description?: string
  descriptionAccessory?: ReactNode
  actions?: ReactNode
  beforeHeader?: ReactNode
  afterHeader?: ReactNode
  className?: string
  contentWidth?: "standard" | "wide"
  children: ReactNode
}) {
  return (
    <div className="management-scroll">
      <div
        className={cn("management-page", className)}
        data-content-width={contentWidth}
      >
        {beforeHeader && <div className="mb-6">{beforeHeader}</div>}
        <header className="management-header" role="banner">
          <div className="min-w-0">
            <h1 className="text-pretty">{title}</h1>
            {(description || descriptionAccessory) && (
              <div
                className={cn(
                  descriptionAccessory && "management-header-description-row"
                )}
              >
                {description && (
                  <p
                    title={description}
                    className={cn(
                      descriptionAccessory && "management-header-description",
                      "text-pretty"
                    )}
                  >
                    {description}
                  </p>
                )}
                {descriptionAccessory}
              </div>
            )}
          </div>
          {actions && <div className="management-actions">{actions}</div>}
        </header>
        {afterHeader && <div className="mb-6">{afterHeader}</div>}
        {children}
      </div>
    </div>
  )
}
