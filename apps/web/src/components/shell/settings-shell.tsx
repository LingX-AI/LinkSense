import { useEffect, useMemo, useState, type ElementType } from "react"
import {
  ArrowLeftIcon,
  ArchiveIcon,
  BotIcon,
  BookOpenCheckIcon,
  BrainIcon,
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  FileKey2Icon,
  HeartPulseIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  SearchIcon,
  ServerCogIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunMoonIcon,
  UserRoundIcon,
  UserRoundCogIcon,
  UsersRoundIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { NavLink, Outlet, useLocation } from "react-router-dom"

import { useAuth } from "@/app/auth-state"
import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import {
  resolveSettingsReturn,
  type SettingsReturnState,
} from "@/components/shell/settings-return-navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SettingsNavigationItem = {
  to: string
  activePaths?: readonly string[]
  labelKey: string
  descriptionKey: string
  icon: ElementType
}

const personalSettingsItems: SettingsNavigationItem[] = [
  {
    to: "/settings/general",
    labelKey: "settings.general",
    descriptionKey: "settings.generalDescription",
    icon: SlidersHorizontalIcon,
  },
  {
    to: "/settings/profile",
    labelKey: "settings.profile",
    descriptionKey: "settings.profileDescription",
    icon: UserRoundIcon,
  },
  {
    to: "/settings/personalization",
    labelKey: "settings.personalization",
    descriptionKey: "settings.personalizationDescription",
    icon: BrainIcon,
  },
  {
    to: "/settings/appearance",
    labelKey: "settings.appearance",
    descriptionKey: "settings.appearanceDescription",
    icon: SunMoonIcon,
  },
  {
    to: "/settings/security",
    labelKey: "settings.security",
    descriptionKey: "settings.securityDescription",
    icon: ShieldCheckIcon,
  },
  {
    to: "/settings/credentials",
    labelKey: "settings.credentials",
    descriptionKey: "settings.credentialsDescription",
    icon: FileKey2Icon,
  },
  {
    to: "/settings/mcp",
    labelKey: "settings.mcp",
    descriptionKey: "settings.mcpDescription",
    icon: ServerCogIcon,
  },
  {
    to: "/settings/weixin",
    labelKey: "settings.channelAccess",
    descriptionKey: "settings.channelAccessDescription",
    icon: MessagesSquareIcon,
  },
  {
    to: "/archived",
    labelKey: "nav.archived",
    descriptionKey: "settings.archivedDescription",
    icon: ArchiveIcon,
  },
]

const administratorItems: SettingsNavigationItem[] = [
  {
    to: "/admin/users",
    activePaths: ["/admin/groups", "/admin/users"],
    labelKey: "nav.usersAndGroups",
    descriptionKey: "settings.usersAndGroupsDescription",
    icon: UsersRoundIcon,
  },
  {
    to: "/admin/roles",
    labelKey: "nav.roles",
    descriptionKey: "settings.rolesDescription",
    icon: UserRoundCogIcon,
  },
  {
    to: "/admin/capabilities",
    labelKey: "nav.adminCapabilities",
    descriptionKey: "settings.adminCapabilitiesDescription",
    icon: ShieldCheckIcon,
  },
  {
    to: "/admin/knowledge-bases",
    activePaths: ["/admin/knowledge-bases", "/admin/knowledge-sources"],
    labelKey: "nav.adminKnowledgeBases",
    descriptionKey: "settings.adminKnowledgeBasesDescription",
    icon: BookOpenCheckIcon,
  },
  {
    to: "/admin/models",
    labelKey: "settings.modelSettings",
    descriptionKey: "settings.modelSettingsDescription",
    icon: BotIcon,
  },
  {
    to: "/admin/settings",
    labelKey: "settings.systemSettings",
    descriptionKey: "settings.systemSettingsDescription",
    icon: Settings2Icon,
  },
  {
    to: "/admin/health",
    labelKey: "settings.systemHealth",
    descriptionKey: "settings.systemHealthDescription",
    icon: HeartPulseIcon,
  },
  {
    to: "/admin/feedback",
    labelKey: "nav.feedback",
    descriptionKey: "settings.feedbackDescription",
    icon: MessageSquareTextIcon,
  },
  {
    to: "/admin/audit",
    labelKey: "nav.audit",
    descriptionKey: "settings.auditDescription",
    icon: UserRoundCogIcon,
  },
  {
    to: "/admin/usage",
    labelKey: "nav.usage",
    descriptionKey: "settings.usageDescription",
    icon: ChartNoAxesCombinedIcon,
  },
]

export function SettingsShell() {
  const { t } = useTranslation()
  const productName = useProductName()
  const { user } = useAuth()
  const location = useLocation()
  const [search, setSearch] = useState("")
  const [mobileOpen, setMobileOpen] = useState(false)
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const isActiveAdmin = user?.role === "admin" && user.status === "active"
  const isAdministrationPage = location.pathname.startsWith("/admin/")
  const settingsReturnTo = resolveSettingsReturn(location.state)
  const appReturnTo = settingsReturnTo ?? "/conversations/new"
  const settingsNavigationState: SettingsReturnState | undefined =
    settingsReturnTo ? { settingsReturnTo } : undefined

  const filterItems = (items: SettingsNavigationItem[]) =>
    items.filter((item) =>
      `${t(item.labelKey)} ${t(item.descriptionKey)}`
        .toLocaleLowerCase()
        .includes(normalizedSearch)
    )
  const personalItems = useMemo(
    () => filterItems(personalSettingsItems),
    // Translation changes re-render the component through useTranslation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedSearch, t]
  )
  const adminItems = useMemo(
    () => filterItems(administratorItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalizedSearch, t]
  )

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [mobileOpen])

  return (
    <div className="settings-shell">
      <aside
        className="settings-sidebar"
        aria-label={t("settings.navigationLabel", { productName })}
      >
        <div className="settings-mobile-header">
          <NavLink
            to={appReturnTo}
            className="settings-back-link font-semibold"
          >
            <ArrowLeftIcon aria-hidden="true" />
            <ProductLogo
              productName={productName}
              className="settings-brand-logo"
            />
          </NavLink>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-semibold"
            aria-expanded={mobileOpen}
            aria-controls="settings-navigation-body"
            onClick={() => setMobileOpen((value) => !value)}
          >
            {t("settings.navigation")}
            <ChevronDownIcon
              className={cn("transition-transform", mobileOpen && "rotate-180")}
              aria-hidden="true"
            />
          </Button>
        </div>
        <div
          id="settings-navigation-body"
          className="settings-navigation-body"
          data-mobile-open={mobileOpen ? "true" : "false"}
        >
          <NavLink
            to={appReturnTo}
            className="settings-back-link settings-desktop-back-link font-semibold"
          >
            <ArrowLeftIcon aria-hidden="true" />
            <span>{t("settings.backToApp", { productName })}</span>
          </NavLink>
          <div className="settings-search-field">
            <SearchIcon aria-hidden="true" />
            <Input
              aria-label={t("settings.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("settings.search")}
              className="font-medium"
            />
          </div>
          <SettingsNavigationGroup
            title={t("settings.personalGroup")}
            items={personalItems}
            currentPath={location.pathname}
            navigationState={settingsNavigationState}
            onNavigate={() => setMobileOpen(false)}
          />
          {isActiveAdmin && (
            <SettingsNavigationGroup
              title={t("settings.administrationGroup")}
              items={adminItems}
              currentPath={location.pathname}
              navigationState={settingsNavigationState}
              onNavigate={() => setMobileOpen(false)}
            />
          )}
          {personalItems.length === 0 &&
            (!isActiveAdmin || adminItems.length === 0) && (
              <p className="settings-navigation-empty font-medium">
                {t("settings.noResults")}
              </p>
            )}
        </div>
      </aside>
      <main className="settings-main" id="main-content">
        <div
          className={cn(
            "settings-content",
            isAdministrationPage && "settings-content-administration"
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function SettingsNavigationGroup({
  title,
  items,
  currentPath,
  navigationState,
  onNavigate,
}: {
  title: string
  items: SettingsNavigationItem[]
  currentPath: string
  navigationState?: SettingsReturnState
  onNavigate: () => void
}) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <section className="settings-navigation-group">
      <h2 className="font-semibold">{title}</h2>
      <nav aria-label={title}>
        {items.map(({ to, activePaths, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            state={navigationState}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "settings-navigation-link font-medium",
                (isActive || activePaths?.includes(currentPath)) &&
                  "settings-navigation-link-active"
              )
            }
          >
            <Icon aria-hidden="true" />
            <span className="min-w-0 truncate">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </section>
  )
}
