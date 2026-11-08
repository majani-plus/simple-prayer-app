import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backChevron } from '@/i18n/direction';
import { formatNumber } from '@/i18n/numerals';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ClockZoneNote } from '@/components/ClockZoneNote';
import { Icon } from '@/components/Icon';
import { MethodPicker } from '@/components/MethodPicker';
import { OptionCard } from '@/components/OptionCard';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { SectionDivider } from '@/components/SectionDivider';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingRow } from '@/components/SettingRow';
import { SettingStepperRow } from '@/components/SettingStepperRow';
import { todayDay } from '@/domain/dates';
import { MAX_HIJRI_OFFSET, formatHijri, toHijri } from '@/domain/hijri';
import { METHOD_DESCRIPTION_KEYS, METHOD_LABEL_KEYS, resolveMethod } from '@/domain/methods';
import { computeDayTimes, getCurrentPrayerDay } from '@/domain/prayerTimes';
import { PRAYERS } from '@/domain/types';
import {
  MAX_PRAYER_OFFSET_MINUTES,
  useCalculationSettings,
  useLocation,
  useSettingsActions,
} from '@/stores/settingsStore';
import { useLayout } from '@/hooks/useLayout';
import { radius, spacing, useTheme } from '@/theme';
import { formatTime } from '@/utils/formatTime';

import type {
  CalculationSettings,
  HighLatitudeRuleId,
  Madhab,
  Prayer,
  PrayerOffsets,
  TimeMarker,
} from '@/domain/types';

/**
 * Settings → Prayer times (PRODUCT_SPEC §3 and §12).
 *
 * This is the screen the app's credibility rests on. The market research is emphatic about it: in
 * Türkiye and across the Arabic-speaking markets, "the times are wrong" is the review that sinks a
 * prayer app, and it almost never means the astronomy is wrong — it means the app disagrees with
 * the calendar the user's mosque prints (our market research). So every control here answers
 * the same question: **can I make this app agree with my mosque, and can I see that it did?**
 *
 * Four commitments follow from that:
 *
 * 1. **The authority is named, always.** `Auto` renders as "Auto · Diyanet", never as a shrug.
 * 2. **Every change previews itself.** The madhab rows carry today's resulting Asr; the offset
 *    rows carry today's resulting time for that prayer; the Hijri stepper carries the resulting
 *    Hijri date. Nothing here is a setting whose effect you have to go and look for.
 * 3. **The rule that does not apply says so.** The high-latitude rule is highlighted where it
 *    matters (roughly above 48°) and honestly labelled "makes no difference here" below that,
 *    rather than presented as a mysterious knob everybody must have an opinion about.
 * 4. **Nothing is computed here.** Times come from `domain/prayerTimes`, the authority list and
 *    the country map from `domain/methods`, the Hijri conversion from `domain/hijri`. Every write
 *    goes through `settingsStore`, which clamps it — so the Today tab, the notification planner
 *    and this screen can never hold different opinions about what the settings are.
 *
 * The previews are rendered on the **device clock**, like every other time in the app; when the
 * chosen city keeps a different one, `ClockZoneNote` says so at the top of this screen too.
 */

/**
 * Latitude beyond which the high-latitude rule starts to change anything, in degrees.
 *
 * adhan's own `HighLatitudeRule.recommended` switches to seventh-of-the-night at 48°, and that is
 * roughly where the astronomical twilight stops reaching the Fajr/Isha angle in midsummer (Paris
 * is 48.9°, Munich 48.1°). Below it the rules are equivalent in practice, which is exactly what
 * the screen tells the user rather than making them guess.
 */
const HIGH_LATITUDE_DEGREES = 48;

/** The high-latitude options, in the order the picker offers them. */
const HIGH_LATITUDE_RULES: readonly HighLatitudeRuleId[] = [
  'auto',
  'middleOfTheNight',
  'seventhOfTheNight',
  'twilightAngle',
];

/** The two Asr schools, Shafi first (the default). */
const MADHABS: readonly Madhab[] = ['shafi', 'hanafi'];

/** All-zero offsets — what "reset" writes. */
function zeroOffsets(): PrayerOffsets {
  return { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
}

export default function CalculationSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const location = useLocation();
  const calculation = useCalculationSettings();
  const { setCalculation, setPrayerOffset, setHijriOffset } = useSettingsActions();

  const [methodOpen, setMethodOpen] = useState(false);
  const [latitudeOpen, setLatitudeOpen] = useState(false);

  const locale = i18n.language;

  /** Plain integers in the locale's own numerals; the sign is added by an i18n layout key. */
  const numbers = useMemo(
    () => (value: number) => formatNumber(value, locale, { useGrouping: false }),
    [locale]
  );

  /**
   * Wraps a magnitude in its sign.
   *
   * `Intl.NumberFormat`'s own `signDisplay: 'exceptZero'` would be the obvious way to do this and
   * is deliberately avoided: it is an ES2020 option that several of the ICU builds React Native
   * ships on Android silently ignore, and an ignored sign turns "five minutes later" into "five
   * minutes" — a wrong prayer time with no visible cause. The sign is therefore a translated
   * layout key, which cannot be dropped by a platform.
   */
  const withSign = useCallback(
    (value: number, magnitude: string): string =>
      t(value > 0 ? 'settings.calculation.sign.plus' : 'settings.calculation.sign.minus', {
        value: magnitude,
      }),
    [t]
  );

  const resolvedMethod = resolveMethod(calculation.method, location?.countryCode);
  const countryName = useMemo(() => {
    const code = location?.countryCode;
    if (code === undefined) return undefined;
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      // `DisplayNames` is missing from some minimal ICU builds; the raw code still reads fine.
      return code;
    }
  }, [location?.countryCode, locale]);

  /**
   * The prayer day the previews describe. Between midnight and Fajr that is still *yesterday*
   * (`domain/dates`), which is exactly the day the Today tab is showing — the two screens must
   * never disagree about which times are "today's". Falls back to the calendar date when there is
   * no location to compute a boundary from.
   */
  const day = useMemo(() => {
    if (location === null) return todayDay();
    try {
      return getCurrentPrayerDay(new Date(), location, calculation);
    } catch {
      return todayDay();
    }
  }, [location, calculation]);

  /** Times under a hypothetical settings change, or `null` when they cannot be computed. */
  const timesFor = useCallback(
    (patch: Partial<CalculationSettings>): Record<TimeMarker, Date> | null => {
      if (location === null) return null;
      try {
        return computeDayTimes(day, location, { ...calculation, ...patch }).times;
      } catch {
        // A polar day the engine cannot resolve must cost the preview, never the screen.
        return null;
      }
    },
    [location, day, calculation]
  );

  const currentTimes = useMemo(() => timesFor({}), [timesFor]);
  const asrByMadhab = useMemo(
    () => ({
      shafi: timesFor({ madhab: 'shafi' })?.asr ?? null,
      hanafi: timesFor({ madhab: 'hanafi' })?.asr ?? null,
    }),
    [timesFor]
  );

  const showTime = useCallback(
    (value: Date | null | undefined): string | undefined =>
      value === null || value === undefined ? undefined : formatTime(value, { locale }),
    [locale]
  );

  const adjustedPrayers = PRAYERS.filter((prayer) => calculation.offsets[prayer] !== 0);
  const highLatitudeRelevant =
    location !== null && Math.abs(location.latitude) >= HIGH_LATITUDE_DEGREES;

  const hijriPreview = useMemo(() => {
    const formatted = formatHijri(toHijri(day, calculation.hijriOffset), {
      style: 'dayMonthYear',
      includeEra: true,
    });
    const numbers = (value: number) => formatNumber(value, locale, { useGrouping: false });
    return t('settings.calculation.hijri.preview', {
      day: numbers(formatted.date.day),
      month: t(formatted.monthKey),
      year: numbers(formatted.date.year),
      era: t('hijri.era.ah'),
    });
  }, [day, calculation.hijriOffset, locale, t]);

  const formatOffset = useCallback(
    (minutes: number): string =>
      minutes === 0
        ? t('settings.calculation.offsets.none')
        : withSign(
            minutes,
            t('settings.calculation.offsets.value', {
              value: numbers(Math.abs(minutes)),
            })
          ),
    [numbers, t, withSign]
  );

  const formatHijriOffset = useCallback(
    (days: number): string =>
      days === 0
        ? t('settings.calculation.hijri.none')
        : withSign(
            days,
            t('settings.calculation.hijri.days', {
              count: Math.abs(days),
              value: numbers(Math.abs(days)),
            })
          ),
    [numbers, t, withSign]
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const resetOffsets = useCallback(() => {
    setCalculation({ offsets: zeroOffsets() });
  }, [setCalculation]);

  return (
    <PaperBackground>
      <ScrollView
        testID="calculation-settings-scroll"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + spacing.lg,
          paddingHorizontal: spacing.xl,
          paddingBottom: insets.bottom + spacing.xxl,
          gap: spacing.lg,
          ...contentClampPadding(spacing.xl),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <PressableScale
            testID="calculation-back"
            accessibilityRole="button"
            accessibilityLabel={t('settings.calculation.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('settings.calculation.title')}
          </AppText>
        </View>

        <SectionDivider />

        {/* The authority, said out loud, before any control. */}
        <Card
          testID="calculation-summary"
          variant="bright"
          border="strong"
          style={{ gap: spacing.xs, padding: spacing.lg }}
        >
          <View accessible accessibilityRole="text" style={{ gap: 2 }}>
            <AppText variant="caption" tone="header">
              {calculation.method === 'auto'
                ? t('settings.calculation.summary.auto')
                : t('settings.calculation.summary.manual')}
            </AppText>
            <AppText testID="calculation-summary-authority" variant="hero">
              {t(METHOD_LABEL_KEYS[resolvedMethod])}
            </AppText>
            <AppText variant="caption" tone="header">
              {t(METHOD_DESCRIPTION_KEYS[resolvedMethod])}
            </AppText>
          </View>
          {adjustedPrayers.length > 0 ? (
            <AppText testID="calculation-summary-adjusted" variant="hint">
              {t('settings.calculation.summary.adjustedList', {
                prayers: adjustedPrayers.map((prayer) => t(`prayers.${prayer}`)).join(', '),
              })}
            </AppText>
          ) : null}
        </Card>

        <ClockZoneNote location={location} />

        {location === null ? (
          <Card
            testID="calculation-no-location"
            variant="normal"
            border="faint"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              padding: spacing.lg,
            }}
          >
            <Icon name="location_on" size={19} variant="outlined" color={colors.faint} />
            <AppText variant="caption" tone="header" style={{ flex: 1 }}>
              {t('settings.calculation.noLocation')}
            </AppText>
          </Card>
        ) : null}

        {/* ---- Method ---------------------------------------------------------------------- */}
        <SettingGroup
          testID="calculation-method-group"
          title={t('settings.calculation.method.title')}
          footer={t('settings.calculation.method.footer')}
        >
          <SettingRow
            testID="calculation-method-toggle"
            icon="mosque"
            label={t('settings.calculation.method.current')}
            description={t('settings.calculation.method.description')}
            value={
              calculation.method === 'auto'
                ? t('settings.calculation.method.autoLabel', {
                    authority: t(METHOD_LABEL_KEYS[resolvedMethod]),
                  })
                : t(METHOD_LABEL_KEYS[resolvedMethod])
            }
            onPress={() => setMethodOpen((open) => !open)}
          />
        </SettingGroup>

        {methodOpen ? (
          <MethodPicker
            value={calculation.method}
            countryCode={location?.countryCode}
            countryName={countryName}
            onChange={(method) => {
              setCalculation({ method });
              setMethodOpen(false);
            }}
          />
        ) : null}

        {/* ---- Asr madhab ------------------------------------------------------------------ */}
        <SettingGroup
          testID="calculation-madhab-group"
          title={t('settings.calculation.madhab.title')}
          footer={t('settings.calculation.madhab.footer')}
        >
          <View style={{ gap: spacing.xs, padding: spacing.md }}>
            {MADHABS.map((madhab) => (
              <OptionCard
                key={madhab}
                testID={`calculation-madhab-${madhab}`}
                label={t(`settings.calculation.madhab.option.${madhab}`)}
                description={t(`settings.calculation.madhab.description.${madhab}`)}
                value={showTime(asrByMadhab[madhab])}
                selected={calculation.madhab === madhab}
                onPress={() => setCalculation({ madhab })}
                accessibilityHint={t('settings.calculation.madhab.a11yHint')}
              />
            ))}
          </View>
        </SettingGroup>

        {/* ---- High-latitude rule ---------------------------------------------------------- */}
        <SettingGroup
          testID="calculation-latitude-group"
          title={t('settings.calculation.highLatitude.title')}
          footer={
            highLatitudeRelevant
              ? t('settings.calculation.highLatitude.relevant')
              : t('settings.calculation.highLatitude.notRelevant')
          }
        >
          <SettingRow
            testID="calculation-latitude-toggle"
            icon="wb_twilight"
            label={t('settings.calculation.highLatitude.current')}
            description={t('settings.calculation.highLatitude.description')}
            value={t(`settings.calculation.highLatitude.option.${calculation.highLatitudeRule}`)}
            // A disclosure, not a push: the options open underneath this row. The caret has to
            // say so, and has to say which way it will go — a right-pointing chevron above a
            // list that is already open promises a screen that does not exist.
            expanded={latitudeOpen || highLatitudeRelevant}
            onPress={() => setLatitudeOpen((open) => !open)}
          />
          {latitudeOpen || highLatitudeRelevant ? (
            <View
              testID="calculation-latitude-options"
              style={{ gap: spacing.xs, padding: spacing.md }}
            >
              {HIGH_LATITUDE_RULES.map((rule) => (
                <OptionCard
                  key={rule}
                  testID={`calculation-latitude-${rule}`}
                  label={t(`settings.calculation.highLatitude.option.${rule}`)}
                  description={t(`settings.calculation.highLatitude.explain.${rule}`)}
                  selected={calculation.highLatitudeRule === rule}
                  onPress={() => setCalculation({ highLatitudeRule: rule })}
                />
              ))}
            </View>
          ) : null}
        </SettingGroup>

        {/* ---- Per-prayer offsets ---------------------------------------------------------- */}
        <SettingGroup
          testID="calculation-offsets-group"
          title={t('settings.calculation.offsets.title')}
          footer={t('settings.calculation.offsets.footer')}
        >
          {PRAYERS.map((prayer) => (
            <OffsetRow
              key={prayer}
              prayer={prayer}
              minutes={calculation.offsets[prayer]}
              time={showTime(currentTimes?.[prayer])}
              formatValue={formatOffset}
              onChange={(minutes) => setPrayerOffset(prayer, minutes)}
            />
          ))}
          {adjustedPrayers.length > 0 ? (
            <View style={{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}>
              <PressableScale
                testID="calculation-offsets-reset"
                accessibilityRole="button"
                accessibilityLabel={t('settings.calculation.offsets.reset')}
                accessibilityHint={t('settings.calculation.offsets.resetHint')}
                haptics
                onPress={resetOffsets}
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 44,
                  paddingVertical: 10,
                  paddingHorizontal: spacing.lg,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.borderMid,
                  backgroundColor: colors.card,
                }}
              >
                <Icon name="undo" size={16} color={colors.accent} />
                <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
                  {t('settings.calculation.offsets.reset')}
                </AppText>
              </PressableScale>
            </View>
          ) : null}
        </SettingGroup>

        {/* ---- Hijri offset ---------------------------------------------------------------- */}
        <SettingGroup
          testID="calculation-hijri-group"
          title={t('settings.calculation.hijri.title')}
          footer={t('settings.calculation.hijri.footer')}
        >
          <SettingStepperRow
            testID="calculation-hijri-stepper"
            label={t('settings.calculation.hijri.label')}
            // The preview *is* the description here: what the shift produces, not what it means.
            description={hijriPreview}
            value={calculation.hijriOffset}
            min={-MAX_HIJRI_OFFSET}
            max={MAX_HIJRI_OFFSET}
            onChange={setHijriOffset}
            formatValue={formatHijriOffset}
            accessibilityLabel={t('settings.calculation.hijri.a11yLabel')}
            decreaseLabel={t('settings.calculation.hijri.decrease')}
            increaseLabel={t('settings.calculation.hijri.increase')}
          />
        </SettingGroup>

        <AppText variant="hint" style={{ textAlign: 'center' }}>
          {t('settings.calculation.footerHint')}
        </AppText>
      </ScrollView>
    </PaperBackground>
  );
}

/* -------------------------------------------------------------------------------------------- */

/**
 * One prayer's manual adjustment: the name, the time it currently produces, and the stepper.
 *
 * The time is the *result* — offset already applied by `domain/prayerTimes` — so a user holding a
 * printed takvim can tap until the two agree and then stop, which is the entire interaction this
 * feature exists for.
 */
function OffsetRow({
  prayer,
  minutes,
  time,
  formatValue,
  onChange,
}: {
  prayer: Prayer;
  minutes: number;
  time: string | undefined;
  formatValue: (value: number) => string;
  onChange: (minutes: number) => void;
}) {
  const { t } = useTranslation();
  const name = t(`prayers.${prayer}`);

  return (
    <SettingStepperRow
      testID={`calculation-offset-stepper-${prayer}`}
      label={name}
      // The resulting time rides on the label's line, not the trailing edge: it belongs to the
      // prayer's name, and the trailing edge is where the adjustment itself lives.
      leading={
        time === undefined ? undefined : (
          <AppText testID={`calculation-offset-time-${prayer}`} variant="time" weight={600}>
            {time}
          </AppText>
        )
      }
      value={minutes}
      min={-MAX_PRAYER_OFFSET_MINUTES}
      max={MAX_PRAYER_OFFSET_MINUTES}
      onChange={onChange}
      formatValue={formatValue}
      accessibilityLabel={t('settings.calculation.offsets.a11yLabel', { prayer: name })}
      decreaseLabel={t('settings.calculation.offsets.decrease', { prayer: name })}
      increaseLabel={t('settings.calculation.offsets.increase', { prayer: name })}
    />
  );
}
