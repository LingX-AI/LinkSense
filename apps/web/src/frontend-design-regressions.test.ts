import adminKnowledgeSource from "@/pages/admin-knowledge-base-page.tsx?raw"
import adminUsageSource from "@/pages/admin-usage-page.tsx?raw"
import alertDialogSource from "@/components/ui/alert-dialog.tsx?raw"
import applicationCatalogSource from "@/features/applications/application-catalog-panel.tsx?raw"
import applicationExternalAccessSource from "@/features/applications/application-external-access-page.tsx?raw"
import authSource from "@/pages/auth-pages.tsx?raw"
import automationSource from "@/pages/automation-pages.tsx?raw"
import dialogSource from "@/components/ui/dialog.tsx?raw"
import initializeSource from "@/pages/initialize-page.tsx?raw"
import knowledgeBaseSource from "@/pages/knowledge-base-pages.tsx?raw"
import productLogoSource from "@/components/brand/product-logo.tsx?raw"
import sheetSource from "@/components/ui/sheet.tsx?raw"
import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"

describe("frontend design regressions", () => {
  it("contains scroll chaining in every modal surface", () => {
    expect(dialogSource).toContain("overscroll-contain")
    expect(alertDialogSource).toContain("overscroll-contain")
    expect(sheetSource).toContain("overscroll-contain")
  })

  it("uses links for navigation to known destinations", () => {
    expect(applicationExternalAccessSource).toContain(
      "<Link\n          to={applicationCenterReturnTo}"
    )
    expect(knowledgeBaseSource).toContain(
      '<Link\n          to="/knowledge-bases"'
    )
  })

  it("keeps list and analytics view state in URL parameters", () => {
    expect(adminKnowledgeSource).toContain('searchParams.get("cursor")')
    expect(adminUsageSource).toContain('searchParams.get("user_search")')
    expect(adminUsageSource).toContain('"tab",')
    expect(automationSource).toContain('"status",')
    expect(knowledgeBaseSource).toContain('"kb_lifecycle",')
    expect(applicationCatalogSource).toContain('"app_scope",')
  })

  it("provides stable authentication field names and email input hints", () => {
    expect(authSource).toContain('name="email"')
    expect(authSource).toContain('name="password"')
    expect(authSource).toContain("spellCheck={false}")
    expect(initializeSource).toContain('name="new-password-confirmation"')
    expect(initializeSource).toContain("spellCheck={false}")
  })

  it("reserves product logo space and prioritizes its loading", () => {
    expect(productLogoSource).toContain('width="348"')
    expect(productLogoSource).toContain('height="94"')
    expect(productLogoSource).toContain('fetchPriority="high"')
  })

  it("matches the documented shell dimensions and semantic theme tokens", () => {
    expect(appStyles).toContain("--app-sidebar-width: 248px")
    expect(appStyles).toContain("--conversation-top-bar-height: 54px")
    expect(appStyles).toMatch(
      /:root\s*\{[\s\S]*?--sidebar:\s*#f5f5f5;[\s\S]*?--app-sidebar:\s*#f5f5f5;/u
    )
    expect(appStyles).toMatch(
      /\.dark\s*\{[\s\S]*?--app-canvas:\s*#000000;[\s\S]*?--app-sidebar:\s*#202020;/u
    )
  })

  it("uses a real ellipsis in progress copy", () => {
    expect(JSON.stringify(enUS)).not.toContain("...")
    expect(JSON.stringify(zhCN)).not.toContain("...")
    expect(enUS.automation.runNowLoading).toBe("Running automation…")
    expect(zhCN.conversation.inlineHtmlPreview.generating).toBe(
      "正在生成交互组件…"
    )
  })
})
