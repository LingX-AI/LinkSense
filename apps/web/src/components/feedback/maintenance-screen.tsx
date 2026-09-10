import { Clock3Icon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import type { MaintenanceStatus } from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

export function MaintenanceScreen({
  maintenance,
  children,
}: {
  maintenance: MaintenanceStatus
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  return (
    <main className="flex h-svh flex-col overflow-y-auto bg-[var(--app-canvas)] px-5 py-10">
      <section className="my-auto w-full max-w-lg shrink-0 self-center px-2 py-8 text-center sm:px-8">
        <ProductLogo
          productName={productName}
          className="maintenance-brand-logo"
        />
        <h1 className="mt-5 text-[length:var(--app-font-16)] leading-[var(--app-line-24)] font-semibold">
          {t("maintenance.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 wrap-anywhere text-muted-foreground">
          {maintenance.reason ?? t("maintenance.defaultReason")}
        </p>
        <div className="mt-6 flex items-start gap-3 border-y border-[color:var(--app-divider)] py-4 text-left">
          <Clock3Icon
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 text-sm leading-6">
            <p className="font-medium">{t("maintenance.windowLabel")}</p>
            <p className="mt-1 text-muted-foreground">
              {t("maintenance.windowValue", {
                start: formatDateTime(maintenance.start_at, language),
                end: formatDateTime(maintenance.end_at, language),
              })}
            </p>
          </div>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          {t("maintenance.description")}
        </p>
      </section>
      {children}
    </main>
  )
}
