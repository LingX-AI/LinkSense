import {
  ChartNoAxesColumnIncreasingIcon,
  FileTextIcon,
  PencilIcon,
  SearchIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import welcomeBackground from "@/assets/home/welcome-background.svg?raw"
import { Button } from "@/components/ui/button"

import { WelcomeOrb } from "./welcome-orb"

const starterQuestions = [
  {
    id: "analyzeFile",
    icon: FileTextIcon,
    tone: "file",
    colors: "bg-task-file-soft text-task-file",
  },
  {
    id: "searchKnowledge",
    icon: SearchIcon,
    tone: "knowledge",
    colors: "bg-task-knowledge-soft text-task-knowledge",
  },
  {
    id: "analyzeData",
    icon: ChartNoAxesColumnIncreasingIcon,
    tone: "data",
    colors: "bg-task-data-soft text-task-data",
  },
  {
    id: "createDeliverable",
    icon: PencilIcon,
    tone: "deliverable",
    colors: "bg-task-deliverable-soft text-task-deliverable",
  },
] as const

export function NewTaskWelcome({
  productName,
  userName,
  guide,
  notice,
  onSelect,
}: Readonly<{
  productName: string
  userName?: string
  guide?: ReactNode
  notice?: ReactNode
  onSelect?: (prompt: string) => void
}>) {
  const { t } = useTranslation()

  return (
    <section
      className="conversation-welcome @container/task-home grid w-full gap-4 font-interface @min-[44rem]/conversation-workspace:gap-6 @min-[60rem]/conversation-workspace:gap-10"
      aria-labelledby="new-task-welcome-title"
    >
      <div className="conversation-welcome-banner relative isolate flex min-h-36 items-center justify-between gap-4 overflow-clip rounded-2xl bg-card px-4 py-4 @min-[44rem]/task-home:min-h-40 @min-[44rem]/task-home:px-6 @min-[44rem]/task-home:py-5 @min-[60rem]/task-home:min-h-48 @min-[60rem]/task-home:px-8 @min-[60rem]/task-home:py-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 dark:hidden [&>svg]:h-full [&>svg]:w-full"
          // Trusted, bundled artwork; never insert user-provided SVG here.
          dangerouslySetInnerHTML={{ __html: welcomeBackground }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-white/50 dark:bg-transparent"
        />
        <div className="grid min-w-0 gap-1.5 @min-[44rem]/task-home:gap-2">
          <p className="text-xs leading-[var(--app-line-22)] text-muted-foreground">
            {userName
              ? t("workspaceHome.greetingName", { name: userName })
              : t("workspaceHome.greeting")}
          </p>
          <h2
            id="new-task-welcome-title"
            className="max-w-[24ch] text-lg font-semibold tracking-tight text-balance text-home-heading @min-[44rem]/task-home:text-xl @min-[60rem]/task-home:text-2xl"
          >
            {t("conversation.newTaskWelcome", { productName })}
          </h2>
          <p className="text-xs leading-[var(--app-line-24)] text-muted-foreground @min-[44rem]/task-home:text-sm">
            {t("workspaceHome.description")}
          </p>
        </div>
        <WelcomeOrb />
      </div>
      {notice}
      {guide}
      {onSelect && (
        <div
          className="conversation-starter-questions grid min-w-0 grid-cols-1 gap-2 @min-[20rem]/task-home:grid-cols-2 @min-[44rem]/task-home:gap-3 @min-[64rem]/task-home:grid-cols-4"
          role="group"
          aria-label={t("conversation.starterQuestions.label")}
        >
          {starterQuestions.map(({ id, icon: Icon, tone, colors }) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              className="conversation-starter-question h-auto min-h-0 min-w-0 items-start justify-start gap-3 rounded-xl border-border bg-card p-3 text-left whitespace-normal shadow-home-card hover:border-input-hover hover:bg-card focus-visible:border-ring focus-visible:ring-0! @min-[44rem]/task-home:flex-col @min-[44rem]/task-home:gap-2.5"
              onClick={() =>
                onSelect(t(`conversation.starterQuestions.${id}.prompt`))
              }
            >
              <span
                className={`conversation-starter-question-icon grid size-8 shrink-0 place-items-center rounded-[10px] border-3 border-(--home-icon-border) shadow-home-icon ${colors}`}
                data-tone={tone}
                aria-hidden="true"
              >
                <Icon className="size-4!" strokeWidth={1.8} />
              </span>
              <span className="grid w-full min-w-0 gap-1.5">
                <span className="text-[length:var(--app-font-13)] font-medium text-home-heading">
                  {t(`conversation.starterQuestions.${id}.title`)}
                </span>
                <span className="text-xs leading-[var(--app-line-18)] font-normal text-muted-foreground">
                  {t(`conversation.starterQuestions.${id}.description`)}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
    </section>
  )
}
