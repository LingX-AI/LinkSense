import { useEffect, useRef, useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  MAX_PRIVACY_MASKING_WORDS,
  defaultPrivacyMaskingSettings,
  type PrivacyMaskingSettings,
} from "@linksense/shared";

import { getErrorMessage } from "@/api/error-message";
import { notify } from "@/components/feedback/notification";
import { StatusBanner } from "@/components/feedback/status-banner";
import {
  FieldShell,
  SettingsFieldGroup,
  SettingsFieldRow,
} from "@/components/forms/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSectionHeader } from "@/components/settings/settings-section-header";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  usePrivacyMaskingSettings,
  useUpdatePrivacyMaskingSettings,
} from "@/features/privacy-masking/use-privacy-masking";

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function PrivacyMaskingSettingsCard() {
  const { t } = useTranslation();
  const query = usePrivacyMaskingSettings();
  const mutation = useUpdatePrivacyMaskingSettings();
  const [draft, setDraft] = useState<PrivacyMaskingSettings | null>(null);
  const [wordsText, setWordsText] = useState("");
  const [allowText, setAllowText] = useState("");
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

  return (
    <SettingsCard
      aria-labelledby="privacy-masking-heading"
      layout="split"
      icon={<ShieldCheckIcon />}
      header={
        <SettingsSectionHeader
          id="privacy-masking-heading"
          title={t("settings.privacyMasking")}
          description={t("settings.privacyMaskingDescription")}
        />
      }
    >
      {query.isPending ? (
        <div
          className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner />
          <span>{t("common.loading")}</span>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5">
          {error && <StatusBanner variant="error">{error}</StatusBanner>}
          {!error && query.error && (
            <p className="text-sm text-destructive">
              {getErrorMessage(query.error, t)}
            </p>
          )}
          <p className="text-sm leading-[var(--app-line-22)] text-muted-foreground">
            {t("settings.privacyMaskingEnabledDescription")}
          </p>
          <SettingsFieldGroup>
            <SettingsFieldRow
              id="privacy-masking-enabled"
              label={t("settings.privacyMaskingEnabled")}
              hint={t("settings.privacyMaskingBehaviorNote")}
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
                disabled={!query.data || !current.enabled || mutation.isPending}
                onCheckedChange={(secrets) => update({ secrets })}
              />
            </SettingsFieldRow>
            <SettingsFieldRow
              id="privacy-masking-any-case"
              label={t("settings.privacyMaskingAnyCase")}
              hint={t("settings.privacyMaskingAnyCaseDescription")}
              controlWidth="compact"
            >
              <Switch
                id="privacy-masking-any-case"
                checked={current.words_any_case}
                disabled={!query.data || !current.enabled || mutation.isPending}
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
                disabled={!query.data || !current.enabled || mutation.isPending}
                onCheckedChange={(wordsWhole) =>
                  update({ words_whole: wordsWhole })
                }
              />
            </SettingsFieldRow>
          </SettingsFieldGroup>

          <FieldShell
            id="privacy-masking-words"
            layout="settings"
            multiline
            label={t("settings.privacyMaskingWords")}
            hint={t("settings.privacyMaskingWordsDescription")}
          >
            <Textarea
              id="privacy-masking-words"
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
          </FieldShell>

          <FieldShell
            id="privacy-masking-allow"
            layout="settings"
            multiline
            label={t("settings.privacyMaskingAllow")}
            hint={t("settings.privacyMaskingAllowDescription")}
          >
            <Textarea
              id="privacy-masking-allow"
              className="min-h-24 resize-y"
              value={allowText}
              disabled={!query.data || !current.enabled || mutation.isPending}
              placeholder={t("settings.privacyMaskingAllowPlaceholder")}
              onChange={(event) => {
                setError(null);
                setAllowText(event.target.value);
              }}
            />
          </FieldShell>

          <div className="flex justify-end">
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
        </div>
      )}
    </SettingsCard>
  );
}
