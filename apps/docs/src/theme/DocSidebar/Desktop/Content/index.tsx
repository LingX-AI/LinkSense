import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import OriginalContent from "@theme-original/DocSidebar/Desktop/Content"
import SearchBar from "@theme/SearchBar"
import type { Props } from "@theme/DocSidebar/Desktop/Content"

export default function SidebarContent(props: Props) {
  const { siteConfig } = useDocusaurusContext()
  return (
    <>
      {siteConfig.customFields?.publicDocs && (
        <div className="website-doc-search">
          <SearchBar />
        </div>
      )}
      <OriginalContent {...props} />
    </>
  )
}
