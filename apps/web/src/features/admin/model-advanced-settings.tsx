import { useId, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ModelAdvancedSettings({
  children,
  defaultOpen = false,
}: {
  children: ReactNode
  defaultOpen?: boolean
}) {
  const { t } = useTranslation()
  const contentId = useId()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={contentId}
        className="h-7 w-fit gap-1.5 px-1.5 text-sm font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        {t("modelSetup.advanced")}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180"
          )}
        />
      </Button>
      {open && (
        <div id={contentId} className="flex min-w-0 flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            {t("modelSetup.advancedHint")}
          </p>
          {children}
        </div>
      )}
    </section>
  )
}
