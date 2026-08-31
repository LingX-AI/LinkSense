import { useEffect, useState } from "react"
import { MenuIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useProductName } from "@/app/product-branding"
import { Composer } from "@/components/prototype/composer"
import { ConversationThread } from "@/components/prototype/conversation-thread"
import { SearchDialog } from "@/components/prototype/search-dialog"
import { Sidebar, SidebarContent } from "@/components/prototype/sidebar"
import { TopBar } from "@/components/prototype/top-bar"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

export function ConversationPrototype() {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const [isRunning, setIsRunning] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "zh-CN"
  }, [i18n.resolvedLanguage])

  const sidebarProps = {
    onOpenSearch: () => setSearchOpen(true),
  }

  const mobileNavigation = (
    <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
      <SheetTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="top-bar-action border-0 bg-transparent shadow-none md:hidden"
            aria-label={t("mobile.openNavigation")}
          />
        }
      >
        <MenuIcon aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="left"
        closeLabel={t("common.close")}
        closeButtonClassName="mobile-navigation-close"
        className="mobile-navigation-sheet w-[min(88vw,296px)] border-0 bg-[var(--app-sidebar)] p-0 ring-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{productName}</SheetTitle>
          <SheetDescription>{t("nav.conversations")}</SheetDescription>
        </SheetHeader>
        <SidebarContent
          {...sidebarProps}
          onNavigate={() => setMobileNavigationOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )

  return (
    <div className="prototype-shell" data-testid="prototype-shell">
      <Sidebar {...sidebarProps} />
      <main className="app-main">
        <TopBar mobileNavigation={mobileNavigation} />
        <ConversationThread isRunning={isRunning} />
        <div className="composer-dock">
          <Composer
            isRunning={isRunning}
            onStop={() => setIsRunning(false)}
            onStart={() => setIsRunning(true)}
          />
        </div>
      </main>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}
