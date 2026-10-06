import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { FieldLegend, FieldSet } from "@/components/ui/field"

export function ModelAdvancedSettings({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <FieldSet className="min-w-0 gap-4">
      <FieldLegend className="text-sm font-medium">
        {t("modelSetup.advanced")}
      </FieldLegend>
      <p className="text-xs text-muted-foreground">
        {t("modelSetup.advancedHint")}
      </p>
      {children}
    </FieldSet>
  )
}
