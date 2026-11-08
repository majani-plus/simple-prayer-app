import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText, useTextFieldStyle } from './AppText';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { SectionDivider } from './SectionDivider';
import { SettingGroup } from './SettingGroup';
import { SettingStepperRow } from './SettingStepperRow';
import { StepButton } from './StepButton';
import { forwardChevron } from '@/i18n/direction';
import { NON_DIGIT_CHARACTERS, formatDate as localizedDate, formatNumber, toAsciiDigits } from '@/i18n/numerals';
import {
  addDays,
  isAfterDay,
  parseDay,
  toDayString,
  todayDay as calendarToday,
} from '@/domain/dates';
import { averageExemptDaysPerMonth } from '@/domain/exemptions';
import { emptyDebts, estimateDebt, estimateRangeDays, totalDebt } from '@/domain/qada';
import { PRAYERS, type Prayer, type PrayerDay, type QadaDebts } from '@/domain/types';
import { useQada } from '@/hooks/useQada';
import {
  MAX_EXEMPT_DAYS_PER_MONTH,
  MIN_EXEMPT_DAYS_PER_MONTH,
  useExemptionSettings,
  useSettingsActions,
} from '@/stores/settingsStore';
import { useExemptPeriods } from '@/stores/trackingStore';
import { radius, spacing, useTheme } from '@/theme';

/**
 * The qada setup wizard — the first thing the qada screen shows, and re-runnable from it.
 *
 * Three steps, and the first one is the whole point (PRODUCT_SPEC §7):
 *
 * 1. **Where to start.** Count what was missed, or begin at zero. The copy is careful not to
 *    make either the "honest" choice — someone who cannot face a number is not doing it wrong,
 *    and someone who wants the number is not being morbid.
 * 2. **When** (backtracking only). A date range, which `domain/qada.estimateDebt` turns into five
 *    counters.
 *
 *    Two rules here exist because of a number a user was actually shown — an estimate of ~372
 *    prayers *per prayer* for a stretch he meant to be four days:
 *
 *    - **Nothing is pre-filled.** The range used to open a year wide, and the date picker
 *      therefore opened a year in the past, so a day tapped in the month it was showing kept
 *      that old year and quietly bought a year of debt. The start day now begins unset and the
 *      picker opens on the end of the range (near today), so a mis-tap costs days, never a year.
 *    - **The number is on screen before it is applied.** The range step shows the span and the
 *      total it would produce, so an estimate can never arrive unseen. Overstating a debt is
 *      the most harmful thing this feature can do, so the range that produces it is never
 *      allowed to be invisible.
 *
 *    The range also stops at **yesterday**: today's prayers belong to the Today screen, which
 *    already turns a missed one into debt, and charging for a day that is not over yet would
 *    both overstate and double-count.
 *
 *    The excused-days deduction is offered **only when the feature is on**
 *    (PRODUCT_SPEC §6) — a woman who has not turned it on must not be handed a menstrual
 *    settings question out of nowhere, and everyone else must not be shown a deduction that means
 *    nothing to them. The days-each-month figure the deduction needs is asked HERE, in context,
 *    at the moment it changes the number on screen — never as a free-floating Settings control.
 *    Its starting point is her own recorded excused days over the chosen range
 *    (`domain/exemptions.averageExemptDaysPerMonth`) whenever that history is long enough to
 *    say anything; only failing that does it fall back to the remembered figure.
 * 3. **The estimate, edited.** Never presented as a verdict: every one of the five numbers is a
 *    text field, and the total updates as they are changed. The word "estimate" is in the copy
 *    because that is what it is.
 *
 * Skipping is offered on every step and is not a failure state — it simply marks the setup done
 * (`settings.qadaSetupCompleted`) so the wizard never ambushes anyone twice.
 *
 * The component owns its draft state only. Every write goes through `useQada`, so the counters
 * and the "setup completed" flag land through the same door the rest of the feature uses.
 */

/** Which step is on screen. */
type Step = 'choice' | 'range' | 'estimate';

export interface QadaSetupWizardProps {
  /** Called after the wizard saves, skips, or is dismissed — the screen closes it. */
  onDone: () => void;
  /**
   * The day the range ends on by default, and the latest day it may reach. Defaults to the local
   * calendar date; the screen passes the prayer day it is already holding.
   */
  today?: PrayerDay;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Per-prayer text drafts, so a field the user has cleared is not silently a zero yet. */
type Drafts = Record<Prayer, string>;

function draftsFrom(debts: QadaDebts, language: string): Drafts {
  const draft = (value: number) => formatNumber(value, language, { useGrouping: false });
  return {
    fajr: draft(debts.fajr),
    dhuhr: draft(debts.dhuhr),
    asr: draft(debts.asr),
    maghrib: draft(debts.maghrib),
    isha: draft(debts.isha),
  };
}

/**
 * A draft field back to a count: anything unusable reads as zero, never as an error.
 *
 * `toAsciiDigits` first, because the field accepts whatever digits the user's own number pad
 * emits — `٣` on an Arabic-locale keyboard — and `Number.parseInt` only reads ASCII.
 */
function countFrom(draft: string): number {
  const digits = toAsciiDigits(draft).replace(/[^0-9]/g, '');
  if (digits === '') return 0;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : 0;
}

function debtsFrom(drafts: Drafts): QadaDebts {
  const debts = emptyDebts();
  for (const prayer of PRAYERS) debts[prayer] = countFrom(drafts[prayer]);
  return debts;
}

/**
 * The setup wizard.
 *
 * @param onDone - Called once the wizard has finished, in every exit path.
 * @returns The current step, on paper.
 */
export function QadaSetupWizard({
  onDone,
  today = calendarToday(),
  style,
  testID = 'qada-wizard',
}: QadaSetupWizardProps) {
  const { t, i18n } = useTranslation();
  const fieldStyle = useTextFieldStyle();
  const language = i18n.language;
  const { colors } = useTheme();
  const { saveDebts, completeSetup } = useQada();
  const exemption = useExemptionSettings();
  const { setExemptDaysPerMonth } = useSettingsActions();
  const periods = useExemptPeriods();

  const [step, setStep] = useState<Step>('choice');
  // The last day this wizard may charge for. Day arithmetic is `domain/dates`' job, never a
  // milliseconds subtraction: yesterday across a DST boundary is one calendar day back, not
  // 86 400 000 ms back.
  const latestDay = useMemo(() => addDays(today, -1), [today]);
  // `null` until the user says where to start: a pre-filled range is a debt nobody chose.
  const [startDay, setStartDay] = useState<PrayerDay | null>(null);
  const [endDay, setEndDay] = useState<PrayerDay>(latestDay);
  const [deduct, setDeduct] = useState(false);
  // `null` until she touches the stepper: the suggestion below keeps tracking the range until then.
  const [daysAdjusted, setDaysAdjusted] = useState<number | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(emptyDebts(), language));

  // Her own records beat a guess: the observed average over the exact window being estimated.
  // `null` — window too short, or nothing recorded in it — falls back to the remembered figure.
  const observedDays = useMemo(() => {
    if (startDay === null) return null;
    try {
      return averageExemptDaysPerMonth(periods, startDay, endDay);
    } catch {
      return null;
    }
  }, [periods, startDay, endDay]);
  const suggestedDays =
    observedDays === null
      ? exemption.daysPerMonth
      : Math.min(
          MAX_EXEMPT_DAYS_PER_MONTH,
          Math.max(MIN_EXEMPT_DAYS_PER_MONTH, Math.round(observedDays))
        );
  const exemptDays = daysAdjusted ?? suggestedDays;

  const formatDate = useCallback(
    (day: PrayerDay) =>
      localizedDate(parseDay(day), i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [i18n.language]
  );

  /**
   * The estimate for the chosen range: `null` while no start day has been chosen, and `null`
   * when the range runs backwards. Either way there is no number to show and no way forward.
   */
  const estimate = useMemo((): QadaDebts | null => {
    if (startDay === null) return null;
    try {
      return estimateDebt({
        startDay,
        endDay,
        // The deduction is only ever applied when the feature it belongs to is switched on, so a
        // stale `true` from a toggle the user later turned off in Settings cannot leak into it.
        deductExemptions: deduct && exemption.enabled,
        exemptDaysPerMonth: exemptDays,
      });
    } catch {
      return null;
    }
  }, [startDay, endDay, deduct, exemption.enabled, exemptDays]);

  const finish = useCallback(() => {
    completeSetup();
    onDone();
  }, [completeSetup, onDone]);

  const startBlank = useCallback(() => {
    // "Begin at zero" is a real write, not just a flag: the counters are set, so the choice
    // survives a reinstall of the screen and reads the same as any other saved setup.
    saveDebts(emptyDebts(), 'manual');
    finish();
  }, [saveDebts, finish]);

  const showEstimate = useCallback(() => {
    if (estimate === null) return;
    // The figure that was actually used is worth remembering: a re-run without enough recorded
    // history starts from her answer instead of the shipped default.
    if (deduct && exemption.enabled) setExemptDaysPerMonth(exemptDays);
    setDrafts(draftsFrom(estimate, language));
    setStep('estimate');
  }, [estimate, language, deduct, exemption.enabled, exemptDays, setExemptDaysPerMonth]);

  const save = useCallback(() => {
    saveDebts(debtsFrom(drafts), 'estimate');
    finish();
  }, [saveDebts, drafts, finish]);

  const adjust = useCallback((prayer: Prayer, delta: number) => {
    setDrafts((current) => ({
      ...current,
      [prayer]: formatNumber(Math.max(0, countFrom(current[prayer]) + delta), language, {
        useGrouping: false,
      }),
    }));
  }, [language]);

  const handlePicked = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      const which = picking;
      setPicking(null);
      if (which === null || event.type === 'dismissed' || date === undefined) return;
      // `maximumDate` already stops this on both platforms; clamping again costs nothing and
      // means no picker quirk can ever charge someone for a day that has not happened yet.
      const picked = toDayString(date);
      const day = isAfterDay(picked, latestDay) ? latestDay : picked;
      if (which === 'start') setStartDay(day);
      else setEndDay(day);
    },
    [picking, latestDay]
  );

  const draftTotal = useMemo(() => totalDebt(debtsFrom(drafts)), [drafts]);

  /**
   * What the chosen range would cost, in the range step itself: how long it is and how many
   * prayers that comes to. This is the guard against a silently wrong range — the number is
   * read before it is applied, not discovered afterwards on the counters.
   */
  const rangeSummary = useMemo(() => {
    if (startDay === null || estimate === null) return null;
    const days = estimateRangeDays(startDay, endDay);
    return t('qada.setup.range.summary', {
      days: t('qada.setup.range.days', { count: days }),
      total: t('qada.count', { count: totalDebt(estimate) }),
    });
  }, [startDay, endDay, estimate, t]);

  return (
    <View testID={testID} style={[{ gap: spacing.lg }, style]}>
      {step === 'choice' ? (
        <>
          <Heading title={t('qada.setup.title')} body={t('qada.setup.body')} />
          <ChoiceCard
            testID={`${testID}-choice-backtrack`}
            icon="history"
            title={t('qada.setup.backtrack.title')}
            body={t('qada.setup.backtrack.body')}
            onPress={() => setStep('range')}
          />
          <ChoiceCard
            testID={`${testID}-choice-blank`}
            icon="spa"
            title={t('qada.setup.blank.title')}
            body={t('qada.setup.blank.body')}
            onPress={startBlank}
          />
          <QuietAction testID={`${testID}-skip`} label={t('qada.setup.skip')} onPress={finish} />
        </>
      ) : null}

      {step === 'range' ? (
        <>
          <Heading title={t('qada.setup.range.title')} body={t('qada.setup.range.body')} />

          <Card variant="bright" border="mid" style={{ padding: spacing.lg, gap: spacing.md }}>
            <DateField
              testID={`${testID}-from`}
              label={t('qada.setup.range.from')}
              value={startDay === null ? t('qada.setup.range.pick') : formatDate(startDay)}
              chosen={startDay !== null}
              onPress={() => setPicking('start')}
            />
            <SectionDivider placement="bottom" />
            <DateField
              testID={`${testID}-to`}
              label={t('qada.setup.range.to')}
              value={formatDate(endDay)}
              onPress={() => setPicking('end')}
            />
          </Card>

          {picking !== null ? (
            <DateTimePicker
              testID={`${testID}-picker`}
              mode="date"
              // An unset start opens on the end of the range — i.e. near today. The picker used
              // to open a year back (the old default), which is how a day tapped in the month it
              // was showing silently kept the wrong year and bought a year of debt.
              value={parseDay(picking === 'start' ? (startDay ?? endDay) : endDay)}
              // Yesterday, not today: today's prayers are the Today screen's to log.
              maximumDate={parseDay(latestDay)}
              onChange={handlePicked}
            />
          ) : null}

          {/* The deduction exists only inside the excused-days feature (PRODUCT_SPEC §6). */}
          {exemption.enabled ? (
            <PressableScale
              testID={`${testID}-deduct`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: deduct }}
              accessibilityLabel={t('qada.setup.range.exempt')}
              accessibilityHint={t('qada.setup.range.exemptBody')}
              onPress={() => setDeduct((value) => !value)}
            >
              <Card
                variant={deduct ? 'bright' : 'normal'}
                border={deduct ? 'strong' : 'faint'}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  padding: spacing.lg,
                }}
              >
                <Icon
                  name={deduct ? 'check_circle' : 'circle'}
                  variant={deduct ? 'filled' : 'outlined'}
                  size={22}
                  color={deduct ? colors.accent : colors.unlogged}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="rowName">{t('qada.setup.range.exempt')}</AppText>
                  <AppText variant="caption" tone="header">
                    {t('qada.setup.range.exemptBody')}
                  </AppText>
                </View>
              </Card>
            </PressableScale>
          ) : null}

          {/* The days-each-month figure, asked at the one moment it means something: while the
              number it changes is on screen. Prefilled from her recorded days when the range
              holds enough history, otherwise from the remembered figure. */}
          {exemption.enabled && deduct ? (
            <SettingGroup divider={false}>
              <SettingStepperRow
                testID={`${testID}-days-per-month`}
                label={t('qada.setup.range.daysPerMonth.label')}
                description={
                  observedDays === null
                    ? t('qada.setup.range.daysPerMonth.guess')
                    : t('qada.setup.range.daysPerMonth.fromRecords')
                }
                value={exemptDays}
                min={MIN_EXEMPT_DAYS_PER_MONTH}
                max={MAX_EXEMPT_DAYS_PER_MONTH}
                onChange={setDaysAdjusted}
                decreaseLabel={t('qada.setup.range.daysPerMonth.decrease')}
                increaseLabel={t('qada.setup.range.daysPerMonth.increase')}
              />
            </SettingGroup>
          ) : null}

          {/* What this range would cost, before it costs it. */}
          {rangeSummary !== null ? (
            <Card variant="bright" border="mid" style={{ padding: spacing.md }}>
              <AppText
                testID={`${testID}-summary`}
                variant="caption"
                tone="header"
                style={{ textAlign: 'center' }}
              >
                {rangeSummary}
              </AppText>
            </Card>
          ) : null}

          {/* On a card, never the bare paper: `late` clears AA on cardBright (4.655:1) but only
              3.80:1 on the screen ground — the call-site defect disclosed in D56. A start day
              that has not been chosen yet is not an error, so it says nothing. */}
          {startDay !== null && estimate === null ? (
            <Card variant="bright" border="mid" style={{ padding: spacing.md }}>
              <AppText
                testID={`${testID}-range-error`}
                variant="caption"
                color={colors.late}
                style={{ textAlign: 'center' }}
              >
                {t('qada.setup.range.invalid')}
              </AppText>
            </Card>
          ) : null}

          <PrimaryAction
            testID={`${testID}-next`}
            label={t('qada.setup.range.next')}
            disabled={estimate === null}
            onPress={showEstimate}
          />
          <QuietAction
            testID={`${testID}-back`}
            label={t('qada.setup.back')}
            onPress={() => setStep('choice')}
          />
        </>
      ) : null}

      {step === 'estimate' ? (
        <>
          <Heading title={t('qada.setup.estimate.title')} body={t('qada.setup.estimate.body')} />

          <Card variant="bright" border="mid" style={{ padding: spacing.lg, gap: spacing.sm }}>
            {PRAYERS.map((prayer) => (
              <View
                key={prayer}
                style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="rowName">{t(`prayers.${prayer}`)}</AppText>
                </View>
                <StepButton
                  testID={`${testID}-minus-${prayer}`}
                  icon="remove"
                  accessibilityLabel={t('qada.setup.estimate.decrease', {
                    prayer: t(`prayers.${prayer}`),
                  })}
                  onPress={() => adjust(prayer, -1)}
                />
                <TextInput
                  testID={`${testID}-count-${prayer}`}
                  accessibilityLabel={t('qada.setup.estimate.field', {
                    prayer: t(`prayers.${prayer}`),
                  })}
                  value={drafts[prayer]}
                  // Digits of *any* script survive the filter: an Arabic-locale number pad sends
                  // U+0660–U+0669, and an `[^0-9]` filter would delete every keystroke as it
                  // arrived — a field that simply cannot be typed into, but only in Arabic.
                  onChangeText={(text) =>
                    setDrafts((current) => ({
                      ...current,
                      [prayer]: text.replace(NON_DIGIT_CHARACTERS, ''),
                    }))
                  }
                  keyboardType="number-pad"
                  selectTextOnFocus
                  maxLength={6}
                  style={{
                    minWidth: 74,
                    paddingVertical: 6,
                    borderRadius: radius.card,
                    borderWidth: 1,
                    borderColor: colors.borderMid,
                    backgroundColor: colors.cardElevated,
                    ...fieldStyle,
                    // A centred figure in a bordered box: this one field really does want
                    // `center`, so it overrides the resolver's leading-edge default.
                    textAlign: 'center',
                    color: colors.ink,
                    fontVariant: ['tabular-nums'],
                  }}
                />
                <StepButton
                  testID={`${testID}-plus-${prayer}`}
                  icon="add"
                  accessibilityLabel={t('qada.setup.estimate.increase', {
                    prayer: t(`prayers.${prayer}`),
                  })}
                  onPress={() => adjust(prayer, 1)}
                />
              </View>
            ))}
          </Card>

          <AppText testID={`${testID}-total`} variant="caption" style={{ textAlign: 'center' }}>
            {t('qada.setup.estimate.total', {
              total: t('qada.count', { count: draftTotal }),
            })}
          </AppText>

          <PrimaryAction
            testID={`${testID}-save`}
            label={t('qada.setup.estimate.save')}
            onPress={save}
          />
          <QuietAction
            testID={`${testID}-back`}
            label={t('qada.setup.back')}
            onPress={() => setStep('range')}
          />
        </>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------------------------- */

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <View accessible accessibilityRole="header" style={{ gap: spacing.xs }}>
      <AppText variant="hero" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText variant="caption" tone="header" style={{ textAlign: 'center' }}>
        {body}
      </AppText>
    </View>
  );
}

interface ChoiceCardProps {
  icon: IconName;
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
}

function ChoiceCard({ icon, title, body, onPress, testID }: ChoiceCardProps) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={body}
      onPress={onPress}
    >
      <Card
        variant="bright"
        border="mid"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
        }}
      >
        <Icon name={icon} size={24} color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="rowName">{title}</AppText>
          <AppText variant="caption" tone="header">
            {body}
          </AppText>
        </View>
        {/* Points the way navigation goes, which mirrors with the writing direction. */}
        <Icon name={forwardChevron()} size={20} color={colors.faint} />
      </Card>
    </PressableScale>
  );
}

function DateField({
  label,
  value,
  onPress,
  testID,
  chosen = true,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID: string;
  /** `false` renders `value` as a prompt rather than as a date the user has settled on. */
  chosen?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 44,
      }}
    >
      <AppText variant="caption" tone="header" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="rowName" weight={chosen ? 600 : 400} tone={chosen ? 'strong' : 'muted'}>
        {value}
      </AppText>
      <Icon name="calendar_month" size={18} color={colors.faint} />
    </PressableScale>
  );
}

function PrimaryAction({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      haptics
      onPress={onPress}
      style={{
        alignSelf: 'center',
        paddingVertical: 11,
        paddingHorizontal: spacing.xxl,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.accent,
        backgroundColor: disabled ? colors.card : colors.accent,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <AppText
        variant="time"
        weight={600}
        tabularNums={false}
        color={disabled ? colors.header : colors.sealFg}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}

function QuietAction({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: spacing.lg }}
    >
      <AppText variant="caption" tone="header">
        {label}
      </AppText>
    </PressableScale>
  );
}
