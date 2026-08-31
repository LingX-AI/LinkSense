import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  CornerDownRightIcon,
  EllipsisIcon,
  ListEndIcon,
  LoaderCircleIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import type { CapabilitySummary, PendingRequest } from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { normalizeLanguage } from "@/i18n"
import { formatFileSize } from "@/i18n/date"
import { capabilityPresentation } from "@/features/capabilities/built-in-presentation"
import type { KnowledgeBase } from "@/features/knowledge-bases/knowledge-base-contracts"
import { reorderPendingRequestIds } from "@/features/conversations/pending-request-order"

export function PendingRequests({
  requests,
  capabilities,
  knowledgeBases = [],
  canGuideCurrentTurn = false,
  pendingActionId,
  reorderDisabled = false,
  taskStartDisabled = false,
  onGuide,
  onStart,
  onEdit,
  onCancel,
  onReorder,
}: {
  requests: PendingRequest[]
  capabilities: CapabilitySummary[]
  knowledgeBases?: KnowledgeBase[]
  canGuideCurrentTurn?: boolean
  pendingActionId?: string
  reorderDisabled?: boolean
  taskStartDisabled?: boolean
  onGuide: (request: PendingRequest) => void
  onStart: (request: PendingRequest) => void
  onEdit: (request: PendingRequest) => void
  onCancel: (request: PendingRequest) => void
  onReorder?: (requestIds: string[]) => void | Promise<void>
}) {
  const { t, i18n } = useTranslation()
  const productName = useProductName()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const sortedRequestIds = useMemo(
    () =>
      [...requests]
        .sort((a, b) => a.sequence_no - b.sequence_no)
        .map((request) => request.id),
    [requests]
  )
  const [draggedRequestIds, setDraggedRequestIds] = useState<string[] | null>(
    null
  )
  const orderedRequestIds = draggedRequestIds ?? sortedRequestIds
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  if (!requests.length) return null
  const requestsById = new Map(requests.map((request) => [request.id, request]))
  const ordered = orderedRequestIds.flatMap((id) => {
    const request = requestsById.get(id)
    return request ? [request] : []
  })
  const sortingDisabled =
    !onReorder ||
    reorderDisabled ||
    Boolean(pendingActionId) ||
    ordered.length < 2 ||
    ordered.some((request) => request.status === "steering")
  const requestPosition = (id: string | number) =>
    orderedRequestIds.indexOf(String(id)) + 1
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || sortingDisabled || !onReorder) return
    const previousIds = orderedRequestIds
    const nextIds = reorderPendingRequestIds(
      previousIds,
      String(active.id),
      String(over.id)
    )
    setDraggedRequestIds(nextIds)
    try {
      await onReorder(nextIds)
    } finally {
      setDraggedRequestIds(null)
    }
  }

  return (
    <section
      className="pending-requests"
      aria-label={t("conversation.pendingTitle")}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{
          screenReaderInstructions: {
            draggable: t("conversation.pendingReorderInstructions"),
          },
          announcements: {
            onDragStart: ({ active }) =>
              t("conversation.pendingReorderStarted", {
                position: requestPosition(active.id),
              }),
            onDragOver: ({ over }) =>
              over
                ? t("conversation.pendingReorderOver", {
                    position: requestPosition(over.id),
                  })
                : undefined,
            onDragEnd: ({ over }) =>
              over
                ? t("conversation.pendingReorderCompleted", {
                    position: requestPosition(over.id),
                  })
                : t("conversation.pendingReorderCancelled"),
            onDragCancel: () => t("conversation.pendingReorderCancelled"),
          },
        }}
        onDragEnd={(event) => void handleDragEnd(event)}
      >
        <SortableContext
          items={orderedRequestIds}
          strategy={verticalListSortingStrategy}
        >
          <ol>
            {ordered.map((request, index) => {
              const blocked =
                request.status === "blocked_overload" ||
                request.status === "blocked_preflight"
              const blockKey = request.block_code
                ? `conversation.pendingBlockCodes.${request.block_code}`
                : undefined
              const translatedBlock = blockKey ? t(blockKey) : undefined
              const priorityCapabilities = (
                request.priority_capability_ids ?? []
              ).map((id) => {
                const capability = capabilities.find((item) => item.id === id)
                return capability
                  ? capabilityPresentation(capability, t, productName).name
                  : id
              })
              const attachments = request.attachments ?? []
              const selectedKnowledgeBases = (
                request.knowledge_base_ids ?? []
              ).map(
                (id) =>
                  knowledgeBases.find(
                    (knowledgeBase) => knowledgeBase.id === id
                  )?.name ?? t("conversation.knowledgeBaseUnavailable")
              )
              const attachmentCount =
                attachments.length || request.attachment_count || 0
              const hasRequestDetails =
                priorityCapabilities.length > 0 ||
                selectedKnowledgeBases.length > 0 ||
                attachmentCount > 0
              const canGuide =
                request.status === "steering" ||
                (canGuideCurrentTurn &&
                  index === 0 &&
                  request.status === "waiting_previous_turn" &&
                  !request.display &&
                  Boolean(request.input_text?.trim()) &&
                  priorityCapabilities.length === 0 &&
                  selectedKnowledgeBases.length === 0 &&
                  attachmentCount === 0)
              const lockedForSteering = request.status === "steering"
              const annotationLabel = request.display
                ? t(
                    request.display.kind === "presentation_annotation"
                      ? "conversation.presentationAnnotationCount"
                      : request.display.kind === "html_annotation"
                        ? "conversation.htmlAnnotationCount"
                        : "conversation.officeAnnotationCount",
                    { count: request.display.annotation_count }
                  )
                : null
              const requestLabel =
                annotationLabel ||
                request.input_text ||
                t("conversation.pendingAttachmentCount", {
                  count: attachmentCount,
                })

              return (
                <SortablePendingRequestRow
                  key={request.id}
                  id={request.id}
                  disabled={sortingDisabled}
                  handleLabel={t("conversation.pendingReorderHandle", {
                    position: index + 1,
                  })}
                  tooltip={t("conversation.pendingReorderTooltip")}
                >
                  <div className="pending-request-context-content">
                    <span
                      className="pending-request-context-input"
                      title={
                        request.display
                          ? request.display.annotations
                              .map((annotation) => annotation.request)
                              .join("\n")
                          : requestLabel
                      }
                    >
                      {requestLabel}
                    </span>
                  </div>

                  <div className="pending-request-context-actions">
                    {canGuide ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="pending-request-context-guide rounded-full"
                              aria-label={t("conversation.pendingGuide")}
                              disabled={pendingActionId === request.id}
                              onClick={() => onGuide(request)}
                            />
                          }
                        >
                          {pendingActionId === request.id ? (
                            <LoaderCircleIcon
                              data-icon="inline-start"
                              className="animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <CornerDownRightIcon
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                          )}
                          {t("conversation.pendingGuide")}
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("conversation.pendingGuideTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="pending-request-context-mode">
                        <CornerDownRightIcon aria-hidden="true" />
                        {t("conversation.pendingQueued")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="pending-request-context-action"
                      aria-label={t("conversation.closePending")}
                      disabled={
                        lockedForSteering || pendingActionId === request.id
                      }
                      onClick={() => onCancel(request)}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="pending-request-context-action"
                            aria-label={t("conversation.pendingDetails")}
                            disabled={
                              lockedForSteering ||
                              pendingActionId === request.id
                            }
                          />
                        }
                      >
                        <EllipsisIcon aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        side="top"
                        className="min-w-56"
                      >
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            disabled={
                              lockedForSteering ||
                              pendingActionId === request.id
                            }
                            onClick={() => onEdit(request)}
                          >
                            {t("conversation.editPending")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={pendingActionId === request.id}
                            onClick={() => onCancel(request)}
                          >
                            {t("conversation.closePending")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        {hasRequestDetails && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              {priorityCapabilities.length > 0 && (
                                <DropdownMenuLabel className="font-normal">
                                  {t(
                                    "conversation.pendingPriorityCapabilities"
                                  )}
                                  : {priorityCapabilities.join(", ")}
                                </DropdownMenuLabel>
                              )}
                              {selectedKnowledgeBases.length > 0 && (
                                <DropdownMenuLabel className="font-normal">
                                  {t("conversation.pendingKnowledgeBases")}:{" "}
                                  {selectedKnowledgeBases.join(", ")}
                                </DropdownMenuLabel>
                              )}
                              {attachmentCount > 0 && (
                                <DropdownMenuLabel className="font-normal">
                                  {t("conversation.pendingAttachmentCount", {
                                    count: attachmentCount,
                                  })}
                                </DropdownMenuLabel>
                              )}
                            </DropdownMenuGroup>
                          </>
                        )}
                        {attachments.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>
                                {t("conversation.pendingAttachments")}
                              </DropdownMenuLabel>
                              {attachments.map((file) => (
                                <DropdownMenuLabel
                                  key={file.id}
                                  className="flex min-w-0 items-center justify-between gap-4 font-normal"
                                >
                                  <span className="truncate">{file.name}</span>
                                  <span className="shrink-0">
                                    {formatFileSize(file.size, language)}
                                  </span>
                                </DropdownMenuLabel>
                              ))}
                            </DropdownMenuGroup>
                          </>
                        )}
                        {blocked && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="font-normal">
                                {request.status === "blocked_overload"
                                  ? t("conversation.pendingBlockedOverload")
                                  : request.block_code &&
                                      translatedBlock !== blockKey
                                    ? translatedBlock
                                    : t("conversation.pendingBlockedPreflight")}
                              </DropdownMenuLabel>
                              {index === 0 && (
                                <DropdownMenuItem
                                  disabled={
                                    taskStartDisabled ||
                                    pendingActionId === request.id
                                  }
                                  onClick={() => onStart(request)}
                                >
                                  <PlayIcon aria-hidden="true" />
                                  {t("common.continue")}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuGroup>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </SortablePendingRequestRow>
              )
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  )
}

function SortablePendingRequestRow({
  id,
  disabled,
  handleLabel,
  tooltip,
  children,
}: {
  id: string
  disabled: boolean
  handleLabel: string
  tooltip: string
  children: ReactNode
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  return (
    <li
      ref={setNodeRef}
      className="pending-request-context"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={setActivatorNodeRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="pending-request-drag-handle"
              aria-label={handleLabel}
              disabled={disabled}
              {...attributes}
              {...listeners}
            />
          }
        >
          <ListEndIcon aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      {children}
    </li>
  )
}
