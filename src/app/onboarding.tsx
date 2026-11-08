import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, BackHandler, Linking, Platform, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { LocationPromptCard, type LocationPromptState } from '@/components/LocationPromptCard';
import { Logo } from '@/components/Logo';
import { OnboardingScaffold, type OnboardingAction } from '@/components/OnboardingScaffold';
import { OptionCard } from '@/components/OptionCard';
import { PressableScale } from '@/components/PressableScale';
import { TrackingModeDemo } from '@/components/TrackingModeDemo';
import {
  PRAYERS,
  type AppLocation,
  type StreakMode,
  type ThemePreference,
  type TrackingMode,
} from '@/domain/types';
import { useNotificationPermission } from '@/hooks/useNotificationPermission';
import { rebuildNotificationsFromStores } from '@/hooks/useNotificationSync';
import {
  currentOemFamily,
  hasAggressiveBatteryManager,
  openBatteryOptimisationSettings,
} from '@/services/batteryGuidance';
import {
  openExactAlarmSettings,
  readExactAlarmState,
  type ExactAlarmState,
} from '@/services/exactAlarms';
import {
  useLocationActions,
  useLocationPermission,
  useLocationStatus,
} from '@/stores/locationStore';
import {
  useLocation,
  useReminders,
  useSettingsActions,
  useThemePreference,
} from '@/stores/settingsStore';
import { useTrackingStore } from '@/stores/trackingStore';
import { radius, spacing, useTheme } from '@/theme';

/**
 * First-run setup — the flow the app offers once, on a genuinely fresh install.
 *
 * ## How this squares with "the app works before it asks for anything"
 *
 * PRODUCT_SPEC §10 commits this app to no dark-pattern onboarding, and the market research behind
 * it found permission walls and sign-up gates to be a leading reason people abandon prayer apps.
 * That commitment is kept here in full, by one rule: **this flow may offer, and may never gate.**
 * Concretely —
 *
 * - Nothing is required. Every step either has an explicit way to decline it, or costs nothing to
 *   accept (see `OnboardingScaffold` on why those two cases look different).
 * - No permission is ever requested without a tap on the control that names it. The location ask
 *   is the same `LocationPromptCard` the Today tab shows, and the notification ask happens on a
 *   button that says "Allow notifications" — never on arrival, never on a screen transition.
 * - Someone who declines every step lands on Today in exactly the state the app shipped in before
 *   this flow existed: the location card, the five rows once a location exists, an honest
 *   reminder pill. Skipping is not a degraded path; it is the old path.
 * - It runs **once**. Finishing and skipping set the same flag, because a flow that reappears is
 *   a nag. An install that predates the flow never sees it at all (`settingsStore`).
 *
 * ## What it deliberately does not do
 *
 * It builds nothing it can offer instead. The location ask, the city search, the qada setup
 * wizard and the Android battery guidance all already exist and are reached from here, so the
 * copy a user reads at minute one is the copy they will read again in Settings.
 *
 * ## Order
 *
 * Location (the one thing the app cannot work without) → theme (instant, visible, free) →
 * reminders → battery reliability (Android, and only when reminders can actually fire) → how
 * prayers are marked (D192) → streak → qada. The heavier questions come last, once the app has already given something back.
 */

/** The steps, in order. `battery` only exists on Android and only when reminders can fire. */
type StepId =
  | 'welcome'
  | 'location'
  | 'theme'
  | 'notifications'
  | 'battery'
  | 'tracking'
  | 'streak'
  | 'qada';

/** The three-way reminder choice this screen offers (PRODUCT_SPEC §11.1 collapsed to one tap). */
type ReminderChoice = 'off' | 'system' | 'adhan';

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const { colors, scheme } = useTheme();

  const { setTheme, setAllReminders, setStreakMode, setTrackingMode, setOnboardingCompleted } =
    useSettingsActions();
  const today = useTrackingStore((state) => state.todayDay());
  const reminders = useReminders();
  const location = useLocation();
  const themePreference = useThemePreference();

  const notificationPermission = useNotificationPermission();
  const { permission } = notificationPermission;

  const [current, setCurrent] = useState<StepId>('welcome');
  // Whether the OS dialog has been raised during this run of the flow. It decides only one
  // thing — whether the forward button still *names* the ask — and it exists because the
  // permission alone cannot answer that question honestly. Android 13's first refusal (and a
  // dialog dismissed rather than answered, on either platform) leaves `canAskAgain` true, which
  // is indistinguishable from "never asked": the button would keep reading "Allow notifications"
  // and re-opening the dialog the user just refused, with no Continue on the step at all. This
  // flow may offer and may never gate, so once the ask has been made the answer is taken for an
  // answer and the button goes back to moving the flow along.
  const [permissionAsked, setPermissionAsked] = useState(false);
  // Held as a draft rather than written on selection: a person who leaves the flow at this step
  // — or never reaches it — keeps the forgiving default the app ships with (see DECISIONS D68).
  const [streakDraft, setStreakDraft] = useState<StreakMode>('hard');
  // The same draft rule (D192): someone who leaves before Continue keeps `detailed`, the app as it
  // was. Simple is offered first and pre-selected — it is the one-tap way the feel bar asks for.
  const [trackingDraft, setTrackingDraft] = useState<TrackingMode>('simple');

  /** Which reminder choice the stored settings currently amount to. */
  const reminderChoice: ReminderChoice = useMemo(() => {
    const silent = PRAYERS.every(
      (prayer) =>
        !reminders[prayer].adhanEnabled &&
        !reminders[prayer].preReminderEnabled &&
        !reminders[prayer].nudgeEnabled
    );
    if (silent) return 'off';
    return reminders.fajr.sound === 'adhan' ? 'adhan' : 'system';
  }, [reminders]);

  // Battery guidance is Android-only, and pointless when nothing can arrive anyway: a user who
  // chose "no reminders", or whose phone has refused the permission outright, is shown a screen
  // about protecting notifications that will never be sent. `null` (the permission read is still
  // in flight) counts as "probably fine" rather than hiding the step behind a race.
  const showBattery =
    Platform.OS === 'android' &&
    reminderChoice !== 'off' &&
    (permission === null || permission.granted);

  const steps = useMemo<StepId[]>(
    () => [
      'welcome',
      'location',
      'theme',
      'notifications',
      ...(showBattery ? (['battery'] as const) : []),
      'tracking',
      'streak',
      'qada',
    ],
    [showBattery]
  );

  const index = Math.max(0, steps.indexOf(current));

  /**
   * Leaves the flow for good. Skipping and finishing are the same fact — see the header.
   *
   * **Setup always ends on Today**, in both branches. It used to `replace` straight to `/qada` for
   * the counting branch, and a user reported the result: the qada screen is a root-stack sibling
   * of the tabs, so it fills the screen with no tab bar and nothing underneath, and they took it
   * for the app's main screen — believing the counters were where prayers get marked. So Today is
   * replaced in first, and the counting is *pushed on top* of it. The user sees the app they were
   * setting up, the wizard sits over it as the offer it is, and dismissing it reveals Today rather
   * than stranding them.
   *
   * The qada destination carries `setup=1`, which is what makes "Count them with me" arrive at
   * the counting. The qada screen deliberately does not open its wizard by itself (a first visit
   * is the list of counters, because someone who owes two prayers came for the list), so the
   * intent has to travel with the route or this button lands the user on five zeroes.
   */
  const finish = useCallback(
    (destination: 'today' | 'qadaSetup') => {
      setOnboardingCompleted(true);
      router.replace('/');
      if (destination === 'qadaSetup') router.push({ pathname: '/qada', params: { setup: '1' } });
    },
    [setOnboardingCompleted]
  );

  const goNext = useCallback(() => {
    const next = steps[index + 1];
    if (next === undefined) finish('today');
    else setCurrent(next);
  }, [steps, index, finish]);

  const goBack = useCallback(() => {
    const previous = steps[index - 1];
    if (previous !== undefined) setCurrent(previous);
  }, [steps, index]);

  // Exact alarms (D91) — the app's one offer of them, and it lives inside the battery step. Read
  // only while that step is on screen (nowhere else in the flow mentions them) and again on every
  // foreground, because the way this permission is granted is by leaving for a system screen and
  // coming back. Declining changes nothing: reminders still arrive, just not always to the minute.
  const [exactAlarms, setExactAlarms] = useState<ExactAlarmState | null>(null);
  useEffect(() => {
    if (current !== 'battery') return;
    let alive = true;
    let seen: ExactAlarmState | null = null;

    const read = async (): Promise<void> => {
      const next = await readExactAlarmState();
      if (!alive) return;
      setExactAlarms(next);
      const previous = seen;
      seen = next;
      // Granting them does not reach an alarm that is already set, and the reminders chosen two
      // steps ago are already set. Without this the fix would do nothing for days.
      if (previous === 'inexact' && next === 'exact') await rebuildNotificationsFromStores();
    };

    void read();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') void read();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [current]);

  // Android's hardware back means "the previous step", not "quit the app half-way through
  // setup". On the first step there is no previous, so the event is left to the OS.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (index === 0) return false;
      goBack();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, [index, goBack]);

  const common = {
    step: index + 1,
    total: steps.length,
    onBack: index === 0 ? undefined : goBack,
  };

  /* ------------------------------------------------------------------------------ WELCOME */
  if (current === 'welcome') {
    return (
      <OnboardingScaffold
        {...common}
        ornament={<Logo size={84} />}
        title={t('onboarding.welcome.title')}
        body={t('onboarding.welcome.body')}
        footnote={t('onboarding.welcome.pledge')}
        primary={{
          testID: 'onboarding-start',
          label: t('onboarding.welcome.start'),
          onPress: goNext,
        }}
        quiet={{
          testID: 'onboarding-skip-all',
          label: t('onboarding.welcome.skip'),
          onPress: () => finish('today'),
        }}
      />
    );
  }

  /* ----------------------------------------------------------------------------- LOCATION */
  if (current === 'location') {
    return <LocationStep {...common} onNext={goNext} location={location} />;
  }

  /* -------------------------------------------------------------------------------- THEME */
  if (current === 'theme') {
    const themeOptions: { value: ThemePreference; label: string; description: string }[] = [
      {
        value: 'system',
        label: t('settings.home.appearance.theme.system'),
        description: t('onboarding.theme.system'),
      },
      {
        value: 'light',
        label: t('settings.home.appearance.theme.light'),
        description: t('onboarding.theme.light'),
      },
      {
        value: 'dark',
        label: t('settings.home.appearance.theme.dark'),
        description: t('onboarding.theme.dark'),
      },
    ];

    return (
      <OnboardingScaffold
        {...common}
        // The glyph follows the choice, so the page demonstrates the setting it is asking about.
        icon={scheme === 'dark' ? 'dark_mode' : 'light_mode'}
        title={t('onboarding.theme.title')}
        body={t('onboarding.theme.body')}
        primary={{ label: t('onboarding.continue'), onPress: goNext }}
      >
        {themeOptions.map((option) => (
          <OptionCard
            key={option.value}
            testID={`onboarding-theme-${option.value}`}
            label={option.label}
            description={option.description}
            selected={themePreference === option.value}
            // Applied on the spot: the whole page changes colour, which explains the setting
            // better than any sentence could.
            onPress={() => setTheme(option.value)}
          />
        ))}
      </OnboardingScaffold>
    );
  }

  /* ------------------------------------------------------------------------ NOTIFICATIONS */
  if (current === 'notifications') {
    /** Raises the OS dialog and remembers that it was raised (see `permissionAsked`). */
    const askOs = (): void => {
      setPermissionAsked(true);
      notificationPermission.request();
    };

    const choose = (choice: ReminderChoice): void => {
      if (choice === 'off') {
        // Every kind, not just the adhan reminder: someone who picked "no reminders" and then
        // received an end-of-window nudge would have been lied to.
        setAllReminders({ adhanEnabled: false, preReminderEnabled: false, nudgeEnabled: false });
        return;
      }
      setAllReminders({ adhanEnabled: true, sound: choice, nudgeEnabled: true });
      // Asking for a reminder is the strongest possible signal of intent to be notified, so the
      // OS permission is requested right here (spec-accessibility §4.1) — never on arrival.
      // `null` (unread, or a read that failed — some OEM builds do) asks too: requesting is the
      // one call that always learns the truth, and it is a no-op where the answer is already yes.
      if (permission === null || (!permission.granted && permission.canAskAgain)) {
        askOs();
      }
    };

    const ungranted = permission !== null && !permission.granted;
    const blocked = ungranted && !permission.canAskAgain;
    // The tap-through case: the pre-selected choice is a real reminder, but nothing has asked the
    // OS yet. The button says exactly what it is about to do rather than pretending to be
    // "Continue" and springing a system dialog. Once the dialog HAS been raised, whatever came
    // back is the answer and the button goes back to moving the flow along — see
    // `permissionAsked` for why the permission alone cannot decide this. An UNREAD permission
    // (`null`) must land on the asking side: treating it as granted once let a slow or failed
    // read walk a user out of onboarding believing reminders were on when nothing could ever
    // fire — the widget-era bug report that reshaped this step.
    const needsPermission =
      reminderChoice !== 'off' &&
      !blocked &&
      !permissionAsked &&
      (permission === null || !permission.granted);
    // The refusal that is not final (Android's first "Don't allow", a dialog swiped away): the
    // way back is ON this step, not hidden in Settings, for the thumb that slipped. iOS never
    // lands here: its refusal flips canAskAgain off and takes the `blocked` card below instead.
    const refusedButAskable =
      permission !== null && !permission.granted && permission.canAskAgain && permissionAsked;
    // **A reminder was chosen and the OS will not deliver it.** Until one of those two facts
    // changes, the primary button does not say "Continue" — because the step would then be
    // walking someone out of onboarding with a reminder selected on screen that can never fire.
    // That is the exact failure the `needsPermission` comment above was already written against;
    // it guarded the tap-through and left the refusal alone (owner, 2026-08-30, D137).
    //
    // It is not a trap, and it must never become one: "No reminders" is an option card two
    // fingers above, and choosing it makes this false and the button move on immediately. So the
    // way forward is always one visible tap — either grant the permission or say you do not want
    // it — and the step never pretends a choice works when it does not.
    const cannotDeliver = reminderChoice !== 'off' && ungranted;

    return (
      <OnboardingScaffold
        {...common}
        icon="notifications"
        title={t('onboarding.notifications.title')}
        body={t('onboarding.notifications.body')}
        footnote={t('onboarding.notifications.footnote')}
        primary={{
          testID: 'onboarding-notifications-primary',
          label:
            needsPermission || (cannotDeliver && !blocked)
              ? t('onboarding.notifications.allow')
              : cannotDeliver
                ? t('onboarding.notifications.openSettings')
                : t('onboarding.continue'),
          onPress:
            needsPermission || (cannotDeliver && !blocked)
              ? askOs
              : cannotDeliver
                ? notificationPermission.openSystemSettings
                : goNext,
        }}
      >
        <OptionCard
          testID="onboarding-reminders-off"
          label={t('onboarding.notifications.off')}
          description={t('onboarding.notifications.offBody')}
          selected={reminderChoice === 'off'}
          onPress={() => choose('off')}
        />
        <OptionCard
          testID="onboarding-reminders-system"
          label={t('onboarding.notifications.system')}
          description={t('onboarding.notifications.systemBody')}
          selected={reminderChoice === 'system'}
          onPress={() => choose('system')}
        />
        <OptionCard
          testID="onboarding-reminders-adhan"
          label={t('onboarding.notifications.adhan')}
          description={t('onboarding.notifications.adhanBody')}
          selected={reminderChoice === 'adhan'}
          onPress={() => choose('adhan')}
        />

        {/* The refusal that can be taken back (Android; iOS refusals go to the blocked card).
            Continue stays the primary — the flow never gates — but the accidental "Don't allow"
            gets its second chance right here, in words, without a trip to Settings. */}
        {refusedButAskable && reminderChoice !== 'off' ? (
          <Card
            testID="onboarding-reminders-refused"
            variant="bright"
            border="mid"
            style={{ padding: spacing.md, gap: spacing.sm }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
              <Icon name="notifications_off" size={18} color={colors.header} />
              <AppText variant="caption" tone="header" style={{ flex: 1 }}>
                {t('onboarding.notifications.refused')}
              </AppText>
            </View>
          </Card>
        ) : null}

        {/* The OS has stopped asking. Say so plainly — icon and words, never a colour — and give
            the one door that is left, so the Today pill's third state is not the first the user
            hears of it. */}
        {blocked && reminderChoice !== 'off' ? (
          <Card
            testID="onboarding-reminders-blocked"
            variant="bright"
            border="mid"
            style={{ padding: spacing.md, gap: spacing.sm }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
              <Icon name="notifications_off" size={18} color={colors.header} />
              <AppText variant="caption" tone="header" style={{ flex: 1 }}>
                {t('onboarding.notifications.blocked')}
              </AppText>
            </View>
          </Card>
        ) : null}
      </OnboardingScaffold>
    );
  }

  /* ------------------------------------------------------------------------------ BATTERY */
  if (current === 'battery') {
    const oem = currentOemFamily();
    const named = hasAggressiveBatteryManager(oem);

    return (
      <OnboardingScaffold
        {...common}
        icon="electric_bolt"
        title={t('onboarding.battery.title')}
        body={
          named
            ? t('onboarding.battery.bodyOem', {
                brand: t(`settings.reminderHealth.battery.oem.${oem}`),
              })
            : t('onboarding.battery.body')
        }
        footnote={t('onboarding.battery.footnote')}
        primary={{ label: t('onboarding.continue'), onPress: goNext }}
      >
        <View style={{ alignItems: 'center' }}>
          <OutlinedAction
            testID="onboarding-battery-open"
            icon="settings"
            label={t('onboarding.battery.open')}
            onPress={() => void openBatteryOptimisationSettings()}
          />
        </View>

        {/* The exact-alarm offer, made once and never again: from here on it lives in Settings ›
            Reminders › Reminder reliability, where it is shown in both states. It appears only
            when the phone is actually holding reminders back, so nobody is asked to fix something
            that is not broken. */}
        {exactAlarms === 'inexact' ? (
          <Card
            testID="onboarding-exact-alarms"
            variant="bright"
            border="mid"
            style={{ padding: spacing.md, gap: spacing.sm }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
              <Icon name="alarm" size={18} color={colors.header} />
              <AppText variant="caption" tone="header" style={{ flex: 1 }}>
                {t('onboarding.battery.exactBody')}
              </AppText>
            </View>
            <OutlinedAction
              testID="onboarding-exact-alarms-open"
              icon="alarm"
              label={t('onboarding.battery.exactOpen')}
              onPress={() => void openExactAlarmSettings()}
            />
          </Card>
        ) : null}
      </OnboardingScaffold>
    );
  }

  /* ----------------------------------------------------------------------------- TRACKING */
  if (current === 'tracking') {
    const modes: { value: TrackingMode; label: string; description: string }[] = [
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
    return (
      <OnboardingScaffold
        {...common}
        icon="check_circle"
        title={t('onboarding.tracking.title')}
        body={t('onboarding.tracking.body')}
        footnote={t('onboarding.tracking.footnote')}
        primary={{
          testID: 'onboarding-tracking-continue',
          label: t('onboarding.continue'),
          onPress: () => {
            setTrackingMode(trackingDraft, today);
            goNext();
          },
        }}
      >
        {/* The wording is the Settings screen's, verbatim — as on the streak step. */}
        {modes.map((mode) => (
          <View key={mode.value} style={{ gap: spacing.sm }}>
            <TrackingModeDemo testID={`onboarding-tracking-demo-${mode.value}`} mode={mode.value} />
            <OptionCard
              testID={`onboarding-tracking-${mode.value}`}
              label={mode.label}
              description={mode.description}
              selected={trackingDraft === mode.value}
              onPress={() => setTrackingDraft(mode.value)}
            />
          </View>
        ))}
      </OnboardingScaffold>
    );
  }

  /* ------------------------------------------------------------------------------- STREAK */
  if (current === 'streak') {
    return (
      <OnboardingScaffold
        {...common}
        icon="done_all"
        title={t('onboarding.streak.title')}
        body={t('onboarding.streak.body')}
        footnote={t('onboarding.streak.footnote')}
        primary={{
          testID: 'onboarding-streak-continue',
          label: t('onboarding.continue'),
          onPress: () => {
            setStreakMode(streakDraft);
            goNext();
          },
        }}
      >
        {/* The wording is the Settings screen's, verbatim: someone who goes looking for this
            later has to recognise the answer they gave here. */}
        <OptionCard
          testID="onboarding-streak-hard"
          label={t('settings.home.tracking.streak.committed')}
          description={t('settings.home.tracking.streak.committedBody')}
          selected={streakDraft === 'hard'}
          onPress={() => setStreakDraft('hard')}
        />
        <OptionCard
          testID="onboarding-streak-soft"
          label={t('settings.home.tracking.streak.relaxed')}
          description={t('settings.home.tracking.streak.relaxedBody')}
          selected={streakDraft === 'soft'}
          onPress={() => setStreakDraft('soft')}
        />
      </OnboardingScaffold>
    );
  }

  /* --------------------------------------------------------------------------------- QADA */
  return (
    <OnboardingScaffold
      {...common}
      icon="history"
      title={t('onboarding.qada.title')}
      body={t('onboarding.qada.body')}
      primary={{
        testID: 'onboarding-qada-start',
        label: t('onboarding.qada.start'),
        // Straight into the wizard that already exists — it opens by itself, because the qada
        // setup flag is still unset (`QadaScreen`).
        onPress: () => finish('qadaSetup'),
      }}
      quiet={{
        testID: 'onboarding-qada-skip',
        label: t('onboarding.qada.skip'),
        onPress: () => finish('today'),
      }}
    />
  );
}

/* -------------------------------------------------------------------------------------------- */

interface LocationStepProps {
  step: number;
  total: number;
  onBack?: () => void;
  onNext: () => void;
  /** The stored location, or `null` while none has been resolved or typed. */
  location: AppLocation | null;
}

/**
 * The one thing the app genuinely cannot work without — and therefore the one step written to be
 * refusable twice over: the device can be declined in favour of typing a city, and the whole step
 * can be declined in favour of the same card appearing on Today.
 *
 * The ask itself is `LocationPromptCard`, unchanged and unwrapped: it is already the app's only
 * location-permission origin, it already covers "not set", "you said no", "the OS will not ask
 * again" and "the fix failed", and it already carries the manual route beside the device one.
 * Re-authoring any of that here would mean two versions of the most important paragraph in the
 * app — and the manual route is the same `app/city` picker every other caller opens, presented
 * over this step and dismissing back to it, so declining GPS never ejects anyone from setup.
 */
function LocationStep({ step, total, onBack, onNext, location }: LocationStepProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useLocationStatus();
  const { canAskAgain } = useLocationPermission();
  const { requestAndResolve } = useLocationActions();

  const promptState: LocationPromptState =
    status === 'denied' ? (canAskAgain ? 'denied' : 'blocked') : status === 'error' ? 'error' : 'idle';

  const handleAction = useCallback(() => {
    if (status === 'denied' && !canAskAgain) {
      void Promise.resolve(Linking.openSettings()).catch(() => {
        // Some OEM builds refuse the deep link; the card still offers "Choose a city".
      });
      return;
    }
    void requestAndResolve();
  }, [status, canAskAgain, requestAndResolve]);

  const resolved = location !== null;
  // Once there is a location the step is answered, so the page grows the forward button it did
  // not have while the card's own button was the primary action.
  const primary: OnboardingAction | undefined = resolved
    ? { testID: 'onboarding-location-continue', label: t('onboarding.continue'), onPress: onNext }
    : undefined;
  const quiet: OnboardingAction | undefined = resolved
    ? undefined
    : { testID: 'onboarding-location-skip', label: t('onboarding.location.skip'), onPress: onNext };

  const openPicker = useCallback(() => {
    router.push('/city');
  }, []);

  return (
    <OnboardingScaffold
      step={step}
      total={total}
      onBack={onBack}
      title={t('onboarding.location.title')}
      primary={primary}
      quiet={quiet}
    >
      {resolved ? (
        <Card
          testID="onboarding-location-resolved"
          variant="bright"
          border="strong"
          style={{ padding: spacing.lg, gap: spacing.sm, alignItems: 'center' }}
        >
          <Icon name="check_circle" size={26} color={colors.accent} />
          <AppText variant="rowName" weight={600} style={{ textAlign: 'center' }}>
            {location.label}
          </AppText>
          <AppText variant="caption" tone="header" style={{ textAlign: 'center' }}>
            {t('onboarding.location.resolved')}
          </AppText>
          <OutlinedAction
            testID="onboarding-location-change"
            icon="search"
            label={t('onboarding.location.change')}
            onPress={openPicker}
          />
        </Card>
      ) : (
        <LocationPromptCard
          testID="onboarding-location-prompt"
          state={promptState}
          busy={status === 'requesting'}
          onPress={handleAction}
          // The picker opens OVER this step and dismisses back to it. Leaving setup to find a
          // text field somewhere else, and having to come back, is the opposite of a step you
          // can skip.
          onChooseCity={openPicker}
        />
      )}
    </OnboardingScaffold>
  );
}

/* -------------------------------------------------------------------------------------------- */

/**
 * An outlined pill for a secondary action inside a step — "open your battery settings", "choose a
 * different place". Deliberately not the filled primary: nothing inside a step outranks the
 * button that moves the flow along.
 */
function OutlinedAction({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: 'settings' | 'search' | 'my_location' | 'alarm' | 'notifications';
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      haptics
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 48,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.xl,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.borderMid,
        backgroundColor: colors.card,
      }}
    >
      <Icon name={icon} size={16} color={colors.accent} />
      <AppText variant="time" weight={600} tabularNums={false} color={colors.accent}>
        {label}
      </AppText>
    </PressableScale>
  );
}
