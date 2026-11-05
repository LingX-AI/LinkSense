import { useId, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  publicKnowledgeSettingsSchema,
  publicKnowledgeConcurrencyLimit,
  type PublicKnowledgeSettings,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import {
  capabilitySummarySchema,
  modelPreferenceSchema,
  paginatedSchema,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { useKnowledgeBaseList } from "@/features/knowledge-bases/knowledge-base-hooks"
import { ResourceMultiSelect } from "@/features/applications/application-resource-multi-select"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBanner } from "@/components/feedback/status-banner"
import { savePublicKnowledge } from "./api"

export function PublicKnowledgeSettingsForm({
  initial,
  applicationId,
  onSaved,
}: {
  initial?: PublicKnowledgeSettings
  applicationId?: string
  onSaved: (
    result: Awaited<ReturnType<typeof savePublicKnowledge>>
  ) => void | Promise<void>
}) {
  const { t } = useTranslation(),
    id = useId()
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    instructions:
      initial?.instructions ?? t("publicKnowledge.defaultInstructions"),
    model: initial?.model ?? "",
    reasoning_effort: initial?.reasoning_effort ?? "medium",
    knowledge_base_ids: initial?.knowledge_base_ids ?? [],
    skill_ids: initial?.skill_ids ?? [],
    origins: initial?.allowed_origins.join("\n") ?? "",
    max_concurrent_turns:
      initial?.max_concurrent_turns ?? publicKnowledgeConcurrencyLimit,
    session_ttl_hours: initial?.session_ttl_hours ?? 24,
    retention_days: initial?.retention_days ?? 30,
    enabled: initial?.enabled ?? true,
    show_references: initial?.show_references ?? true,
  })
  const [invalid, setInvalid] = useState(false)
  const models = useQuery({
    queryKey: ["me", "model-preference", "public-knowledge"],
    queryFn: ({ signal }) =>
      apiRequest("/me/model-preference", {
        schema: modelPreferenceSchema,
        signal,
      }),
  })
  const knowledge = useKnowledgeBaseList({
    lifecycle: "active",
    scope: "owned",
    search: "",
  })
  const capabilities = useQuery({
    queryKey: ["capabilities", "managed", "application-editor"],
    queryFn: ({ signal }) =>
      apiRequest("/capabilities", {
        query: { view: "managed" },
        schema: paginatedSchema(capabilitySummarySchema),
        signal,
      }),
  })
  const save = useMutation({
    mutationFn: (settings: PublicKnowledgeSettings) =>
      savePublicKnowledge(settings, applicationId),
    onSuccess: onSaved,
  })
  const installedSkills = (capabilities.data?.items ?? []).filter(
    (capability) => capability.type === "skill" && !capability.is_builtin
  )
  const installedSkillIds = new Set(installedSkills.map((skill) => skill.id))
  const skillItems = [
    ...installedSkills.map((skill) => ({
      id: skill.id,
      label: skill.name,
      detail: skill.description ?? "",
      detailInline: false,
      disabled: !skill.can_select,
    })),
    ...(capabilities.data ? form.skill_ids : [])
      .filter((skillId) => !installedSkillIds.has(skillId))
      .map((skillId) => ({
        id: skillId,
        label: t("applications.dependencyUnavailableShort"),
        detail: "",
        detailInline: false,
        disabled: true,
      })),
  ]
  const modelItems = (models.data?.models ?? []).map((model) => ({
    value: model.id,
    label: model.display_name,
  }))
  const selectedModel = models.data?.models.find(
    (model) => model.id === form.model
  )
  const efforts = (selectedModel?.supported_reasoning_efforts ?? []).map(
    (value) => ({ value, label: t(`reasoningEffort.${value}`) })
  )
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (save.isPending) return
        const { origins, ...values } = form
        const parsed = publicKnowledgeSettingsSchema.safeParse({
          ...values,
          description: values.description || null,
          allowed_origins: origins
            .split(/\r?\n/u)
            .map((value) => value.trim())
            .filter(Boolean),
        })
        setInvalid(!parsed.success)
        if (parsed.success) save.mutate(parsed.data)
      }}
    >
      <FieldGroup className="grid grid-cols-1 items-start md:grid-cols-2">
        <Field data-invalid={invalid && !form.name}>
          <FieldLabel htmlFor={`${id}-name`} required>
            {t("publicKnowledge.name")}
          </FieldLabel>
          <Input
            id={`${id}-name`}
            required
            maxLength={160}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-description`}>
            {t("publicKnowledge.descriptionLabel")}
          </FieldLabel>
          <Textarea
            id={`${id}-description`}
            maxLength={4000}
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={`${id}-instructions`} required>
            {t("publicKnowledge.instructions")}
          </FieldLabel>
          <Textarea
            id={`${id}-instructions`}
            className="min-h-28"
            required
            maxLength={20000}
            value={form.instructions}
            onChange={(event) =>
              setForm({ ...form, instructions: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-model`} required>
            {t("publicKnowledge.model")}
          </FieldLabel>
          <Select
            items={modelItems}
            value={form.model}
            onValueChange={(value) => {
              const model = models.data?.models.find(
                (item) => item.id === value
              )
              setForm({
                ...form,
                model: value ?? "",
                reasoning_effort: model?.default_reasoning_effort ?? "medium",
              })
            }}
          >
            <SelectTrigger
              id={`${id}-model`}
              aria-label={t("publicKnowledge.model")}
            >
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {modelItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-effort`}>
            {t("publicKnowledge.reasoning")}
          </FieldLabel>
          <Select
            items={efforts}
            value={form.reasoning_effort}
            disabled={!selectedModel}
            onValueChange={(value) => {
              const effort = selectedModel?.supported_reasoning_efforts.find(
                (item) => item === value
              )
              if (effort) setForm({ ...form, reasoning_effort: effort })
            }}
          >
            <SelectTrigger
              id={`${id}-effort`}
              aria-label={t("publicKnowledge.reasoning")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {efforts.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <ResourceMultiSelect
          id={`${id}-skills`}
          title={t("applications.skills")}
          description={t("publicKnowledge.skillsHelp")}
          items={skillItems}
          selectedIds={form.skill_ids}
          onChange={(skill_ids) => setForm({ ...form, skill_ids })}
          emptyLabel={t("applications.noSkills")}
          placeholder={t("applications.skillSelectPlaceholder")}
          searchPlaceholder={t("applications.skillSearchPlaceholder")}
          loading={capabilities.isPending}
        />
        <ResourceMultiSelect
          id={`${id}-knowledge`}
          title={t("publicKnowledge.knowledge")}
          description={t("publicKnowledge.knowledgeHelp")}
          items={(
            knowledge.data?.pages.flatMap((page) => page.items) ?? []
          ).map((base) => ({
            id: base.id,
            label: base.name,
            detail: "",
            detailInline: false,
            disabled: base.availability_status !== "enabled",
          }))}
          selectedIds={form.knowledge_base_ids}
          onChange={(knowledge_base_ids) =>
            setForm({ ...form, knowledge_base_ids })
          }
          emptyLabel={t("publicKnowledge.empty")}
          placeholder={t("common.select")}
          searchPlaceholder={t("common.search")}
          loading={knowledge.isPending}
          loadingMore={knowledge.isFetchingNextPage}
          onLoadMore={
            knowledge.hasNextPage
              ? () => void knowledge.fetchNextPage()
              : undefined
          }
        />
        <Field className="md:col-span-2">
          <FieldLabel htmlFor={`${id}-origins`} required>
            {t("publicKnowledge.origins")}
          </FieldLabel>
          <Textarea
            id={`${id}-origins`}
            required
            value={form.origins}
            onChange={(event) =>
              setForm({ ...form, origins: event.target.value })
            }
          />
          <FieldDescription>
            {t("publicKnowledge.originsHelp")}
          </FieldDescription>
        </Field>
        {(
          [
            {
              key: "max_concurrent_turns",
              label: "concurrency",
              min: 1,
              max: publicKnowledgeConcurrencyLimit,
            },
            {
              key: "session_ttl_hours",
              label: "sessionHours",
              min: 1,
              max: 168,
            },
            { key: "retention_days", label: "retention", min: 1, max: 365 },
          ] as const
        ).map((item) => (
          <Field key={item.key}>
            <FieldLabel htmlFor={`${id}-${item.key}`}>
              {t(`publicKnowledge.${item.label}`)}
            </FieldLabel>
            <Input
              id={`${id}-${item.key}`}
              type="number"
              min={item.min}
              max={item.max}
              required
              value={form[item.key]}
              onChange={(event) =>
                setForm({ ...form, [item.key]: event.target.valueAsNumber })
              }
            />
            {item.key === "max_concurrent_turns" && (
              <FieldDescription>
                {t("publicKnowledge.concurrencyHelp")}
              </FieldDescription>
            )}
          </Field>
        ))}
        <Field orientation="horizontal" className="self-end">
          <Switch
            id={`${id}-enabled`}
            checked={form.enabled}
            onCheckedChange={(enabled) => setForm({ ...form, enabled })}
          />
          <FieldLabel htmlFor={`${id}-enabled`}>
            {t("publicKnowledge.enabled")}
          </FieldLabel>
        </Field>
        <Field orientation="horizontal" className="md:col-span-2">
          <Switch
            id={`${id}-show-references`}
            checked={form.show_references}
            onCheckedChange={(show_references) =>
              setForm({ ...form, show_references })
            }
          />
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`${id}-show-references`}>
              {t("publicKnowledge.showReferences")}
            </FieldLabel>
            <FieldDescription>
              {t("publicKnowledge.showReferencesHelp")}
            </FieldDescription>
          </div>
        </Field>
        {invalid && (
          <StatusBanner variant="error" className="md:col-span-2">
            {t("publicKnowledge.invalid")}
          </StatusBanner>
        )}
        {(save.error ||
          models.error ||
          knowledge.error ||
          capabilities.error) && (
          <StatusBanner variant="error" className="md:col-span-2">
            {getErrorMessage(
              save.error ??
                models.error ??
                knowledge.error ??
                capabilities.error,
              t
            )}
          </StatusBanner>
        )}
        <Button
          type="submit"
          className="md:col-span-2"
          disabled={
            save.isPending ||
            models.isPending ||
            knowledge.isPending ||
            capabilities.isPending ||
            Boolean(models.error || knowledge.error || capabilities.error)
          }
        >
          {save.isPending && <Spinner data-icon="inline-start" />}
          {t("publicKnowledge.publish")}
        </Button>
      </FieldGroup>
    </form>
  )
}
