import { ActivityIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { PrivacyMaskingKind } from "@linksense/shared"

import { getErrorMessage } from "@/api/error-message"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { privacyMaskingKindLabelKeys } from "@/features/privacy-masking/kinds"
import { usePrivacyMaskingActivity } from "@/features/privacy-masking/use-privacy-masking-activity"

function formatWhen(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

export function PrivacyMaskingActivityCard() {
  const { t, i18n } = useTranslation()
  const [days, setDays] = useState<7 | 30>(7)
  const query = usePrivacyMaskingActivity(days)
  const summary = query.data?.pages[0]?.summary
  const records = query.data?.pages.flatMap((page) => page.records) ?? []
  const numberFormat = new Intl.NumberFormat(i18n.language)

  return (
    <SettingsCard
      aria-labelledby="privacy-masking-activity-heading"
      layout="split"
      icon={<ActivityIcon />}
      header={
        <SettingsSectionHeader
          id="privacy-masking-activity-heading"
          title={t("settings.privacyMaskingActivity")}
          description={t("settings.privacyMaskingActivityDescription")}
        />
      }
    >
      <div className="grid min-w-0 gap-4">
        <Tabs
          value={String(days)}
          onValueChange={(value) => setDays(value === "30" ? 30 : 7)}
        >
          <TabsList aria-label={t("settings.privacyMaskingActivityPeriod")}>
            <TabsTrigger value="7">
              {t("settings.privacyMaskingActivity7Days")}
            </TabsTrigger>
            <TabsTrigger value="30">
              {t("settings.privacyMaskingActivity30Days")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {summary && (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="text-4xl font-extralight leading-none tracking-tight tabular-nums">
                {numberFormat.format(summary.masked_count)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("settings.privacyMaskingActivityMasked")}
              </div>
            </div>
            <div>
              <div className="text-lg font-light leading-tight tabular-nums">
                {numberFormat.format(summary.request_count)}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("settings.privacyMaskingActivityRequests")}
              </div>
            </div>
          </div>
        )}

        {query.isPending ? (
          <div
            className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner />
            <span>{t("common.loading")}</span>
          </div>
        ) : query.error ? (
          <p className="text-sm text-destructive">
            {getErrorMessage(query.error, t)}
          </p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("settings.privacyMaskingActivityEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {records.map((record) => (
              <li
                key={record.id}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              >
                <time
                  dateTime={record.created_at}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {formatWhen(record.created_at, i18n.language)}
                </time>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {record.model}
                </span>
                <span className="flex flex-wrap gap-1">
                  {Object.entries(record.kinds)
                    .sort((left, right) => right[1] - left[1])
                    .map(([kind, count]) => (
                      <span
                        key={kind}
                        className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {t(
                          privacyMaskingKindLabelKeys[
                            kind as PrivacyMaskingKind
                          ] ?? kind
                        )}{" "}
                        ×{count}
                      </span>
                    ))}
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  ×{record.masked_count}
                </span>
              </li>
            ))}
          </ul>
        )}

        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage && <Spinner data-icon="inline-start" />}
              {t("settings.privacyMaskingActivityLoadMore")}
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
