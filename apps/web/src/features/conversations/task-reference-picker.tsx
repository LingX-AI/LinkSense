import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover"

import {
  useTaskReferenceOptions,
  type TaskReference,
} from "./task-reference-data"
export type { TaskReference } from "./task-reference-data"
export function TaskReferencePicker({
  anchor,
  finalFocus,
  currentConversationId,
  open,
  onOpenChange,
  selected,
  onChange,
  disabled,
}: {
  anchor: React.ComponentProps<typeof PopoverContent>["anchor"]
  finalFocus?: React.ComponentProps<typeof PopoverContent>["finalFocus"]
  currentConversationId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: TaskReference[]
  onChange: (selected: TaskReference[]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [search, setSearch] = useState("")
  const [archived, setArchived] = useState(false)
  const query = useTaskReferenceOptions(
    currentConversationId,
    search,
    archived,
    open
  )
  const tasks = query.items
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent
        anchor={anchor}
        finalFocus={finalFocus}
        side="top"
        align="start"
        className="w-96 max-w-[calc(100vw-2rem)]"
      >
        <PopoverHeader>
          <PopoverTitle>{t("taskReferences.title")}</PopoverTitle>
          <PopoverDescription>
            {t("taskReferences.description")}
          </PopoverDescription>
        </PopoverHeader>
        <Label htmlFor={id} className="sr-only">
          {t("taskReferences.search")}
        </Label>
        <Input
          id={id}
          maxLength={240}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("taskReferences.search")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <Label className="text-xs font-normal text-muted-foreground">
          <Checkbox
            checked={archived}
            onCheckedChange={(checked) => setArchived(checked === true)}
          />
          {t("taskReferences.archived")}
        </Label>
        <fieldset className="max-h-72 space-y-1 overflow-y-auto">
          <legend className="sr-only">{t("taskReferences.title")}</legend>
          {query.isPending && <LoadingState />}
          {query.isError && (
            <ErrorState
              message={getErrorMessage(query.error, t)}
              onRetry={() => void query.refetch()}
            />
          )}
          {!query.isPending && !query.isError && tasks.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              {t("taskReferences.empty")}
            </p>
          )}
          {tasks.map((task) => {
            const checked = selected.some((item) => item.id === task.id)
            return (
              <Label
                key={task.id}
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled || (!checked && selected.length >= 3)}
                  onCheckedChange={() =>
                    onChange(
                      checked
                        ? selected.filter((item) => item.id !== task.id)
                        : [...selected, { id: task.id, title: task.title }]
                    )
                  }
                />
                <span className="min-w-0 truncate">{task.title}</span>
              </Label>
            )
          })}
        </fieldset>
        {query.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("taskReferences.more")}
          </Button>
        )}
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("taskReferences.limit", { count: selected.length })}
        </p>
      </PopoverContent>
    </Popover>
  )
}
