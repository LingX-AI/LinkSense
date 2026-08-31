export type RecentConversation = {
  id: string
  titleKey: string
  dateKey: string
}

export type Capability = {
  id: string
  nameKey: string
  descriptionKey: string
  kind: "plugin" | "skill"
}

export const recentConversations: RecentConversation[] = [
  {
    id: "risk-review",
    titleKey: "recent.riskReview",
    dateKey: "recent.now",
  },
  {
    id: "project-meeting",
    titleKey: "recent.projectMeeting",
    dateKey: "recent.yesterday",
  },
  {
    id: "proposal-comparison",
    titleKey: "recent.proposalComparison",
    dateKey: "recent.friday",
  },
]

export const capabilities: Capability[] = [
  {
    id: "microsoft-365",
    nameKey: "capabilities.microsoft365.name",
    descriptionKey: "capabilities.microsoft365.description",
    kind: "plugin",
  },
  {
    id: "shared-calendar",
    nameKey: "capabilities.sharedCalendar.name",
    descriptionKey: "capabilities.sharedCalendar.description",
    kind: "plugin",
  },
  {
    id: "document-analysis",
    nameKey: "capabilities.documentAnalysis.name",
    descriptionKey: "capabilities.documentAnalysis.description",
    kind: "skill",
  },
  {
    id: "report-writing",
    nameKey: "capabilities.reportWriting.name",
    descriptionKey: "capabilities.reportWriting.description",
    kind: "skill",
  },
]
