import { MessageSquareIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { recentConversations } from "@/data/mock-data"

type SearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useTranslation()

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("search.title")}
      description={t("search.description")}
      className="border-0 bg-[var(--app-popover)] text-[var(--app-text)] ring-0"
    >
      <Command className="bg-transparent">
        <CommandInput placeholder={t("search.placeholder")} autoFocus />
        <CommandList className="px-1 pb-1">
          <CommandEmpty>{t("search.empty")}</CommandEmpty>
          {recentConversations.map((conversation) => (
            <CommandItem
              key={conversation.id}
              value={t(conversation.titleKey)}
              onSelect={() => onOpenChange(false)}
            >
              <MessageSquareIcon aria-hidden="true" />
              <span>{t(conversation.titleKey)}</span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
