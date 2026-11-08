import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Platform, ScrollView, View, type AppStateStatus } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backChevron } from '@/i18n/direction';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { HealthNotice, type HealthLevel, type HealthNoticeAction } from '@/components/HealthNotice';
import { Icon } from '@/components/Icon';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { ScheduledReminderList } from '@/components/ScheduledReminderList';
import { SectionDivider } from '@/components/SectionDivider';
import { SettingGroup } from '@/components/SettingGroup';
import { PRAYERS } from '@/domain/types';
import {
  rebuildNotificationsFromStores,
  syncNotificationsFromStores,
} from '@/hooks/useNotificationSync';
import {
  readBackgroundRefreshStatus,
  type BackgroundRefreshStatus,
} from '@/services/backgroundRefresh';
import {
  currentOemFamily,
  hasAggressiveBatteryManager,
  openAutoStartSettings,
  openBatteryOptimisationSettings,
  readExemptionState,
  type ExemptionState,
} from '@/services/batteryGuidance';
import {
  openExactAlarmSettings,
  readExactAlarmState,
  type ExactAlarmState,
} from '@/services/exactAlarms';
import {
  getNotificationPermission,
  listScheduledNotifications,
  requestNotificationPermission,
  sendTestNotification,
  type NotificationPermission,
  type ScheduledNotification,
} from '@/services/notifications';
import {
  openNotificationSettings,
  supportsNotificationOrganizer,
} from '@/services/notificationOrganizer';
import { useReminders, useTimeFormat } from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';
import { useLayout } from '@/hooks/useLayout';
import { radius, spacing, useTheme } from '@/theme';
import { formatTime } from '@/utils/formatTime';

/**
 * Settings → Reminder reliability (PRODUCT_SPEC §11, decisions D19/D27).
 *
 * ## Why this screen exists
 *
 * "The adhan did not fire" is the second most common complaint in the entire category, and every
 * major competitor's answer to it is the same sentence: *open the app every few days*
 * (our market research). That is an app asking its user to do its job, and it is an admission
 * that nobody can tell whether reminders are actually going to arrive.
 *
 * This screen is the opposite bet. It answers one question — **will my next adhan actually
 * fire?** — and it answers it from the operating system rather than from our own bookkeeping.
 *
 * ## The order is the argument
 *
 * Everything the user can *act on* comes first, and the evidence comes last:
 *
 * 1. **The verdict**, in plain language, with the one action that fixes it — the permission
 *   prompt while the OS will still show one, the system settings page once it will not, the
 *   reminders screen when nothing is switched on, a reschedule when the schedule is empty.
 * 2. **A test notification** with a visible result, so "does anything arrive at all" takes one
 *   tap rather than waiting for Maghrib.
 * 3. **Exact alarms** (Android, D91) — the setting that decides whether a reminder arrives *on the
 *   minute* rather than whenever the system gets round to it. It is above the battery card because
 *   it is the one thing on this screen whose state we can actually read.
 * 4. **The platform's own culprits** — Android battery management, named by manufacturer where we
 *   can, with a deep link to the screen holding the switch; whether the phone ever wakes the app
 *   to extend the plan (`services/backgroundRefresh`); iOS's Focus, Do Not Disturb and Scheduled
 *   Summary.
 * 5. **The reminders the OS is actually holding**, with their times, read back through
 *   `getAllScheduledNotificationsAsync`. It is last on purpose (owner, 2026-08-20): it is the
 *   ground truth the verdict rests on, but it is a list of times, and reading it has never once
 *   been the fix.
 *
 * ## The tone rules
 *
 * Calm and factual, never alarming. Nobody arrives here happy — they arrive here because they
 * missed a prayer and want to know why — so no exclamation marks, no blame, no scare copy about
 * what "might" happen, and every card ends in something the user can actually do. The severity of
 * a card is carried by a glyph and a word as well as a tint (`HealthNotice`), so nothing on this
 * screen is legible only in colour.
 *
 * ## What it deliberately does not claim
 *
 * The battery card now reads Android's own exemption through `services/batteryGuidance`, so it
 * says which way that flag sits instead of admitting it cannot look. It still refuses to turn
 * that into a tick on the manufacturers that keep a battery manager of their own: on a Xiaomi or
 * a Samsung the stock exemption is necessary and not sufficient, so the card stays at `info` and
 * the copy says so. A build with no native module, and every non-Android platform, keeps the
 * original "we cannot check this from in here". A wrong reassurance on this screen would be worse
 * than no screen.
 *
 * Composition only: every verdict comes from the notification service, every string from i18n.
 */

/**
 * Where "no reminders are switched on" sends the user. Left unasserted so expo-router's generated
 * route union checks it: if that screen is ever renamed, this is a typecheck error, not a dead tap.
 */
const REMINDERS_ROUTE = '/settings/reminders' satisfies Href;

/** The single answer the top of the screen gives, in the order the checks have to happen. */
type Verdict =
  'loading' | 'permissionMissing' | 'permissionDenied' | 'noReminders' | 'empty' | 'ok';

/** How the test-notification button is currently doing. */
type TestState = 'idle' | 'sending' | 'sent' | 'failed';

/** The severity each verdict renders at. */
const VERDICT_LEVEL: Record<Exclude<Verdict, 'loading'>, HealthLevel> = {
  permissionMissing: 'attention',
  permissionDenied: 'problem',
  noReminders: 'info',
  empty: 'problem',
  ok: 'ok',
};

export default function ReminderHealthScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const reminders = useReminders();
  const timeFormat = useTimeFormat();
  const todayDay = useTrackingStore((state) => state.todayDay());

  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [scheduled, setScheduled] = useState<readonly ScheduledNotification[] | null>(null);
  const [exactAlarms, setExactAlarms] = useState<ExactAlarmState | null>(null);
  const [exemption, setExemption] = useState<ExemptionState>('unknown');
  const [backgroundRefresh, setBackgroundRefresh] = useState<BackgroundRefreshStatus>('unknown');
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');

  // Every async result is dropped once the screen is gone: this is a pushed screen the user can
  // leave mid-request, and a `setState` after that is a warning at best and a leak at worst.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * The last exact-alarm answer this screen saw, so a *change* can be acted on. A ref rather than
   * state because it is read inside a callback that must not be rebuilt when it moves.
   */
  const exactAlarmsSeen = useRef<ExactAlarmState | null>(null);

  /** Re-reads every fact from the OS. Never prompts — only an explicit tap may do that. */
  const reload = useCallback(async () => {
    const [nextPermission, nextScheduled, nextExactAlarms, nextExemption, nextBackgroundRefresh] =
      await Promise.all([
        getNotificationPermission(),
        listScheduledNotifications(),
        readExactAlarmState(),
        readExemptionState(),
        readBackgroundRefreshStatus(),
      ]);
    if (!alive.current) return;
    setPermission(nextPermission);
    setScheduled(nextScheduled);
    setExactAlarms(nextExactAlarms);
    setExemption(nextExemption);
    setBackgroundRefresh(nextBackgroundRefresh);
    setCheckedAt(new Date());

    // Coming back from the system's alarms screen having allowed them is the one moment the
    // schedule has to be built again. An alarm's exactness is decided when it is set and never
    // revisited, so every reminder already waiting — tonight's Isha, tomorrow's Fajr — would stay
    // inexact, and an ordinary sync would correctly leave them alone because the plan has not
    // changed (D91). Only on this transition: nothing else here ever rewrites the schedule by
    // itself.
    const previous = exactAlarmsSeen.current;
    exactAlarmsSeen.current = nextExactAlarms;
    if (previous !== 'inexact' || nextExactAlarms !== 'exact') return;

    await rebuildNotificationsFromStores();
    const rebuilt = await listScheduledNotifications();
    if (!alive.current) return;
    setScheduled(rebuilt);
    setCheckedAt(new Date());
  }, []);

  // On arrival, and again on every foreground: returning from the system settings screen is
  // exactly when a "denied" can have become a "granted" without the app doing anything.
  useEffect(() => {
    void reload();
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') void reload();
    });
    return () => {
      subscription.remove();
    };
  }, [reload]);

  // Back goes to Settings, not Today: this screen only ever hangs off the Settings tab, so when
  // there is no history to pop (a cold start straight into it — a notification deep link, a
  // process restart while it was foregrounded) the parent is where "back" means, and landing on
  // Today instead would strand the user a tab away from the row they came through.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  /** Reminders the OS holds that are ours — the test notification is not a reminder. */
  const ours = useMemo(
    () => (scheduled ?? []).filter((entry) => entry.payload !== null),
    [scheduled]
  );

  /** Whether the user has asked for any reminder at all. Nothing is scheduled if they have not. */
  const remindersOn = useMemo(
    () =>
      PRAYERS.some((prayer) => {
        const reminder = reminders[prayer];
        return reminder.adhanEnabled || reminder.preReminderEnabled || reminder.nudgeEnabled;
      }),
    [reminders]
  );

  const verdict: Verdict = useMemo(() => {
    if (permission === null || scheduled === null) return 'loading';
    if (!permission.granted)
      return permission.canAskAgain ? 'permissionMissing' : 'permissionDenied';
    if (!remindersOn) return 'noReminders';
    if (ours.length === 0) return 'empty';
    return 'ok';
  }, [permission, scheduled, remindersOn, ours.length]);

  const handleAllow = useCallback(async () => {
    setBusy(true);
    try {
      const answer = await requestNotificationPermission();
      // A fresh "yes" should have something to show for itself immediately, rather than waiting
      // for the next foreground to schedule anything.
      if (answer.granted) await syncNotificationsFromStores();
      await reload();
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [reload]);

  const handleReschedule = useCallback(async () => {
    setBusy(true);
    try {
      await syncNotificationsFromStores();
      await reload();
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [reload]);

  const handleRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await reload();
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [reload]);

  const handleTest = useCallback(async () => {
    setTestState('sending');
    const sent = await sendTestNotification();
    if (!alive.current) return;
    setTestState(sent ? 'sent' : 'failed');
  }, []);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      // Some OEM builds refuse the deep link. The written instructions above it still stand.
    });
  }, []);

  const isAndroid = Platform.OS === 'android';
  const isIOS = Platform.OS === 'ios';
  const oem = useMemo(() => (isAndroid ? currentOemFamily() : 'other'), [isAndroid]);
  const oemIsAggressive = isAndroid && hasAggressiveBatteryManager(oem);
  // Android 16 and later only — see `services/notificationOrganizer` on why the gate is the OS
  // version and not the manufacturer.
  const hasOrganizer = useMemo(() => supportsNotificationOrganizer(), []);

  /**
   * How serious the battery card is, now that the exemption can actually be read.
   *
   * `'ok'` is reserved for the one case where the answer really is the whole answer: Android's own
   * limits are off AND this manufacturer has no battery manager of its own. On a Xiaomi or a
   * Samsung the stock exemption is necessary and not sufficient (`services/batteryGuidance`), and
   * a tick there would be the wrong reassurance this screen exists to refuse.
   */
  const batteryLevel: HealthLevel =
    exemption === 'restricted'
      ? 'attention'
      : exemption === 'exempt' && !oemIsAggressive
        ? 'ok'
        : 'info';

  /** What the card says about the exemption itself — including "we could not read it". */
  const batteryFootnote =
    exemption === 'exempt'
      ? t('settings.reminderHealth.battery.exempt')
      : exemption === 'restricted'
        ? t('settings.reminderHealth.battery.restricted')
        : t('settings.reminderHealth.battery.cannotCheck');

  /** The one action the current verdict offers, if any. */
  const verdictActions = useMemo<HealthNoticeAction[]>(() => {
    switch (verdict) {
      case 'permissionMissing':
        return [
          {
            testID: 'reminder-health-allow',
            label: t('settings.reminderHealth.verdict.permissionMissing.action'),
            icon: 'notifications',
            primary: true,
            disabled: busy,
            onPress: () => void handleAllow(),
          },
        ];
      case 'permissionDenied':
        return [
          {
            testID: 'reminder-health-open-settings',
            label: t('settings.reminderHealth.verdict.permissionDenied.action'),
            icon: 'open_in_new',
            primary: true,
            onPress: openSystemSettings,
          },
        ];
      case 'noReminders':
        return [
          {
            testID: 'reminder-health-choose-reminders',
            label: t('settings.reminderHealth.verdict.noReminders.action'),
            icon: 'notifications',
            primary: true,
            onPress: () => router.push(REMINDERS_ROUTE),
          },
        ];
      case 'empty':
        return [
          {
            testID: 'reminder-health-reschedule-now',
            label: t('settings.reminderHealth.verdict.empty.action'),
            icon: 'sync',
            primary: true,
            disabled: busy,
            onPress: () => void handleReschedule(),
          },
        ];
      default:
        return [];
    }
  }, [verdict, busy, t, router, handleAllow, handleReschedule, openSystemSettings]);

  const checkedLabel =
    checkedAt === null
      ? undefined
      : t('settings.reminderHealth.schedule.checkedAt', {
          time: formatTime(checkedAt, { timeFormat, locale: i18n.language }),
        });

  return (
    <PaperBackground>
      <ScrollView
        testID="reminder-health-scroll"
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
            testID="reminder-health-back"
            accessibilityRole="button"
            accessibilityLabel={t('settings.reminderHealth.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('settings.reminderHealth.title')}
          </AppText>
        </View>

        <AppText variant="caption" tone="muted" style={{ paddingHorizontal: spacing.xs }}>
          {t('settings.reminderHealth.intro')}
        </AppText>

        {/* ----------------------------------------------------------------- THE VERDICT */}
        {verdict === 'loading' ? (
          <Card testID="reminder-health-loading" variant="bright" style={{ padding: spacing.lg }}>
            <AppText variant="caption" tone="muted">
              {t('settings.reminderHealth.loading')}
            </AppText>
          </Card>
        ) : (
          <HealthNotice
            testID={`reminder-health-verdict-${verdict}`}
            level={VERDICT_LEVEL[verdict]}
            statusLabel={t(`settings.reminderHealth.level.${VERDICT_LEVEL[verdict]}`)}
            icon={verdict === 'permissionDenied' ? 'notifications_off' : undefined}
            title={t(`settings.reminderHealth.verdict.${verdict}.title`)}
            body={t(`settings.reminderHealth.verdict.${verdict}.body`)}
            actions={verdictActions}
            footnote={
              verdict === 'ok'
                ? t('settings.reminderHealth.verdict.ok.footnote', { count: ours.length })
                : undefined
            }
          />
        )}

        {/* --------------------------------------------------------------- TEST NOTIFICATION */}
        <SectionDivider />
        <HealthNotice
          testID="reminder-health-test"
          level={testState === 'sent' ? 'ok' : testState === 'failed' ? 'problem' : 'info'}
          statusLabel={t(`settings.reminderHealth.test.status.${testState}`)}
          icon="notifications_active"
          title={t(`settings.reminderHealth.test.${testState}.title`)}
          body={t(`settings.reminderHealth.test.${testState}.body`)}
          actions={[
            {
              testID: 'reminder-health-test-send',
              label: t(
                testState === 'idle'
                  ? 'settings.reminderHealth.test.send'
                  : 'settings.reminderHealth.test.sendAgain'
              ),
              icon: 'notifications_active',
              primary: true,
              disabled: testState === 'sending',
              onPress: () => void handleTest(),
            },
          ]}
        />

        {/* ------------------------------------------------------------------- EXACT ALARMS */}
        {/* Above the battery card because it is the one thing here we can actually read from the
            OS, and the one with a switch that fixes it outright. `'unknown'` renders nothing at
            all — that is a dev client with no native module, and an invented verdict on this
            screen would be worse than a missing card. */}
        {isAndroid && (exactAlarms === 'exact' || exactAlarms === 'inexact') ? (
          <>
            <SectionDivider />
            <HealthNotice
              testID="reminder-health-exact-alarms"
              level={exactAlarms === 'exact' ? 'ok' : 'attention'}
              statusLabel={t(
                exactAlarms === 'exact'
                  ? 'settings.reminderHealth.level.ok'
                  : 'settings.reminderHealth.level.attention'
              )}
              icon="alarm"
              title={t(`settings.reminderHealth.exactAlarms.${exactAlarms}.title`)}
              body={t(`settings.reminderHealth.exactAlarms.${exactAlarms}.body`)}
              footnote={
                exactAlarms === 'inexact'
                  ? t('settings.reminderHealth.exactAlarms.inexact.footnote')
                  : undefined
              }
              actions={
                exactAlarms === 'inexact'
                  ? [
                      {
                        testID: 'reminder-health-exact-alarms-open',
                        label: t('settings.reminderHealth.exactAlarms.inexact.action'),
                        icon: 'alarm',
                        primary: true,
                        onPress: () => void openExactAlarmSettings(),
                      },
                    ]
                  : []
              }
            />
          </>
        ) : null}

        {/* ------------------------------------------------------------------------ ANDROID */}
        {isAndroid ? (
          <>
            <SectionDivider />
            <HealthNotice
              testID="reminder-health-battery"
              level={batteryLevel}
              statusLabel={t(`settings.reminderHealth.level.${batteryLevel}`)}
              icon="electric_bolt"
              title={t('settings.reminderHealth.battery.title')}
              body={
                // Xiaomi gets its own text because it is the one ROM whose real path we know:
                // MIUI/HyperOS keeps a per-app "Battery saver" policy that the stock exemption
                // above does not touch, and naming that screen is the difference between advice
                // someone can follow and advice they scroll past. Every other aggressive
                // manufacturer keeps the general wording rather than being sent to a screen that
                // may not exist on their phone — a wrong instruction here is worse than a vague
                // one.
                oem === 'xiaomi'
                  ? t('settings.reminderHealth.battery.bodyXiaomi', {
                      brand: t('settings.reminderHealth.battery.oem.xiaomi'),
                    })
                  : oemIsAggressive
                    ? t('settings.reminderHealth.battery.bodyOem', {
                        brand: t(`settings.reminderHealth.battery.oem.${oem}`),
                      })
                    : t('settings.reminderHealth.battery.body')
              }
              footnote={batteryFootnote}
              actions={[
                {
                  testID: 'reminder-health-battery-open',
                  label: t('settings.reminderHealth.battery.open'),
                  icon: 'settings',
                  onPress: () => void openBatteryOptimisationSettings(),
                },
                ...(oemIsAggressive
                  ? [
                      {
                        testID: 'reminder-health-autostart-open',
                        label: t('settings.reminderHealth.battery.openAutoStart', {
                          brand: t(`settings.reminderHealth.battery.oem.${oem}`),
                        }),
                        icon: 'open_in_new' as const,
                        onPress: () => void openAutoStartSettings(oem),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        ) : null}

        {/* Android 16's classifier can take a reminder into a bundle and silence it (D146).
            Below the battery card on purpose: battery is far the more common cause, and this one
            can only be true on a fraction of Android 16 phones. */}
        {isAndroid && hasOrganizer ? (
          <>
            <SectionDivider />
            <HealthNotice
              testID="reminder-health-organizer"
              level="info"
              statusLabel={t('settings.reminderHealth.level.info')}
              icon="volume_off"
              title={t('settings.reminderHealth.organizer.title')}
              body={t('settings.reminderHealth.organizer.body')}
              footnote={t('settings.reminderHealth.organizer.cannotCheck')}
              actions={[
                {
                  testID: 'reminder-health-organizer-open',
                  label: t('settings.reminderHealth.organizer.open'),
                  icon: 'settings',
                  onPress: () => void openNotificationSettings(),
                },
              ]}
            />
          </>
        ) : null}

        {/* ------------------------------------------------------------- BACKGROUND REFRESH */}
        {/* The reminder plan is five days long and the app tops it up whenever it is woken, so
            the question this card answers is whether the phone ever wakes it. Two states only:

            - `'restricted'` — the OS says it will not run our background work at all. Honest and
              actionable, and on a phone it is rare (on iOS the library reports it for the
              simulator; Android's WorkManager is always available).
            - `'available'` on iOS — the OS will *schedule* the task, but iOS gates whether it ever
              runs behind Background App Refresh, which no API lets us read. So this is the same
              shape as the battery and organizer cards: state the fact, admit we cannot check it,
              and open the screen that can. It stays at `info` for exactly that reason — a tick
              here would be the wrong reassurance.

            `'available'` on Android renders nothing: WorkManager needs no advice of its own, and
            everything that actually stops it there is the battery card above. `'unknown'` renders
            nothing either — a verdict nobody can act on is worse than no card. */}
        {backgroundRefresh === 'restricted' || (backgroundRefresh === 'available' && isIOS) ? (
          <>
            <SectionDivider />
            <HealthNotice
              testID="reminder-health-background-refresh"
              level={backgroundRefresh === 'restricted' ? 'attention' : 'info'}
              statusLabel={t(
                backgroundRefresh === 'restricted'
                  ? 'settings.reminderHealth.level.attention'
                  : 'settings.reminderHealth.level.info'
              )}
              icon="cached"
              title={t(`settings.reminderHealth.backgroundRefresh.${backgroundRefresh}.title`)}
              body={t(`settings.reminderHealth.backgroundRefresh.${backgroundRefresh}.body`)}
              footnote={
                backgroundRefresh === 'available'
                  ? t('settings.reminderHealth.backgroundRefresh.available.cannotCheck')
                  : undefined
              }
              actions={
                isIOS
                  ? [
                      {
                        testID: 'reminder-health-background-refresh-open',
                        label: t('settings.reminderHealth.backgroundRefresh.open'),
                        icon: 'settings',
                        onPress: openSystemSettings,
                      },
                    ]
                  : []
              }
            />
          </>
        ) : null}

        {/* ---------------------------------------------------------------------------- iOS */}
        {isIOS ? (
          <>
            <SectionDivider />
            <HealthNotice
              testID="reminder-health-ios"
              level="info"
              statusLabel={t('settings.reminderHealth.level.info')}
              icon="bedtime"
              title={t('settings.reminderHealth.ios.title')}
              body={t('settings.reminderHealth.ios.body')}
              actions={[
                {
                  testID: 'reminder-health-ios-settings',
                  label: t('settings.reminderHealth.ios.open'),
                  icon: 'settings',
                  onPress: openSystemSettings,
                },
              ]}
            />
          </>
        ) : null}

        {/* -------------------------------------------------------- WHAT THE OS IS HOLDING */}
        {/* Last on the screen on purpose. It is the ground truth, and it is the reason the
            verdict above can be trusted — but it is a *list of times*, and someone who came here
            because a reminder did not arrive needs the thing they can act on first. Reading it is
            never the fix; it is the evidence behind one. */}
        <SettingGroup title={t('settings.reminderHealth.schedule.title')} footer={checkedLabel}>
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            {ours.length === 0 ? (
              <AppText variant="caption" tone="muted" testID="reminder-health-schedule-empty">
                {t('settings.reminderHealth.schedule.none')}
              </AppText>
            ) : (
              <>
                <AppText variant="caption" tone="header" testID="reminder-health-schedule-count">
                  {t('settings.reminderHealth.schedule.count', { count: ours.length })}
                </AppText>
                <ScheduledReminderList
                  testID="reminder-health-schedule-list"
                  entries={ours}
                  todayDay={todayDay}
                  timeFormat={timeFormat}
                />
              </>
            )}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              <QuietAction
                testID="reminder-health-refresh"
                icon="refresh"
                label={t('settings.reminderHealth.schedule.refresh')}
                disabled={busy}
                onPress={() => void handleRefresh()}
              />
              <QuietAction
                testID="reminder-health-reschedule"
                icon="sync"
                label={t('settings.reminderHealth.schedule.reschedule')}
                disabled={busy}
                onPress={() => void handleReschedule()}
              />
            </View>
          </View>
        </SettingGroup>

        {/* --------------------------------------------------------------------- THE PLEDGE */}
        <SectionDivider placement="bottom" />
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <Icon name="task_alt" size={17} variant="outlined" color={colors.faint} />
          <AppText variant="hint" style={{ flex: 1 }}>
            {t('settings.reminderHealth.pledge')}
          </AppText>
        </View>
      </ScrollView>
    </PaperBackground>
  );
}

/**
 * An outlined pill for a secondary action. `HealthNotice` grows its own; these sit under the
 * schedule, which is a list rather than a verdict.
 */
function QuietAction({
  icon,
  label,
  onPress,
  disabled = false,
  testID,
}: {
  icon: 'refresh' | 'sync';
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
      onPress={onPress}
      style={{
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
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={15} color={colors.accent} />
      <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
        {label}
      </AppText>
    </PressableScale>
  );
}
