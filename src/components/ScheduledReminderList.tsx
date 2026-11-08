import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from './AppText';
import { formatDate } from '@/i18n/numerals';
import { addDays } from '@/domain/dates';
import { prayerNameKey } from '@/domain/prayerNames';
import { spacing, useTheme } from '@/theme';
import { formatTime, type TimeFormatPreference } from '@/utils/formatTime';

import type { PrayerDay } from '@/domain/types';
import type { ScheduledNotification } from '@/services/notifications';

/**
 * The reminders the operating system is actually holding, day by day.
 *
 * ## Why this reads the OS and not our own intent
 *
 * Every competitor's answer to "my adhan did not fire" is "open the app every few days"
 * (our market research). Behind that answer is an app that believes its own bookkeeping: it
 * scheduled the reminders, therefore they exist. They frequently do not — an OEM battery manager
 * purged them, the user revoked the permission, a reboot dropped them.
 *
 * So this list renders `getAllScheduledNotificationsAsync` — the platform's own answer — and
 * nothing else. If the OS says it is holding nothing, the screen says nothing is scheduled, even
 * though we asked for thirty. That honesty is the entire feature; a list that can only ever agree
 * with us would be decoration.
 *
 * Notifications without one of our payloads are dropped rather than shown as unknown rows: the
 * test notification and anything a future version schedules differently are not reminders, and a
 * row we cannot name is not information.
 *
 * Renders no strings of its own beyond `Intl`-formatted dates and times.
 */

/** How many rows to show before collapsing the rest into a count. */
export const DEFAULT_SCHEDULE_LIMIT = 12;

export interface ScheduledReminderListProps {
  /** Straight from `NotificationService.listScheduled()` — the OS's answer, unfiltered. */
  entries: readonly ScheduledNotification[];
  /** The current prayer day, so "today" and "tomorrow" can be named rather than dated. */
  todayDay: PrayerDay;
  timeFormat?: TimeFormatPreference;
  /** Rows shown before the "and N more" line. Defaults to {@link DEFAULT_SCHEDULE_LIMIT}. */
  limit?: number;
  testID?: string;
}

interface ScheduleRow {
  key: string;
  day: PrayerDay;
  at: Date;
  prayer: string;
  kind: string;
}

/** Groups sorted rows under their prayer day, preserving order. */
function groupByDay(rows: readonly ScheduleRow[]): { day: PrayerDay; rows: ScheduleRow[] }[] {
  const out: { day: PrayerDay; rows: ScheduleRow[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last !== undefined && last.day === row.day) last.rows.push(row);
    else out.push({ day: row.day, rows: [row] });
  }
  return out;
}

/**
 * A day-grouped list of what the OS is holding.
 *
 * @param entries - The platform's scheduled notifications.
 * @param todayDay - The current prayer day.
 * @returns The list, or `null` when there is nothing of ours to show — the caller renders the
 * empty state, because "the OS is holding nothing" is a verdict, not a list.
 */
export function ScheduledReminderList({
  entries,
  todayDay,
  timeFormat,
  limit = DEFAULT_SCHEDULE_LIMIT,
  testID,
}: ScheduledReminderListProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();

  const rows = useMemo<ScheduleRow[]>(() => {
    return entries
      .flatMap((entry) => {
        const payload = entry.payload;
        const at = entry.fireAt;
        if (payload === null || at === null || Number.isNaN(at.getTime())) return [];
        return [
          {
            key: payload.key,
            day: payload.day,
            at,
            // Named for the day the OS will fire it on, so a Friday Dhuhr reads as Jumu'ah (D75).
            prayer: t(`prayers.${prayerNameKey(payload.prayer, payload.day)}`),
            kind: t(`settings.reminderHealth.schedule.kind.${payload.kind}`),
          },
        ];
      })
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [entries, t]);

  const shown = rows.slice(0, Math.max(0, limit));
  const hidden = rows.length - shown.length;
  const groups = useMemo(() => groupByDay(shown), [shown]);

  const tomorrow = addDays(todayDay, 1);
  const dayLabel = (day: PrayerDay): string => {
    if (day === todayDay) return t('settings.reminderHealth.schedule.today');
    if (day === tomorrow) return t('settings.reminderHealth.schedule.tomorrow');
    try {
      // `T00:00` keeps the date on the device's own clock; a bare "YYYY-MM-DD" is parsed as UTC
      // and reads as the previous day west of Greenwich.
      return formatDate(new Date(`${day}T00:00:00`), i18n.language, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return day;
    }
  };

  if (rows.length === 0) return null;

  return (
    <View testID={testID} style={{ gap: spacing.md }}>
      {groups.map((group) => (
        <View key={group.day} style={{ gap: spacing.xs }}>
          <AppText variant="caption" weight={600} tone="header" accessibilityRole="header">
            {dayLabel(group.day)}
          </AppText>

          {group.rows.map((row) => {
            const time = formatTime(row.at, { timeFormat, locale: i18n.language });
            return (
              <View
                key={row.key}
                testID={`reminder-health-scheduled-${row.key}`}
                accessible
                accessibilityRole="text"
                accessibilityLabel={t('settings.reminderHealth.schedule.rowA11y', {
                  prayer: row.prayer,
                  kind: row.kind,
                  time,
                })}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  minHeight: 26,
                }}
              >
                <AppText variant="time" weight={600} tone="strong" style={{ minWidth: 68 }}>
                  {time}
                </AppText>
                <AppText variant="caption" tone="ink" style={{ flexShrink: 0 }}>
                  {row.prayer}
                </AppText>
                <AppText
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  style={{ flex: 1, color: colors.muted }}
                >
                  {row.kind}
                </AppText>
              </View>
            );
          })}
        </View>
      ))}

      {hidden > 0 ? (
        <AppText variant="hint" testID="reminder-health-scheduled-more">
          {t('settings.reminderHealth.schedule.more', { count: hidden })}
        </AppText>
      ) : null}
    </View>
  );
}
