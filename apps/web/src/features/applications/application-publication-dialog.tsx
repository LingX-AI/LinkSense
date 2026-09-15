import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  applicationPublicationSchema,
  applicationSchema,
  copyApplicationInputSchema,
  publishApplicationInputSchema,
  type Application,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"

export function ApplicationPublicationDialog({
  application,
  onClose,
  onCopied,
}: {
  application: Application
  onClose: () => void
  onCopied: (application: Application) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [guide, setGuide] = useState<string | null>(null)
  const [allowCopy, setAllowCopy] = useState<boolean | null>(null)
  const [copyName, setCopyName] = useState(application.name)
  const queryKey = ["applications", application.id, "publication"] as const
  const publication = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      apiRequest(`/applications/${application.id}/publication`, {
        schema: applicationPublicationSchema,
        signal,
      }),
  })
  const instructions = guide ?? publication.data?.usage_instructions ?? ""
  const copiesAllowed = allowCopy ?? publication.data?.allow_copy ?? false
  const publishInput = publishApplicationInputSchema.safeParse({
    usage_instructions: instructions,
    allow_copy: copiesAllowed,
  })
  const publish = useMutation({
    mutationFn: () =>
      apiRequest(`/applications/${application.id}/publish`, {
        method: "POST",
        body: publishApplicationInputSchema.parse({
          usage_instructions: instructions,
          allow_copy: copiesAllowed,
        }),
        schema: applicationPublicationSchema,
      }),
    onSuccess: async (result) => {
      client.setQueryData(queryKey, result)
      await client.invalidateQueries({ queryKey: ["applications"] })
    },
  })
  const copy = useMutation({
    mutationFn: () =>
      apiRequest(`/applications/${application.id}/copy`, {
        method: "POST",
        body: copyApplicationInputSchema.parse({ name: copyName }),
        schema: applicationSchema,
      }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["applications"] })
      await client.invalidateQueries({ queryKey: ["capabilities"] })
      onCopied(result)
    },
  })
  const busy = publish.isPending || copy.isPending
  const error = publication.error ?? publish.error ?? copy.error
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("applications.publication.title")}</DialogTitle>
          <DialogDescription>
            {t("applications.publication.description")}
          </DialogDescription>
        </DialogHeader>
        {publication.isPending && <p role="status">{t("common.loading")}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {getErrorMessage(error, t)}
          </p>
        )}
        {publication.data && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              {publication.data.version_number
                ? t("applications.publication.version", {
                    version: publication.data.version_number,
                  })
                : t("applications.publication.unpublished")}
            </p>
            {application.is_owner ? (
              <>
                <Field>
                  <FieldLabel htmlFor="application-usage-guide">
                    {t("applications.publication.guide")}
                  </FieldLabel>
                  <Textarea
                    id="application-usage-guide"
                    className="min-h-32"
                    maxLength={20000}
                    value={instructions}
                    onChange={(event) => setGuide(event.target.value)}
                    disabled={busy}
                  />
                </Field>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <FieldLabel
                      htmlFor="application-allow-copy"
                      className="text-sm font-medium"
                    >
                      {t("applications.publication.allowCopy")}
                    </FieldLabel>
                    <p
                      className="mt-1 text-sm text-muted-foreground"
                      id="application-allow-copy-description"
                    >
                      {t("applications.publication.allowCopyDescription")}
                    </p>
                  </div>
                  <Switch
                    id="application-allow-copy"
                    aria-describedby="application-allow-copy-description"
                    checked={copiesAllowed}
                    onCheckedChange={setAllowCopy}
                    disabled={busy}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("applications.publication.fixedVersion")}
                </p>
              </>
            ) : (
              <section
                aria-label={t("applications.publication.guide")}
                className="text-sm break-words whitespace-pre-wrap"
              >
                {publication.data.usage_instructions ||
                  t("applications.publication.noGuide")}
              </section>
            )}
            {publication.data.version_id &&
              (publication.data.allow_copy || application.is_owner) && (
                <section className="space-y-3 border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    {t("applications.publication.copyDescription")}
                  </p>
                  <Field>
                    <FieldLabel htmlFor="application-copy-name">
                      {t("applications.publication.copyName")}
                    </FieldLabel>
                    <Input
                      id="application-copy-name"
                      value={copyName}
                      maxLength={160}
                      onChange={(event) => setCopyName(event.target.value)}
                      disabled={busy}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    disabled={
                      busy ||
                      !copyApplicationInputSchema.safeParse({ name: copyName })
                        .success
                    }
                    onClick={() => copy.mutate()}
                  >
                    {t("applications.publication.copy")}
                  </Button>
                </section>
              )}
            {publish.isSuccess && (
              <p role="status" className="text-sm">
                {t("applications.publication.published")}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("common.close")}
          </Button>
          {application.is_owner && (
            <Button
              disabled={
                busy ||
                !publication.data ||
                !publishInput.success ||
                application.status !== "active"
              }
              onClick={() => publish.mutate()}
            >
              {t("applications.publication.publish")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
