// @vitest-environment node

import appShellSource from "@/components/shell/app-shell.tsx?raw"
import applicationCatalogSource from "@/features/applications/application-catalog-panel.tsx?raw"
import automationPagesSource from "@/pages/automation-pages.tsx?raw"
import { describe, expect, it } from "vitest"

describe("navigation menu links", () => {
  it("renders internal menu destinations as links with native href semantics", () => {
    expect(appShellSource).toContain("<NavLink")
    expect(appShellSource).toContain('to="/settings/general"')
    expect(automationPagesSource).toContain(
      "to={`/conversations/${automation.conversation.id}`}"
    )
    expect(applicationCatalogSource).toContain(
      "to={`/capabilities/applications/${application.id}/external-access`}"
    )
  })
})
