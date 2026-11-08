import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { Icon } from './Icon';
import { spacing, useTheme } from '@/theme';
import { formatDuration } from '@/utils/formatTime';

import type { AppLocation } from '@/domain/types';

/**
 * The honest label on a known limitation: **prayer times are always written on the device's
 * clock**, even when the location they were computed for keeps a different one.
 *
 * ## Why the app behaves this way (the decision, not just the note)
 *
 * `AppLocation.timeZone` has been carried but unused since M3 (D39).
 * Two honest resolutions existed: render a manually chosen city in *its own* zone, or keep the
 * device clock and say so. This app does the second, deliberately:
 *
 * - The instants are already right either way. `domain/prayerTimes` computes absolute instants
 *   from the *coordinates*; nothing about a display zone changes when Fajr actually is. So the
 *   choice is purely about which clock the same moment is written on.
 * - Rendering a foreign zone would be a **half** change unless the prayer *day* moved with it.
 *   The day boundary lives in `domain/dates` and is a local calendar date; a day that runs on
 *   Jakarta time while the phone, the notifications and the streak roll over on Berlin time is a
 *   worse lie than a labelled one — and `domain/` is frozen this milestone.
 * - A notification fires on the device's clock no matter what the screen says. A screen that
 *   promised "Fajr 05:12" while the phone buzzed at 23:12 would be the reliability complaint the
 *   research puts second in the whole category.
 * - `timeZone` is only populated by the iOS geocoder anyway, so a zone-rendering feature would
 *   silently work on one platform and not the other — and parity is a hard requirement.
 *
 * So: the device clock, always, and this note wherever a difference exists, on both the Location
 * and the Prayer-times screens. It renders **nothing at all** when the two clocks agree, which is
 * the overwhelmingly common case (auto location, or a city in the user's own zone).
 *
 * Presentational only: the caller passes the location and, in tests, the instant.
 */

const MINUTE_MS = 60_000;

/** Degrees of longitude per hour of solar time — the fallback when no IANA zone is known. */
const DEGREES_PER_HOUR = 15;

const MINUTES_PER_HOUR = 60;

/**
 * Smallest difference worth a note when the city's real IANA zone is known. Below one hour the
 * gap is either a half-hour zone the user already knows about or geocoder noise, and a note about
 * it would be pedantry rather than help.
 */
export const MIN_NOTABLE_DIFFERENCE_MINUTES = 60;

/**
 * The same bar for a difference **estimated from longitude**, which is all the Android geocoder
 * leaves us with (it reports no `timezone`).
 *
 * It is three hours rather than one because political time zones routinely sit up to two hours
 * off solar time — Türkiye keeps UTC+3 at a solar UTC+2, Spain keeps CET at a solar UTC+0 — so a
 * one- or two-hour estimated "difference" is at least as likely to be the *user's own city*
 * misjudged as it is to be a real one. Saying "Istanbul runs an hour behind your phone" to
 * someone sitting in Istanbul would damage exactly the credibility this note exists to protect,
 * and a missed note costs nothing: the times shown are correct either way. Only a gap no
 * political offset can explain gets to speak, and even then it is labelled as approximate.
 */
export const MIN_ESTIMATED_DIFFERENCE_MINUTES = 180;

/**
 * The UTC offset of an IANA time zone at a given instant, in minutes east of UTC.
 *
 * Implemented by formatting the instant *in* that zone and reading the wall-clock back as if it
 * were UTC: the difference between the two is the offset, DST included. `timeZoneName` is
 * deliberately not used — `longOffset` is missing from several of the ICU builds React Native
 * ships with, and a silently `undefined` part would read as "no difference".
 *
 * @param timeZone - IANA id, e.g. `"Europe/Istanbul"`.
 * @param at - The instant to measure at (offsets move with DST).
 * @returns Minutes east of UTC (Istanbul → `180`), or `null` when the zone is unknown to the
 * platform or the parts could not be read.
 */
export function zoneOffsetMinutes(timeZone: string, at: Date): number | null {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return null;
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);

    const read: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
    for (const part of parts) {
      if (part.type === 'literal') continue;
      const value = Number(part.value);
      if (Number.isFinite(value)) read[part.type] = value;
    }
    const { year, month, day, hour, minute, second } = read;
    if (
      year === undefined ||
      month === undefined ||
      day === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined
    ) {
      return null;
    }

    // Some ICU builds render midnight as hour 24 under `hour12: false`; `% 24` normalises it.
    const asIfUtc = Date.UTC(year, month - 1, day, hour % 24, minute, second);
    // Seconds are compared, not milliseconds: the formatted wall clock has no sub-second part.
    return Math.round((asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE_MS);
  } catch {
    // An unknown zone id (a stale value, a platform without full tzdata) is not an error here.
    return null;
  }
}

/** How far a location's own clock runs from the device's. */
export interface ClockDifference {
  /** Minutes the location is AHEAD of the device clock; negative means behind. */
  minutes: number;
  /** `true` when read from a real IANA zone, `false` when estimated from longitude. */
  exact: boolean;
}

/**
 * The difference between the location's local clock and the device's, or `null` when there is
 * nothing worth saying.
 *
 * Falls back to solar time (`longitude / 15`) when the location carries no zone id, because the
 * Android geocoder never supplies one — a labelled estimate beats silently showing nothing on
 * half the devices we ship to.
 *
 * @param location - The location prayer times are being computed for.
 * @param at - The instant to measure at; defaults to now.
 * @returns The signed difference and whether it is exact, or `null` below
 * {@link MIN_NOTABLE_DIFFERENCE_MINUTES}.
 */
export function clockDifference(
  location: AppLocation | null | undefined,
  at: Date = new Date()
): ClockDifference | null {
  if (location === null || location === undefined) return null;
  if (!Number.isFinite(location.longitude)) return null;

  const deviceMinutes = -at.getTimezoneOffset();
  const fromZone =
    typeof location.timeZone === 'string' ? zoneOffsetMinutes(location.timeZone, at) : null;
  // The solar estimate is only trusted for a city the user typed. An `auto` fix is *where the
  // device is*, so its local clock is the device clock by definition — and political zones sit up
  // to two hours off solar time (Spain, western China), which would otherwise make the app tell a
  // user sitting at home that their own city keeps a different clock than their own phone.
  if (fromZone === null && location.source !== 'manual') return null;
  const locationMinutes =
    fromZone ?? Math.round(location.longitude / DEGREES_PER_HOUR) * MINUTES_PER_HOUR;

  const exact = fromZone !== null;
  const minutes = locationMinutes - deviceMinutes;
  const threshold = exact ? MIN_NOTABLE_DIFFERENCE_MINUTES : MIN_ESTIMATED_DIFFERENCE_MINUTES;
  if (Math.abs(minutes) < threshold) return null;
  return { minutes, exact };
}

export interface ClockZoneNoteProps {
  /** The location times are computed for. `null` renders nothing. */
  location: AppLocation | null;
  /** Instant to measure the difference at; defaults to now. Injected by tests. */
  at?: Date;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The "shown on your phone's clock" note.
 *
 * @param location - The location prayer times are computed for.
 * @returns A quiet paper card explaining the difference, or `null` when the clocks agree.
 */
export function ClockZoneNote({
  location,
  at,
  style,
  testID = 'clock-zone-note',
}: ClockZoneNoteProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  // `at` defaults inside the memo so the component does not read the clock on every render.
  const difference = useMemo(() => clockDifference(location, at ?? new Date()), [location, at]);
  if (location === null || difference === null) return null;

  const offset = formatDuration(Math.abs(difference.minutes) * MINUTE_MS, { countdown: false });
  const body = t(
    difference.minutes > 0 ? 'settings.location.clock.ahead' : 'settings.location.clock.behind',
    { city: location.label, offset }
  );

  return (
    <Card
      testID={testID}
      variant="quiet"
      border="mid"
      style={[
        { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'flex-start' },
        style,
      ]}
    >
      <Icon name="schedule" size={19} variant="outlined" color={colors.header} />
      <View accessible accessibilityRole="text" style={{ flex: 1, gap: 3 }}>
        <AppText variant="rowName">{t('settings.location.clock.title')}</AppText>
        <AppText variant="caption" tone="header">
          {body}
        </AppText>
        {difference.exact ? null : (
          <AppText variant="hint">{t('settings.location.clock.estimated')}</AppText>
        )}
      </View>
    </Card>
  );
}
