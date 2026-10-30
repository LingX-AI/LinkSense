import { useId, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { useProductName } from "@/app/product-branding"
import accountAccessArt from "@/assets/brand/account-access-art.png"
import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import { ProductLogo } from "@/components/brand/product-logo"
import { LanguageSwitcher } from "@/features/onboarding/language-switcher"

export function AccountAccessLayout({
  children,
  showPoweredBy = true,
}: {
  children: ReactNode
  showPoweredBy?: boolean
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  const brandHeadingId = useId()
  return (
    <div
      data-slot="account-access-layout"
      className="account-access-theme grid h-dvh gap-6 overflow-y-auto bg-background p-4 font-interface text-foreground lg:grid-cols-[minmax(0,5fr)_minmax(0,6.4fr)] lg:p-6"
    >
      <aside
        aria-labelledby={brandHeadingId}
        className="relative hidden min-h-144 overflow-hidden rounded-2xl bg-card p-account-brand py-11 lg:sticky lg:top-0 lg:flex lg:h-[calc(100dvh-3rem)] lg:flex-col"
      >
        <img
          src={accountAccessArt}
          alt=""
          width="1145"
          height="1374"
          fetchPriority="high"
          className="pointer-events-none absolute top-[-10.82%] left-[-20.49%] h-[118.52%] w-[140.25%] max-w-none object-cover dark:brightness-20"
        />
        <div className="relative flex min-w-0 flex-col items-start gap-10">
          <div className="w-36">
            <ProductLogo productName={productName} />
          </div>
          <div className="grid gap-4">
            <h2
              id={brandHeadingId}
              className="text-account-brand-title font-semibold tracking-tight whitespace-pre-line"
            >
              {t("accountAccess.brandHeadline")}
            </h2>
            <p className="text-sm leading-[var(--app-line-22)] text-muted-foreground">
              {t("accountAccess.brandDescription")}
            </p>
          </div>
        </div>
        <p className="relative mt-auto pt-8 text-xs text-muted-foreground">
          {t("accountAccess.brandProducts")}
        </p>
      </aside>
      <div className="flex min-h-[calc(100dvh-2rem)] min-w-0 flex-col lg:min-h-[calc(100dvh-3rem)]">
        <div className="flex min-h-12 shrink-0 justify-end">
          <LanguageSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-2 py-8 sm:px-8">
          <main className="grid w-full max-w-account-form min-w-0 gap-6">
            <div className="w-36 lg:hidden">
              <ProductLogo productName={productName} />
            </div>
            {children}
          </main>
        </div>
        <div className="flex shrink-0 justify-center">
          {showPoweredBy && <PoweredByLinkSense placement="page" />}
        </div>
      </div>
    </div>
  )
}

export function AccountAccessHeading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <header className="grid gap-3 pb-2">
      <h1 className="text-account-title font-semibold tracking-tight wrap-break-word">
        {title}
      </h1>
      <p className="text-sm leading-[var(--app-line-22)] text-muted-foreground">
        {description}
      </p>
    </header>
  )
}
