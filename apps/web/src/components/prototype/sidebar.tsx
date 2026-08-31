import {
  ArchiveIcon,
  BlocksIcon,
  ChevronDownIcon,
  MessageSquarePlusIcon,
  MessagesSquareIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import i18n, { type SupportedLanguage } from "@/i18n"
import { recentConversations } from "@/data/mock-data"

type SidebarContentProps = {
  onOpenSearch: () => void
  onNavigate?: () => void
}

type NavigationKey =
  "newConversation" | "search" | "conversations" | "archived" | "capabilities"

type NavigationItem = {
  key: NavigationKey
  icon: typeof SearchIcon
  action?: () => void
}

export function SidebarContent({
  onOpenSearch,
  onNavigate,
}: SidebarContentProps) {
  const { t } = useTranslation()
  const productName = useProductName()

  const navItems: NavigationItem[] = [
    { key: "newConversation", icon: MessageSquarePlusIcon },
    { key: "search", icon: SearchIcon, action: onOpenSearch },
    { key: "conversations", icon: MessagesSquareIcon },
    { key: "archived", icon: ArchiveIcon },
    { key: "capabilities", icon: BlocksIcon },
  ]

  const changeLanguage = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language)
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-3 py-3">
      <div className="flex h-11 items-center px-2">
        <ProductLogo
          productName={productName}
          className="sidebar-brand-logo min-w-0"
        />
      </div>

      <nav aria-label={t("nav.conversations")} className="mt-2 space-y-0.5">
        {navItems.map(({ key, icon: Icon, action }) => (
          <Button
            key={key}
            type="button"
            variant="ghost"
            className="sidebar-nav-item h-8 w-full justify-start gap-2 border-0 px-2.5 text-[length:var(--app-font-13)] font-medium shadow-none"
            onClick={() => {
              action?.()
              onNavigate?.()
            }}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span>{t(`nav.${key}`)}</span>
          </Button>
        ))}
      </nav>

      <section
        aria-labelledby="recent-conversations-title"
        className="mt-5 min-h-0 flex-1"
      >
        <h2
          id="recent-conversations-title"
          className="px-2.5 pb-2 text-[length:var(--app-font-11)] font-semibold text-[var(--app-muted)]"
        >
          {t("nav.recent")}
        </h2>
        <div className="space-y-0.5 overflow-y-auto pr-0.5">
          {recentConversations.map((conversation, index) => (
            <Button
              key={conversation.id}
              type="button"
              variant="ghost"
              className="sidebar-conversation-item h-9 w-full justify-start rounded-lg border-0 px-2.5 py-0 text-left shadow-none"
              data-active={index === 0 || undefined}
              aria-current={index === 0 ? "page" : undefined}
              onClick={onNavigate}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[length:var(--app-font-12-5)] font-semibold text-[var(--app-text)]">
                  {t(conversation.titleKey)}
                </span>
                <time className="shrink-0 text-[length:var(--app-font-10-5)] font-medium text-[var(--app-muted)]">
                  {t(conversation.dateKey)}
                </time>
              </span>
            </Button>
          ))}
        </div>
      </section>

      <div className="mt-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                className="sidebar-user-button h-auto w-full justify-start gap-2 border-0 px-2 py-2 text-left shadow-none"
              />
            }
          >
            <Avatar className="size-7 border-0 bg-[var(--app-avatar)]">
              <AvatarFallback className="bg-transparent text-[length:var(--app-font-11)] font-semibold text-[var(--app-avatar-foreground)]">
                林
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-[var(--app-text)]">
                {t("user.name")}
              </span>
              <span className="block truncate text-[length:var(--app-font-10)] font-medium text-[var(--app-muted)]">
                {t("user.role")}
              </span>
            </span>
            <ChevronDownIcon
              className="size-3 text-[var(--app-muted)]"
              aria-hidden="true"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="w-52 border-0 bg-[var(--app-popover)] text-[var(--app-text)] ring-0"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t("common.language")}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => changeLanguage("zh-CN")}>
                {t("common.chinese")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeLanguage("en-US")}>
                {t("common.english")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuItem>
              <Settings2Icon aria-hidden="true" />
              {t("common.settings")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function Sidebar(props: SidebarContentProps) {
  const { t } = useTranslation()
  const productName = useProductName()

  return (
    <aside
      className="app-sidebar hidden min-h-0 md:block"
      aria-label={t("nav.navigationLabel", { productName })}
    >
      <SidebarContent {...props} />
    </aside>
  )
}
