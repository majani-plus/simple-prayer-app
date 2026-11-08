import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import {
  BeginExemptionSheet,
  EndExemptionSheet,
  ExemptPeriodEditorSheet,
  ModeOffSheet,
} from '@/components/ExemptionSheets';
import { Icon } from '@/components/Icon';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingRow, SettingSwitchRow } from '@/components/SettingRow';
import { findOngoingPeriod } from '@/domain/exemptions';
import { backChevron } from '@/i18n/direction';
import { formatDate } from '@/i18n/numerals';
import { addDays, isBeforeDay, parseDay } from '@/domain/dates';
import { useExemptionSettings, useSettingsActions } from '@/stores/settingsStore';
import { useExemptPeriods, useTrackingActions, useTrackingStore } from '@/stores/trackingStore';
import { useLayout } from '@/hooks/useLayout';
import { spacing, useTheme } from '@/theme';

import type { ExemptPeriod, PrayerDay } from '@/domain/types';

/**
 * Settings → Excused days (spec-exemption §2a/§2b/§2c) — the whole feature on one screen: the
 * switch that enables it, with the explanation under it; the current status; and the list of
 * recorded periods with add, edit and delete. (The days-per-month figure for the qada estimate
 * lives where it is used, in the qada setup wizard's range step — asked in context, at the moment
 * it changes the number on screen.)
 *
 * The switch moved here from the Settings index (D178). Its body is the one place in the app
 * that names menstruation and post-natal bleeding (D62), and on the index that paragraph was the
 * largest block on the page and readable by anyone glancing at an open Settings tab. Here she
 * reads it deliberately, once, and the index only says "Excused days · Off".
 *
 * The list is what makes the record *correctable*: a period that already happened can be entered
 * after the fact, one entered wrong can be fixed, one entered by mistake removed. Every write
 * goes through the tracking store, whose period transactions also settle the qada consequences —
 * backdating over days logged `missed` refunds the debt those misses created (D-x5), so
 * correcting the record here can never leave her owing prayers she was never obliged to make up.
 *
 * Register (P1): everything on this screen says exempt / عذر / özel günler, except the body
 * under the switch, where the anatomical words belong. Future-dated records are not offerable
 * anywhere on this screen — nobody knows the date in advance, and a period that has not begun
 * cannot excuse anything.
 */

/** What the editor sheet is currently editing: nothing, a new record, or a stored one. */
type EditorTarget = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; period: ExemptPeriod };

export default function ExemptionSettingsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();
  const locale = i18n.language;

  const periods = useExemptPeriods();
  const { startExemptPeriod, endExemptPeriod, addExemptPeriod, updateExemptPeriod, deleteExemptPeriod } =
    useTrackingActions();
  const { enabled } = useExemptionSettings();
  const { setExemptionModeEnabled, setExemptionMuteReminders } = useSettingsActions();
  // The store's own "today" (Fajr→Fajr via the installed resolver), so the day lists agree with
  // every other surface about which day it currently is.
  const today = useTrackingStore((state) => state.todayDay());

  // What is running now — open-ended, or closed with an end still to come.
  const ongoingPeriod = useMemo(() => findOngoingPeriod(periods, today), [periods, today]);
  // Past records, which is what this list is for. A period whose end has not arrived is not
  // history: it belongs to the status rows above, where it can be ended, not to a list of things
  // that already happened. Compared by day rather than by identity because `findOngoingPeriod`
  // returns a normalized copy, not one of these objects.
  const pastPeriods = useMemo(
    () => periods.filter((period) => period.endDay !== null && isBeforeDay(period.endDay, today)),
    [periods, today]
  );

  const [beginOpen, setBeginOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [modeOffOpen, setModeOffOpen] = useState(false);
  const [editor, setEditor] = useState<EditorTarget>({ kind: 'closed' });

  // The switch enables the FEATURE; a period is a separate idea — but flipping it on immediately
  // offers to begin one, because that is the moment she is most likely to need it (the old
  // dead-end: a toggle that did nothing). Re-enabling over a period that never got ended just
  // resumes it; only a fresh state gets the begin sheet. Flipping it off over a running period
  // asks one question in a sheet (§4a) instead of quietly stranding the record behind a disabled
  // mode.
  const handleToggle = useCallback(
    (next: boolean) => {
      if (next) {
        setExemptionModeEnabled(true);
        if (ongoingPeriod === null) setBeginOpen(true);
        return;
      }
      if (ongoingPeriod !== null) {
        setModeOffOpen(true);
        return;
      }
      setExemptionModeEnabled(false);
    },
    [ongoingPeriod, setExemptionModeEnabled]
  );

  const handleModeOffConfirm = useCallback(() => {
    setModeOffOpen(false);
    // "End it as of yesterday": today is already a regular day. A period that started today is
    // cancelled outright by the same call (the domain drops inverted ranges) — the honest
    // reading of "turn it all off".
    endExemptPeriod(addDays(today, -1));
    setExemptionModeEnabled(false);
  }, [endExemptPeriod, setExemptionModeEnabled, today]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const sinceText = useCallback(
    (day: PrayerDay) =>
      formatDate(parseDay(day), locale, { day: 'numeric', month: 'long' }),
    [locale]
  );

  // History rows carry the year: a record is exactly the thing that may be from last Ramadan.
  const historyDate = useCallback(
    (day: PrayerDay) =>
      formatDate(parseDay(day), locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [locale]
  );

  // What the ongoing period says about itself: "Excused since …" while it is open-ended, "Excused
  // until …" once it has an end date to run out on.
  const ongoingText = useCallback(
    (period: ExemptPeriod) =>
      period.endDay === null
        ? t('exemption.settings.activeSince', { date: sinceText(period.startDay) })
        : t('exemption.settings.activeUntil', { date: sinceText(period.endDay) }),
    [sinceText, t]
  );

  const rangeText = useCallback(
    (period: ExemptPeriod) => {
      const start = historyDate(period.startDay);
      if (period.endDay === null || period.endDay === period.startDay) return start;
      return t('exemption.settings.periods.range', { start, end: historyDate(period.endDay) });
    },
    [historyDate, t]
  );

  // A period always implies the switch (spec-exemption §2a, the same side effect Today's ⋯
  // performs). This screen is reachable with the mode OFF — Today's overflow offers "Excused
  // days" to everyone, and its quiet second action opens this register — and a period recorded
  // under a disabled flag is invisible to the whole app: `isExemptDay` answers `false` while the
  // mode is off, so the rows stay due, the reminders keep firing, the banner never appears and
  // the qada refund never runs, while this screen alone says "Excused since …". Only coverage
  // *created* flips it; ending or deleting a period must not, or the switch would start implying
  // a period, which §2a forbids in that direction.
  const handleBegin = useCallback(
    (day: PrayerDay, lastDay: PrayerDay | null, muteReminders: boolean) => {
      setBeginOpen(false);
      setExemptionModeEnabled(true);
      // Her answer to "pause reminders?" — the plan reads it on the next sync (owner, 2026-08-28).
      setExemptionMuteReminders(muteReminders);
      if (lastDay === null) startExemptPeriod(day);
      else addExemptPeriod(day, lastDay);
    },
    [setExemptionModeEnabled, setExemptionMuteReminders, startExemptPeriod, addExemptPeriod]
  );

  const handleEnd = useCallback(
    (day: PrayerDay) => {
      setEndOpen(false);
      endExemptPeriod(day);
    },
    [endExemptPeriod]
  );

  const handleEditorSave = useCallback(
    (startDay: PrayerDay, endDay: PrayerDay) => {
      // Same rule as `handleBegin`: recording a period is using the feature, so it turns it on.
      setExemptionModeEnabled(true);
      if (editor.kind === 'add') addExemptPeriod(startDay, endDay);
      else if (editor.kind === 'edit' && editor.period.id !== undefined) {
        updateExemptPeriod(editor.period.id, startDay, endDay);
      }
      setEditor({ kind: 'closed' });
    },
    [editor, setExemptionModeEnabled, addExemptPeriod, updateExemptPeriod]
  );

  const handleEditorRemove = useCallback(() => {
    if (editor.kind === 'edit' && editor.period.id !== undefined) {
      deleteExemptPeriod(editor.period.id);
    }
    setEditor({ kind: 'closed' });
  }, [editor, deleteExemptPeriod]);

  return (
    <PaperBackground>
      <ScrollView
        testID="exemption-scroll"
        showsVerticalScrollIndicator={false}
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
            testID="exemption-back"
            accessibilityRole="button"
            accessibilityLabel={t('exemption.settings.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('settings.home.tracking.exemption.label')}
          </AppText>
        </View>

        {/* ------------------------------------------------------------------- SWITCH */}
        {/* The feature's switch, and under it the only paragraph in the app that says what the
            feature is for in plain anatomical words (D62). */}
        <SettingGroup testID="exemption-group-mode" divider={false}>
          <SettingSwitchRow
            testID="exemption-row-mode"
            label={t('settings.home.tracking.exemption.label')}
            description={t('settings.home.tracking.exemption.body')}
            value={enabled}
            onValueChange={handleToggle}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
          />
        </SettingGroup>

        {/* ------------------------------------------------------------------- STATUS */}
        {/* The §2c status sub-row: what is running now, and the one action that fits. */}
        <SettingGroup testID="exemption-group-status">
          <SettingRow
            testID="exemption-row-status"
            label={ongoingPeriod === null ? t('exemption.settings.notActive') : ongoingText(ongoingPeriod)}
            value={
              ongoingPeriod === null ? t('exemption.settings.begin') : t('exemption.settings.end')
            }
            chevron={false}
            onPress={() => {
              if (ongoingPeriod === null) setBeginOpen(true);
              else setEndOpen(true);
            }}
          />
        </SettingGroup>

        {/* ------------------------------------------------------------------ RECORDS */}
        <SettingGroup
          testID="exemption-group-periods"
          title={t('exemption.settings.periods.label')}
        >
          {ongoingPeriod !== null ? (
            <SettingRow
              testID="exemption-period-open"
              label={ongoingText(ongoingPeriod)}
              value={t('exemption.settings.end')}
              chevron={false}
              onPress={() => setEndOpen(true)}
            />
          ) : null}
          {pastPeriods.map((period) => (
            <SettingRow
              key={period.id ?? `${period.startDay}-${period.endDay ?? 'open'}`}
              testID={`exemption-period-${period.id ?? period.startDay}`}
              label={rangeText(period)}
              accessibilityHint={t('exemption.editor.editTitle')}
              chevron={false}
              onPress={() => setEditor({ kind: 'edit', period })}
            />
          ))}
          {pastPeriods.length === 0 && ongoingPeriod === null ? (
            <SettingRow testID="exemption-periods-empty" label={t('exemption.settings.periods.empty')} />
          ) : null}
          <SettingRow
            testID="exemption-period-add"
            icon="add"
            label={t('exemption.settings.periods.add')}
            chevron={false}
            onPress={() => setEditor({ kind: 'add' })}
          />
        </SettingGroup>
      </ScrollView>

      <BeginExemptionSheet
        visible={beginOpen}
        today={today}
        onBegin={handleBegin}
        onClose={() => setBeginOpen(false)}
      />
      <ModeOffSheet
        visible={modeOffOpen}
        onConfirm={handleModeOffConfirm}
        onClose={() => setModeOffOpen(false)}
      />
      {ongoingPeriod !== null ? (
        <EndExemptionSheet
          visible={endOpen}
          today={today}
          startDay={ongoingPeriod.startDay}
          onEnd={handleEnd}
          onClose={() => setEndOpen(false)}
        />
      ) : null}
      <ExemptPeriodEditorSheet
        visible={editor.kind !== 'closed'}
        period={editor.kind === 'edit' ? editor.period : null}
        today={today}
        onSave={handleEditorSave}
        onRemove={editor.kind === 'edit' ? handleEditorRemove : undefined}
        onClose={() => setEditor({ kind: 'closed' })}
      />
    </PaperBackground>
  );
}
