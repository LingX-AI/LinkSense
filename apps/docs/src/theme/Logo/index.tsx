import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import OriginalLogo from "@theme-original/Logo"
import type { Props } from "@theme/Logo"

export default function Logo(props: Props) {
  const { siteConfig } = useDocusaurusContext()
  const homeLink = siteConfig.customFields?.publicDocs
    ? { to: "pathname:///", autoAddBaseUrl: false, target: "_self" }
    : {}
  return <OriginalLogo {...props} {...homeLink} />
}
