import { FolderIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProjects } from "./project-api"

const projectlessValue = "projectless"

export function ProjectPicker({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  id?: string
}) {
  const { t } = useTranslation()
  const query = useProjects()
  const projects = query.data ?? []
  const selected = projects.find((project) => project.id === value)
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <Select
        value={value ?? projectlessValue}
        disabled={disabled || query.isPending}
        onValueChange={(next) => {
          if (next !== null) onChange(next === projectlessValue ? null : next)
        }}
      >
        <SelectTrigger
          id={id}
          aria-label={t("projects.choose")}
          className="w-full min-w-0"
        >
          <FolderIcon aria-hidden="true" />
          <SelectValue className="min-w-0">
            <span className="truncate" title={selected?.name}>
              {query.isPending
                ? t("common.loading")
                : value === null
                  ? t("projects.projectless")
                  : (selected?.name ?? t("projects.unavailable"))}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="max-w-[min(24rem,calc(100vw-2rem))]"
        >
          <SelectGroup>
            <SelectItem value={projectlessValue}>
              {t("projects.projectless")}
            </SelectItem>
            {projects.map((project) => (
              <SelectItem
                key={project.id}
                value={project.id}
                className="min-w-0 [&>span:first-child]:min-w-0 [&>span:first-child]:shrink"
              >
                <span className="truncate" title={project.name}>
                  {project.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {query.isError && (
        <div
          role="alert"
          className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-destructive"
        >
          <span>{t("projects.loadError")}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
    </div>
  )
}
