import { useEffect, useRef, useState, type ReactNode } from "react";
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
  type PrivacyMaskingKind,
  type PrivacyMaskingSettings,
} from "@linksense/shared";

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
import { Textarea } from "@/components/ui/textarea";
import { PrivacyMaskingActivityCard } from "@/features/privacy-masking/privacy-masking-activity-card";
import { privacyMaskingKindLabelKeys } from "@/features/privacy-masking/kinds";
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
  const [previewInput, setPreviewInput] = useState({
    text: "",
    settings: defaultPrivacyMaskingSettings,
  });
  const [error, setError] = useState<string | null>(null);
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
      setPreviewInput({
        text: tryInput,
        settings: JSON.parse(settingsSignature) as PrivacyMaskingSettings,
      });
    }, previewDebounceMs);
    return () => window.clearTimeout(timer);
  }, [tryInput, settingsSignature]);
  const preview = usePrivacyMaskingPreview(
    previewInput.text,
    previewInput.settings
  );

  const update = (patch: Partial<PrivacyMaskingSettings>) => {
    setError(null);
    setDraft((value) => ({ ...(value ?? saved), ...patch }));
  };

  const save = () => {
    if (!query.data) return;
    setError(null);
    mutation.mutate(
      { expected_revision: query.data.revision, settings: next },
      {
        onSuccess: () => {
          notify.success(t("settings.privacyMaskingSaved"), {
            id: "privacy-masking-saved",
          });
        },
        onError: (nextError) => setError(getErrorMessage(nextError, t)),
      }
    );
  };

  const hitsByKind = new Map<PrivacyMaskingKind, number>();
  for (const hit of preview.data?.hits ?? []) {
    hitsByKind.set(hit.kind, (hitsByKind.get(hit.kind) ?? 0) + 1);
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="text-pretty">{t("settings.privacyMasking")}</h1>
        <p className="text-pretty">
          {t("settings.privacyMaskingPageDescription")}
        </p>
      </header>

      {error && <StatusBanner variant="error">{error}</StatusBanner>}
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
        <div className="grid min-w-0 gap-8">
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
                {tryInput.trim().length > 0 && preview.isPending ? (
                  <span
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    role="status"
                  >
                    <Spinner />
                    {t("common.loading")}
                  </span>
                ) : preview.error ? (
                  <span className="text-xs text-destructive">
                    {getErrorMessage(preview.error, t)}
                  </span>
                ) : preview.data ? (
                  <>
                    <MaskedText text={preview.data.text} />
                    {preview.data.hits.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        {t("settings.privacyMaskingTryItEmpty")}
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {[...hitsByKind].map(([kind, count]) => (
                          <span
                            key={kind}
                            className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {t(privacyMaskingKindLabelKeys[kind])} ×{count}
                          </span>
                        ))}
                      </div>
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

          <PrivacyMaskingActivityCard />
        </div>
      )}

      {query.data && (
        <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex items-center justify-end gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-7 sm:px-7">
          <Button
            type="button"
            onClick={save}
            aria-busy={mutation.isPending || undefined}
            disabled={!dirty || mutation.isPending}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {t("settings.privacyMaskingSave")}
          </Button>
        </div>
      )}
    </div>
  );
}
