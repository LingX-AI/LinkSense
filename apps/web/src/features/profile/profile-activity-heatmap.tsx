import {
  cloneElement,
  isValidElement,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type SVGProps,
  useMemo,
  useRef,
  useState,
} from "react"
import CalendarHeatmap from "react-calendar-heatmap"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"

import type { PersonalUsageProfile } from "@/api/contracts"
import { EmptyState } from "@/components/feedback/page-state"
import { activityLevel } from "@/features/profile/profile-usage"
import { calendarMonthLabels, formatCalendarDate } from "@/i18n/date"
import type { SupportedLanguage } from "@/i18n"
import { cn } from "@/lib/utils"
import { formatTokenCount } from "@/lib/usage-number"

type ProfileActivityHeatmapProps = {
  activity: PersonalUsageProfile["daily_activity"]
  language: SupportedLanguage
  peakDailyTokens: string
}

type HeatmapValue = {
  date: Date
  iso_date: string
  total_tokens: string
}

type HeatmapTooltipStyle = CSSProperties & {
  "--profile-activity-tooltip-x": string
  "--profile-activity-tooltip-y": string
}

type HeatmapTooltipState = {
  label: string
  style: HeatmapTooltipStyle
}

const activityLevelClassNames = [
  "profile-activity-level-0",
  "profile-activity-level-1",
  "profile-activity-level-2",
  "profile-activity-level-3",
  "profile-activity-level-4",
] as const
const activityLevels = [0, 1, 2, 3, 4] as const
const tooltipHorizontalPadding = 132
const tooltipVerticalOffset = 42

export function ProfileActivityHeatmap({
  activity,
  language,
  peakDailyTokens,
}: ProfileActivityHeatmapProps) {
  const { t } = useTranslation()
  const heatmapShellRef = useRef<HTMLDivElement | null>(null)
  const [tooltip, setTooltip] = useState<HeatmapTooltipState | null>(null)
  const values = useMemo<HeatmapValue[]>(
    () =>
      activity.map((point) => ({
        date: dayjs(point.date).startOf("day").toDate(),
        iso_date: point.date,
        total_tokens: point.total_tokens,
      })),
    [activity]
  )
  const monthLabels = useMemo(() => calendarMonthLabels(language), [language])

  if (values.length === 0) {
    return <EmptyState title={t("profile.activityUnavailable")} />
  }

  const accessibleLabel = (value: HeatmapValue) =>
    t("profile.activityDayLabel", {
      date: formatCalendarDate(value.iso_date, language),
      tokens: formatTokenCount(value.total_tokens, language),
    })

  const tooltipLabel = (value: HeatmapValue) =>
    t("profile.activityTooltip", {
      date: formatTooltipDate(value.iso_date, language),
      tokens: formatTokenCount(value.total_tokens, language),
    })

  const showTooltip = (
    event: MouseEvent<SVGRectElement> | FocusEvent<SVGRectElement>,
    value:
      | {
          date: string | number | Date
          iso_date?: unknown
          total_tokens?: unknown
        }
      | undefined
  ) => {
    const typedValue = heatmapValue(value)
    const shell = heatmapShellRef.current
    if (!typedValue || !shell) {
      setTooltip(null)
      return
    }

    const targetRect = event.currentTarget.getBoundingClientRect()
    const shellRect = shell.getBoundingClientRect()
    const centerX = targetRect.left - shellRect.left + targetRect.width / 2
    const tooltipX = clamp(
      centerX,
      tooltipHorizontalPadding,
      Math.max(
        tooltipHorizontalPadding,
        shellRect.width - tooltipHorizontalPadding
      )
    )
    const tooltipY = targetRect.top - shellRect.top - tooltipVerticalOffset

    setTooltip({
      label: tooltipLabel(typedValue),
      style: {
        "--profile-activity-tooltip-x": `${tooltipX}px`,
        "--profile-activity-tooltip-y": `${tooltipY}px`,
      },
    })
  }

  const hideTooltip = () => {
    setTooltip(null)
  }

  return (
    <>
      <div ref={heatmapShellRef} className="profile-activity-heatmap-shell">
        <div
          className="profile-activity-heatmap"
          role="group"
          aria-label={t("profile.activityChartLabel")}
        >
          <CalendarHeatmap
            startDate={values[0]?.date}
            endDate={values.at(-1)?.date}
            values={values}
            gutterSize={3}
            monthLabels={monthLabels}
            showMonthLabels
            showOutOfRangeDays
            classForValue={(value) =>
              activityLevelClassNames[
                activityLevel(
                  typeof value?.total_tokens === "string"
                    ? value.total_tokens
                    : "0",
                  peakDailyTokens
                )
              ]
            }
            onMouseOver={showTooltip}
            onMouseLeave={hideTooltip}
            transformDayElement={(element, value) => {
              if (!isValidElement(element)) return null
              const rectElement = element as ReactElement<
                SVGProps<SVGRectElement>
              >
              return cloneElement(rectElement, {
                onFocus: (event: FocusEvent<SVGRectElement>) =>
                  showTooltip(event, value),
                onBlur: hideTooltip,
              })
            }}
            tooltipDataAttrs={(value) => {
              const typedValue = heatmapValue(value)
              return typedValue
                ? {
                    "aria-label": accessibleLabel(typedValue),
                    role: "img",
                    tabIndex: 0,
                  }
                : { "aria-hidden": true }
            }}
          />
        </div>
        {tooltip ? (
          <div
            className="profile-activity-tooltip"
            role="tooltip"
            style={tooltip.style}
          >
            {tooltip.label}
          </div>
        ) : null}
      </div>
      <div className="profile-activity-legend" aria-hidden="true">
        <span>{t("profile.activityLess")}</span>
        {activityLevels.map((level) => (
          <span
            key={level}
            className={cn(
              "profile-activity-legend-cell",
              activityLevelClassNames[level]
            )}
          />
        ))}
        <span>{t("profile.activityMore")}</span>
      </div>
    </>
  )
}

function formatTooltipDate(value: string, language: SupportedLanguage): string {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  return parsed
    .locale(language === "zh-CN" ? "zh-cn" : "en")
    .format(language === "zh-CN" ? "M月D日" : "MMM D")
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function heatmapValue(
  value:
    | {
        date: string | number | Date
        iso_date?: unknown
        total_tokens?: unknown
      }
    | undefined
): HeatmapValue | null {
  if (
    !(value?.date instanceof Date) ||
    typeof value.iso_date !== "string" ||
    typeof value.total_tokens !== "string"
  ) {
    return null
  }
  return {
    date: value.date,
    iso_date: value.iso_date,
    total_tokens: value.total_tokens,
  }
}
