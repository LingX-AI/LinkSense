import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import { useWindowSize } from "@docusaurus/theme-common"
import OriginalSearch from "@theme-original/Navbar/Search"
import type { Props } from "@theme/Navbar/Search"

export default function NavbarSearch(props: Props) {
  const { siteConfig } = useDocusaurusContext()
  const size = useWindowSize()
  if (siteConfig.customFields?.publicDocs && size !== "mobile") return null
  return <OriginalSearch {...props} />
}
