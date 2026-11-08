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
 * The travel banner — Today's quiet acknowledgement that travel mode is on.
 *
 * It is modelled on the excused-days banner, and for the same three reasons at once:
 *
 * 1. **The record.** "Travelling — shortened and combined prayers count as on time.", or
 *    "Travelling until {date}" once an end was chosen. It restates the concession rather than the
 *    rule, because by now the rule was read in the begin sheet and what a glance needs is *why the
 *    marks are behaving differently*.
 * 2. **The end control.** The trailing "End" is how travel usually ends, and it ends it outright:
 *    there is nothing to backdate, because travel writes no per-day record (D117).
 * 3. **The forgotten-state defence.** It is deliberately NOT dismissible, and after
 *    {@link STILL_TRAVELING_AFTER_DAYS} days of open-ended travel it grows one gentle line offering
 *    the way out. The threshold is longer than exemption's five days on purpose: forgetting travel
 *    mode costs at most one prayer marked "prayed" where "late" was the truer word, while an
 *    excused day forgotten hides a whole day of prayers. Static line, no badge, no count, no
 *    escalation — and, as with exemption, no notification version of it ever (D61's reasoning).
 *
 *    Travel with an end date never shows the line: it cannot be forgotten, because it ends itself.
 *
 * Never a failure state, and never a boast: neutral paper card, the ◆ ornament (icon + words, never
 * colour alone), calm body text.
 *
 * ## Stacking with the excused-days banner
 *
 * Both can be on at once — somebody may be travelling during her period — and both render, with
 * exemption first. That is the honest order: exemption governs whether the prayers are owed at all,
 * so it is the more consequential state, and travel is then a note about something that stays true
 * underneath it. No precedence logic exists anywhere, because none is needed: the rows are already
 * inert under exemption, so travel's marking rule never gets a chance to apply.
 */

/**
 * Days of open-ended travel before the gentle "still travelling?" line appears. Longer than
 * exemption's threshold — see the module header.
 */
export const STILL_TRAVELING_AFTER_DAYS = 10;

export interface TravelBannerProps {
  /** First travel day (`YYYY-MM-DD`). */
  sinceDay: PrayerDay;
  /** Last travel day when one was chosen, else `null`. Present, it replaces "since" with "until". */
  untilDay?: PrayerDay | null;
  /** The current prayer day, for measuring how long travel has been on. */
  today: PrayerDay;
  /** "End" was tapped: the screen ends travel. */
  onEnd: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The persistent travel banner.
 *
 * @param sinceDay - First travel day.
 * @param untilDay - Last travel day, or `null` for open-ended.
 * @param today - Current prayer day; at `sinceDay + 10` days the gentle second line appears.
 * @param onEnd - Ends travel.
 * @returns A quiet card: ◆, one line of body, a trailing "End" text action.
 */
export function TravelBanner({
  sinceDay,
  untilDay = null,
  today,
  onEnd,
  style,
  testID,
}: TravelBannerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  // The weekday is named as well as the date: "until Saturday, 22 August" is how somebody says
  // when they get back, and it is the half of the phrase they will actually check against.
  const dateText = useMemo(
    () =>
      untilDay === null
        ? ''
        : formatDate(parseDay(untilDay), locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }),
    [locale, untilDay]
  );

  const showStillOn =
    untilDay === null && diffDays(sinceDay, today) >= STILL_TRAVELING_AFTER_DAYS;

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
          {t(untilDay === null ? 'travel.banner.body' : 'travel.banner.bodyUntil', {
            date: dateText,
          })}
        </AppText>
        <PressableScale
          testID={testID === undefined ? undefined : `${testID}-end`}
          accessibilityRole="button"
          accessibilityLabel={t('travel.overflow.end')}
          onPress={onEnd}
          // The card is small; the 48pt floor grows a hitSlop around the word instead.
          style={{ paddingHorizontal: spacing.xs }}
        >
          <AppText variant="caption" tone="accent" weight={600} italic={false}>
            {t('travel.banner.end')}
          </AppText>
        </PressableScale>
      </View>
      {showStillOn ? (
        <AppText
          testID={testID === undefined ? undefined : `${testID}-still-on`}
          variant="hint"
          style={{ marginTop: spacing.sm, marginStart: spacing.lg }}
        >
          {t('travel.banner.stillOn')}
        </AppText>
      ) : null}
    </Card>
  );
}
