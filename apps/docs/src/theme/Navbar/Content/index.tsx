import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import { useThemeConfig } from "@docusaurus/theme-common"
import OriginalContent from "@theme-original/Navbar/Content"
import NavbarItem from "@theme/NavbarItem"
import NavbarLogo from "@theme/Navbar/Logo"
import NavbarSearch from "@theme/Navbar/Search"
import MobileToggle from "@theme/Navbar/MobileSidebar/Toggle"
import SearchBar from "@theme/SearchBar"

export default function NavbarContent() {
  const { siteConfig } = useDocusaurusContext()
  const { navbar } = useThemeConfig()
  if (!siteConfig.customFields?.publicDocs) return <OriginalContent />

  return (
    <div className="navbar__inner">
      <NavbarLogo />
      <div className="navbar__items website-header-navigation">
        {navbar.items
          .filter((item) => item.position === "left")
          .map((item) => (
            <NavbarItem key={item.label} {...item} type="default" />
          ))}
      </div>
      <div className="navbar__items navbar__items--right website-header-actions">
        {navbar.items
          .filter((item) => item.position === "right")
          .map((item) => {
            if (item.type === "localeDropdown") {
              return (
                <NavbarItem
                  key={item.type}
                  type="localeDropdown"
                  position="right"
                  items={[]}
                  dropdownItemsBefore={[]}
                  dropdownItemsAfter={[]}
                />
              )
            }
            if (
              item.className === "website-cta" &&
              typeof item.href === "string" &&
              item.label
            ) {
              return (
                <a
                  key={item.label}
                  href={item.href}
                  className="navbar__item navbar__link website-cta pill-fill"
                >
                  <span className="pill-label">
                    <span>{item.label}</span>
                    <span aria-hidden="true">{item.label}</span>
                  </span>
                  <span className="website-cta-arrow" aria-hidden="true" />
                </a>
              )
            }
            return <NavbarItem key={item.label} {...item} type="default" />
          })}
        <NavbarSearch>
          <SearchBar />
        </NavbarSearch>
        <MobileToggle />
      </div>
    </div>
  )
}
