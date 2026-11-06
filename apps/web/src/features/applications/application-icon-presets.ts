import {
  applicationIconPresets,
  type ApplicationIconPreset,
} from "@linksense/shared"
import defaultIcon from "@/assets/applications/default.svg"
import reportIcon from "@/assets/applications/report.svg"
import researchIcon from "@/assets/applications/research.svg"
import knowledgeIcon from "@/assets/applications/knowledge.svg"
import writingIcon from "@/assets/applications/writing.svg"
import educationIcon from "@/assets/applications/education.svg"
import analyticsIcon from "@/assets/applications/analytics.svg"
import codeIcon from "@/assets/applications/code.svg"
import creativeIcon from "@/assets/applications/creative.svg"
import workflowIcon from "@/assets/applications/workflow.svg"
import {
  AnalyticsSceneIcon,
  BotSceneIcon,
  BusinessSceneIcon,
  CalendarSceneIcon,
  CodeSceneIcon,
  CreativeSceneIcon,
  DocumentSceneIcon,
  EducationSceneIcon,
  FinanceSceneIcon,
  GlobeSceneIcon,
  HealthSceneIcon,
  IdeaSceneIcon,
  KnowledgeSceneIcon,
  LegalSceneIcon,
  SearchSceneIcon,
  SecuritySceneIcon,
  SupportSceneIcon,
  TeamSceneIcon,
  WorkflowSceneIcon,
  WritingSceneIcon,
  type ApplicationIllustratedIcon,
} from "@/features/applications/application-illustrated-icons"

type ApplicationIconPresetDefinition = {
  icon: ApplicationIllustratedIcon
}

// Figma 1:86829 / 1:86113. Keep the persisted preset keys and legacy artwork
// so existing applications remain readable without changing stored data.
export const applicationIconArtwork: Partial<
  Record<ApplicationIconPreset, string>
> = {
  bot: defaultIcon,
  "file-text": reportIcon,
  search: researchIcon,
  "book-open": knowledgeIcon,
  "pen-line": writingIcon,
  "graduation-cap": educationIcon,
  "chart-column": analyticsIcon,
  "code-xml": codeIcon,
  sparkles: creativeIcon,
  workflow: workflowIcon,
}

export const applicationDesignIconPresets: ApplicationIconPreset[] = [
  "bot",
  "file-text",
  "search",
  "book-open",
  "pen-line",
  "graduation-cap",
  "chart-column",
  "code-xml",
  "sparkles",
  "workflow",
]

export const applicationIconPresetDefinitions: Record<
  ApplicationIconPreset,
  ApplicationIconPresetDefinition
> = {
  bot: {
    icon: BotSceneIcon,
  },
  search: {
    icon: SearchSceneIcon,
  },
  "book-open": {
    icon: KnowledgeSceneIcon,
  },
  "graduation-cap": {
    icon: EducationSceneIcon,
  },
  "briefcase-business": {
    icon: BusinessSceneIcon,
  },
  "chart-column": {
    icon: AnalyticsSceneIcon,
  },
  "code-xml": {
    icon: CodeSceneIcon,
  },
  "pen-line": {
    icon: WritingSceneIcon,
  },
  sparkles: {
    icon: CreativeSceneIcon,
  },
  lightbulb: {
    icon: IdeaSceneIcon,
  },
  headset: {
    icon: SupportSceneIcon,
  },
  "file-text": {
    icon: DocumentSceneIcon,
  },
  landmark: {
    icon: FinanceSceneIcon,
  },
  scale: {
    icon: LegalSceneIcon,
  },
  "heart-pulse": {
    icon: HealthSceneIcon,
  },
  "shield-check": {
    icon: SecuritySceneIcon,
  },
  workflow: {
    icon: WorkflowSceneIcon,
  },
  "calendar-clock": {
    icon: CalendarSceneIcon,
  },
  users: {
    icon: TeamSceneIcon,
  },
  "globe-2": {
    icon: GlobeSceneIcon,
  },
}

export const applicationIconPresetOptions = applicationIconPresets.map(
  (value) => ({ value, ...applicationIconPresetDefinitions[value] })
)
