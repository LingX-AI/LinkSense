import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type AdminKnowledgeTab = "knowledgeBases" | "sources"

const adminKnowledgeTabPaths: Record<AdminKnowledgeTab, string> = {
  knowledgeBases: "/admin/knowledge-bases",
  sources: "/admin/knowledge-sources",
}

export function AdminKnowledgeTabs({
  value,
  children,
}: {
  value: AdminKnowledgeTab
  children: ReactNode
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => {
        if (!isAdminKnowledgeTab(nextValue) || nextValue === value) return
        navigate(adminKnowledgeTabPaths[nextValue])
      }}
    >
      <TabsList
        aria-label={t("adminKnowledge.tabsLabel")}
        className="max-w-full justify-start overflow-x-auto"
      >
        <TabsTrigger value="knowledgeBases">
          {t("adminKnowledge.tabs.knowledgeBases")}
        </TabsTrigger>
        <TabsTrigger value="sources">
          {t("adminKnowledge.tabs.sources")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value={value}>{children}</TabsContent>
    </Tabs>
  )
}

function isAdminKnowledgeTab(value: string): value is AdminKnowledgeTab {
  return value === "knowledgeBases" || value === "sources"
}
