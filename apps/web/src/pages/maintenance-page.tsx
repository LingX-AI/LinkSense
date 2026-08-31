import { Clock3Icon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import type { MaintenanceStatus } from "@/api/contracts"
import { useAuth } from "@/app/auth-state"
import { enableMaintenanceAdminEntry } from "@/app/maintenance-admin-entry"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { Button } from "@/components/ui/button"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

export function MaintenancePage({
  maintenance,
}: {
  maintenance: MaintenanceStatus
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { signOut, status } = useAuth()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [openingAdminEntry, setOpeningAdminEntry] = useState(false)

  const openAdminEntry = async () => {
    setOpeningAdminEntry(true)
    enableMaintenanceAdminEntry()
    try {
      if (status === "authenticated") await signOut()
    } finally {
      navigate("/login", { state: { from: "/conversations/new" } })
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-canvas)] px-5 py-10">
      <section className="w-full max-w-lg px-2 py-8 text-center sm:px-8">
        <ProductLogo
          productName={productName}
          className="maintenance-brand-logo"
        />
        <h1 className="mt-5 text-[length:var(--app-font-16)] leading-[var(--app-line-24)] font-semibold">
          {t("maintenance.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
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
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="fixed right-4 bottom-4 h-7 border border-[color:var(--app-divider)] bg-[var(--app-canvas)] px-3 text-xs text-muted-foreground hover:bg-[var(--app-hover)] hover:text-foreground"
        disabled={openingAdminEntry}
        onClick={() => void openAdminEntry()}
      >
        {t("maintenance.adminEntry")}
      </Button>
    </main>
  )
}
