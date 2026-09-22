import { useTranslation } from "react-i18next"
import { normalizeLanguage } from "@/i18n"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import type { ManagedPricedModel } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type TableActions = {
  disabled: boolean
  onEdit: (model: ManagedPricedModel) => void
  onDelete: (model: ManagedPricedModel) => void
  onAvailability: (model: ManagedPricedModel, enabled: boolean) => void
  onReorder: (models: ManagedPricedModel[]) => void
}

export function ModelSettingsTable({
  models,
  ...actions
}: TableActions & { models: ManagedPricedModel[] }) {
  const { t } = useTranslation()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const ids = models.map((model) => model.id)
  const title = (id: string | number) =>
    models.find((model) => model.id === id)?.display_name ?? ""
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      accessibility={{
        screenReaderInstructions: {
          draggable: t("admin.modelProvider.reorderInstructions"),
        },
        announcements: {
          onDragStart: ({ active }) =>
            t("admin.modelProvider.reorderStarted", { name: title(active.id) }),
          onDragOver: ({ active, over }) =>
            over
              ? t("admin.modelProvider.reorderPosition", {
                  name: title(active.id),
                  position: ids.indexOf(String(over.id)) + 1,
                })
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? t("admin.modelProvider.reorderPosition", {
                  name: title(active.id),
                  position: ids.indexOf(String(over.id)) + 1,
                })
              : t("admin.modelProvider.reorderCancelled"),
          onDragCancel: () => t("admin.modelProvider.reorderCancelled"),
        },
      }}
      onDragEnd={({ active, over }) => {
        if (actions.disabled || !over || active.id === over.id) return
        const from = ids.indexOf(String(active.id))
        const to = ids.indexOf(String(over.id))
        if (from >= 0 && to >= 0) actions.onReorder(arrayMove(models, from, to))
      }}
    >
      <Table
        appearance="card"
        className="min-w-[640px]"
        aria-label={t("admin.modelProvider.models")}
      >
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">
                {t("admin.modelProvider.modelOrder")}
              </span>
            </TableHead>
            <TableHead>{t("admin.modelProvider.modelName")}</TableHead>
            <TableHead>{t("admin.modelProvider.modelKind")}</TableHead>
            <TableHead className="text-right">
              {t("admin.modelProvider.priceSummary")}
            </TableHead>
            <TableHead className="text-center">
              {t("admin.modelProvider.showInComposer")}
            </TableHead>
            <TableHead className="w-24">
              <span className="sr-only">{t("common.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <TableBody>
            {models.map((model, index) => (
              <ModelSettingsRow
                key={model.id}
                model={model}
                first={index === 0}
                last={index === models.length - 1}
                only={models.length === 1}
                {...actions}
                onMove={(direction) =>
                  actions.onReorder(arrayMove(models, index, index + direction))
                }
              />
            ))}
          </TableBody>
        </SortableContext>
      </Table>
    </DndContext>
  )
}

function ModelSettingsRow({
  model,
  first,
  last,
  only,
  onMove,
  ...actions
}: Omit<TableActions, "onReorder"> & {
  model: ManagedPricedModel
  first: boolean
  last: boolean
  only: boolean
  onMove: (direction: -1 | 1) => void
}) {
  const { t, i18n } = useTranslation()
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: model.id, disabled: actions.disabled || only })
  const formatPrice = (value: string) =>
    new Intl.NumberFormat(normalizeLanguage(i18n.language) ?? "zh-CN", {
      maximumFractionDigits: 8,
    }).format(Number(value))
  return (
    <TableRow
      ref={setNodeRef}
      aria-label={model.display_name}
      className={cn("bg-card", isDragging && "relative z-10 bg-hover")}
      // dnd-kit supplies dynamic movement; appearance stays in semantic Tailwind classes.
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <TableCell className="px-1">
        <Button
          ref={setActivatorNodeRef}
          type="button"
          size="icon"
          variant="ghost"
          className="cursor-grab touch-none text-muted-foreground"
          {...attributes}
          {...listeners}
          disabled={actions.disabled || only}
          aria-label={t("admin.modelProvider.reorderModel", {
            name: model.display_name,
          })}
        >
          <GripVerticalIcon />
        </Button>
      </TableCell>
      <TableCell className="max-w-64 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium" title={model.display_name}>
            {model.display_name}
          </span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={model.id}
          >
            {model.id}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="ghost">
          {t(`admin.modelProvider.modelKinds.${model.kind}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        {formatPrice(model.input_price_per_million)} /{" "}
        {model.kind === "chat"
          ? formatPrice(model.cached_input_price_per_million)
          : "-"}{" "}
        /{" "}
        {model.kind === "chat"
          ? formatPrice(model.output_price_per_million)
          : "-"}
      </TableCell>
      <TableCell className="text-center">
        {model.kind === "chat" ? (
          <Switch
            disabled={actions.disabled}
            checked={model.enabled}
            aria-label={t("admin.modelProvider.modelAvailability", {
              name: model.display_name,
            })}
            onCheckedChange={(checked) =>
              actions.onAvailability(model, checked)
            }
          />
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={actions.disabled}
            aria-label={t("admin.modelProvider.editModel", {
              name: model.display_name,
            })}
            onClick={() => actions.onEdit(model)}
          >
            <PencilIcon className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={actions.disabled}
                  aria-label={t("admin.modelProvider.modelActions", {
                    name: model.display_name,
                  })}
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={first} onClick={() => onMove(-1)}>
                  <ArrowUpIcon />
                  {t("admin.modelProvider.moveUp")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={last} onClick={() => onMove(1)}>
                  <ArrowDownIcon />
                  {t("admin.modelProvider.moveDown")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  className="whitespace-nowrap"
                  disabled={only}
                  onClick={() => actions.onDelete(model)}
                >
                  <Trash2Icon />
                  {t("admin.modelProvider.deleteModel")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
