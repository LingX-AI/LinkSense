import { useId, useRef, useState } from "react"
import { CopyIcon, GlobeIcon, Link2Icon, UploadIcon, XIcon } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  webSiteCreateSchema,
  webSiteUpdateSchema,
  webSiteSlugSchema,
  type WebSite,
} from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import { StatusBanner } from "@/components/feedback/status-banner"
import { notify } from "@/components/feedback/notification"
import { FieldShell } from "@/components/forms/form-field"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { cn } from "@/lib/utils"
import { copyConversationShareUrl } from "@/features/conversations/conversation-share-contracts"
import {
  createWebSite,
  deleteWebSite,
  getWebSiteSources,
  publishWebSite,
  updateWebSite,
  webSiteKeys,
} from "./api"
import { SiteDialogHero } from "./site-dialog-hero"
import { SiteTargetPicker } from "./site-target-picker"

export type WebSiteSourceFile = {
  conversationId: string
  fileId: string
  name: string
}
export type SiteAction =
  | { kind: "share"; source: WebSiteSourceFile }
  | { kind: "edit" | "publish" | "delete"; site: WebSite }
export function SiteDialog({
  action,
  onClose,
}: {
  action: SiteAction
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const client = useQueryClient()
  const id = useId()
  const formId = `${id}-form`
  const inFlight = useRef(false)
  const [name, setName] = useState(
    action.kind === "share"
      ? action.source.name.replace(/\.html?$/iu, "")
      : action.site.name
  )
  const [description, setDescription] = useState(
    action.kind === "share" ? "" : action.site.description
  )
  const [slug, setSlug] = useState(
    action.kind === "share" ? "" : action.site.slug
  )
  const [publishMode, setPublishMode] = useState<"new" | "update">("new")
  const [selectedSite, setSelectedSite] = useState<WebSite | null>(null)
  const [fileId, setFileId] = useState("")
  const [result, setResult] = useState<WebSite | null>(null)
  const sources = useQuery({
    queryKey: webSiteKeys.sources(
      action.kind === "publish" ? action.site.id : ""
    ),
    enabled: action.kind === "publish",
    queryFn: ({ signal }) =>
      getWebSiteSources(
        action.kind === "publish" ? action.site.id : "",
        signal
      ),
  })
  const updating =
    action.kind === "publish" ||
    (action.kind === "share" && publishMode === "update")
  const metadata = { name, description, ...(slug.trim() ? { slug } : {}) }
  const sourceItems = (sources.data ?? []).map((file, index) => ({
    value: file.id,
    label: t(
      action.kind === "publish" && file.id === action.site.source_file_id
        ? "webSites.currentSource"
        : index === 0
          ? "webSites.latestSource"
          : "webSites.datedSource",
      { name: file.filename, date: formatDateTime(file.created_at, language) }
    ),
  }))
  const valid =
    action.kind === "share"
      ? publishMode === "update"
        ? Boolean(selectedSite)
        : publishMode === "new" &&
          webSiteCreateSchema.safeParse({
            ...metadata,
            conversation_id: action.source.conversationId,
            file_id: action.source.fileId,
          }).success
      : action.kind === "edit"
        ? webSiteUpdateSchema.safeParse({ name, description, slug }).success
        : action.kind === "publish"
          ? Boolean(fileId)
          : true
  const mutation = useMutation({
    mutationFn: async (): Promise<WebSite | null> => {
      if (action.kind === "share")
        return publishMode === "new"
          ? createWebSite(
              webSiteCreateSchema.parse({
                ...metadata,
                conversation_id: action.source.conversationId,
                file_id: action.source.fileId,
              })
            )
          : selectedSite
            ? publishWebSite(selectedSite.id, action.source.fileId)
            : Promise.reject(new Error(t("webSites.selectExistingSite")))
      if (action.kind === "edit")
        return updateWebSite(
          action.site.id,
          webSiteUpdateSchema.parse({ name, description, slug })
        )
      if (action.kind === "publish")
        return publishWebSite(action.site.id, fileId)
      await deleteWebSite(action.site.id)
      return null
    },
    onSuccess: async (site) => {
      await client.invalidateQueries({ queryKey: webSiteKeys.all })
      if (site && (action.kind === "share" || action.kind === "publish"))
        setResult(site)
      else onClose()
    },
    onSettled: () => {
      inFlight.current = false
    },
  })
  const copy = async () => {
    if (!result) return
    try {
      await copyConversationShareUrl(
        new URL(result.url_path, window.location.origin).href
      )
      notify.success(t("webSites.copied"))
    } catch {
      notify.error(t("webSites.copyFailed"))
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "max-h-[calc(100dvh_-_2rem)] w-[calc(100vw_-_2rem)] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0",
          action.kind === "share"
            ? "max-w-lg sm:max-w-lg"
            : "max-w-md sm:max-w-md"
        )}
      >
        <form
          id={formId}
          className="flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && !inFlight.current) {
              inFlight.current = true
              mutation.mutate()
            }
          }}
        >
          {action.kind !== "delete" && (
            <SiteDialogHero
              mode={result ? "success" : updating ? "publish" : action.kind}
            />
          )}
          <DialogHeader
            className={
              action.kind === "delete"
                ? "items-start gap-2 px-6 pt-6 pb-4 text-left"
                : "items-center gap-2 px-6 pt-5 pb-5 text-center"
            }
          >
            <DialogTitle
              className={
                action.kind === "delete"
                  ? "pr-8 text-base leading-snug font-semibold"
                  : "text-xl leading-snug font-semibold tracking-tight"
              }
            >
              {t(
                result
                  ? updating || result.status === "disabled"
                    ? "webSites.updatedTitle"
                    : "webSites.publishedTitle"
                  : `webSites.dialog.${action.kind}`
              )}
            </DialogTitle>
            <DialogDescription
              className={
                action.kind === "delete"
                  ? "text-sm leading-relaxed"
                  : "max-w-xs text-sm leading-relaxed"
              }
            >
              {t(
                result
                  ? result.status === "disabled"
                    ? "webSites.stillDisabled"
                    : updating
                      ? "webSites.updatedDescription"
                      : "webSites.publishedDescription"
                  : action.kind === "delete"
                    ? "webSites.deleteDescription"
                    : updating
                      ? "webSites.updateDescription"
                      : "webSites.shareDescription"
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4 px-6 pb-5">
            {mutation.error && (
              <StatusBanner variant="error">
                {getErrorMessage(mutation.error, t)}
              </StatusBanner>
            )}
            {result ? (
              <FieldShell id={`${id}-url`} label={t("webSites.url")}>
                <Input
                  id={`${id}-url`}
                  readOnly
                  value={new URL(result.url_path, window.location.origin).href}
                />
              </FieldShell>
            ) : (
              <FieldGroup className="gap-4">
                {action.kind === "share" && (
                  <FieldSet>
                    <FieldLegend id={`${id}-mode-label`} variant="label">
                      {t("webSites.publishMode")}
                    </FieldLegend>
                    <RadioGroup
                      name={`${id}-mode`}
                      aria-labelledby={`${id}-mode-label`}
                      value={publishMode}
                      disabled={mutation.isPending}
                      onValueChange={(value) => {
                        if (value === "new" || value === "update") {
                          setPublishMode(value)
                          setSelectedSite(null)
                        }
                      }}
                    >
                      <RadioGroupOption
                        htmlFor={`${id}-new`}
                        className="flex-1"
                      >
                        <RadioGroupItem id={`${id}-new`} value="new" />
                        <span>{t("webSites.newSite")}</span>
                      </RadioGroupOption>
                      <RadioGroupOption
                        htmlFor={`${id}-update`}
                        className="flex-1"
                      >
                        <RadioGroupItem id={`${id}-update`} value="update" />
                        <span>{t("webSites.updateExisting")}</span>
                      </RadioGroupOption>
                    </RadioGroup>
                  </FieldSet>
                )}
                {action.kind === "share" && publishMode === "update" && (
                  <>
                    <SiteTargetPicker
                      conversationId={action.source.conversationId}
                      value={selectedSite}
                      onChange={setSelectedSite}
                      disabled={mutation.isPending}
                    />
                    {selectedSite && (
                      <FieldShell
                        id={`${id}-existing-url`}
                        label={t("webSites.url")}
                      >
                        <Input
                          id={`${id}-existing-url`}
                          readOnly
                          value={
                            new URL(
                              selectedSite.url_path,
                              window.location.origin
                            ).href
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {t(
                            selectedSite.status === "disabled"
                              ? "webSites.updateDisabledDescription"
                              : "webSites.updateDescription"
                          )}
                        </p>
                      </FieldShell>
                    )}
                  </>
                )}
                {(action.kind === "edit" ||
                  (action.kind === "share" && publishMode === "new")) && (
                  <>
                    <FieldShell id={`${id}-name`} label={t("webSites.name")}>
                      <Input
                        id={`${id}-name`}
                        value={name}
                        maxLength={240}
                        disabled={mutation.isPending}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </FieldShell>
                    <FieldShell
                      id={`${id}-description`}
                      label={t("webSites.summary")}
                    >
                      <Textarea
                        id={`${id}-description`}
                        className="min-h-16 resize-y"
                        rows={2}
                        value={description}
                        maxLength={1000}
                        disabled={mutation.isPending}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </FieldShell>
                    <FieldShell
                      id={`${id}-slug`}
                      label={t("webSites.slug")}
                      error={
                        slug && !webSiteSlugSchema.safeParse(slug).success
                          ? t("webSites.invalidSlug")
                          : undefined
                      }
                    >
                      <Input
                        id={`${id}-slug`}
                        value={slug}
                        maxLength={80}
                        placeholder={t("webSites.slugPlaceholder")}
                        disabled={mutation.isPending}
                        onChange={(event) => setSlug(event.target.value)}
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("webSites.slugHelp")}
                      </p>
                      {action.kind === "edit" &&
                        slug.trim().toLowerCase() !== action.site.slug && (
                          <p className="text-sm text-destructive">
                            {t("webSites.slugChanged")}
                          </p>
                        )}
                    </FieldShell>
                  </>
                )}
                {action.kind === "publish" && (
                  <FieldShell
                    id={`${id}-source`}
                    label={t("webSites.sourceFile")}
                  >
                    {sources.isPending ? (
                      <Spinner />
                    ) : sources.error ? (
                      <StatusBanner variant="error">
                        {getErrorMessage(sources.error, t)}
                      </StatusBanner>
                    ) : (
                      <Select
                        value={fileId || null}
                        onValueChange={(value) => value && setFileId(value)}
                        items={sourceItems}
                      >
                        <SelectTrigger id={`${id}-source`} className="w-full">
                          <SelectValue
                            placeholder={t("webSites.selectSource")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {sourceItems.map((file) => (
                              <SelectItem key={file.value} value={file.value}>
                                {file.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                    {!sources.isPending &&
                      !sources.error &&
                      !sources.data?.length && (
                        <p className="text-sm text-muted-foreground">
                          {t("webSites.noSources")}
                        </p>
                      )}
                  </FieldShell>
                )}
                {action.kind === "delete" && (
                  <div className="flex min-w-0 items-center gap-3 rounded-lg bg-muted/50 px-3 py-3">
                    <GlobeIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="min-w-0 text-sm leading-5 font-medium [overflow-wrap:anywhere]">
                      {action.site.name}
                    </p>
                  </div>
                )}
              </FieldGroup>
            )}
          </div>
        </form>
        <DialogFooter
          className={
            action.kind === "delete"
              ? "flex-row justify-end gap-2 px-6 pb-6"
              : "flex-row justify-center gap-2 px-6 pb-5 sm:justify-center"
          }
        >
          <Button
            type="button"
            variant="ghost"
            className={
              action.kind === "delete"
                ? "h-8 px-4"
                : "h-9 min-w-24 rounded-full"
            }
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {t(result ? "webSites.done" : "webSites.cancel")}
          </Button>
          {result ? (
            <Button
              type="button"
              className="h-9 min-w-32 rounded-full"
              onClick={() => void copy()}
            >
              <CopyIcon aria-hidden="true" />
              {t("webSites.copy")}
            </Button>
          ) : (
            <Button
              type="submit"
              form={formId}
              className={
                action.kind === "delete"
                  ? "h-8 px-4"
                  : "h-9 min-w-32 rounded-full"
              }
              disabled={!valid || mutation.isPending}
              variant={action.kind === "delete" ? "destructive" : "default"}
            >
              {mutation.isPending && <Spinner />}
              {!mutation.isPending && action.kind === "share" && !updating && (
                <Link2Icon aria-hidden="true" />
              )}
              {!mutation.isPending && updating && (
                <UploadIcon aria-hidden="true" />
              )}
              {t(
                action.kind === "delete"
                  ? "webSites.delete"
                  : action.kind === "edit"
                    ? "webSites.save"
                    : updating
                      ? "webSites.updateSite"
                      : "webSites.publish"
              )}
            </Button>
          )}
        </DialogFooter>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={
                action.kind === "delete"
                  ? "absolute top-3 right-3 rounded-full"
                  : "absolute top-3 right-3 rounded-full text-maintenance-hero-ink hover:bg-maintenance-hero-ink/15 hover:text-maintenance-hero-ink"
              }
            />
          }
          disabled={mutation.isPending}
          aria-label={t("common.close")}
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
