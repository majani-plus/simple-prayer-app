import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { SectionDivider } from './SectionDivider';
import { formatDate } from '@/i18n/numerals';
import { parseDay } from '@/domain/dates';
import { spacing, useTheme } from '@/theme';

import type { PrayerDay } from '@/domain/types';

/**
 * The pieces every action sheet in the app is built from: the titled shell, the full-width action
 * row, and the day picker.
 *
 * They started inside `ExemptionSheets`, which was the only family that had any. Travel mode needs
 * the same shell and the same rows, and Today's ⋯ now offers both features from one menu — so they
 * live here rather than being imported *out of* one feature and into another.
 *
 * The rules they carry, which is most of why they are shared at all:
 *
 * - **Every tappable row in a sheet wears a surface.** A row is a card with a hairline, never a
 *   bare line of text — see {@link SheetRow}, which is the only way to build one. Owner's rule,
 *   2026-08-30: *"Sure it looks nice being just text, but without some visual guide it's not
 *   accessible when you don't see a visual button/clickable area."*
 * - **The sheet IS the confirmation.** No dialog ever stacks on a sheet. Every action a sheet
 *   offers is reversible, so a second "are you sure?" would only add friction to a gesture somebody
 *   makes often.
 * - **No typing, and no calendars of the future.** Dates are picked from short reverse-chronological
 *   lists bounded by what can be true. The one forward-looking choice anywhere is a *number of
 *   days*, never a date.
 * - **Three ways out, always** — drag down, tap the backdrop, Android back — all owned by
 *   {@link BottomSheet}, so no sheet in the app can forget one.
 * - **Every string arrives localized.** Nothing here reaches for i18n except the shell's own
 *   dismiss label and the day formatter's locale.
 */

/**
 * How much of the window a sheet that can show a {@link DayChoiceList} may fill — lower than the
 * sheet's own cap, which is the whole point.
 *
 * The reason is the list's order. It runs newest-first, so its top row is the likeliest pick; let
 * the sheet grow to its natural height and sixty days would fill the screen, carrying that row as
 * far from the thumb as it can go. A taller sheet showing the same days is strictly worse to use.
 *
 * The number is a compromise and worth knowing as one: it also caps the *other* steps of the same
 * sheets — the durations, the record editor's rows — which are shorter than the list and fit
 * inside it on a normal phone, and scroll on a small one at large text. That trade only became
 * cheap when every sheet body started scrolling (D141); before, a cap this low would have hidden
 * them outright.
 */
export const DAY_PICKER_MAX_HEIGHT_FRACTION = 0.6;

/**
 * The metrics of a full-width sheet row: the 48pt touch floor, the padding that makes the card
 * feel like a target, and the rhythm between rows. Private — a row is built with {@link SheetRow},
 * never by borrowing these.
 */
const SHEET_ROW_STYLE = {
  minHeight: 48,
  flexDirection: 'row',
  alignItems: 'center',
  gap: spacing.md,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.lg,
  marginBottom: spacing.sm,
} as const satisfies ViewStyle;

export interface SheetShellProps {
  visible: boolean;
  /** The sheet's title, already localized. Sits in the drag area with the grabber. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** A tighter height cap than the sheet's own — see {@link DAY_PICKER_MAX_HEIGHT_FRACTION}. */
  maxHeightFraction?: number;
  /** The sheet holds a text field — see {@link BottomSheetProps.keyboard}. */
  keyboard?: boolean;
  testID: string;
}

/**
 * The bottom-sheet shell an action sheet renders into: {@link BottomSheet} (scrim, paper card,
 * grabber, drag-to-dismiss, backdrop tap, Android back) plus the quiet title and its rule. The
 * title sits inside the drag area, so the whole top of the sheet is pullable.
 *
 * @param title - Localized title.
 * @returns The sheet, or nothing while closed.
 */
export function SheetShell({
  visible,
  title,
  onClose,
  children,
  maxHeightFraction,
  keyboard,
  testID,
}: SheetShellProps) {
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissLabel={t('sheet.dismiss')}
      maxHeightFraction={maxHeightFraction}
      keyboard={keyboard}
      testID={testID}
      header={
        <>
          <AppText variant="rowName" weight={600} accessibilityRole="header">
            {title}
          </AppText>
          <SectionDivider placement="top" style={{ marginVertical: spacing.md }} />
        </>
      }
    >
      {children}
    </BottomSheet>
  );
}

export interface SheetRowProps {
  /** The row's content. Laid out as a row, so a label and a value sit at opposite edges. */
  children: ReactNode;
  onPress: () => void;
  /** What a screen reader announces. The row is its words, so this is usually just the label. */
  accessibilityLabel: string;
  /** The primary choice of the sheet: a firmer hairline under the accent word. */
  emphasis?: boolean;
  testID: string;
}

/**
 * The tappable surface every row in a sheet wears — and the only way to build one.
 *
 * A sheet row used to be a line of text with a press handler on it. It read beautifully and it
 * was, as the owner put it (2026-08-30), *"not accessible when you don't see a visual button /
 * clickable area"*: nothing on screen said where the target began or ended, so the eye had no
 * edge to aim at and the thumb had no margin for error. The card is that edge, and it is the
 * app's own row surface, so a menu row now says "tappable" in the same voice as every settings
 * row and every prayer row.
 *
 * **No chevron.** In this app a chevron means *this leads somewhere else* — a settings row into a
 * screen, a {@link DayChoiceList} row into the next step of the sheet. A menu action does its
 * thing and closes, so a chevron here would promise a journey that never happens; the surface
 * alone carries "you can press this".
 *
 * @param emphasis - The sheet's primary choice. Never colour alone: the border firms up, the word
 * takes the accent, and the weight rises with it.
 * @returns A pressable card at the sheet's row metrics.
 */
export function SheetRow({
  children,
  onPress,
  accessibilityLabel,
  emphasis = false,
  testID,
}: SheetRowProps) {
  return (
    <PressableScale
      testID={testID}
      scale={0.98}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
    >
      <Card border={emphasis ? 'mid' : 'faint'} style={styles.action}>
        {children}
      </Card>
    </PressableScale>
  );
}

export interface SheetActionProps {
  /** Localized label. It is also the accessibility label: the row is its words. */
  label: string;
  onPress: () => void;
  /** The primary choice of the sheet. */
  emphasis?: boolean;
  testID: string;
}

/** One full-width action row inside a sheet — a {@link SheetRow} whose content is its label. */
export function SheetAction({ label, onPress, emphasis = false, testID }: SheetActionProps) {
  return (
    <SheetRow
      testID={testID}
      accessibilityLabel={label}
      emphasis={emphasis}
      onPress={onPress}
    >
      <AppText
        variant="rowName"
        weight={emphasis ? 600 : 500}
        tone={emphasis ? 'accent' : 'ink'}
        style={styles.actionLabel}
      >
        {label}
      </AppText>
    </SheetRow>
  );
}

/**
 * Localized "Tue, 12 August" (with the year once it is not this year's).
 *
 * @param day - The day to name.
 * @param locale - The active i18n language.
 * @param today - Today, only to decide whether the year is worth saying.
 * @returns One dated phrase a screen reader can speak whole.
 */
export function formatDayChoice(day: PrayerDay, locale: string, today: PrayerDay): string {
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return formatDate(parseDay(day), locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface DayChoiceListProps {
  /** Candidate days, any order; rendered newest first. */
  days: PrayerDay[];
  today: PrayerDay;
  onPick: (day: PrayerDay) => void;
  testID: string;
}

/**
 * A reverse-chronological list of pickable days — the app's whole date picker. A list rather than a
 * calendar grid: the common pick is within the last week, every row is a full dated sentence a
 * screen reader can speak, and nothing about it can select the future.
 *
 * Each day is a **card with a chevron**, not a line of text. It was the latter until the owner
 * put it plainly (2026-08-30): *"just a list of text doesn't look clickable and is hard to click
 * accurately"*. Both halves of that are fixed by the same change — the card draws the target so
 * the eye can aim at it, and it is the app's own row surface, so a row here now says "tappable"
 * in the same voice as every settings row and every prayer row.
 *
 * It does no scrolling of its own. The sheet holding it does that, which is what lets a drag over
 * these rows scroll them and then collapse the sheet once they are at the top (D141); the sheet
 * also caps its height with {@link DAY_PICKER_MAX_HEIGHT_FRACTION}. A scroll view here would take
 * both away — the sheet would size itself to all sixty days, and the drag would have two
 * scrollables to negotiate instead of one.
 */
export function DayChoiceList({ days, today, onPick, testID }: DayChoiceListProps) {
  const { i18n } = useTranslation();
  const { colors } = useTheme();
  const locale = i18n.language;
  const ordered = useMemo(() => [...days].sort().reverse(), [days]);

  return (
    <View testID={testID} style={styles.dayList}>
      {ordered.map((day) => (
        <PressableScale
          key={day}
          testID={`${testID}-${day}`}
          scale={0.98}
          minTouchTarget={0}
          accessibilityRole="button"
          accessibilityLabel={formatDayChoice(day, locale, today)}
          onPress={() => onPick(day)}
        >
          <Card border="faint" style={styles.dayRow}>
            <AppText variant="rowName" weight={500} style={styles.dayName}>
              {formatDayChoice(day, locale, today)}
            </AppText>
            {/* The chevron points the way the tap goes, so it mirrors with the writing direction
                — `isRTL` read during render, as every other row in the app reads it. */}
            <Icon
              name="chevron_right"
              size={20}
              color={colors.faint}
              style={{ transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }] }}
            />
          </Card>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  action: SHEET_ROW_STYLE,
  /** The label takes the line, so a value beside it is pushed to the trailing edge. */
  actionLabel: { flex: 1 },
  /** Cards need air between them to read as separate targets; text rows did not. */
  dayList: { gap: spacing.sm },
  dayRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  /** The date takes the line; the chevron keeps the trailing edge at every text size. */
  dayName: { flex: 1 },
});
