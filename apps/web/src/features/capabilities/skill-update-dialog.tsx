import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  capabilityDisplayName,
  skillEditInputSchema,
  type SkillEditDetail,
} from "@linksense/shared"
import { DownloadIcon, EyeIcon, RefreshCwIcon } from "lucide-react"
import { getErrorMessage } from "@/api/error-message"
import { CapabilityRiskSummary } from "@/components/capabilities/capability-risk-summary"
import { SkillContentPreview } from "@/components/capabilities/skill-content-preview"
import { ErrorState } from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { downloadBlob } from "@/lib/download-blob"
import {
  useSkillEditDetail,
  useSkillPackageDownload,
  useSkillUpdateConfirmation,
  useSkillUpdatePreview,
  type SkillUpdateImportPreview,
} from "./skill-update-api"

interface SkillUpdateDialogProps {
  capabilityId: string
  onClose: () => void
  onCompleted: () => Promise<void>
}

export function SkillUpdateDialog(props: SkillUpdateDialogProps) {
  const { t } = useTranslation()
  const detail = useSkillEditDetail(props.capabilityId)
  const [confirming, setConfirming] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !confirming) props.onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        showCloseButton={!confirming}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{t("marketplace.updatePersonalSkill")}</DialogTitle>
          <DialogDescription>{t("skillUpdate.description")}</DialogDescription>
        </DialogHeader>
        {detail.isFetching || detail.isPending ? (
          <div
            role="status"
            aria-label={t("skillUpdate.loading")}
            className="flex flex-col gap-4"
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : detail.isError ? (
          <ErrorState
            message={t("skillUpdate.loadFailed")}
            onRetry={() => {
              void detail.refetch()
            }}
          />
        ) : (
          <SkillUpdateForm
            key={detail.data.revision}
            {...props}
            detail={detail.data}
            onConfirmingChange={setConfirming}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SkillUpdateForm({
  capabilityId,
  detail,
  onClose,
  onCompleted,
  onConfirmingChange,
}: SkillUpdateDialogProps & {
  detail: SkillEditDetail
  onConfirmingChange: (value: boolean) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<"edit" | "replace">(
    detail.content === null ? "replace" : "edit"
  )
  const [displayName, setDisplayName] = useState(detail.display_name ?? "")
  const [description, setDescription] = useState(detail.description ?? "")
  const [content, setContent] = useState(detail.content ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState<SkillUpdateImportPreview | null>(null)
  const [riskConfirmed, setRiskConfirmed] = useState(false)
  const [deletionsConfirmed, setDeletionsConfirmed] = useState(false)
  const previewMutation = useSkillUpdatePreview(capabilityId, setProgress)
  const confirmMutation = useSkillUpdateConfirmation()
  const download = useSkillPackageDownload(capabilityId)
  const input = skillEditInputSchema.safeParse({
    base_revision: detail.revision,
    display_name: displayName.trim() || null,
    description: description.trim() || null,
    content,
  })
  const changed =
    input.success &&
    (input.data.display_name !== detail.display_name ||
      input.data.description !== detail.description ||
      input.data.content !== detail.content)
  const pending = previewMutation.isPending || confirmMutation.isPending
  const canPreview = !pending && (mode === "edit" ? changed : file !== null)
  const error = confirmMutation.error ?? previewMutation.error ?? download.error

  async function checkUpdate() {
    if (!canPreview) return
    setProgress(0)
    confirmMutation.reset()
    try {
      const value =
        mode === "edit" && input.success
          ? await previewMutation.mutateAsync({
              mode: "edit",
              input: input.data,
            })
          : mode === "replace" && file
            ? await previewMutation.mutateAsync({
                mode: "replace",
                file,
                revision: detail.revision,
              })
            : null
      setPreview(value)
      setRiskConfirmed(false)
      setDeletionsConfirmed(false)
    } catch {
      /* The mutation error is displayed with the draft intact. */
    }
  }

  async function confirmUpdate() {
    if (
      !preview ||
      pending ||
      !riskConfirmed ||
      (preview.skill_update.changes.deleted.length > 0 && !deletionsConfirmed)
    )
      return
    onConfirmingChange(true)
    try {
      await confirmMutation.mutateAsync(preview)
      notify.success(t("capability.updateSkillCompleted"))
      onClose()
      await onCompleted()
    } catch {
      /* The mutation error is displayed with the draft intact. */
    } finally {
      onConfirmingChange(false)
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
        {error && <ErrorState message={getErrorMessage(error, t)} />}
        {preview ? (
          <SkillUpdatePreview
            preview={preview}
            riskConfirmed={riskConfirmed}
            onRiskConfirmed={setRiskConfirmed}
            deletionsConfirmed={deletionsConfirmed}
            onDeletionsConfirmed={setDeletionsConfirmed}
            disabled={pending}
          />
        ) : (
          <form
            id="skill-update-form"
            onSubmit={(event) => {
              event.preventDefault()
              void checkUpdate()
            }}
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend id="skill-update-mode-label" variant="label">
                  {t("skillUpdate.mode")}
                </FieldLegend>
                <RadioGroup
                  name="skill-update-mode"
                  aria-labelledby="skill-update-mode-label"
                  value={mode}
                  disabled={pending}
                  onValueChange={(next) => {
                    if (next === "edit" || next === "replace") setMode(next)
                  }}
                >
                  <RadioGroupOption htmlFor="skill-update-edit">
                    <RadioGroupItem
                      id="skill-update-edit"
                      value="edit"
                      disabled={detail.content === null}
                    />
                    <span>{t("skillUpdate.edit")}</span>
                  </RadioGroupOption>
                  <RadioGroupOption htmlFor="skill-update-replace">
                    <RadioGroupItem id="skill-update-replace" value="replace" />
                    <span>{t("skillUpdate.replace")}</span>
                  </RadioGroupOption>
                </RadioGroup>
              </FieldSet>
              {detail.content === null && (
                <StatusBanner variant="warning">
                  {t("skillUpdate.contentTooLarge")}
                </StatusBanner>
              )}
              <StatusBanner>
                {t(
                  mode === "edit"
                    ? "skillUpdate.preserveNotice"
                    : "skillUpdate.replaceNotice"
                )}
              </StatusBanner>
              <FieldShell
                id="skill-update-name"
                label={t("marketplace.skillIdentifier")}
                hint={t("skillUpdate.identifierHint")}
              >
                <Input id="skill-update-name" value={detail.name} readOnly />
              </FieldShell>
              {mode === "edit" ? (
                <>
                  <FieldShell
                    id="skill-update-display-name"
                    label={t("marketplace.skillDisplayName")}
                  >
                    <Input
                      id="skill-update-display-name"
                      value={displayName}
                      disabled={pending}
                      maxLength={64}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </FieldShell>
                  <FieldShell
                    id="skill-update-description"
                    label={t("common.description")}
                  >
                    <Textarea
                      id="skill-update-description"
                      value={description}
                      disabled={pending}
                      maxLength={4_000}
                      className="max-h-40 overflow-y-auto"
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </FieldShell>
                  <FieldShell
                    id="skill-update-content"
                    label={t("skillUpdate.content")}
                    error={
                      content.trim()
                        ? undefined
                        : t("skillUpdate.contentRequired")
                    }
                  >
                    <Textarea
                      id="skill-update-content"
                      value={content}
                      disabled={pending}
                      aria-invalid={!content.trim() || undefined}
                      aria-describedby={
                        !content.trim()
                          ? "skill-update-content-error"
                          : undefined
                      }
                      maxLength={1_000_000}
                      className="max-h-96 min-h-56 overflow-y-auto font-mono"
                      onChange={(event) => setContent(event.target.value)}
                    />
                  </FieldShell>
                  {input.success && !changed && (
                    <p className="text-sm text-muted-foreground">
                      {t("skillUpdate.noChanges")}
                    </p>
                  )}
                </>
              ) : (
                <FieldShell
                  id="skill-update-package"
                  label={t("marketplace.zipSkillPackage")}
                  hint={
                    file
                      ? t("skillUpdate.selectedFile", { name: file.name })
                      : t("marketplace.zipSkillPackageHint")
                  }
                >
                  <Input
                    id="skill-update-package"
                    type="file"
                    accept=".zip,application/zip"
                    disabled={pending}
                    onChange={(event) =>
                      setFile(event.currentTarget.files?.[0] ?? null)
                    }
                  />
                </FieldShell>
              )}
              {previewMutation.isPending && (
                <p role="status">
                  {t(
                    mode === "replace" && progress < 100
                      ? "skillUpdate.uploading"
                      : "skillUpdate.checking",
                    { percentage: progress }
                  )}
                </p>
              )}
              <section
                aria-label={t("skillUpdate.files")}
                className="flex min-w-0 flex-col gap-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{t("skillUpdate.files")}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={download.isPending || pending}
                    onClick={() => {
                      void download
                        .mutateAsync()
                        .then((blob) =>
                          downloadBlob(blob, `${detail.name}.zip`)
                        )
                        .catch(() => {
                          /* Displayed by the mutation. */
                        })
                    }}
                  >
                    <DownloadIcon data-icon="inline-start" />
                    {t("skillUpdate.download")}
                  </Button>
                </div>
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-field p-3 text-sm">
                  {detail.files.map((item) => (
                    <li key={item.path} className="font-mono break-all">
                      {item.path}
                    </li>
                  ))}
                </ul>
              </section>
            </FieldGroup>
          </form>
        )}
      </div>
      <DialogFooter className="shrink-0">
        {preview && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setPreview(null)
              confirmMutation.reset()
              setRiskConfirmed(false)
              setDeletionsConfirmed(false)
            }}
          >
            {t("common.back")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={confirmMutation.isPending}
          onClick={onClose}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          aria-busy={pending}
          disabled={
            preview
              ? pending ||
                !riskConfirmed ||
                (preview.skill_update.changes.deleted.length > 0 &&
                  !deletionsConfirmed)
              : !canPreview
          }
          onClick={() => {
            void (preview ? confirmUpdate() : checkUpdate())
          }}
        >
          {pending ? (
            <RefreshCwIcon data-icon="inline-start" className="animate-spin" />
          ) : (
            <EyeIcon data-icon="inline-start" />
          )}
          {t(preview ? "skillUpdate.confirm" : "skillUpdate.check")}
        </Button>
      </DialogFooter>
    </>
  )
}

function SkillUpdatePreview({
  preview,
  riskConfirmed,
  onRiskConfirmed,
  deletionsConfirmed,
  onDeletionsConfirmed,
  disabled,
}: {
  preview: SkillUpdateImportPreview
  riskConfirmed: boolean
  onRiskConfirmed: (value: boolean) => void
  deletionsConfirmed: boolean
  onDeletionsConfirmed: (value: boolean) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const { changes } = preview.skill_update
  return (
    <>
      <h3 className="font-medium">{capabilityDisplayName(preview)}</h3>
      {preview.description && (
        <p className="text-sm break-words text-muted-foreground">
          {preview.description}
        </p>
      )}
      <section
        aria-label={t("skillUpdate.changes")}
        className="flex flex-col gap-3"
      >
        <h3 className="font-medium">{t("skillUpdate.changes")}</h3>
        <p className="text-sm">
          {t("skillUpdate.changeSummary", {
            added: changes.added.length,
            modified: changes.modified.length,
            deleted: changes.deleted.length,
            unchanged: changes.unchanged_count,
          })}
        </p>
        {(["added", "modified", "deleted"] as const).map(
          (kind) =>
            changes[kind].length > 0 && (
              <div key={kind} className="flex flex-col gap-1">
                <h4 className="text-sm font-medium">
                  {t(`skillUpdate.${kind}`)}
                </h4>
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
                  {changes[kind].map((path) => (
                    <li key={path} className="font-mono break-all">
                      {path}
                    </li>
                  ))}
                </ul>
              </div>
            )
        )}
        {changes.deleted.length > 0 && (
          <StatusBanner variant="warning">
            {t("skillUpdate.deleteNotice")}
          </StatusBanner>
        )}
        {changes.deleted.length > 0 && (
          <Label className="flex items-start gap-3">
            <Checkbox
              checked={deletionsConfirmed}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onDeletionsConfirmed(Boolean(checked))
              }
            />
            <span>
              {t("skillUpdate.confirmDeletions", {
                count: changes.deleted.length,
              })}
            </span>
          </Label>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="font-medium">{t("marketplace.riskSummary")}</h3>
        <CapabilityRiskSummary value={preview.risk_summary} />
      </section>
      <SkillContentPreview
        type="skill"
        content={preview.skill_content_preview ?? ""}
        truncated={preview.skill_content_truncated}
      />
      <Label className="flex items-start gap-3">
        <Checkbox
          checked={riskConfirmed}
          disabled={disabled}
          onCheckedChange={(checked) => onRiskConfirmed(Boolean(checked))}
        />
        <span>{t("capability.riskConfirm")}</span>
      </Label>
    </>
  )
}
