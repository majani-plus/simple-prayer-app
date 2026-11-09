import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { ExportRow, useDataExport } from '@/components/DataExportRows';
import { PaperBackground } from '@/components/PaperBackground';
import { PledgeCard } from '@/components/PledgeCard';
import { FeedbackRow } from '@/components/FeedbackRow';
import { RateAppRow } from '@/components/RateAppRow';
import { SettingChoiceRow, type SettingChoiceOption } from '@/components/SettingChoiceRow';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingNavigationRow, SettingRow, SettingSwitchRow } from '@/components/SettingRow';
import { TipJar } from '@/components/TipJar';
import { parseDay } from '@/domain/dates';
import { findOngoingPeriod } from '@/domain/exemptions';
import { methodLabelKey, resolveMethod } from '@/domain/methods';
import { PRAYERS } from '@/domain/types';
import { formatDate } from '@/i18n/numerals';
import { sentryDsn } from '@/services/telemetry';
import { HealthNotice } from '@/components/HealthNotice';
import { useWatchInstallHint } from '@/hooks/useWatchInstallHint';
import { useLanguageSwitch } from '@/i18n/useLanguageSwitch';
import { useBuddyEnabled } from '@/stores/buddyStore';
import { useExemptPeriods, useTrackingStore } from '@/stores/trackingStore';
import {
  useCalculationSettings,
  useCrashReportingEnabled,
  useExemptionSettings,
  useLocation,
  useReminders,
  useSettingsActions,
  useStreakMode,
  useTrackingMode,
  useArabicNumerals,
  useThemePreference,
  useUseAutoLocation,
} from '@/stores/settingsStore';
import { useLayout } from '@/hooks/useLayout';
import { spacing } from '@/theme';

import type {
  LanguagePreference,
  NumeralPreference,
  StreakMode,
  TrackingMode,
  ThemePreference,
} from '@/domain/types';

/**
 * The Settings tab (PRODUCT_SPEC §12) — the index of everything the app can be told.
 *
 * It is a *list of doors and switches*, nothing more. Anything with more than about four options
 * (the calculation method, the per-prayer reminder matrix, city search, the excused-days
 * register) lives on its own screen behind a navigation row, and this screen shows the answer
 * that screen produced as the row's value — so the whole configuration can be read at a glance
 * without opening anything.
 *
 * The rules it follows:
 *
 * - **Groups are questions, not features.** Each group is a titled paper card behind a ◆ rule,
 *   named for the thing somebody opens Settings *to do*, in the order they are likely to want it
 *   (D178): are my times right → what reminds me → who prays with me → what my log counts → how
 *   it looks → what leaves the phone → where to get help. Location sits inside Prayer times
 *   because "the times are wrong" is one question with two answers (where you are, and whose
 *   method), and nobody should have to guess which of two groups holds theirs. Buddies is a
 *   group of its own near the top because a feature nobody can find is a feature nobody has
 *   (owner, 2026-09-16); it is still off by default and nothing outside this screen mentions it
 *   (D174). The exports live under the log they export, so the list has one fewer heading.
 * - **No paragraphs on the index.** A row is a label, one sentence, and a value. The excused-days
 *   explanation — the one place in the app that names menstruation and post-natal bleeding
 *   (D62) — sits under its switch on the excused-days screen, so the index reads in the neutral
 *   register and a glance at an open Settings tab says nothing a stranger can name.
 * - **Immediate application.** Theme and language are written straight to the settings store,
 *   which the root layout watches; the paper repaints and the whole app re-renders in the new
 *   language without a confirm step. The **one** exception is a language change that turns the
 *   layout around — Arabic in or out — because React Native fixes the writing direction at
 *   startup. That case asks first and offers to reopen the app; the whole protocol lives in
 *   `i18n/useLanguageSwitch`, so this screen still just renders chips.
 * - **Empty groups vanish.** `SettingGroup` renders nothing when it has no rows, which is what
 *   lets the watch group be conditional and the tip jar be absent (D46) without any extra
 *   wiring here.
 * - **A leading glyph means "this leads somewhere".** Navigation rows carry one; rows you operate
 *   in place (the choice chips, the switches) do not, so the icon column reads as a signpost
 *   rather than decoration.
 *
 * Composition only: every value comes from the settings store, every string from i18n, and every
 * row from the shared setting-row vocabulary (`SettingRow`, `SettingChoiceRow`,
 * `SettingStepperRow`) that the settings sub-screens build from too.
 */

/**
 * The sub-screens this index links to. Every one of them now exists as a file, so these are left
 * as plain literals and checked against expo-router's generated route union: renaming or deleting
 * one of those files is a typecheck failure here rather than a dead row discovered by hand. (They
 * were asserted with `as Href` while the screens were still being built — an assertion that would
 * now hide exactly the breakage it was covering for.)
 */
const ROUTES = {
  location: '/settings/location',
  calculation: '/settings/calculation',
  reminders: '/settings/reminders',
  reminderHealth: '/settings/reminder-health',
  exemption: '/settings/exemption',
  buddies: '/settings/buddies',
  about: '/settings/about',
  qada: '/qada',
} as const satisfies Record<string, Href>;

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  // Speaks only when a paired watch is missing the app; silent everywhere else.
  const watchInstallWanted = useWatchInstallHint();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const location = useLocation();
  const useAutoLocation = useUseAutoLocation();
  const calculation = useCalculationSettings();
  const streakMode = useStreakMode();
  const { enabled: exemptionEnabled } = useExemptionSettings();
  const buddyEnabled = useBuddyEnabled();
  const reminders = useReminders();
  const theme = useThemePreference();
  const arabicNumerals = useArabicNumerals();
  // Language is the one preference that cannot simply be written: switching to or from Arabic
  // turns the whole layout around, which React Native can only do at startup. The hook owns the
  // warning and the reload (src/i18n/useLanguageSwitch.ts); this screen just renders the chips.
  const { preference: language, chooseLanguage, awaitingRestart, restartNow } = useLanguageSwitch();
  const crashReportingEnabled = useCrashReportingEnabled();
  const trackingMode = useTrackingMode();
  const { setStreakMode, setTrackingMode, setTheme, setCrashReportingEnabled, setArabicNumerals } =
    useSettingsActions();
  // One controller for both export rows, so the second is disabled while the first is running.
  const dataExport = useDataExport();

  // The excused-days row reads the same state the Today banner shows, so the index can say
  // "Excused since …" without being opened. The switch itself, and the explanation under it,
  // live on the excused-days screen (D178).
  const exemptPeriods = useExemptPeriods();
  const today = useTrackingStore((state) => state.todayDay());
  const ongoingPeriod = useMemo(
    () => findOngoingPeriod(exemptPeriods, today),
    [exemptPeriods, today]
  );
  const exemptionDescription = useMemo(() => {
    if (!exemptionEnabled) return t('settings.home.tracking.exemption.teaser');
    if (ongoingPeriod === null) return t('exemption.settings.notActive');
    return t(
      ongoingPeriod.endDay === null
        ? 'exemption.settings.activeSince'
        : 'exemption.settings.activeUntil',
      {
        date: formatDate(parseDay(ongoingPeriod.endDay ?? ongoingPeriod.startDay), i18n.language, {
          day: 'numeric',
          month: 'long',
        }),
      }
    );
  }, [exemptionEnabled, i18n.language, ongoingPeriod, t]);

  // "Auto (Diyanet)" — the resolved authority is always named, never left as the word "Auto"
  // (our market research: "the times are wrong" is really "they do not match my mosque's
  // calendar", and naming the authority is what lets someone check that at a glance).
  const methodValue = useMemo(() => {
    const concrete = resolveMethod(calculation.method, location?.countryCode);
    const name = t(methodLabelKey(concrete));
    return calculation.method === 'auto'
      ? t('settings.home.prayerTimes.methodAuto', { method: name })
      : name;
  }, [calculation.method, location?.countryCode, t]);

  const remindersOn = useMemo(
    () =>
      PRAYERS.filter((prayer) => {
        const reminder = reminders[prayer];
        return reminder.adhanEnabled || reminder.preReminderEnabled || reminder.nudgeEnabled;
      }).length,
    [reminders]
  );

  const streakOptions: SettingChoiceOption<StreakMode>[] = [
    {
      value: 'soft',
      label: t('settings.home.tracking.streak.relaxed'),
      description: t('settings.home.tracking.streak.relaxedBody'),
    },
    {
      value: 'hard',
      label: t('settings.home.tracking.streak.committed'),
      description: t('settings.home.tracking.streak.committedBody'),
    },
  ];

  const trackingModeOptions: SettingChoiceOption<TrackingMode>[] = [
    {
      value: 'simple',
      label: t('settings.home.tracking.mode.simple'),
      description: t('settings.home.tracking.mode.simpleBody'),
    },
    {
      value: 'detailed',
      label: t('settings.home.tracking.mode.detailed'),
      description: t('settings.home.tracking.mode.detailedBody'),
    },
  ];

  const themeOptions: SettingChoiceOption<ThemePreference>[] = [
    { value: 'system', label: t('settings.home.appearance.theme.system') },
    { value: 'light', label: t('settings.home.appearance.theme.light') },
    { value: 'dark', label: t('settings.home.appearance.theme.dark') },
  ];

  // Arabic-only, because it is the Arabic digits it decides. Keyed off the RESOLVED language, so
  // "System" on an Arabic phone shows it and an explicit switch to English hides it again.
  const numeralOptions: SettingChoiceOption<NumeralPreference>[] = [
    { value: 'auto', label: t('settings.home.appearance.numerals.auto') },
    { value: 'arab', label: t('settings.home.appearance.numerals.arab') },
    { value: 'latn', label: t('settings.home.appearance.numerals.latn') },
  ];

  const languageOptions: SettingChoiceOption<LanguagePreference>[] = [
    { value: 'system', label: t('settings.home.appearance.language.system') },
    { value: 'en', label: t('settings.home.appearance.language.en') },
    { value: 'ar', label: t('settings.home.appearance.language.ar') },
    { value: 'tr', label: t('settings.home.appearance.language.tr') },
    { value: 'ur', label: t('settings.home.appearance.language.ur') },
  ];

  return (
    <PaperBackground>
      <ScrollView
        testID="settings-scroll"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + spacing.xxl,
          paddingHorizontal: spacing.xl,
          // Room under the last group so the tab bar never crowds it on a short device.
          paddingBottom: spacing.xxl * 2,
          gap: spacing.lg,
          ...contentClampPadding(spacing.xl),
        }}
      >
        <View accessibilityRole="header">
          <AppText variant="hero">{t('settings.title')}</AppText>
        </View>

        {/* -------------------------------------------------------------- PRAYER TIMES */}
        {/* Where you are and whose method: the two things a prayer time is made of, and the two
            answers to "the times are wrong". One group, so nobody has to guess which one. */}
        <SettingGroup
          testID="settings-group-prayer-times"
          title={t('settings.home.prayerTimes.title')}
          divider={false}
        >
          <SettingNavigationRow
            testID="settings-row-location"
            icon="location_on"
            label={t('settings.home.location.row')}
            description={
              useAutoLocation
                ? t('settings.home.location.auto')
                : t('settings.home.location.manual')
            }
            value={location?.label ?? t('settings.home.location.notSet')}
            accessibilityHint={t('settings.home.location.a11yHint')}
            onPress={() => router.push(ROUTES.location)}
          />
          <SettingNavigationRow
            testID="settings-row-calculation"
            icon="schedule"
            label={t('settings.home.prayerTimes.calculation')}
            description={t('settings.home.prayerTimes.calculationDescription')}
            value={methodValue}
            accessibilityHint={t('settings.home.prayerTimes.a11yHint')}
            onPress={() => router.push(ROUTES.calculation)}
          />
        </SettingGroup>

        {/* ----------------------------------------------------------------- REMINDERS */}
        {/* The group people come back to — a sound to change, a wake-up to turn off, a reminder
            that never came — so it sits second, above everything that is set once. */}
        <SettingGroup testID="settings-group-reminders" title={t('settings.home.reminders.title')}>
          <SettingNavigationRow
            testID="settings-row-reminders"
            icon="notifications"
            label={t('settings.home.reminders.perPrayer')}
            description={t('settings.home.reminders.perPrayerDescription')}
            value={
              remindersOn === 0
                ? t('settings.home.reminders.summaryNone')
                : t('settings.home.reminders.summary', { on: remindersOn, total: PRAYERS.length })
            }
            accessibilityHint={t('settings.home.reminders.a11yHint')}
            onPress={() => router.push(ROUTES.reminders)}
          />
          <SettingNavigationRow
            testID="settings-row-reminder-health"
            icon="task_alt"
            label={t('settings.home.reminders.health.label')}
            description={t('settings.home.reminders.health.description')}
            accessibilityHint={t('settings.home.reminders.health.a11yHint')}
            onPress={() => router.push(ROUTES.reminderHealth)}
          />
        </SettingGroup>

        {/* ------------------------------------------------------------------- BUDDIES */}
        {/* Its own group, high on the page. As the last row under the qada counter it was, in the
            owner's words, hard to find — and a feature nobody can find is a feature nobody has.
            The row's value says On or Off, so the group reads as a switch you have not flipped
            rather than as a mystery. Still off by default, still nothing anywhere else in the app
            that mentions it (D174). */}
        <SettingGroup
          testID="settings-group-buddies"
          title={t('buddy.settings.title')}
          footer={t('buddy.settings.group.footer')}
        >
          <SettingNavigationRow
            testID="settings-row-buddies"
            icon="favorite"
            label={t('buddy.settings.row.label')}
            description={t('buddy.settings.row.description')}
            value={buddyEnabled ? t('settings.on') : t('settings.off')}
            accessibilityHint={t('buddy.settings.row.a11yHint')}
            onPress={() => router.push(ROUTES.buddies)}
          />
        </SettingGroup>

        {/* ---------------------------------------------------------------- PRAYER LOG */}
        {/* Everything about the record itself: what counts as a streak day, the days that are
            never counted, the prayers still owed, and getting the record out as a file. Not
            called "Tracking" — an app whose pledge says "no tracking" cannot also have a group by
            that name. Nothing here assumes the log is used. */}
        <SettingGroup
          testID="settings-group-tracking"
          title={t('settings.home.tracking.title')}
          footer={t('settings.home.data.footer')}
        >
          {/* Turning simple mode on starts it at today's prayer day, so no earlier day is ever
              shown as missed by the switch (D192). Nothing stored changes either way. */}
          <SettingChoiceRow
            testID="settings-row-tracking-mode"
            label={t('settings.home.tracking.mode.label')}
            options={trackingModeOptions}
            value={trackingMode}
            onChange={(mode) => setTrackingMode(mode, today)}
          />
          <SettingChoiceRow
            testID="settings-row-streak"
            label={t('settings.home.tracking.streak.label')}
            options={streakOptions}
            value={streakMode}
            onChange={setStreakMode}
          />
          <SettingNavigationRow
            testID="settings-row-exemption"
            icon="bedtime"
            label={t('settings.home.tracking.exemption.label')}
            description={exemptionDescription}
            value={exemptionEnabled ? t('settings.on') : t('settings.off')}
            accessibilityHint={t('settings.home.tracking.exemption.a11yHint')}
            onPress={() => router.push(ROUTES.exemption)}
          />
          <SettingNavigationRow
            testID="settings-row-qada"
            icon="done_all"
            label={t('settings.home.tracking.qada.label')}
            description={t('settings.home.tracking.qada.description')}
            accessibilityHint={t('settings.home.tracking.qada.a11yHint')}
            onPress={() => router.push(ROUTES.qada)}
          />
          <ExportRow testID="settings-row-export-csv" format="csv" controller={dataExport} />
          <ExportRow testID="settings-row-export-json" format="json" controller={dataExport} />
        </SettingGroup>

        {/* --------------------------------------------------------------------- WATCH */}
        {/* Only when a paired watch is genuinely missing the app: watchOS installs companion
            apps by itself unless "Automatic App Install" is off, and there is no API to do it
            for anyone it misses — so this says where the switch lives, once, in Settings, where
            nobody meets it uninvited (owner, 2026-08-29). */}
        {watchInstallWanted ? (
          <SettingGroup testID="settings-group-watch" title={t('settings.home.watch.title')}>
            <SettingRow
              testID="settings-row-watch-install"
              icon="schedule"
              label={t('settings.home.watch.label')}
              description={t('settings.home.watch.description')}
              accessibilityHint={t('settings.home.watch.a11yHint')}
            />
          </SettingGroup>
        ) : null}

        {/* ------------------------------------------------------ APPEARANCE & LANGUAGE */}
        <SettingGroup
          testID="settings-group-appearance"
          title={t('settings.home.appearance.title')}
        >
          <SettingChoiceRow
            testID="settings-row-theme"
            label={t('settings.home.appearance.theme.label')}
            options={themeOptions}
            value={theme}
            onChange={setTheme}
          />
          <SettingChoiceRow
            testID="settings-row-language"
            label={t('settings.home.appearance.language.label')}
            options={languageOptions}
            value={language}
            onChange={chooseLanguage}
          />
          {/* D136: on Android the "region" behind D40's rule is the top system language's country,
              which can be a keyboard added years ago or nothing at all. Everyone the automatic
              answer fails needs a way to say so, and there is no other one. */}
          {i18n.language.startsWith('ar') ? (
            <SettingChoiceRow
              testID="settings-row-numerals"
              label={t('settings.home.appearance.numerals.label')}
              description={t('settings.home.appearance.numerals.description')}
              options={numeralOptions}
              value={arabicNumerals}
              onChange={setArabicNumerals}
            />
          ) : null}
        </SettingGroup>

        {/*
          The strings and the layout disagree: the user picked a direction change and declined
          the restart. React Native can only turn the screens around at startup, so until then
          Arabic renders in a left-to-right frame — which reads as a broken app rather than as a
          pending setting, and was reported as exactly that from a real device. The notice says
          what is happening and offers the restart again; it disappears of its own accord the
          moment the layout catches up.
        */}
        {awaitingRestart ? (
          <HealthNotice
            testID="settings-awaiting-restart"
            level="info"
            title={t('settings.home.appearance.language.direction.awaiting.title')}
            statusLabel={t('settings.home.appearance.language.direction.awaiting.status')}
            body={t('settings.home.appearance.language.direction.awaiting.body')}
            actions={[
              {
                icon: 'refresh',
                label: t('settings.home.appearance.language.direction.awaiting.action'),
                onPress: () => void restartNow(),
              },
            ]}
          />
        ) : null}

        {/* ------------------------------------------------------------------- PRIVACY */}
        {/*
          The pledge and its one exception, under the word everybody looks for. The pledge stands
          directly above the tip jar because it is the answer to the question the jar raises (why
          is this free, what is the catch), and it is the one claim in the app that must never
          quietly stop being true (D31). Crash reports sit beside it because the pledge is where
          the app's privacy claims are made, so the one diagnostic exception to them is disclosed
          — and switchable — in the same breath. The setting is read once at startup
          (services/telemetry.ts), which is why the copy says a change applies next launch.
        */}
        <SettingGroup testID="settings-group-privacy" title={t('settings.home.privacy.title')}>
          <PledgeCard testID="settings-row-pledge" framed={false} />
          {/* No DSN (a FOSS build, a fork): nothing to switch, so no row. */}
          {sentryDsn() === null ? null : (
            <SettingSwitchRow
              testID="settings-row-diagnostics"
              label={t('settings.diagnostics.label')}
              description={t('settings.diagnostics.body')}
              value={crashReportingEnabled}
              onValueChange={setCrashReportingEnabled}
              onLabel={t('settings.on')}
              offLabel={t('settings.off')}
            />
          )}
        </SettingGroup>
        {/* ------------------------------------------------------------------- SUPPORT */}
        {/*
          The tip jar, "Rate the app", "Send feedback" and About: everything that reaches
          outside the app, for someone who wants to give something back or needs a person.
        */}
        <SettingGroup testID="settings-group-support" title={t('settings.home.support.title')}>
          {/*
            The tip jar opens the group, directly under the pledge, and passes `showNoAds={false}`
            because the card above it has just said exactly that — §14 asks for "no ads, and never
            will be" *beside* the jar, not twice in the same breath. It renders nothing at all
            until a RevenueCat key is configured, so this group looks unchanged until the day
            tipping is switched on (see docs/TIP_JAR_RUNBOOK.md).
          */}
          <TipJar testID="settings-row-tip" framed={false} showNoAds={false} />
          <RateAppRow testID="settings-row-rate" />
          {/*
            "Send feedback" sits beside "Rate the app" because they are the same kind of row — both
            hand the user to somewhere outside the app, and both exist because an app with no ads
            and no account has no other way to hear from anyone. It is deliberately NOT a form in
            the app: see services/appInfo.FEEDBACK_URL for why a fourth thing may not start leaving
            this phone (D87). It appears again on the About screen, exactly as RateAppRow does —
            these two are what people go looking for, and Settings and About are both places they
            look.
          */}
          <FeedbackRow testID="settings-row-feedback" />
          <SettingNavigationRow
            testID="settings-row-about"
            icon="info"
            label={t('settings.home.support.about.label')}
            description={t('settings.home.support.about.description')}
            accessibilityHint={t('settings.home.support.about.a11yHint')}
            onPress={() => router.push(ROUTES.about)}
          />
        </SettingGroup>

      </ScrollView>
    </PaperBackground>
  );
}
