import {
  applicationIconPresets,
  type ApplicationIconPreset,
} from "@linksense/shared"
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
