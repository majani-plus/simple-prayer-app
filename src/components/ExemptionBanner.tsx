import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Card } from './Card';
import { PressableScale } from './PressableScale';
import { formatDate } from '@/i18n/numerals';
import { diffDays, parseDay } from '@/domain/dates';
import { spacing } from '@/theme';

import type { PrayerDay } from '@/domain/types';

/**
 * The exemption banner — Today's quiet acknowledgement that a period is ongoing
 * (spec-exemption §3).
 *
 * It sits directly under the hero and above the prayer rows, and it is three things at once:
 *
 * 1. **The record.** "Excused since {date} — no prayers are owed for these days. Reminders are
 *    paused.", or, when the period was begun with an end date, "Excused until {date}". Written in
 *    the neutral register (P1): a glance at the open phone reveals nothing a stranger can name,
 *    while she always knows exactly what it means. "No prayers are owed" is deliberately
 *    prayer-specific — the same ruling that lifts prayer-qada imposes fast-qada, so the sentence
 *    must never be readable as covering Ramadan.
 * 2. **The end control.** The trailing "End" action is how a period usually ends;
 *    `findOngoingPeriod` exists for exactly this surface. It ends a planned period early just as
 *    it closes an open-ended one.
 * 3. **The forgotten-period defence.** It is deliberately NOT dismissible — dismissing it would
 *    recreate the silent-forever-exempt trap — and once an open-ended period is
 *    {@link STILL_ON_AFTER_DAYS} days old it grows one gentle italic line offering the way out.
 *    The line is static: no badge, no count, no repetition, no escalation. A typical hayd runs 3–7
 *    days, so at the owner's 5-day threshold it appears during many ordinary periods — which is
 *    why "there's no rush" is load-bearing copy, not decoration. There is deliberately no
 *    notification version of this (D-x3): any lock-screen wording specific enough to be useful
 *    announces her cycle to whoever glances at her phone.
 *
 *    **A period with an end date never shows that line.** It exists to catch an exemption nobody
 *    remembered to end, and one that ends itself cannot be forgotten; asking "still excused?" of
 *    someone who already answered would be the interrogation the feature is built to avoid.
 *
 * Never a failure state: neutral paper card, the ◆ ornament (icon + words, never colour-only),
 * calm body text.
 */

/** Days an open period must have run before the gentle "still exempt?" line appears (owner: 5). */
export const STILL_ON_AFTER_DAYS = 5;

export interface ExemptionBannerProps {
  /** First day of the ongoing period (`YYYY-MM-DD`). */
  sinceDay: PrayerDay;
  /**
   * Last exempt day, when the period was begun with a duration; `null` for an open-ended one.
   * Present, it replaces "since" with "until" and silences the gentle line.
   */
  untilDay?: PrayerDay | null;
  /** The current prayer day, for measuring how long the period has been open. */
  today: PrayerDay;
  /** The "End" action was tapped: the screen opens the end sheet. */
  onEnd: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The persistent ongoing-period banner.
 *
 * @param sinceDay - First day of the ongoing period.
 * @param untilDay - Last exempt day when one was chosen, else `null`.
 * @param today - Current prayer day; at `sinceDay + 5` days the gentle second line appears.
 * @param onEnd - Opens the end sheet.
 * @returns A quiet card: ◆, one line of body, a trailing "End" text action.
 */
export function ExemptionBanner({
  sinceDay,
  untilDay = null,
  today,
  onEnd,
  style,
  testID,
}: ExemptionBannerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const dateText = useMemo(
    () =>
      formatDate(parseDay(untilDay ?? sinceDay), locale, { day: 'numeric', month: 'long' }),
    [locale, sinceDay, untilDay]
  );

  // "≥ 5 days old": the 6th day of the period and later. Not a fiqh claim — nothing ends and
  // nothing is asserted; it is merely when a gentle in-app line stops being noise. A period that
  // ends itself never reaches this: see the module header.
  const showStillOn = untilDay === null && diffDays(sinceDay, today) >= STILL_ON_AFTER_DAYS;

  return (
    <Card testID={testID} variant="quiet" border="mid" style={[{ padding: spacing.lg }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        {/* The ◆ ornament: the banner's state mark, beside its words — never colour alone. */}
        <AppText variant="caption" tone="diamond" accessibilityElementsHidden>
          ◆
        </AppText>
        <AppText
          testID={testID === undefined ? undefined : `${testID}-body`}
          variant="caption"
          tone="header"
          style={{ flex: 1 }}
        >
          {t(untilDay === null ? 'exemption.banner.body' : 'exemption.banner.bodyUntil', {
            date: dateText,
          })}
        </AppText>
        <PressableScale
          testID={testID === undefined ? undefined : `${testID}-end`}
          accessibilityRole="button"
          accessibilityLabel={t('exemption.overflow.end')}
          onPress={onEnd}
          // The card is small; the 48pt floor grows a hitSlop around the word instead.
          style={{ paddingHorizontal: spacing.xs }}
        >
          <AppText variant="caption" tone="accent" weight={600} italic={false}>
            {t('exemption.banner.end')}
          </AppText>
        </PressableScale>
      </View>
      {showStillOn ? (
        <AppText
          testID={testID === undefined ? undefined : `${testID}-still-on`}
          variant="hint"
          style={{ marginTop: spacing.sm, marginStart: spacing.lg }}
        >
          {t('exemption.banner.stillOn')}
        </AppText>
      ) : null}
    </Card>
  );
}
