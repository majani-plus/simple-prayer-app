import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { SettingStepperRow } from './SettingStepperRow';
import {
  DAY_PICKER_MAX_HEIGHT_FRACTION,
  DayChoiceList,
  SheetAction,
  SheetRow,
  SheetShell,
  formatDayChoice,
} from './SheetKit';
import { addDays, daysBetween, isAfterDay, isBeforeDay } from '@/domain/dates';
import { SettingSwitchRow } from '@/components/SettingRow';
import { spacing } from '@/theme';

import type { ExemptPeriod, PrayerDay } from '@/domain/types';

/**
 * The exemption bottom sheets (spec-exemption §2, §4) — begin, end, the mode-off confirmation, and
 * the historical-record editor. The shell, the action row and the day picker they are made of are
 * `SheetKit`'s, and so are the rules those carry; what belongs to this family is here.
 *
 * (Today's ⋯ used to live here too, and moved to `TodayOverflowSheet` when it stopped being this
 * feature's own menu and started offering travel mode beside excused days.)
 *
 * The rules specific to these sheets:
 *
 * - **Never a question about her body.** Titles and options are actions she takes, not questions
 *   the app asks — the interrogatives ("When was the last excused day?", "For how long?") ask about
 *   the record or the plan being written, never about her. Nothing here counts, badges or hurries.
 * - **The neutral register (P1).** Every string uses excused / عذر / özel günler; the anatomical
 *   words live in the Settings body alone.
 * - **A duration is not a schedule.** Beginning for a number of days writes an ordinary closed
 *   period whose end has not arrived, so it ends by coverage running out (D114).
 */

/** How many past days the begin sheet offers. Nifas can run 40–60 days, so never less (§2a). */
const BEGIN_LOOKBACK_DAYS = 60;

/** How many past days the record editor offers — a full year, for genuinely old corrections. */
const EDITOR_LOOKBACK_DAYS = 366;

// ---------------------------------------------------------------------------
// Begin
// ---------------------------------------------------------------------------

export interface BeginExemptionSheetProps {
  visible: boolean;
  /** The current prayer day — "From today" and the top of the earlier-day list. */
  today: PrayerDay;
  /**
   * A start day and a duration were chosen. `lastDay` is the last exempt day, or `null` for
   * "until I end it" — the caller runs `addExemptPeriod` or `startExemptPeriod` accordingly and
   * closes the sheet.
   */
  onBegin: (day: PrayerDay, lastDay: PrayerDay | null, muteReminders: boolean) => void;
  /** Dismissed without choosing ("Not now", backdrop, Android back). */
  onClose: () => void;
  testID?: string;
}

/**
 * The begin sheet (§2a), in two steps: **when it started** (From today · From an earlier day… ·
 * Not now, the last 60 days unfolding in place) and then **how long** (Until I end it · 3 days ·
 * 7 days · a day count). The one-line qada reassurance sits under both.
 *
 * The second step exists because of the owner's ask: *"turn on exemption for 3 days, and I don't
 * need to remember to turn it off"*. It costs one extra tap on a monthly gesture, which is why
 * "Until I end it" is the emphasised first row — the old behaviour stays the quickest path.
 *
 * A duration is not a guess and not a schedule: it writes an ordinary closed period whose end has
 * not arrived, so the exemption ends by coverage running out, with nothing running in the
 * background. Durations are **inclusive of the start day** — "3 days" begun today means today and
 * two more.
 */
export function BeginExemptionSheet({
  visible,
  today,
  onBegin,
  onClose,
  testID = 'exemption-begin',
}: BeginExemptionSheetProps) {
  const { t } = useTranslation();

  return (
    <SheetShell
      visible={visible}
      title={t('exemption.begin.title')}
      onClose={onClose}
      // One of its steps is a sixty-day list; bounded so the newest day stays under the thumb.
      maxHeightFraction={DAY_PICKER_MAX_HEIGHT_FRACTION}
      testID={testID}
    >
      <BeginSheetBody today={today} onBegin={onBegin} onClose={onClose} testID={testID} />
    </SheetShell>
  );
}

/** Durations offered as one tap each. Anything else is the day count below them. */
const DURATION_PRESETS = [3, 7] as const;

/** Bounds and starting point of the custom day count. 60 matches the begin sheet's lookback. */
const MIN_DURATION_DAYS = 1;
const MAX_DURATION_DAYS = 60;
const DEFAULT_DURATION_DAYS = 5;

/** Which page of the begin sheet is on screen. */
type BeginStep =
  | { kind: 'start' }
  | { kind: 'earlier' }
  /** The duration question, holding the start day already chosen. */
  | { kind: 'duration'; startDay: PrayerDay };

/**
 * The begin sheet's content. A separate component so its "which page am I on" state lives in
 * something that unmounts with the sheet — every open starts at the three options, with no
 * reset effect (the shell renders nothing while closed).
 */
function BeginSheetBody({
  today,
  onBegin,
  onClose,
  testID,
}: {
  today: PrayerDay;
  onBegin: (day: PrayerDay, lastDay: PrayerDay | null, muteReminders: boolean) => void;
  onClose: () => void;
  testID: string;
}) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<BeginStep>({ kind: 'start' });
  // `null` until "a number of days…" is opened, so the stepper appears only when asked for.
  const [count, setCount] = useState<number | null>(null);
  // Reminders pause by default while she is excused (the pre-2026-08-28 behaviour, kept as the
  // default); the switch below lets the adhan keep speaking — it announces the clock, not her.
  const [muteReminders, setMuteReminders] = useState(true);

  const earlierDays = useMemo(
    () => daysBetween(addDays(today, -BEGIN_LOOKBACK_DAYS), addDays(today, -1)),
    [today]
  );

  /** The last exempt day of a `days`-long period, counting the start day as the first. */
  const lastDayOf = (startDay: PrayerDay, days: number): PrayerDay => addDays(startDay, days - 1);

  return (
    <>
      {step.kind === 'earlier' ? (
        <DayChoiceList
          days={earlierDays}
          today={today}
          onPick={(day) => setStep({ kind: 'duration', startDay: day })}
          testID={`${testID}-day`}
        />
      ) : step.kind === 'duration' ? (
        <View>
          {/* A question about the plan being written, never about her — the same licence the end
              sheet's "When was the last excused day?" takes. */}
          <AppText testID={`${testID}-how-long`} variant="caption" style={styles.stepCaption}>
            {t('exemption.begin.howLong')}
          </AppText>
          <SheetAction
            testID={`${testID}-until`}
            label={t('exemption.begin.untilIEnd')}
            emphasis
            onPress={() => onBegin(step.startDay, null, muteReminders)}
          />
          {DURATION_PRESETS.map((days) => (
            <SheetAction
              key={days}
              testID={`${testID}-${days}`}
              label={t('exemption.begin.days', {
                count: days,
                date: formatDayChoice(lastDayOf(step.startDay, days), i18n.language, today),
              })}
              onPress={() => onBegin(step.startDay, lastDayOf(step.startDay, days), muteReminders)}
            />
          ))}
          {count === null ? (
            <SheetAction
              testID={`${testID}-count`}
              label={t('exemption.begin.pickCount')}
              onPress={() => setCount(DEFAULT_DURATION_DAYS)}
            />
          ) : (
            <>
              <SettingStepperRow
                testID={`${testID}-stepper`}
                label={t('exemption.begin.howLong')}
                value={count}
                min={MIN_DURATION_DAYS}
                max={MAX_DURATION_DAYS}
                onChange={setCount}
                formatValue={(days) => t('exemption.begin.stepper', { count: days })}
                decreaseLabel={t('exemption.begin.dayFewer')}
                increaseLabel={t('exemption.begin.dayMore')}
              />
              <SheetAction
                testID={`${testID}-confirm`}
                label={t('exemption.begin.confirmCount', {
                  date: formatDayChoice(lastDayOf(step.startDay, count), i18n.language, today),
                })}
                emphasis
                onPress={() => onBegin(step.startDay, lastDayOf(step.startDay, count), muteReminders)}
              />
            </>
          )}
          <SettingSwitchRow
            testID={`${testID}-mute`}
            icon={muteReminders ? 'notifications_off' : 'notifications'}
            label={t('exemption.begin.pauseReminders')}
            description={t('exemption.begin.pauseRemindersHint')}
            value={muteReminders}
            onValueChange={setMuteReminders}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
          />
          {/* The plan being written, read back in one line (owner, 2026-08-28) — dated when a
              day count is on screen, general otherwise; presets carry their date themselves. */}
          <AppText
            testID={`${testID}-summary`}
            variant="hint"
            style={{ textAlign: 'center', marginTop: spacing.sm }}
          >
            {count !== null
              ? t(muteReminders ? 'exemption.begin.summaryMutedUntil' : 'exemption.begin.summaryKeptUntil', {
                  date: formatDayChoice(lastDayOf(step.startDay, count), i18n.language, today),
                })
              : t(muteReminders ? 'exemption.begin.summaryMuted' : 'exemption.begin.summaryKept')}
          </AppText>
        </View>
      ) : (
        <View>
          <SheetAction
            testID={`${testID}-today`}
            label={t('exemption.begin.fromToday')}
            emphasis
            onPress={() => setStep({ kind: 'duration', startDay: today })}
          />
          <SheetAction
            testID={`${testID}-earlier`}
            label={t('exemption.begin.fromEarlier')}
            onPress={() => setStep({ kind: 'earlier' })}
          />
          <SheetAction
            testID={`${testID}-not-now`}
            label={t('exemption.begin.notNow')}
            onPress={onClose}
          />
        </View>
      )}
      {/* The ruling, once, as reassurance — stated (P2), never asked. Prayer-specific wording:
          "nothing builds up" must not be readable as covering Ramadan fast-qada. */}
      <AppText
        testID={`${testID}-reassure`}
        variant="hint"
        style={{ textAlign: 'center', marginTop: spacing.md }}
      >
        {t('exemption.begin.reassure')}
      </AppText>
    </>
  );
}

// ---------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------

export interface EndExemptionSheetProps {
  visible: boolean;
  /** The current prayer day. */
  today: PrayerDay;
  /** First day of the open period — the earliest offerable end day. */
  startDay: PrayerDay;
  /** A last-exempt-day was chosen. The caller runs `endExemptPeriod` and closes the sheet. */
  onEnd: (day: PrayerDay) => void;
  onClose: () => void;
  testID?: string;
}

/**
 * The end sheet (§4a): "When was the last exempt day?" — Yesterday · Today · An earlier day….
 * Backdating is the graceful recovery for a period forgotten for days: the overrun days return
 * to honest `unlogged` (never auto-missed, D06), loggable from History as usual.
 */
export function EndExemptionSheet({
  visible,
  today,
  startDay,
  onEnd,
  onClose,
  testID = 'exemption-end',
}: EndExemptionSheetProps) {
  const { t } = useTranslation();

  return (
    <SheetShell
      visible={visible}
      title={t('exemption.end.title')}
      onClose={onClose}
      testID={testID}
    >
      <EndSheetBody today={today} startDay={startDay} onEnd={onEnd} testID={testID} />
    </SheetShell>
  );
}

/** The end sheet's content — unmounts with the sheet, so every open starts at the options. */
function EndSheetBody({
  today,
  startDay,
  onEnd,
  testID,
}: {
  today: PrayerDay;
  startDay: PrayerDay;
  onEnd: (day: PrayerDay) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);

  const yesterday = addDays(today, -1);
  // Days strictly before yesterday, bounded by the period's own start — nothing outside the
  // period can be its last day.
  const earlierDays = useMemo(() => {
    const lastOffered = addDays(today, -2);
    if (isAfterDay(startDay, lastOffered)) return [];
    return daysBetween(startDay, lastOffered);
  }, [startDay, today]);

  return (
    <>
      <AppText variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>
        {t('exemption.end.question')}
      </AppText>
      {picking ? (
        <DayChoiceList days={earlierDays} today={today} onPick={onEnd} testID={`${testID}-day`} />
      ) : (
        <View>
          <SheetAction
            testID={`${testID}-yesterday`}
            label={t('exemption.end.yesterday')}
            emphasis
            onPress={() => onEnd(yesterday)}
          />
          <SheetAction
            testID={`${testID}-today`}
            label={t('exemption.end.today')}
            onPress={() => onEnd(today)}
          />
          {earlierDays.length > 0 ? (
            <SheetAction
              testID={`${testID}-earlier`}
              label={t('exemption.end.earlier')}
              onPress={() => setPicking(true)}
            />
          ) : null}
        </View>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mode-off confirmation
// ---------------------------------------------------------------------------

export interface ModeOffSheetProps {
  visible: boolean;
  /** Turn the mode off AND end the open period as of yesterday. */
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
}

/**
 * Shown when the Settings switch is flipped off while a period is open (§4a): the mode must
 * never silently strand an open range behind a disabled switch. Closed history is kept.
 */
export function ModeOffSheet({
  visible,
  onConfirm,
  onClose,
  testID = 'exemption-mode-off',
}: ModeOffSheetProps) {
  const { t } = useTranslation();

  return (
    <SheetShell
      visible={visible}
      title={t('exemption.modeOff.title')}
      onClose={onClose}
      testID={testID}
    >
      <AppText variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>
        {t('exemption.modeOff.body')}
      </AppText>
      <SheetAction
        testID={`${testID}-confirm`}
        label={t('exemption.modeOff.confirm')}
        emphasis
        onPress={onConfirm}
      />
      <SheetAction testID={`${testID}-cancel`} label={t('exemption.modeOff.cancel')} onPress={onClose} />
    </SheetShell>
  );
}

// ---------------------------------------------------------------------------
// Historical record editor
// ---------------------------------------------------------------------------

export interface ExemptPeriodEditorSheetProps {
  /** The record being edited, or `null` to add a new past record. Open-ended periods are not
   * edited here — the banner / end sheet own the ongoing one. */
  period: ExemptPeriod | null;
  visible: boolean;
  /** The current prayer day — the latest offerable day (future periods are out of scope, §2b). */
  today: PrayerDay;
  /** Save with the chosen days. The caller persists and closes. */
  onSave: (startDay: PrayerDay, endDay: PrayerDay) => void;
  /** Remove the record entirely. Only offered while editing (never on add). */
  onRemove?: () => void;
  onClose: () => void;
  testID?: string;
}

/**
 * The add/edit sheet for a historical record (§2b): first day, last day, save — and, when
 * editing, a quiet "remove this record". No confirmation stacks on top: re-adding a removed
 * record is the same two taps, so the sheet is the confirmation.
 */
export function ExemptPeriodEditorSheet({
  period,
  visible,
  today,
  onSave,
  onRemove,
  onClose,
  testID = 'exemption-editor',
}: ExemptPeriodEditorSheetProps) {
  const { t } = useTranslation();

  return (
    <SheetShell
      visible={visible}
      title={period === null ? t('exemption.editor.addTitle') : t('exemption.editor.editTitle')}
      onClose={onClose}
      // Both of its day pickers reach back a year — see the begin sheet above.
      maxHeightFraction={DAY_PICKER_MAX_HEIGHT_FRACTION}
      testID={testID}
    >
      <EditorSheetBody
        period={period}
        today={today}
        onSave={onSave}
        onRemove={onRemove}
        onClose={onClose}
        testID={testID}
      />
    </SheetShell>
  );
}

/**
 * The editor's content. Its draft days are `useState` seeded from the record: the body unmounts
 * with the sheet, so every open re-seeds without a reset effect.
 */
function EditorSheetBody({
  period,
  today,
  onSave,
  onRemove,
  onClose,
  testID,
}: {
  period: ExemptPeriod | null;
  today: PrayerDay;
  onSave: (startDay: PrayerDay, endDay: PrayerDay) => void;
  onRemove?: () => void;
  onClose: () => void;
  testID: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [startDay, setStartDay] = useState<PrayerDay | null>(period?.startDay ?? null);
  const [endDay, setEndDay] = useState<PrayerDay | null>(period?.endDay ?? null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);

  const candidates = useMemo(
    () => daysBetween(addDays(today, -EDITOR_LOOKBACK_DAYS), today),
    [today]
  );

  const inverted = startDay !== null && endDay !== null && isBeforeDay(endDay, startDay);
  const complete = startDay !== null && endDay !== null && !inverted;

  const dayValue = (day: PrayerDay | null): string =>
    day === null ? '—' : formatDayChoice(day, locale, today);

  const pickRow = (which: 'start' | 'end', label: string, value: PrayerDay | null) => (
    <SheetRow
      testID={`${testID}-${which}`}
      accessibilityLabel={`${label}, ${dayValue(value)}`}
      onPress={() => setPicking(which)}
    >
      <AppText variant="rowName" weight={500} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText
        testID={`${testID}-${which}-value`}
        variant="rowName"
        weight={500}
        tone={value === null ? 'faint' : 'accent'}
      >
        {dayValue(value)}
      </AppText>
    </SheetRow>
  );

  return (
    <>
      {picking !== null ? (
        <DayChoiceList
          days={candidates}
          today={today}
          onPick={(day) => {
            if (picking === 'start') setStartDay(day);
            else setEndDay(day);
            setPicking(null);
          }}
          testID={`${testID}-day`}
        />
      ) : (
        <View>
          {pickRow('start', t('exemption.editor.firstDay'), startDay)}
          {pickRow('end', t('exemption.editor.lastDay'), endDay)}
          {inverted ? (
            <AppText testID={`${testID}-invalid`} variant="hint" style={{ marginTop: spacing.xs }}>
              {t('exemption.editor.invalid')}
            </AppText>
          ) : null}
          {complete ? (
            <SheetAction
              testID={`${testID}-save`}
              label={t('exemption.editor.save')}
              emphasis
              onPress={() => {
                // `complete` narrowed both to non-null above.
                if (startDay !== null && endDay !== null) onSave(startDay, endDay);
              }}
            />
          ) : null}
          {period !== null && onRemove !== undefined ? (
            <SheetAction
              testID={`${testID}-remove`}
              label={t('exemption.editor.remove')}
              onPress={onRemove}
            />
          ) : null}
          <SheetAction
            testID={`${testID}-cancel`}
            label={t('exemption.editor.cancel')}
            onPress={onClose}
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  stepCaption: { marginBottom: spacing.xs },
});
