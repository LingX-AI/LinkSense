import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  FlaskConicalIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  TagsIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  MAX_PRIVACY_MASKING_PREVIEW_LENGTH,
  MAX_PRIVACY_MASKING_VALUES,
  MAX_PRIVACY_MASKING_WORDS,
  defaultPrivacyMaskingSettings,
  privacyMaskingSettingsSchema,
  type PrivacyMaskingPreviewResponse,
  type PrivacyMaskingSettings,
} from "@linksense/shared";

import { ApiError } from "@/api/client";
import { getErrorMessage } from "@/api/error-message";
import { notify } from "@/components/feedback/notification";
import { StatusBanner } from "@/components/feedback/status-banner";
import {
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSectionHeader } from "@/components/settings/settings-section-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PrivacyMaskingActivityCard } from "@/features/privacy-masking/privacy-masking-activity-card";
import { privacyMaskingKindLabelKeys } from "@/features/privacy-masking/kinds";
import { PrivacyMaskingRules } from "@/features/privacy-masking/privacy-masking-rules";
import { ruleFieldId, type RuleFieldError } from "@/features/privacy-masking/rule-field";
import {
  usePrivacyMaskingPreview,
  usePrivacyMaskingSettings,
  useUpdatePrivacyMaskingSettings,
} from "@/features/privacy-masking/use-privacy-masking";

const placeholderPattern = /\{\{[A-Z][A-Z0-9_]*_[0-9a-f]{16,32}\}\}/gu;
const previewDebounceMs = 300;

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function rejectedRegexId(error: unknown): string | null {
  const id = error instanceof ApiError && error.errorCode === "VALIDATION_ERROR"
    ? error.params?.privacy_masking_rule_id
    : null;
  return typeof id === "string" ? id : null;
}

function PreviewHits({
  hits,
  rules,
}: {
  hits: PrivacyMaskingPreviewResponse["hits"];
  rules: PrivacyMaskingSettings["custom_rules"];
}) {
  const { t } = useTranslation();
  const names = new Map(rules?.map(({ id, name }) => [id, name]));
  const labels = new Map<string, { name: string; action: string; count: number }>();
  for (const hit of hits) {
    const add = (key: string, name: string) => {
      const id = `${key}:${hit.action}`;
      const label = labels.get(id);
      if (label) label.count++;
      else labels.set(id, { name, action: t(`privacyMaskingRules.${hit.action}`), count: 1 });
    };
    const ruleIds = hit.rule_ids ?? [];
    for (const kind of new Set([hit.kind, ...(hit.related_kinds ?? [])])) {
      if (kind !== "TERM" || ruleIds.length === 0) add(kind, t(privacyMaskingKindLabelKeys[kind]));
    }
    for (const id of ruleIds) {
      const name = names.get(id);
      if (name !== undefined) add(id, name);
    }
  }
  return (
    <ul className="flex min-w-0 flex-wrap gap-1.5">
      {[...labels].map(([id, label]) => (
        <li
          key={id}
          className="max-w-full rounded-full border border-border bg-background px-2 py-0.5 text-xs break-words text-muted-foreground"
        >
          {t("privacyMaskingRules.previewHit", label)}
        </li>
      ))}
    </ul>
  );
}

/** Placeholders are the only parts of the preview that are not plain text. */
function MaskedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(placeholderPattern)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push(
      <mark
        key={match.index}
        className="rounded-sm bg-accent px-0.5 text-primary"
      >
        {match[0]}
      </mark>
    );
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-[var(--app-line-20)] text-foreground">
      {parts}
    </pre>
  );
}

export function PrivacyMaskingSettingsPage() {
  const { t } = useTranslation();
  const query = usePrivacyMaskingSettings();
  const mutation = useUpdatePrivacyMaskingSettings();
  const [draft, setDraft] = useState<PrivacyMaskingSettings | null>(null);
  const [wordsText, setWordsText] = useState("");
  const [allowText, setAllowText] = useState("");
  const [tryInput, setTryInput] = useState("");
  const [previewInput, setPreviewInput] = useState<{
    text: string;
    signature: string;
    settings: PrivacyMaskingSettings | null;
  }>({
    text: "",
    signature: "",
    settings: defaultPrivacyMaskingSettings,
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<RuleFieldError | null>(null);
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<"settings" | "activity">("settings");
  const initializedRevision = useRef<number | null>(null);

  useEffect(() => {
    if (!query.data || initializedRevision.current === query.data.revision) {
      return;
    }
    initializedRevision.current = query.data.revision;
    setDraft(query.data.settings);
    setWordsText(query.data.settings.words.join("\n"));
    setAllowText(query.data.settings.allow.join("\n"));
  }, [query.data]);

  const saved = query.data?.settings ?? defaultPrivacyMaskingSettings;
  const current = draft ?? saved;
  const words = parseLines(wordsText);
  const allow = parseLines(allowText);
  const next: PrivacyMaskingSettings = { ...current, words, allow };
  const dirty =
    query.data !== undefined &&
    JSON.stringify(next) !== JSON.stringify(query.data.settings);
  const settingsSignature = JSON.stringify(next);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const parsed = privacyMaskingSettingsSchema.safeParse(JSON.parse(settingsSignature));
      setPreviewInput({
        text: tryInput,
        signature: settingsSignature,
        settings: parsed.success ? parsed.data : null,
      });
    }, previewDebounceMs);
    return () => window.clearTimeout(timer);
  }, [tryInput, settingsSignature]);
  const previewIsCurrent = previewInput.text === tryInput && previewInput.signature === settingsSignature;
  const preview = usePrivacyMaskingPreview(
    previewIsCurrent && previewInput.settings ? previewInput.text : "",
    previewInput.settings ?? defaultPrivacyMaskingSettings
  );

  const update = (patch: Partial<PrivacyMaskingSettings>) => {
    setError(null);
    setFieldError(null);
    setDraft((value) => ({ ...(value ?? saved), ...patch }));
  };

  const focusRuleError = (nextError: RuleFieldError) => {
    setFieldError(nextError);
    requestAnimationFrame(() => document.getElementById(ruleFieldId(nextError.id, nextError.field))?.focus());
  };
  const showSaveError = (message: string) => {
    setError(message);
    requestAnimationFrame(() => saveErrorRef.current?.focus());
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.data || !dirty || mutation.isPending) return;
    setError(null);
    setFieldError(null);
    const parsed = privacyMaskingSettingsSchema.safeParse(next);
    if (!parsed.success) {
      for (const { path: [collection, index, field] } of parsed.error.issues) {
        if (collection !== "custom_rules" || typeof index !== "number") continue;
        const rule = next.custom_rules?.[index];
        if (rule && (field === "name" || field === "prefix" || field === "digits" || field === "pattern")) {
          focusRuleError({ id: rule.id, field, message: t("privacyMaskingRules.invalidField") });
          return;
        }
      }
      showSaveError(t("privacyMaskingRules.invalidSettings"));
      return;
    }
    mutation.mutate(
      { expected_revision: query.data.revision, settings: parsed.data },
      {
        onSuccess: () => {
          notify.success(t("settings.privacyMaskingSaved"), {
            id: "privacy-masking-saved",
          });
        },
        onError: (nextError) => {
          const id = rejectedRegexId(nextError);
          if (id !== null) {
            focusRuleError({ id, field: "pattern", message: t("privacyMaskingRules.invalidRegex") });
          } else {
            showSaveError(getErrorMessage(nextError, t));
          }
        },
      }
    );
  };

  return (
    <form className="settings-page" method="post" noValidate onSubmit={save} aria-labelledby="privacy-masking-title">
      <header className="settings-page-header">
        <h1 id="privacy-masking-title" className="text-pretty">{t("settings.privacyMasking")}</h1>
        <p className="text-pretty">
          {t("settings.privacyMaskingPageDescription")}
        </p>
      </header>

      {error && (
        <div ref={saveErrorRef} tabIndex={-1}>
          <StatusBanner variant="error">{error}</StatusBanner>
        </div>
      )}
      {!error && query.error && (
        <p className="mb-4 text-sm text-destructive">
          {getErrorMessage(query.error, t)}
        </p>
      )}

      {query.isPending ? (
        <div
          className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      ) : (
        <Tabs
          value={section}
          onValueChange={(value) =>
            setSection(value === "activity" ? "activity" : "settings")
          }
        >
          <TabsList aria-label={t("settings.privacyMaskingSections")}>
            <TabsTrigger value="settings">
              {t("settings.privacyMaskingSectionSettings")}
            </TabsTrigger>
            <TabsTrigger value="activity">
              {t("settings.privacyMaskingSectionActivity")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="settings" className="grid min-w-0 gap-8">
          <SettingsCard
            aria-labelledby="privacy-masking-heading"
            layout="split"
            icon={<ShieldCheckIcon />}
            header={
              <SettingsSectionHeader
                id="privacy-masking-heading"
                title={t("settings.privacyMaskingWhatToMask")}
                description={t("settings.privacyMaskingDescription")}
              />
            }
          >
            <SettingsFieldGroup>
              <SettingsFieldRow
                id="privacy-masking-enabled"
                label={t("settings.privacyMaskingEnabled")}
                hint={t("settings.privacyMaskingEnabledDescription")}
                controlWidth="compact"
              >
                <Switch
                  id="privacy-masking-enabled"
                  name="enabled"
                  aria-describedby="privacy-masking-enabled-hint"
                  checked={current.enabled}
                  disabled={!query.data || mutation.isPending}
                  onCheckedChange={(enabled) => update({ enabled })}
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                id="privacy-masking-secrets"
                label={t("settings.privacyMaskingSecrets")}
                hint={t("settings.privacyMaskingSecretsDescription")}
                controlWidth="compact"
              >
                <Switch
                  id="privacy-masking-secrets"
                  name="secrets"
                  checked={current.secrets}
                  disabled={
                    !query.data || !current.enabled || mutation.isPending
                  }
                  onCheckedChange={(secrets) => update({ secrets })}
                />
              </SettingsFieldRow>
            </SettingsFieldGroup>
            <p className="pt-4 text-sm leading-[var(--app-line-22)] text-muted-foreground">
              {t("settings.privacyMaskingBehaviorNote")}
            </p>
          </SettingsCard>

          <SettingsCard
            aria-labelledby="privacy-masking-words-heading"
            layout="split"
            icon={<TagsIcon />}
            header={
              <SettingsSectionHeader
                id="privacy-masking-words-heading"
                title={t("settings.privacyMaskingWords")}
                description={t("settings.privacyMaskingWordsDescription")}
              />
            }
          >
            <SettingsFieldGroup>
              <SettingsFieldRow
                id="privacy-masking-any-case"
                label={t("settings.privacyMaskingAnyCase")}
                hint={t("settings.privacyMaskingAnyCaseDescription")}
                controlWidth="compact"
              >
                <Switch
                  id="privacy-masking-any-case"
                  name="words_any_case"
                  checked={current.words_any_case}
                  disabled={
                    !query.data || !current.enabled || mutation.isPending
                  }
                  onCheckedChange={(wordsAnyCase) =>
                    update({ words_any_case: wordsAnyCase })
                  }
                />
              </SettingsFieldRow>
              <SettingsFieldRow
                id="privacy-masking-whole-word"
                label={t("settings.privacyMaskingWholeWord")}
                hint={t("settings.privacyMaskingWholeWordDescription")}
                controlWidth="compact"
              >
                <Switch
                  id="privacy-masking-whole-word"
                  name="words_whole"
                  checked={current.words_whole}
                  disabled={
                    !query.data || !current.enabled || mutation.isPending
                  }
                  onCheckedChange={(wordsWhole) =>
                    update({ words_whole: wordsWhole })
                  }
                />
              </SettingsFieldRow>
            </SettingsFieldGroup>
            <div className="grid min-w-0 gap-1.5 pt-4">
              <Textarea
                id="privacy-masking-words"
                name="words"
                aria-label={t("settings.privacyMaskingWords")}
                className="min-h-32 resize-y"
                value={wordsText}
                disabled={!query.data || !current.enabled || mutation.isPending}
                placeholder={t("settings.privacyMaskingWordsPlaceholder")}
                onChange={(event) => {
                  setError(null);
                  setWordsText(event.target.value);
                }}
              />
              <span className="text-xs text-muted-foreground">
                {t("settings.privacyMaskingWordsCount", {
                  count: words.length,
                  max: MAX_PRIVACY_MASKING_WORDS,
                })}
              </span>
            </div>
          </SettingsCard>

          <PrivacyMaskingRules
            settings={current}
            disabled={!query.data || mutation.isPending}
            onChange={update}
            fieldError={fieldError}
          />

          <SettingsCard
            aria-labelledby="privacy-masking-allow-heading"
            layout="split"
            icon={<ShieldOffIcon />}
            header={
              <SettingsSectionHeader
                id="privacy-masking-allow-heading"
                title={t("settings.privacyMaskingAllow")}
                description={t("settings.privacyMaskingAllowDescription")}
              />
            }
          >
            <div className="grid min-w-0 gap-1.5">
              <Textarea
                id="privacy-masking-allow"
                name="allow"
                aria-label={t("settings.privacyMaskingAllow")}
                className="min-h-24 resize-y"
                value={allowText}
                disabled={!query.data || !current.enabled || mutation.isPending}
                placeholder={t("settings.privacyMaskingAllowPlaceholder")}
                onChange={(event) => {
                  setError(null);
                  setAllowText(event.target.value);
                }}
              />
              <span className="text-xs text-muted-foreground">
                {t("settings.privacyMaskingWordsCount", {
                  count: allow.length,
                  max: MAX_PRIVACY_MASKING_VALUES,
                })}
              </span>
            </div>
          </SettingsCard>

          <SettingsCard
            aria-labelledby="privacy-masking-try-heading"
            layout="split"
            icon={<FlaskConicalIcon />}
            header={
              <SettingsSectionHeader
                id="privacy-masking-try-heading"
                title={t("settings.privacyMaskingTryIt")}
                description={t("settings.privacyMaskingTryItDescription")}
              />
            }
          >
            <div className="grid min-w-0 gap-3">
              <Textarea
                id="privacy-masking-try"
                name="preview_text"
                aria-label={t("settings.privacyMaskingTryIt")}
                className="min-h-24 resize-y font-mono text-xs"
                value={tryInput}
                maxLength={MAX_PRIVACY_MASKING_PREVIEW_LENGTH}
                disabled={!query.data}
                placeholder={t("settings.privacyMaskingTryItPlaceholder")}
                onChange={(event) => setTryInput(event.target.value)}
              />
              {!current.enabled && (
                <p className="text-xs text-muted-foreground">
                  {t("settings.privacyMaskingTryItOffNote")}
                </p>
              )}
              <div
                className="grid min-w-0 gap-2 rounded-lg border border-border bg-muted/30 p-3"
                aria-live="polite"
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {t("settings.privacyMaskingTryItOutput")}
                </span>
                {tryInput.trim().length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {t("settings.privacyMaskingTryItEmpty")}
                  </span>
                ) : !previewIsCurrent || (previewInput.settings && preview.isPending) ? (
                  <span
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <Spinner />
                    {t("common.loading")}
                  </span>
                ) : !previewInput.settings ? (
                  <span className="text-xs text-muted-foreground">
                    {t("privacyMaskingRules.previewInvalid")}
                  </span>
                ) : preview.error ? (
                  <span className="text-xs text-destructive">
                    {rejectedRegexId(preview.error) !== null
                      ? t("privacyMaskingRules.invalidRegex")
                      : getErrorMessage(preview.error, t)}
                  </span>
                ) : preview.data ? (
                  <>
                    {preview.data.blocked ? (
                      <p className="text-sm font-medium text-destructive">
                        {t("privacyMaskingRules.previewBlocked")}
                      </p>
                    ) : (
                      <MaskedText text={preview.data.text} />
                    )}
                    {preview.data.hits.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("settings.privacyMaskingTryItEmpty")}
                      </span>
                    ) : (
                      <PreviewHits hits={preview.data.hits} rules={previewInput.settings.custom_rules} />
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("settings.privacyMaskingTryItEmpty")}
                  </span>
                )}
              </div>
            </div>
          </SettingsCard>

          </TabsContent>
          <TabsContent value="activity" keepMounted>
            <PrivacyMaskingActivityCard />
          </TabsContent>
        </Tabs>
      )}

      {query.data && section === "settings" && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-7 sm:px-7">
          <Button
            type="submit"
            aria-busy={mutation.isPending || undefined}
            disabled={!dirty || mutation.isPending}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t("settings.privacyMaskingSave")}
          </Button>
        </div>
      )}
    </form>
  );
}
