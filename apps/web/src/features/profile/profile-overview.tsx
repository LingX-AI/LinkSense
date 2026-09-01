import { BotIcon, CameraIcon, PencilIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { PersonalUsageProfile, User } from "@/api/contracts"
import { CapabilityIcon } from "@/components/capabilities/capability-icon"
import { EmptyState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { ProfileActivityHeatmap } from "@/features/profile/profile-activity-heatmap"
import {
  averageTokensPerTurn,
  usageSharePercentage,
} from "@/features/profile/profile-usage"
import type { SupportedLanguage } from "@/i18n"
import { formatTokenCount } from "@/lib/usage-number"

type ProfileOverviewProps = {
  avatarUploadPending: boolean
  initials: string
  language: SupportedLanguage
  onAvatarUploadRequest: () => void
  onNameEditRequest: () => void
  profileError: string | null
  usage: PersonalUsageProfile | undefined
  usageError: string | null
  usagePending: boolean
  user: User
}

export function ProfileOverview({
  avatarUploadPending,
  initials,
  language,
  onAvatarUploadRequest,
  onNameEditRequest,
  profileError,
  usage,
  usageError,
  usagePending,
  user,
}: ProfileOverviewProps) {
  const { t } = useTranslation()

  return (
    <>
      <header className="profile-hero">
        <div className="profile-hero-avatar-wrap">
          <Avatar className="profile-hero-avatar">
            {user.avatar_url && <AvatarImage src={user.avatar_url} alt="" />}
            <AvatarFallback className="profile-hero-avatar-fallback text-xl font-semibold text-[var(--app-avatar-foreground)]">
              {initials}
            </AvatarFallback>
          </Avatar>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="profile-avatar-upload-button rounded-full"
            aria-label={t("profile.uploadAvatar")}
            onClick={onAvatarUploadRequest}
            disabled={avatarUploadPending}
          >
            {avatarUploadPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CameraIcon data-icon="inline-start" aria-hidden="true" />
            )}
          </Button>
        </div>
        <div className="profile-hero-name-row">
          <h2>{user.name}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="profile-name-edit-button"
            aria-label={t("profile.editName")}
            title={t("profile.editName")}
            onClick={onNameEditRequest}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
        </div>
        <div className="profile-hero-meta">
          <span>{user.email}</span>
          <span aria-hidden="true">·</span>
          <Badge variant="secondary">
            {t(user.role === "admin" ? "common.admin" : "common.user")}
          </Badge>
        </div>
      </header>

      {profileError && (
        <StatusBanner variant="error">{profileError}</StatusBanner>
      )}
      {usageError && <StatusBanner variant="error">{usageError}</StatusBanner>}

      <section
        className="profile-usage-summary"
        aria-labelledby="profile-usage-summary-heading"
      >
        <h2 id="profile-usage-summary-heading" className="sr-only">
          {t("profile.usageSummary")}
        </h2>
        {usagePending && !usage ? (
          <div className="profile-usage-loading" role="status">
            <Spinner />
            <span>{t("profile.loadingUsage")}</span>
          </div>
        ) : usage ? (
          <dl className="profile-stat-strip">
            <ProfileStat
              label={t("profile.totalTokens")}
              value={formatTokenCount(
                usage.metrics.token_usage.total_tokens,
                language
              )}
            />
            <ProfileStat
              label={t("profile.peakDailyTokens")}
              value={formatTokenCount(usage.peak_daily_tokens, language)}
            />
            <ProfileStat
              label={t("profile.totalTasks")}
              value={formatInteger(usage.metrics.task_count, language)}
            />
            <ProfileStat
              label={t("profile.currentStreak")}
              value={t("profile.dayCount", {
                count: usage.current_streak_days,
              })}
            />
            <ProfileStat
              label={t("profile.longestStreak")}
              value={t("profile.dayCount", {
                count: usage.longest_streak_days,
              })}
            />
          </dl>
        ) : null}
      </section>

      {usage && (
        <>
          <section
            className="profile-content-section profile-activity-section"
            aria-labelledby="profile-activity-heading"
          >
            <div className="profile-section-heading">
              <h2 id="profile-activity-heading">
                {t("profile.tokenActivity")}
              </h2>
              <p>{t("profile.tokenActivityDescription")}</p>
            </div>
            <ProfileActivityHeatmap
              activity={usage.daily_activity}
              language={language}
              peakDailyTokens={usage.peak_daily_tokens}
            />
          </section>

          <div className="profile-insight-grid">
            <div className="profile-insight-column">
              <section
                className="profile-content-section"
                aria-labelledby="profile-insights-heading"
              >
                <div className="profile-section-heading">
                  <h2 id="profile-insights-heading">
                    {t("profile.usageInsights")}
                  </h2>
                </div>
                <dl className="profile-insight-list">
                  <ProfileInsight
                    label={t("profile.totalTurns")}
                    value={formatInteger(usage.metrics.turn_count, language)}
                  />
                  <ProfileInsight
                    label={t("profile.modelCalls")}
                    value={formatInteger(usage.metrics.request_count, language)}
                  />
                  <ProfileInsight
                    label={t("profile.skillUses")}
                    value={formatInteger(
                      usage.metrics.skill_usage_count,
                      language
                    )}
                  />
                  <ProfileInsight
                    label={t("profile.activeDays")}
                    value={t("profile.dayCount", {
                      count: usage.active_days,
                    })}
                  />
                  <ProfileInsight
                    label={t("profile.averageTokensPerTurn")}
                    value={formatTokenCount(
                      averageTokensPerTurn(
                        usage.metrics.token_usage.total_tokens,
                        usage.metrics.turn_count
                      ),
                      language
                    )}
                  />
                </dl>
              </section>

              <section
                className="profile-content-section"
                aria-labelledby="profile-skills-heading"
              >
                <div className="profile-section-heading">
                  <h2 id="profile-skills-heading">
                    {t("profile.mostUsedSkills")}
                  </h2>
                </div>
                {usage.skills.length > 0 ? (
                  <ol className="profile-model-list">
                    {usage.skills.slice(0, 5).map((skill) => {
                      return (
                        <li key={skill.skill_id}>
                          <div className="profile-model-row">
                            <span className="profile-model-icon">
                              <CapabilityIcon
                                type="skill"
                                className="profile-skill-icon-image"
                              />
                            </span>
                            <span
                              className="profile-model-name"
                              title={skill.name}
                            >
                              {skill.name}
                            </span>
                            <span className="profile-model-token-count">
                              {t("profile.skillUsageCount", {
                                count: skill.usage_count,
                              })}
                            </span>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <EmptyState title={t("profile.noSkillUsage")} />
                )}
              </section>
            </div>

            <section
              className="profile-content-section"
              aria-labelledby="profile-models-heading"
            >
              <div className="profile-section-heading">
                <h2 id="profile-models-heading">
                  {t("profile.mostUsedModels")}
                </h2>
              </div>
              {usage.models.length > 0 ? (
                <ol className="profile-model-list">
                  {usage.models.slice(0, 5).map((model) => {
                    const modelName = model.display_name ?? model.model_id
                    const share = usageSharePercentage(
                      model.token_usage.total_tokens,
                      usage.metrics.token_usage.total_tokens
                    )
                    return (
                      <li key={`${model.model_kind}:${model.model_id}`}>
                        <div className="profile-model-row">
                          <span className="profile-model-icon">
                            <BotIcon aria-hidden="true" />
                          </span>
                          <span
                            className="profile-model-name"
                            title={modelName}
                          >
                            {modelName}
                          </span>
                          <span className="profile-model-token-count">
                            {formatTokenCount(
                              model.token_usage.total_tokens,
                              language
                            )}
                          </span>
                        </div>
                        <Progress
                          inline
                          value={share}
                          aria-label={t("profile.modelUsageShare", {
                            model: modelName,
                            share,
                          })}
                          className="profile-model-progress"
                        />
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <EmptyState title={t("profile.noModelUsage")} />
              )}
            </section>
          </div>
        </>
      )}
    </>
  )
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ProfileInsight({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function formatInteger(value: number, language: SupportedLanguage) {
  return new Intl.NumberFormat(language).format(value)
}
