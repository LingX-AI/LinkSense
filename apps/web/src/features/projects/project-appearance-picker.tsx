import { useState } from "react"
import {
  projectColorSchema,
  projectIconSchema,
  type ProjectAppearance,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { InputGroupButton } from "@/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { ProjectIcon } from "./project-icon"
import { projectColorClasses } from "./project-colors"

export function ProjectAppearancePicker({
  value,
  disabled = false,
  onChange,
}: {
  value: ProjectAppearance
  disabled?: boolean
  onChange: (value: ProjectAppearance) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <InputGroupButton
            size="icon-sm"
            disabled={disabled}
            aria-label={t("projects.appearance.choose")}
          />
        }
      >
        <ProjectIcon {...value} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={12}
        className="w-[min(20rem,calc(100vw-2rem))] gap-4 rounded-2xl p-4"
      >
        <PopoverTitle className="sr-only">
          {t("projects.appearance.choose")}
        </PopoverTitle>
        <ToggleGroup
          value={[value.color]}
          disabled={disabled}
          className="grid w-full grid-cols-6 gap-2"
          aria-label={t("projects.appearance.color")}
          onValueChange={(values) => {
            const color = projectColorSchema.safeParse(values[0])
            if (color.success) onChange({ ...value, color: color.data })
          }}
        >
          {projectColorSchema.options.map((color) => (
            <ToggleGroupItem
              key={color}
              value={color}
              aria-label={t(`projects.appearance.colors.${color}`)}
              className="size-9 min-w-0 rounded-full p-1.5 aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-2 aria-pressed:ring-offset-popover"
            >
              <span
                className={cn(
                  "size-6 rounded-full bg-current",
                  projectColorClasses[color]
                )}
              />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Separator />
        <ToggleGroup
          value={[value.icon]}
          disabled={disabled}
          className="grid max-h-[min(17rem,40vh)] w-full grid-cols-6 gap-2 overflow-y-auto"
          aria-label={t("projects.appearance.icon")}
          onValueChange={(values) => {
            const icon = projectIconSchema.safeParse(values[0])
            if (icon.success) onChange({ ...value, icon: icon.data })
          }}
        >
          {projectIconSchema.options.map((icon) => (
            <ToggleGroupItem
              key={icon}
              value={icon}
              aria-label={t(`projects.appearance.icons.${icon}`)}
              className="size-9 min-w-0 rounded-full p-0"
            >
              <ProjectIcon icon={icon} color={value.color} className="size-6" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setOpen(false)}
          >
            {t("projects.appearance.done")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
