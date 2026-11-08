import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { SettingStepperRow } from './SettingStepperRow';
import { SheetAction, SheetShell, formatDayChoice } from './SheetKit';
import { addDays } from '@/domain/dates';
import { spacing } from '@/theme';

import type { PrayerDay } from '@/domain/types';

/**
 * The sheet that turns travel mode on: what the concession is, and how long the journey lasts.
 *
 * ## Why the explanation lives here, and nowhere else
 *
 * Travel mode has **no Settings presence at all**. It is not a preference — it is a state somebody
 * is in for a few days — and a switch in Settings would be a second place to forget it was on. So
 * this sheet, which somebody reaches by tapping "I'm travelling", is the one place the rule is
 * stated: the moment they asked is the moment the explanation is wanted, which is how every layered
 * option in this app works. One caption, no reading, no links, no madhhab.
 *
 * The note says only what is settled: Dhuhr, Asr and Isha are prayed as two rak'ahs; Dhuhr may be
 * prayed with Asr and Maghrib with Isha; times do not change; mark them as usual. What it does not
 * say is who counts as a traveller — the schools disagree, a phone cannot know, and the honest
 * answer is that the person tapping already knows better than the app does.
 *
 * ## The duration, and why it is a count and never a date
 *
 * "Until I end it" leads, because someone who does not want to think about it should not have to.
 * The presets exist for the owner's own case — a trip you already know the length of — and the day
 * count covers the rest. A number of days rather than a calendar for the reason `SheetKit` gives:
 * this app never offers a picker for the future. Counts are **inclusive of the first day**, and each
 * option names the day it ends on so that arithmetic is visible rather than assumed.
 *
 * Because a day here is a prayer day (Fajr→next Fajr), travel lapses at the Fajr after the last
 * day — the boundary a traveller would recognise, for free.
 */

/** Journey lengths offered as one tap each. Anything else is the day count below them. */
const DURATION_PRESETS = [3, 7] as const;

/** Bounds and starting point of the custom day count. */
const MIN_TRAVEL_DAYS = 1;
const MAX_TRAVEL_DAYS = 90;
const DEFAULT_TRAVEL_DAYS = 5;

export interface BeginTravelSheetProps {
  visible: boolean;
  /** The current prayer day — the first travel day, and the base for every duration. */
  today: PrayerDay;
  /**
   * Travel was begun. `lastDay` is the last travel day, or `null` for "until I end it" — the
   * caller runs `startTravel` and closes the sheet.
   */
  onBegin: (lastDay: PrayerDay | null) => void;
  /** Dismissed without choosing ("Not now", backdrop, drag, Android back). */
  onClose: () => void;
  testID?: string;
}

/**
 * The begin-travel sheet.
 *
 * @param today - The first travel day.
 * @param onBegin - Receives the last travel day, or `null` for open-ended.
 * @returns The sheet: the rule in one caption, then how long.
 */
export function BeginTravelSheet({
  visible,
  today,
  onBegin,
  onClose,
  testID = 'travel-begin',
}: BeginTravelSheetProps) {
  const { t } = useTranslation();

  return (
    <SheetShell visible={visible} title={t('travel.begin.title')} onClose={onClose} testID={testID}>
      <BeginTravelBody today={today} onBegin={onBegin} onClose={onClose} testID={testID} />
    </SheetShell>
  );
}

/**
 * The sheet's content. Separate so the "am I picking a count" state unmounts with the sheet — every
 * open starts from the plain options, with no reset effect (the shell renders nothing while closed).
 */
function BeginTravelBody({
  today,
  onBegin,
  onClose,
  testID,
}: {
  today: PrayerDay;
  onBegin: (lastDay: PrayerDay | null) => void;
  onClose: () => void;
  testID: string;
}) {
  const { t, i18n } = useTranslation();
  // `null` until "a different number of days…" is opened, so the stepper appears only when asked for.
  const [count, setCount] = useState<number | null>(null);

  /** The last travel day of a `days`-long journey, counting today as the first. */
  const lastDayOf = (days: number): PrayerDay => addDays(today, days - 1);

  return (
    <>
      {/* The rule, once, as a statement — the one place travel mode explains itself. */}
      <AppText testID={`${testID}-note`} variant="caption" tone="muted" style={styles.note}>
        {t('travel.begin.note')}
      </AppText>
      <View>
        <SheetAction
          testID={`${testID}-until`}
          label={t('travel.begin.untilIEnd')}
          emphasis
          onPress={() => onBegin(null)}
        />
        {DURATION_PRESETS.map((days) => (
          <SheetAction
            key={days}
            testID={`${testID}-${days}`}
            label={t('travel.begin.days', {
              count: days,
              date: formatDayChoice(lastDayOf(days), i18n.language, today),
            })}
            onPress={() => onBegin(lastDayOf(days))}
          />
        ))}
        {count === null ? (
          <SheetAction
            testID={`${testID}-count`}
            label={t('travel.begin.pickCount')}
            onPress={() => setCount(DEFAULT_TRAVEL_DAYS)}
          />
        ) : (
          <>
            <SettingStepperRow
              testID={`${testID}-stepper`}
              label={t('travel.begin.howLong')}
              value={count}
              min={MIN_TRAVEL_DAYS}
              max={MAX_TRAVEL_DAYS}
              onChange={setCount}
              formatValue={(days) => t('travel.begin.stepper', { count: days })}
              decreaseLabel={t('travel.begin.dayFewer')}
              increaseLabel={t('travel.begin.dayMore')}
            />
            <SheetAction
              testID={`${testID}-confirm`}
              label={t('travel.begin.confirmCount', {
                date: formatDayChoice(lastDayOf(count), i18n.language, today),
              })}
              emphasis
              onPress={() => onBegin(lastDayOf(count))}
            />
          </>
        )}
        <SheetAction
          testID={`${testID}-not-now`}
          label={t('travel.begin.notNow')}
          onPress={onClose}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  note: { marginBottom: spacing.md },
});
