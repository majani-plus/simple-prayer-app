import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { BottomSheet } from './BottomSheet';
import { Card } from './Card';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import type { SealPickMeta } from './PrayerSeal';
import { PrayerRow } from './PrayerRow';
import { SectionDivider } from './SectionDivider';
import { formatDate, formatNumber } from '@/i18n/numerals';
import { parseDay } from '@/domain/dates';
import { formatHijri, toHijri } from '@/domain/hijri';
import { prayerNameKey } from '@/domain/prayerNames';
import { displayRecord } from '@/domain/trackingMode';
import { useTrackingModeView } from '@/hooks/useTrackingModeView';
import {
  PRAYERS,
  type LoggableStatus,
  type DayRecord,
  type Prayer,
  type PrayerDay,
} from '@/domain/types';
import { useCalculationSettings } from '@/stores/settingsStore';
import { spacing, useTheme } from '@/theme';

/**
 * The History day detail — one past day, opened from a calendar cell (PRODUCT_SPEC §8).
 *
 * It is a bottom sheet rather than an expanding card for one reason: the day's five rows are the
 * *same* rows as Today's, seal and all, and inlining them inside the grid would have made the
 * calendar jump by 300pt under the tapped cell. A sheet keeps the month where the user left it,
 * dismisses the way every native sheet does (drag it down by its grabber, tap the paper outside
 * it, the Android back button, or the close control — the first three belong to `BottomSheet`),
 * and gives the rows the full width the seal's morph needs.
 *
 * Everything it renders is imported, never reimplemented: `PrayerRow`/`PrayerSeal` are the Today
 * tab's, so a day edited here and a day edited there cannot diverge in look or in semantics. What
 * this component adds is the two things only History has:
 *
 * 1. **The made-up conversion.** A `missed` prayer offers "mark as made up" — the qada tick of
 *    PRODUCT_SPEC §7 — and a resolved one says so and can be un-marked. It is a quiet warm text
 *    action, never a destructive-looking button, and it is the *only* extra control on the row.
 * 2. **The locks.** A future day never opens (the calendar refuses first, and this refuses again);
 *    an exempt day says so plainly and calmly and offers nothing to mark (PRODUCT_SPEC §6).
 *
 * ## Sheet and panel
 *
 * On an expanded window the same day is shown as a *panel* standing beside the calendar instead of
 * a sheet over it (`DayDetailPanel`, D124) — which PRODUCT_SPEC §8 always allowed ("expanding panel
 * or bottom sheet"). The header and the rows are therefore separate pieces here: the sheet hands
 * the header to `BottomSheet`, which keeps it fixed while the rows scroll under it, and the panel
 * renders the two in sequence inside a card. Both use the very same rows, so a day edited in either
 * place cannot diverge from the other — or from Today.
 *
 * Neither scrolls the rows itself. The sheet's own body scrolls (D141) and the panel's pane
 * already does, so a scroll view here would nest inside one of them either way.
 */

/** Gap between the five rows — the same tighter rhythm the Today tab uses. */
const ROW_GAP = 9;

export interface DayDetailProps {
  /** The day to show. `null` closes the sheet. */
  day: PrayerDay | null;
  /** The day's resolved record; `undefined` while it is still being read. */
  record: DayRecord | undefined;
  /**
   * The five prayer times of `day`. `null` when there is no location (or the engine could not
   * resolve the day) — the sheet then explains itself instead of inventing times.
   */
  times: Record<Prayer, Date> | null;
  /** Whether `day` is still ahead of the current prayer day. Locks every control. */
  isFuture?: boolean;
  onClose: () => void;
  /**
   * A seal option was picked. The screen applies it through the tracking store; `meta.clears`
   * says whether the pick took the mark back off (for the lighter unmark haptic).
   */
  onPick: (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => void;
  /** The made-up marker was toggled on a missed prayer. */
  onToggleMadeUp?: (prayer: Prayer, next: boolean) => void;
  testID?: string;
}

/** Everything the sheet renders about a day — held so it can outlive the selection. */
interface ShownDay {
  day: PrayerDay;
  record: DayRecord | undefined;
  times: Record<Prayer, Date> | null;
  isFuture: boolean;
}

/**
 * Whether the sheet is already showing exactly this. Every one of these arrives with a stable
 * identity — the record straight out of the store, the times memoised on the day — so comparing
 * them by reference re-renders on a real change and on nothing else.
 *
 * @returns `true` when there is nothing to update.
 */
function isSameDayShown(
  shown: ShownDay | null,
  day: PrayerDay,
  record: DayRecord | undefined,
  times: Record<Prayer, Date> | null,
  isFuture: boolean
): boolean {
  return (
    shown !== null &&
    shown.day === day &&
    shown.record === record &&
    shown.times === times &&
    shown.isFuture === isFuture
  );
}

/**
 * The day detail sheet.
 *
 * ## Why it keeps the day it is losing
 *
 * Closing clears the selection, so `day` — and with it the record and the times, which every
 * caller derives from the selection — is already gone by the time the sheet starts its exit. The
 * last complete set is therefore held and rendered while the sheet animates out: `day` decides
 * whether the sheet is *open*, not what it shows. Without this the sheet either flickers into "no
 * times for this day" on its way out, or is torn out of the tree mid-exit — which also robs the
 * library of its own teardown, the thing that keeps the next sheet's presentation clean (D113).
 *
 * While the sheet is open the held set is refreshed on every render, so a seal pressed inside it
 * still updates the moment the store does.
 *
 * @param day - The day to render; `null` closes the sheet.
 * @param times - The day's five prayer times, or `null` when they cannot be computed.
 * @returns A bottom sheet over the calendar, or nothing at all until a day has been opened.
 */
export function DayDetail({
  day,
  record,
  times,
  isFuture = false,
  onClose,
  onPick,
  onToggleMadeUp,
  testID = 'day-detail',
}: DayDetailProps) {
  const { t } = useTranslation();

  // Held in state and adjusted during the render that changes it, not in an effect: React applies
  // it before painting, so a day opened or a seal pressed shows immediately and no frame of the
  // previous day is ever drawn.
  const [shown, setShown] = useState<ShownDay | null>(null);
  if (day !== null && !isSameDayShown(shown, day, record, times, isFuture)) {
    setShown({ day, record, times, isFuture });
  }

  // Nothing has ever been opened: there is not even an exit to play.
  if (shown === null) return null;

  return (
    <BottomSheet
      visible={day !== null}
      onClose={onClose}
      dismissLabel={t('history.detail.a11yDismiss')}
      testID={testID}
      // A tap on the sheet's own paper outside an open seal pill closes just the pill; the
      // backdrop still closes the whole sheet (pill included). Pass-through — see SealDismiss.
      sealDismissTestID={`${testID}-seal-dismiss`}
      header={<DayDetailHeader day={shown.day} onClose={onClose} testID={testID} />}
    >
      <DayDetailRows
        day={shown.day}
        record={shown.record}
        times={shown.times}
        isFuture={shown.isFuture}
        onPick={onPick}
        onToggleMadeUp={onToggleMadeUp}
        testID={testID}
      />
    </BottomSheet>
  );
}

export interface DayDetailPanelProps extends Omit<DayDetailProps, 'day' | 'onClose'> {
  /** The day to show. A panel always shows one — the screen defaults it to today. */
  day: PrayerDay;
  style?: StyleProp<ViewStyle>;
}

/**
 * The same day detail standing beside the calendar instead of over it — the expanded layout's
 * trailing pane (D124).
 *
 * There is no close control, because a panel is not dismissed: it is simply always showing some
 * day, and tapping another cell retargets it.
 *
 * @param day - The day to render. Never `null`; the screen resolves "nothing chosen yet" to today.
 * @returns A card holding the day's date line and its five rows.
 */
export function DayDetailPanel({
  day,
  record,
  times,
  isFuture = false,
  onPick,
  onToggleMadeUp,
  style,
  testID = 'day-panel',
}: DayDetailPanelProps) {
  // The Card takes its default fill and hairline — the same the calendar card wears, so the two
  // panes read as one sheet of paper rather than two documents.
  return (
    <Card testID={`${testID}-card`} style={[styles.panel, style]}>
      <DayDetailHeader day={day} testID={testID} />
      <DayDetailRows
        day={day}
        record={record}
        times={times}
        isFuture={isFuture}
        onPick={onPick}
        onToggleMadeUp={onToggleMadeUp}
        testID={testID}
      />
    </Card>
  );
}

/** The date line that titles a day, and the close control when there is something to close. */
function DayDetailHeader({
  day,
  onClose,
  testID,
}: {
  day: PrayerDay;
  onClose?: () => void;
  testID: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { hijriOffset } = useCalculationSettings();

  const dateLine = useMemo(() => {
    const locale = i18n.language;
    const numbers = (value: number) => formatNumber(value, locale, { useGrouping: false });
    const hijri = formatHijri(toHijri(day, hijriOffset), { style: 'dayMonthYear' });
    const hijriText = t('history.detail.hijriLine', {
      day: numbers(hijri.date.day),
      month: t(hijri.monthKey),
      year: numbers(hijri.date.year),
    });
    const gregorianText = formatDate(parseDay(day), locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return t('today.dateLine', { hijri: hijriText, gregorian: gregorianText });
  }, [day, hijriOffset, i18n.language, t]);

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
        <AppText
          variant="headerMeta"
          accessibilityRole="header"
          style={{ flex: 1 }}
          numberOfLines={2}
        >
          {dateLine}
        </AppText>
        {onClose === undefined ? null : (
          <PressableScale
            testID={`${testID}-close`}
            accessibilityRole="button"
            accessibilityLabel={t('history.detail.close')}
            onPress={onClose}
            style={{ padding: spacing.xs }}
          >
            <Icon name="close" size={18} color={colors.faint} />
          </PressableScale>
        )}
      </View>

      <SectionDivider placement="top" style={{ marginVertical: spacing.md }} />
    </>
  );
}

/** The day's five rows, plus whichever note explains why there are none. */
function DayDetailRows({
  day,
  record,
  times,
  isFuture,
  onPick,
  onToggleMadeUp,
  testID,
}: {
  day: PrayerDay;
  record: DayRecord | undefined;
  times: Record<Prayer, Date> | null;
  isFuture: boolean;
  onPick: (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => void;
  onToggleMadeUp?: (prayer: Prayer, next: boolean) => void;
  testID: string;
}) {
  const { t } = useTranslation();

  // Exactly one seal open at a time, exactly as on Today — and remembered with the day it belongs
  // to, so re-opening on another date never restores a stale open pill.
  const [open, setOpen] = useState<{ day: PrayerDay | null; prayer: Prayer | null }>({
    day: null,
    prayer: null,
  });
  const openPrayer = open.day === day ? open.prayer : null;

  const handleToggleOpen = useCallback(
    (prayer: Prayer) => {
      setOpen((current) => ({
        day,
        prayer: current.day === day && current.prayer === prayer ? null : prayer,
      }));
    },
    [day]
  );

  const handlePick = useCallback(
    (prayer: Prayer, status: LoggableStatus, meta: SealPickMeta) => {
      setOpen({ day, prayer: null });
      onPick(prayer, status, meta);
    },
    [day, onPick]
  );

  // One pair of callbacks per prayer, as on Today (D158): written inline in the row loop they were
  // new closures on every render, so opening one seal re-rendered all five memoised rows.
  const rowHandlers = useMemo(() => {
    const handlers = {} as Record<
      Prayer,
      { toggleOpen: () => void; pick: (status: LoggableStatus, meta: SealPickMeta) => void }
    >;
    for (const prayer of PRAYERS) {
      handlers[prayer] = {
        toggleOpen: () => handleToggleOpen(prayer),
        pick: (status, meta) => handlePick(prayer, status, meta),
      };
    }
    return handlers;
  }, [handleToggleOpen, handlePick]);

  const isExempt = record?.isExempt === true;
  const editable = !isFuture && !isExempt && times !== null;

  // Simple mode (D192): the rows SHOW the mapped statuses, and every seal is one tap — the caller
  // applies it with `toggleSimpleStatus`. The made-up action below still reads the STORED status:
  // only a stored miss has a row to stamp.
  const modeView = useTrackingModeView();
  const simple = modeView.mode === 'simple';
  const shown = useMemo(
    () => (record === undefined ? undefined : displayRecord(record, modeView)),
    [record, modeView]
  );

  const rows =
    times === null
      ? null
      : PRAYERS.map((prayer) => {
          const status = shown?.statuses[prayer] ?? 'unlogged';
          const madeUp = record?.madeUp[prayer] === true;
          // Friday's midday prayer names itself "Jumu'ah · Dhuhr" here too (D75) — the detail is
          // looking at one specific day, so it names occurrences, not slots.
          const nameKey = prayerNameKey(prayer, day);
          return (
            <View key={prayer} style={{ gap: spacing.xs }}>
              <PrayerRow
                testID={`detail-row-${prayer}`}
                prayer={prayer}
                name={t(`prayers.${nameKey}`)}
                arabicName={t(`prayers.arabic.${nameKey}`)}
                time={times[prayer]}
                status={status}
                isOpen={openPrayer === prayer}
                disabled={!editable}
                directPick={simple && editable}
                simple={simple}
                onToggleOpen={rowHandlers[prayer].toggleOpen}
                onPick={rowHandlers[prayer].pick}
              />
              {record?.statuses[prayer] === 'missed' && editable && onToggleMadeUp !== undefined ? (
                <MadeUpAction
                  testID={`detail-madeup-${prayer}`}
                  prayerName={t(`prayers.${nameKey}`)}
                  madeUp={madeUp}
                  onPress={() => onToggleMadeUp(prayer, !madeUp)}
                />
              ) : null}
            </View>
          );
        });

  return (
    <>
      {isFuture ? (
        <AppText testID={`${testID}-locked`} variant="caption" style={styles.note}>
          {t('history.detail.future')}
        </AppText>
      ) : isExempt ? (
        <AppText testID={`${testID}-exempt`} variant="caption" style={styles.note}>
          {t('history.detail.exempt')}
        </AppText>
      ) : times === null ? (
        <AppText testID={`${testID}-no-times`} variant="caption" style={styles.note}>
          {t('history.detail.noTimes')}
        </AppText>
      ) : null}

      {rows === null ? null : (
        <View testID={`${testID}-rows`} style={styles.rows}>
          {rows}
        </View>
      )}
    </>
  );
}

/** The quiet warm text action that converts a missed prayer into a made-up one, and back. */
function MadeUpAction({
  prayerName,
  madeUp,
  onPress,
  testID,
}: {
  prayerName: string;
  madeUp: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: madeUp }}
      accessibilityLabel={t(
        madeUp ? 'history.detail.madeUp.unmarkA11y' : 'history.detail.madeUp.markA11y',
        {
          prayer: prayerName,
        }
      )}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: spacing.xs,
        paddingVertical: spacing.xs,
        paddingHorizontal: spacing.sm,
      }}
    >
      {/* `faint` is the palette's footnote gold (~3.3:1 on the sheet). This is a control, not a
          footnote, so it takes the readable `header` step of the same family. */}
      <Icon
        name={madeUp ? 'task_alt' : 'add'}
        size={15}
        color={madeUp ? colors.accent : colors.header}
      />
      {/* Word plus glyph: "made up" is never signalled by the icon (or the colour) alone. */}
      <AppText variant="caption" color={madeUp ? colors.accent : colors.header} italic={!madeUp}>
        {t(madeUp ? 'history.detail.madeUp.marked' : 'history.detail.madeUp.mark')}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  note: { textAlign: 'center', paddingBottom: spacing.sm },
  rows: { gap: ROW_GAP, paddingTop: spacing.xs },
  panel: { padding: spacing.lg },
});
