import type { ComponentProps, ReactNode } from "react"
import { TitleFormatterProvider } from "@docusaurus/theme-common/internal"
import useDocusaurusContext from "@docusaurus/useDocusaurusContext"
import type { Props } from "@theme/ThemeProvider/TitleFormatter"

type Formatter = ComponentProps<typeof TitleFormatterProvider>["formatter"]

const siteTitles = {
  "zh-CN": "LinkSense 帮助中心",
  "en-US": "LinkSense Help Center",
} as const

export default function ThemeProviderTitleFormatter({
  children,
}: Props): ReactNode {
  const {
    i18n: { currentLocale },
  } = useDocusaurusContext()
  const localizedSiteTitle =
    siteTitles[currentLocale as keyof typeof siteTitles] ?? siteTitles["zh-CN"]

  const formatter: Formatter = ({ title, titleDelimiter }) => {
    const trimmedTitle = title?.trim()
    if (!trimmedTitle || trimmedTitle === localizedSiteTitle) {
      return localizedSiteTitle
    }
    return `${trimmedTitle} ${titleDelimiter} ${localizedSiteTitle}`
  }

  return (
    <TitleFormatterProvider formatter={formatter}>
      {children}
    </TitleFormatterProvider>
  )
}
