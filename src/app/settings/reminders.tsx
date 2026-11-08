import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppState,
  Linking,
  Platform,
  ScrollView,
  View,
  type AppStateStatus,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { backChevron } from '@/i18n/direction';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { OptionCard } from '@/components/OptionCard';
import { PaperBackground } from '@/components/PaperBackground';
import { PressableScale } from '@/components/PressableScale';
import { SectionDivider } from '@/components/SectionDivider';
import { SettingChoiceRow, type SettingChoiceOption } from '@/components/SettingChoiceRow';
import { SettingGroup } from '@/components/SettingGroup';
import { SettingRow, SettingSwitchRow } from '@/components/SettingRow';
import { ADHAN_VOICES } from '@/domain/adhanVoices';
import { PRAYERS } from '@/domain/types';
import { useAdhanPreview } from '@/hooks/useAdhanPreview';
import { useAnnounceChange } from '@/hooks/useAnnounceChange';
import { syncNotificationsFromStores } from '@/hooks/useNotificationSync';
import { useLayout } from '@/hooks/useLayout';
import { isSupported as audioPauseSupported } from '../../../modules/audio-pause';
import {
  getNotificationService,
  type DeliveryWarning,
  type NotificationPermission,
} from '@/services/notifications';
import {
  MAX_LIVE_ACTIVITY_MINUTES,
  MAX_NUDGE_LEAD_MINUTES,
  MAX_PRE_REMINDER_MINUTES,
  MIN_LIVE_ACTIVITY_MINUTES,
  MIN_PRE_REMINDER_MINUTES,
  MIN_NUDGE_LEAD_MINUTES,
  useAdhanVoice,
  useLiveActivityEnabled,
  useLiveActivityLeadMinutes,
  useLiveActivityLingerMinutes,
  useNudgeLeadMinutes,
  usePauseAudioEnabled,
  usePersistentNotificationEnabled,
  useReminders,
  useSettingsActions,
  useSunriseNoteEnabled,
} from '@/stores/settingsStore';
import { liveActivitiesSupported } from '../../../modules/prayer-widgets';
import { radius, spacing, useTheme } from '@/theme';

import type { AdhanVoice, Prayer, PrayerReminderSettings, ReminderSound } from '@/domain/types';

/**
 * Settings → Reminders (PRODUCT_SPEC §11 and §12).
 *
 * The screen where the app's single most-complained-about behaviour in the whole category is
 * configured. Our market research is blunt about it: "the adhan did not fire" is the second
 * most common complaint about prayer apps, and the second is that the one feature people
 * actually want — an early Fajr wake-up — sits behind a competitor's paywall. Both answers live
 * here, free, and both are per prayer.
 *
 * Each prayer gets **three independent reminders**, because they answer three different
 * questions and a single "reminders on/off" switch cannot:
 *
 * 1. **At the adhan** — the prayer has come in. Its sound is chosen per prayer (silent / the
 *    device's own sound / the adhan), because the sound you want at Fajr is rarely the sound you
 *    want in the middle of a working afternoon. *Which* adhan is one global choice among four
 *    recitations, in the bulk group: nobody wants a different reciter for Asr than for Maghrib,
 *    and offering it would be five questions where there is one answer (D81).
 * 2. **Before the adhan** — the heads-up, and at Fajr the wake-up. Lead times are offered as a
 *    short ladder rather than a free number, so the choice is one tap.
 * 3. **The last call** — which *only ever fires while the prayer is still unmarked*
 *    (`domain/notificationPlan` plans it, and logging cancels it immediately). That sentence is
 *    on screen, under the switch, because a nudge you cannot predict reads as nagging and a
 *    nudge you can reads as consideration. *How early* it arrives is one **global** choice, in
 *    the bulk group rather than on each prayer: "how much warning do I want" has one answer, and
 *    five copies of it would be five chances to disagree with yourself. Fajr's last call is the
 *    only one whose deadline is not the next prayer — its time ends at sunrise — and its
 *    description says so.
 * 4. **The note at sunrise** — the fourth notification, and the only one that is not per prayer.
 *    It exists for Fajr alone (PRODUCT_SPEC §11.2), it ships **off**, and it has a group of its
 *    own between the bulk actions and the prayer cards. It used to ride Fajr's last-call switch,
 *    which meant an unmarked Fajr sent two notifications about the same prayer and the only way
 *    to stop the second was to give up the first everywhere (D90).
 *
 * ## Why the prayers are cards that open
 *
 * Fifteen controls — three per prayer, plus the two that appear when their parent is on — is a
 * wall if they are all on screen at once, and the bar this app is held to is "so dumb and easy
 * that an old person or a 7 year old could use" (CLAUDE.md). So each prayer is a **closed card**
 * carrying its name at a size you can read across a room and a one-line summary of what it is
 * currently set to; the controls appear when you open it. Five short cards, and the user chooses
 * which one to meet.
 *
 * The summary is words and glyphs, never a colour or a dot ({@link reminderSummaryChips}), and
 * the header is one button with `expanded` in its accessibility state, so the same information
 * reaches a screen reader in the same order.
 *
 * Cards open independently rather than as an accordion: closing the card someone opened two taps
 * ago would move the page under their thumb, which is a worse surprise than a long screen.
 *
 * Three things this screen deliberately does NOT do:
 *
 * - **It never decides a schedule.** Every control writes one field through `settingsStore`.
 *   `hooks/useNotificationSync` — mounted once in the root layout — watches that store and
 *   reconciles the OS on a debounced trigger, so five taps in a row cost one reschedule and the
 *   Today tab, this screen and the OS can never hold different opinions. The only sync this
 *   screen asks for by hand is the one right after a permission grant, so the user's first "yes"
 *   schedules something immediately instead of at the next foreground.
 * - **It never prompts on its own.** The OS dialog can only come from the button on the
 *   permission card, which is one calm explanation shown once — and which turns into a
 *   system-settings deep link once the OS has stopped asking. Everything below it stays visible
 *   and editable the whole time: a refusal must not hold your preferences hostage.
 * - **It never claims a notification will arrive.** "Send a test notification" is the proof, and
 *   it reports honestly when it fails.
 *
 * Composition only: values from `stores/settingsStore`, side effects from
 * `services/notifications`, strings from i18n, rows from the shared settings vocabulary.
 */

/**
 * The lead times offered for a pre-reminder, in minutes.
 *
 * A ladder rather than a stepper: every one of these is a *decision* ("half an hour before Fajr
 * so I can actually get up"), and a stepper makes the user tap six times to express it. Both
 * store defaults — 30 for Fajr, 15 for the rest — are on the ladder, so a fresh install always
 * opens with a chip already selected.
 */
export const PRE_REMINDER_CHOICES: readonly number[] = [5, 10, 15, 30, 45];

/**
 * How long before a window closes the last call may be set to arrive, in minutes.
 *
 * Four stops rather than the full {@link MIN_NUDGE_LEAD_MINUTES}…{@link MAX_NUDGE_LEAD_MINUTES}
 * range: the question is "how much warning do I want", and ten / fifteen / twenty / thirty are
 * the four answers anyone actually has. Wider values remain valid in storage — the bounds are the
 * trust boundary, this ladder is the conversation.
 */
export const NUDGE_LEAD_CHOICES: readonly number[] = [10, 15, 20, 30];

/**
 * The Live Activity's two distances — how early the lead card appears, how long the due card
 * stays (D112) — share one ladder, for the same reason the nudge has one: the bounds are the
 * trust boundary, this ladder is the conversation.
 */
export const LIVE_ACTIVITY_CHOICES: readonly number[] = [15, 30, 45, 60];

/** The sounds, in the order they escalate. */
const SOUNDS: readonly ReminderSound[] = ['silent', 'system', 'adhan'];

/** Icon for the adhan switch — a glyph change, so the row's state is never colour-only. */
function adhanIcon(enabled: boolean): IconName {
  return enabled ? 'notifications_active' : 'notifications_off';
}

/** How the "send a test" row reports itself. */
type TestState = 'idle' | 'sending' | 'sent' | 'failed';

/**
 * Which of the two test rows a send belongs to — the configured sound or the adhan — so the
 * status and delivery feedback render under the row that was actually pressed.
 */
type TestTarget = 'sound' | 'adhan';

/** One fact about a prayer's current configuration, as shown on its closed card. */
export interface ReminderSummaryChip {
  icon: IconName;
  label: string;
}

/**
 * What a prayer's closed card says it is set to.
 *
 * Every chip is a **glyph and a word** — a prayer with nothing on says so in as many words rather
 * than being the card without a tint, because a state that only exists as an absence is invisible
 * to anyone reading in greyscale or by ear.
 *
 * Pure, and separated from the card so the summary can be asserted without a renderer.
 *
 * @param reminder - The prayer's stored settings.
 * @param labels - Already-localized text; this function chooses *which* facts, never their words.
 * @returns One to three chips, never zero.
 */
export function reminderSummaryChips(
  reminder: PrayerReminderSettings,
  labels: {
    adhan: (sound: ReminderSound) => string;
    pre: (minutes: number) => string;
    nudge: string;
    none: string;
  }
): ReminderSummaryChip[] {
  const chips: ReminderSummaryChip[] = [];
  if (reminder.adhanEnabled) {
    chips.push({ icon: 'notifications_active', label: labels.adhan(reminder.sound) });
  }
  if (reminder.preReminderEnabled) {
    chips.push({ icon: 'schedule', label: labels.pre(reminder.preReminderMinutes) });
  }
  if (reminder.nudgeEnabled) {
    chips.push({ icon: 'alarm', label: labels.nudge });
  }
  if (chips.length === 0) {
    chips.push({ icon: 'notifications_off', label: labels.none });
  }
  return chips;
}

export default function RemindersSettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { contentClampPadding } = useLayout();
  const router = useRouter();

  const reminders = useReminders();
  const nudgeLeadMinutes = useNudgeLeadMinutes();
  const sunriseNoteEnabled = useSunriseNoteEnabled();
  const persistentEnabled = usePersistentNotificationEnabled();
  const liveActivityEnabled = useLiveActivityEnabled();
  const liveActivityLeadMinutes = useLiveActivityLeadMinutes();
  const liveActivityLingerMinutes = useLiveActivityLingerMinutes();
  const pauseAudioEnabled = usePauseAudioEnabled();
  const adhanVoice = useAdhanVoice();
  const {
    setReminder,
    setAllReminders,
    setAdhanVoice,
    setNudgeLeadMinutes,
    setSunriseNoteEnabled,
    setPersistentNotification,
    setLiveActivityEnabled,
    setLiveActivityLeadMinutes,
    setLiveActivityLingerMinutes,
    setPauseAudioEnabled,
  } = useSettingsActions();

  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [asking, setAsking] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testTarget, setTestTarget] = useState<TestTarget>('sound');
  /** What the OS says will stop a notification being seen or heard, or `null` when it says nothing. */
  const [delivery, setDelivery] = useState<DeliveryWarning | null>(null);

  const preview = useAdhanPreview();
  const stopPreview = preview.stop;
  /** Whether the four recitations are on screen. Closed by default — see the row itself. */
  const [voiceOpen, setVoiceOpen] = useState(false);
  /** Which prayer cards are open. Everything starts closed: the screen opens as a list of five. */
  const [openPrayers, setOpenPrayers] = useState<readonly Prayer[]>([]);

  /**
   * Choosing a recitation and hearing it are **one press**, deliberately.
   *
   * The alternative — a play button beside every row, and a separate tap to choose — is two
   * targets per row and a question ("did that change it?") where there was none. This is the
   * ringtone-picker gesture every phone already teaches, and the cost of a mis-tap is a second
   * tap: nothing is confirmed, saved or destroyed, and the marked row always says where you are.
   * A second press on the recitation already sounding stops it (`useAdhanPreview` owns that).
   */
  const playVoice = preview.toggle;
  const chooseVoice = useCallback(
    (voice: AdhanVoice) => {
      setAdhanVoice(voice);
      playVoice(voice);
    },
    [setAdhanVoice, playVoice]
  );

  const togglePrayer = useCallback((prayer: Prayer) => {
    setOpenPrayers((current) =>
      current.includes(prayer)
        ? current.filter((entry) => entry !== prayer)
        : [...current, prayer]
    );
  }, []);

  // Guards for "exactly once": a double tap on either action must not produce two OS dialogs or
  // two test notifications. Refs rather than state because the second tap can arrive in the same
  // frame, before React has re-rendered with the flag set.
  const askingRef = useRef(false);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);

  // Both rows below report back in a line that appears under the row you just pressed, marked as a
  // live region — which does nothing on iOS (the prop is Android-only in React Native), so the
  // whole point of a *test* notification was lost on VoiceOver: you pressed it and the app went
  // quiet. The test row's two lines are spoken as one utterance rather than two, because iOS
  // announcements fired in the same frame can swallow one another.
  useAnnounceChange(
    preview.playing === null
      ? null
      : t('settings.reminders.voice.playing', {
          voice: t(`settings.reminders.voice.${preview.playing}`),
        })
  );
  useAnnounceChange(
    testState === 'idle'
      ? null
      : [
          testState === 'sent'
            ? t('settings.reminders.test.sent')
            : testState === 'failed'
              ? t('settings.reminders.test.failed')
              : t('settings.reminders.test.sending'),
          delivery === null ? null : t(`settings.reminders.delivery.${delivery}`),
        ]
          .filter((line) => line !== null)
          .join('. ')
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Leaving the screen without unmounting it — pushing another screen on top — must silence the
  // adhan just as surely as going back does. (Backgrounding the app is handled inside the hook,
  // and by the audio session itself; see `useAdhanPreview`.)
  useFocusEffect(
    useCallback(() => {
      return () => stopPreview();
    }, [stopPreview])
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  /**
   * The only prompt on this screen. Once the OS has answered "yes", the schedule is applied at
   * once rather than at the next foreground — the user pressed a button and must see reminders
   * exist afterwards.
   */
  const requestPermission = useCallback(() => {
    if (askingRef.current) return;
    askingRef.current = true;
    setAsking(true);
    void (async () => {
      try {
        const next = await getNotificationService().requestPermission();
        if (mountedRef.current) setPermission(next);
        if (next.granted) await syncNotificationsFromStores();
      } catch {
        // `requestPermission` swallows expected failures already; anything left is not fatal.
      } finally {
        askingRef.current = false;
        if (mountedRef.current) setAsking(false);
      }
    })();
  }, []);

  const openSystemSettings = useCallback(() => {
    void Linking.openSettings().catch(() => {
      // Some OEM builds refuse the deep link. Nothing else on the screen depends on it.
    });
  }, []);

  /**
   * The sound the test notification plays: the one the earliest enabled prayer uses, so pressing
   * the button proves the sound the user actually configured — the adhan clip especially, which
   * is the thing people doubt. Shown as the row's value, so this is never hidden logic.
   */
  const testSound: ReminderSound = useMemo(() => {
    const configured = PRAYERS.find((prayer) => reminders[prayer].adhanEnabled);
    return configured === undefined ? 'system' : reminders[configured].sound;
  }, [reminders]);

  /**
   * Re-reads both facts the OS owns about this screen. Depends on `testSound` **and** the chosen
   * recitation, because together they decide which Android channel the test notification will use
   * — the voice is part of an adhan channel's id — and therefore which channel's importance and
   * sound `checkDelivery` has to inspect.
   */
  const readNotificationState = useCallback(() => {
    const service = getNotificationService();
    void service
      .getPermission()
      .then((next) => {
        if (mountedRef.current) setPermission(next);
      })
      .catch(() => {
        // An unreadable permission is not worth a broken screen; the card stays as it was.
      });
    void service
      .checkDelivery({ sound: testSound, voice: adhanVoice })
      .then((warning) => {
        if (mountedRef.current) setDelivery(warning);
      })
      .catch(() => {
        // Unknown stays unknown — the row says nothing rather than guessing.
      });
  }, [testSound, adhanVoice]);

  // The OS permission is the external system this screen subscribes to. Returning from the
  // system settings is the one moment a refusal becomes a grant without the app doing anything,
  // so it is re-read on every foreground — and this path only ever *reads*: nothing here can
  // make the permission dialog appear. The delivery state is read on the same beat and for the
  // same reason: switching the app's sound off, or turning on Do Not Disturb, happens in system
  // settings and comes back with the user.
  useEffect(() => {
    readNotificationState();
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') readNotificationState();
    });
    return () => subscription.remove();
  }, [readNotificationState]);

  const sendTestWith = useCallback(
    (sound: ReminderSound, target: TestTarget) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setTestTarget(target);
      setTestState('sending');
      void (async () => {
        let delivered = false;
        try {
          delivered = await getNotificationService().sendTestNotification({
            sound,
            voice: adhanVoice,
          });
        } catch {
          delivered = false;
        }
        sendingRef.current = false;
        if (mountedRef.current) setTestState(delivered ? 'sent' : 'failed');
        // Right after a send is exactly when "I heard nothing" happens, so this is the moment the
        // answer is worth most.
        readNotificationState();
      })();
    },
    [adhanVoice, readNotificationState]
  );

  const sendTest = useCallback(() => sendTestWith(testSound, 'sound'), [sendTestWith, testSound]);
  // Always the adhan, whatever the prayers are set to — this button exists so the recitation can
  // be heard as a real notification *before* anyone commits a prayer to it.
  const sendAdhanTest = useCallback(() => sendTestWith('adhan', 'adhan'), [sendTestWith]);

  const soundLabel = useCallback(
    (sound: ReminderSound): string =>
      sound === 'silent'
        ? t('settings.reminders.sound.silent')
        : sound === 'system'
          ? t('settings.reminders.sound.system')
          : t('settings.reminders.sound.adhan'),
    [t]
  );

  /** `{{count}} min`, in the locale's own digits and plural form. */
  const minutesLabel = useCallback(
    (minutes: number): string => t('settings.reminders.pre.minutes', { count: minutes }),
    [t]
  );

  const adhanOnCount = PRAYERS.filter((prayer) => reminders[prayer].adhanEnabled).length;
  const nudgeOnCount = PRAYERS.filter((prayer) => reminders[prayer].nudgeEnabled).length;

  // The stored value always has a chip of its own, even if it came from a hand-edited payload:
  // a radio group with nothing selected is a broken control.
  const leadOptions: SettingChoiceOption<string>[] = [
    ...new Set([...NUDGE_LEAD_CHOICES, nudgeLeadMinutes]),
  ]
    .filter((value) => value >= MIN_NUDGE_LEAD_MINUTES && value <= MAX_NUDGE_LEAD_MINUTES)
    .sort((a, b) => a - b)
    .map((value) => ({
      value: String(value),
      label: minutesLabel(value),
      accessibilityLabel: t('settings.reminders.nudgeTiming.a11yOption', {
        value: minutesLabel(value),
      }),
    }));

  // Same chip rule for the Live Activity's two distances, with each row's own spoken label.
  const liveActivityOptions = useCallback(
    (stored: number, a11yKey: string): SettingChoiceOption<string>[] =>
      [...new Set([...LIVE_ACTIVITY_CHOICES, stored])]
        .filter(
          (value) => value >= MIN_LIVE_ACTIVITY_MINUTES && value <= MAX_LIVE_ACTIVITY_MINUTES
        )
        .sort((a, b) => a - b)
        .map((value) => ({
          value: String(value),
          label: minutesLabel(value),
          accessibilityLabel: t(a11yKey, { value: minutesLabel(value) }),
        })),
    [minutesLabel, t]
  );

  const granted = permission?.granted ?? true;
  // `canAskAgain === false` is the end of the road for the in-app dialog: the OS will not show it
  // again, so the button has to lead somewhere that can.
  const blocked = permission !== null && !permission.granted && !permission.canAskAgain;

  // Shared by both test rows, rendered under whichever was pressed last (`testTarget`), so the
  // answer appears where the question was asked.
  const testFeedback = (
    <>
      {/* What the OS has actually told us will happen — never a guess. `checkDelivery`
          reports only what the platform says; the ringer and Focus are unreadable, so when
          nothing is known the footnote below points at them without claiming anything. */}
      {delivery === null ? null : (
        <View
          testID="reminders-test-delivery"
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Icon name="info" size={15} color={colors.header} />
          <AppText variant="caption" tone="header" style={{ flex: 1 }}>
            {t(`settings.reminders.delivery.${delivery}`)}
          </AppText>
        </View>
      )}
      {testState === 'sent' && delivery === null ? (
        <AppText testID="reminders-test-ringer-hint" variant="hint">
          {t('settings.reminders.delivery.checkRinger')}
        </AppText>
      ) : null}
      {testState === 'idle' ? null : (
        <View
          testID="reminders-test-status"
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Icon
            name={testState === 'sent' ? 'check' : testState === 'failed' ? 'error' : 'schedule'}
            size={15}
            color={testState === 'failed' ? colors.missed : colors.accent}
          />
          <AppText
            variant="caption"
            tone="header"
            color={testState === 'failed' ? colors.missed : undefined}
            style={{ flex: 1 }}
          >
            {testState === 'sent'
              ? t('settings.reminders.test.sent')
              : testState === 'failed'
                ? t('settings.reminders.test.failed')
                : t('settings.reminders.test.sending')}
          </AppText>
        </View>
      )}
    </>
  );

  return (
    <PaperBackground>
      <ScrollView
        testID="reminders-settings-scroll"
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
            testID="reminders-back"
            accessibilityRole="button"
            accessibilityLabel={t('settings.reminders.back')}
            onPress={goBack}
            scale={0.9}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={backChevron()} size={24} color={colors.header} />
          </PressableScale>
          <AppText variant="rowName" weight={600} accessibilityRole="header" style={{ flex: 1 }}>
            {t('settings.reminders.title')}
          </AppText>
        </View>

        <SectionDivider />

        <AppText variant="caption" tone="header">
          {t('settings.reminders.intro')}
        </AppText>

        {/* ---- Permission ------------------------------------------------------------------ */}
        {granted ? null : (
          <Card
            testID="reminders-permission"
            variant="bright"
            border="mid"
            style={{ gap: spacing.md, padding: spacing.lg }}
          >
            <View accessible accessibilityRole="text" style={{ gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Icon
                  name={blocked ? 'settings' : 'notifications_off'}
                  size={20}
                  color={colors.accent}
                />
                <AppText variant="rowName" style={{ flex: 1 }}>
                  {t('settings.reminders.permission.title')}
                </AppText>
              </View>
              <AppText variant="caption" tone="header">
                {blocked
                  ? t('settings.reminders.permission.blockedBody')
                  : t('settings.reminders.permission.body')}
              </AppText>
            </View>

            <ActionButton
              testID="reminders-permission-action"
              icon={blocked ? 'open_in_new' : 'notifications'}
              label={
                asking
                  ? t('settings.reminders.permission.asking')
                  : blocked
                    ? t('settings.reminders.permission.openSettings')
                    : t('settings.reminders.permission.allow')
              }
              disabled={asking}
              onPress={blocked ? openSystemSettings : requestPermission}
              accessibilityHint={
                blocked
                  ? t('settings.reminders.permission.a11yHintSettings')
                  : t('settings.reminders.permission.a11yHint')
              }
              prominent
            />

            <AppText variant="hint">{t('settings.reminders.permission.footnote')}</AppText>
          </Card>
        )}

        {/* ---- Bulk actions + the proof ---------------------------------------------------- */}
        <SettingGroup
          testID="reminders-group-all"
          title={t('settings.reminders.all.title')}
          footer={t('settings.reminders.all.footer')}
        >
          <BulkRow
            testID="reminders-bulk-adhan"
            label={t('settings.reminders.all.adhan.label')}
            description={t('settings.reminders.all.adhan.description')}
            count={adhanOnCount}
            onEnable={() => setAllReminders({ adhanEnabled: true })}
            onDisable={() => setAllReminders({ adhanEnabled: false })}
          />
          <BulkRow
            testID="reminders-bulk-nudge"
            label={t('settings.reminders.all.nudge.label')}
            description={t('settings.reminders.all.nudge.description')}
            count={nudgeOnCount}
            onEnable={() => setAllReminders({ nudgeEnabled: true })}
            onDisable={() => setAllReminders({ nudgeEnabled: false })}
          />
          {/* How late a last call is. One answer for all five prayers, and only worth asking
              once at least one of them is on — a timing control for notifications nobody
              receives is a question with no consequence. */}
          {nudgeOnCount > 0 ? (
            <SettingChoiceRow
              testID="reminders-nudge-lead"
              label={t('settings.reminders.nudgeTiming.label')}
              description={t('settings.reminders.nudgeTiming.description')}
              options={leadOptions}
              value={String(nudgeLeadMinutes)}
              onChange={(value) => setNudgeLeadMinutes(Number(value))}
            />
          ) : null}
        </SettingGroup>

        {/* ---- The adhan (D94) --------------------------------------------------------------- */}
        {/* Everything about the sound lives here, apart from the toggles above, because "adhan"
            means exactly one thing in this app: the recording. A reminder is named by its time
            ("when the time comes in"), never by the sound it happens to play — the two used to
            share the word, and "turn all adhan reminders on" read as "set every sound to the
            adhan" (owner, 2026-08-24). */}
        <SettingGroup
          testID="reminders-group-adhan"
          title={t('settings.reminders.adhanSection.title')}
          footer={t('settings.reminders.adhanSection.footer')}
        >
          {/* Which adhan. Hearing one is a different question from proving reminders arrive, and
              this row and the one below it sit together precisely so the wording can keep them
              apart: this one plays media the user asked for, the one below sends a real
              notification.

              A disclosure rather than four rows always on screen — the resting state is one line
              saying which recitation is in use, which is the only thing most people ever want to
              know from it (CLAUDE.md: nobody should meet the options uninvited). It is shown even
              when no prayer is set to the adhan, unlike the last-call timing above: this row is
              also how somebody finds out what the adhan sounds like, and hiding it until after
              they have chosen it would put the answer behind the question. */}
          <SettingRow
            testID="reminders-adhan-voice"
            icon="volume_up"
            label={t('settings.reminders.voice.label')}
            description={t('settings.reminders.voice.description')}
            value={t(`settings.reminders.voice.${adhanVoice}`)}
            expanded={voiceOpen}
            onPress={() => {
              // Folding the list away takes the stop control with it, so it takes the sound too.
              if (voiceOpen) stopPreview();
              setVoiceOpen((open) => !open);
            }}
          />
          {voiceOpen ? (
            <View
              testID="reminders-adhan-voice-options"
              accessibilityRole="radiogroup"
              style={{ gap: spacing.xs, padding: spacing.md }}
            >
              {ADHAN_VOICES.map((voice) => (
                <OptionCard
                  key={voice}
                  testID={`reminders-adhan-voice-${voice}`}
                  label={t(`settings.reminders.voice.${voice}`)}
                  selected={voice === adhanVoice}
                  onPress={() => chooseVoice(voice)}
                  accessibilityHint={t('settings.reminders.voice.a11yHint')}
                />
              ))}
              {preview.playing === null ? null : (
                <View
                  testID="reminders-adhan-preview-status"
                  accessibilityLiveRegion="polite"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    // Aligned with the cards' inner content, not their outer edge, so the line
                    // reads as belonging under them rather than floating beside them.
                    paddingHorizontal: spacing.md,
                  }}
                >
                  <Icon name="volume_up" size={15} color={colors.accent} />
                  <AppText variant="caption" tone="header" style={{ flex: 1 }}>
                    {t('settings.reminders.voice.playing', {
                      voice: t(`settings.reminders.voice.${preview.playing}`),
                    })}
                  </AppText>
                </View>
              )}
              {/* iOS only, and stated plainly: an iPhone rings for about half a minute and fades,
                  because Apple caps how long a notification sound may be. It is a fact about the
                  platform, not a shortcoming of the recording, so it is neither an apology nor a
                  warning — and an Android user, who hears the whole adhan, never sees it. */}
              {Platform.OS === 'ios' ? (
                <AppText
                  testID="reminders-adhan-voice-ios-note"
                  variant="hint"
                  style={{ paddingHorizontal: spacing.md }}
                >
                  {t('settings.reminders.voice.iosNote')}
                </AppText>
              ) : null}
            </View>
          ) : null}
          <SettingRow
            testID="reminders-test"
            icon="notifications_active"
            label={t('settings.reminders.test.label')}
            description={t('settings.reminders.test.description')}
            value={soundLabel(testSound)}
            chevron={false}
            accessibilityHint={t('settings.reminders.test.a11yHint')}
            onPress={sendTest}
          >
            {testTarget === 'sound' ? testFeedback : null}
          </SettingRow>
          {/* The adhan as a real notification, whatever the prayers are set to. The in-app preview
              above answers "which recitation do I like"; this answers "what will it actually be
              like when it goes off" — a different question, asked of the OS rather than the app. */}
          {/* Pause what's playing (D96). Android only, and only where the binary can actually do
              it — a switch that switched nothing would be worse than no switch. iOS shows nothing
              at all: a dead app cannot touch another app's audio there, and describing a feature
              that cannot exist would be noise. */}
          {Platform.OS === 'android' && audioPauseSupported() ? (
            <SettingSwitchRow
              testID="reminders-pause-audio-switch"
              icon={pauseAudioEnabled ? 'volume_off' : 'volume_up'}
              label={t('settings.reminders.pauseAudio.label')}
              description={t('settings.reminders.pauseAudio.description')}
              value={pauseAudioEnabled}
              onValueChange={setPauseAudioEnabled}
              onLabel={t('settings.on')}
              offLabel={t('settings.off')}
              accessibilityHint={t('settings.reminders.pauseAudio.a11yHint')}
            />
          ) : null}
          {/* No value column: the recitation it plays is the one the selector above just named,
              and repeating the name here would put "Makkah" on screen twice. */}
          <SettingRow
            testID="reminders-test-adhan"
            icon="mosque"
            label={t('settings.reminders.test.adhanLabel')}
            description={t('settings.reminders.test.adhanDescription')}
            chevron={false}
            accessibilityHint={t('settings.reminders.test.a11yHint')}
            onPress={sendAdhanTest}
          >
            {testTarget === 'adhan' ? testFeedback : null}
          </SettingRow>
        </SettingGroup>

        {/* ---- The note at sunrise (PRODUCT_SPEC §11.2; D90) -------------------------------- */}
        {/* Its own group rather than a row inside Fajr's card, for two reasons. It is one global
            flag, not a `PrayerReminderSettings` field, so the prayer cards have no way to write
            it; and a setting that ships OFF has to be visible to somebody who has never opened a
            prayer card, or nobody ever finds it. It sits here, right under the last-call timing,
            because the last call is the notification it is most often confused with — and the
            footer says which is which. */}
        <SettingGroup
          testID="reminders-sunrise-note-group"
          title={t('settings.reminders.sunriseNote.title')}
          footer={t('settings.reminders.sunriseNote.footer')}
        >
          <SettingSwitchRow
            testID="reminders-sunrise-note-switch"
            icon={sunriseNoteEnabled ? 'sunny' : 'notifications_off'}
            label={t('settings.reminders.sunriseNote.label')}
            description={t('settings.reminders.sunriseNote.description')}
            value={sunriseNoteEnabled}
            onValueChange={setSunriseNoteEnabled}
            onLabel={t('settings.on')}
            offLabel={t('settings.off')}
            accessibilityHint={t('settings.reminders.sunriseNote.a11yHint')}
          />
        </SettingGroup>

        {/* ---- One card per prayer, closed until asked for ---------------------------------- */}
        <View style={{ gap: spacing.sm }}>
          <SectionDivider placement="top" style={{ marginBottom: spacing.xs }} />
          <AppText
            variant="headerMeta"
            weight={600}
            tone="header"
            accessibilityRole="header"
            style={{ paddingHorizontal: spacing.xs }}
          >
            {t('settings.reminders.perPrayerTitle')}
          </AppText>
          <AppText variant="hint" style={{ paddingHorizontal: spacing.xs }}>
            {t('settings.reminders.perPrayerHint')}
          </AppText>
        </View>

        {PRAYERS.map((prayer) => (
          <PrayerReminderCard
            key={prayer}
            prayer={prayer}
            reminder={reminders[prayer]}
            expanded={openPrayers.includes(prayer)}
            onToggle={() => togglePrayer(prayer)}
            soundLabel={soundLabel}
            minutesLabel={minutesLabel}
            onChange={(patch) => setReminder(prayer, patch)}
          />
        ))}

        {/* ---- Android's always-on notification (PRODUCT_SPEC §11, §12; D27) ---------------- */}
        {Platform.OS === 'android' ? (
          <SettingGroup
            testID="reminders-ongoing-group"
            title={t('settings.reminders.ongoing.title')}
            footer={t('settings.reminders.ongoing.footer')}
          >
            <SettingSwitchRow
              testID="reminders-ongoing-switch"
              icon={persistentEnabled ? 'notifications_active' : 'notifications_off'}
              label={t('settings.reminders.ongoing.label')}
              description={t('settings.reminders.ongoing.description')}
              value={persistentEnabled}
              onValueChange={setPersistentNotification}
              onLabel={t('settings.on')}
              offLabel={t('settings.off')}
              accessibilityHint={t('settings.reminders.ongoing.a11yHint')}
            />
          </SettingGroup>
        ) : null}

        {/* ---- iOS's prayer-window Live Activity (D27's counterpart surface) ----------------
            Renders only on a build whose binary carries the widget extension AND an OS that can
            show Activities — an option the phone cannot honor is never offered. */}
        {Platform.OS === 'ios' && liveActivitiesSupported() ? (
          <SettingGroup
            testID="reminders-live-activity-group"
            title={t('settings.reminders.liveActivity.title')}
            footer={t('settings.reminders.liveActivity.footer')}
          >
            <SettingSwitchRow
              testID="reminders-live-activity-switch"
              icon={liveActivityEnabled ? 'notifications_active' : 'notifications_off'}
              label={t('settings.reminders.liveActivity.label')}
              description={t('settings.reminders.liveActivity.description')}
              value={liveActivityEnabled}
              onValueChange={setLiveActivityEnabled}
              onLabel={t('settings.on')}
              offLabel={t('settings.off')}
              accessibilityHint={t('settings.reminders.liveActivity.a11yHint')}
            />
            {/* The two distances (D112), only asked once the card exists at all — the same
                no-consequence rule as the nudge's timing row. */}
            {liveActivityEnabled ? (
              <>
                <SettingChoiceRow
                  testID="reminders-live-activity-lead"
                  label={t('settings.reminders.liveActivity.lead.label')}
                  description={t('settings.reminders.liveActivity.lead.description')}
                  options={liveActivityOptions(
                    liveActivityLeadMinutes,
                    'settings.reminders.liveActivity.lead.a11yOption'
                  )}
                  value={String(liveActivityLeadMinutes)}
                  onChange={(value) => setLiveActivityLeadMinutes(Number(value))}
                />
                <SettingChoiceRow
                  testID="reminders-live-activity-linger"
                  label={t('settings.reminders.liveActivity.linger.label')}
                  description={t('settings.reminders.liveActivity.linger.description')}
                  options={liveActivityOptions(
                    liveActivityLingerMinutes,
                    'settings.reminders.liveActivity.linger.a11yOption'
                  )}
                  value={String(liveActivityLingerMinutes)}
                  onChange={(value) => setLiveActivityLingerMinutes(Number(value))}
                />
              </>
            ) : null}
          </SettingGroup>
        ) : null}

        <AppText variant="hint" style={{ textAlign: 'center' }}>
          {t('settings.reminders.footerHint')}
        </AppText>
      </ScrollView>
    </PaperBackground>
  );
}

/* -------------------------------------------------------------------------------------------- */

/**
 * One prayer, as a card that opens.
 *
 * Closed it is the prayer's name and what it is currently set to; open it is the same three
 * switches this screen has always had. The two dependent rows — the sound and the lead time —
 * are still mounted only while their parent switch is on: a disabled control that cannot be
 * reached from where the user is looking is noise rather than information.
 */
function PrayerReminderCard({
  prayer,
  reminder,
  expanded,
  onToggle,
  soundLabel,
  minutesLabel,
  onChange,
}: {
  prayer: Prayer;
  reminder: PrayerReminderSettings;
  expanded: boolean;
  onToggle: () => void;
  soundLabel: (sound: ReminderSound) => string;
  minutesLabel: (minutes: number) => string;
  onChange: (patch: Partial<PrayerReminderSettings>) => void;
}) {
  const { t } = useTranslation();
  const name = t(`prayers.${prayer}`);

  const chips = reminderSummaryChips(reminder, {
    adhan: (sound) => t('settings.reminders.summary.adhan', { sound: soundLabel(sound) }),
    pre: (minutes) => t('settings.reminders.summary.pre', { value: minutesLabel(minutes) }),
    nudge: t('settings.reminders.summary.nudge'),
    none: t('settings.reminders.summary.none'),
  });

  /** `"Fajr · At the adhan"` — the group title is not part of a row's spoken label. */
  const rowLabel = (setting: string): string =>
    t('settings.reminders.a11yRow', { prayer: name, setting });

  const soundOptions: SettingChoiceOption<ReminderSound>[] = SOUNDS.map((sound) => ({
    value: sound,
    label: soundLabel(sound),
    accessibilityLabel: t('settings.reminders.a11yOption', {
      option: soundLabel(sound),
      prayer: name,
    }),
    description:
      sound === 'adhan'
        ? // What the clip *is*, and nothing about the 30-second iOS cap that shaped it. The cap
          // is real and it is ours to respect (see `services/notifications`); quoting it here
          // only made a deliberate edit read as a defect (owner: "users don't care for any of
          // this and confuses them").
          t('notifications.soundNote')
        : sound === 'system'
          ? t('settings.reminders.sound.systemBody')
          : t('settings.reminders.sound.silentBody'),
  }));

  // The stored value always has a chip, even if it came from an older build or a hand-edited
  // payload: a radio group with nothing selected is a broken control.
  const minutes = [...new Set([...PRE_REMINDER_CHOICES, reminder.preReminderMinutes])]
    .filter((value) => value >= MIN_PRE_REMINDER_MINUTES && value <= MAX_PRE_REMINDER_MINUTES)
    .sort((a, b) => a - b);

  const minuteOptions: SettingChoiceOption<string>[] = minutes.map((value) => ({
    value: String(value),
    label: minutesLabel(value),
    accessibilityLabel: t('settings.reminders.pre.a11yOption', {
      value: minutesLabel(value),
      prayer: name,
    }),
  }));

  return (
    <SettingGroup
      testID={`reminders-group-${prayer}`}
      divider={false}
      footer={
        expanded && prayer === 'isha' && reminder.nudgeEnabled
          ? t('settings.reminders.nudge.ishaFooter')
          : undefined
      }
    >
      <PrayerCardHeader
        prayer={prayer}
        name={name}
        chips={chips}
        expanded={expanded}
        onToggle={onToggle}
      />

      {!expanded ? null : (
        <SettingSwitchRow
          testID={`reminders-${prayer}-adhan`}
          icon={adhanIcon(reminder.adhanEnabled)}
          label={t('settings.reminders.adhan.label')}
          description={t('settings.reminders.adhan.description', { prayer: name })}
          value={reminder.adhanEnabled}
          onValueChange={(adhanEnabled) => onChange({ adhanEnabled })}
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          accessibilityLabel={rowLabel(t('settings.reminders.adhan.label'))}
        />
      )}

      {expanded && reminder.adhanEnabled ? (
        <SettingChoiceRow
          testID={`reminders-${prayer}-sound`}
          label={t('settings.reminders.sound.label')}
          options={soundOptions}
          value={reminder.sound}
          onChange={(sound) => onChange({ sound })}
        />
      ) : null}

      {!expanded ? null : (
        <SettingSwitchRow
          testID={`reminders-${prayer}-pre`}
          label={t('settings.reminders.pre.label')}
          description={
            prayer === 'fajr'
              ? t('settings.reminders.pre.fajrDescription')
              : t('settings.reminders.pre.description')
          }
          value={reminder.preReminderEnabled}
          onValueChange={(preReminderEnabled) => onChange({ preReminderEnabled })}
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          accessibilityLabel={rowLabel(t('settings.reminders.pre.label'))}
        />
      )}

      {expanded && reminder.preReminderEnabled ? (
        <SettingChoiceRow
          testID={`reminders-${prayer}-minutes`}
          label={t('settings.reminders.pre.minutesLabel')}
          options={minuteOptions}
          value={String(reminder.preReminderMinutes)}
          onChange={(value) => onChange({ preReminderMinutes: Number(value) })}
        />
      ) : null}

      {!expanded ? null : (
        <SettingSwitchRow
          testID={`reminders-${prayer}-nudge`}
          label={t('settings.reminders.nudge.label')}
          description={
            // Fajr's last call is the one whose deadline is sunrise rather than the next prayer,
            // so its description names sunrise. It no longer carries the note at sunrise itself —
            // that has its own switch further up the screen (D90).
            prayer === 'fajr'
              ? t('settings.reminders.nudge.fajrDescription')
              : t('settings.reminders.nudge.description', { prayer: name })
          }
          value={reminder.nudgeEnabled}
          onValueChange={(nudgeEnabled) => onChange({ nudgeEnabled })}
          onLabel={t('settings.on')}
          offLabel={t('settings.off')}
          accessibilityLabel={rowLabel(t('settings.reminders.nudge.label'))}
        />
      )}
    </SettingGroup>
  );
}

/**
 * The card's closed face: the prayer's name at the size of a heading, what it is set to, and the
 * caret that says the rest is one tap away.
 *
 * It is one button rather than a row with a control on it — the whole face opens the card, and a
 * screen reader gets the name, the summary and `expanded` from a single node, in that order.
 */
function PrayerCardHeader({
  prayer,
  name,
  chips,
  expanded,
  onToggle,
}: {
  prayer: Prayer;
  name: string;
  chips: readonly ReminderSummaryChip[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={`reminders-${prayer}-card`}
      scale={1}
      pressedOpacity={0.75}
      minTouchTarget={0}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={t('settings.reminders.card.a11yLabel', {
        prayer: name,
        summary: chips.map((chip) => chip.label).join(' · '),
      })}
      accessibilityHint={t(
        expanded
          ? 'settings.reminders.card.a11yHintCollapse'
          : 'settings.reminders.card.a11yHintExpand'
      )}
      onPress={onToggle}
      style={{
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <AppText variant="hero" weight={600} numberOfLines={1} style={{ flex: 1 }}>
          {name}
        </AppText>
        {/* A caret, not a chevron: this opens in place, and the glyph must not promise a push.
            It points along the vertical, so it does not mirror in RTL. */}
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={22} color={colors.faint} />
      </View>

      {expanded ? null : (
        <View
          testID={`reminders-${prayer}-summary`}
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}
        >
          {chips.map((chip) => (
            <View
              key={chip.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingVertical: 4,
                paddingHorizontal: spacing.sm + 2,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colors.borderFaint,
                backgroundColor: colors.cardQuiet,
              }}
            >
              <Icon name={chip.icon} size={14} color={colors.accent} />
              <AppText variant="caption" tone="header" italic={false}>
                {chip.label}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </PressableScale>
  );
}

/**
 * A row that sets one field on all five prayers at once, with the count of prayers currently on.
 *
 * Two buttons rather than one switch: a switch has to invent an answer for the mixed state
 * ("three of five are on" is neither checked nor unchecked), and inventing one means half the
 * users get the opposite of what they tapped for.
 */
function BulkRow({
  testID,
  label,
  description,
  count,
  onEnable,
  onDisable,
}: {
  testID: string;
  label: string;
  description: string;
  count: number;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const { t } = useTranslation();

  const actionLabel = (action: string): string =>
    t('settings.reminders.all.a11yAction', { action, what: label });

  return (
    <SettingRow
      testID={testID}
      label={label}
      description={description}
      value={t('settings.reminders.all.count', { on: count, total: PRAYERS.length })}
      chevron={false}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <ActionButton
          testID={`${testID}-on`}
          icon="notifications_active"
          label={t('settings.reminders.all.on')}
          disabled={count === PRAYERS.length}
          onPress={onEnable}
          accessibilityLabel={actionLabel(t('settings.reminders.all.on'))}
        />
        <ActionButton
          testID={`${testID}-off`}
          icon="notifications_off"
          label={t('settings.reminders.all.off')}
          disabled={count === 0}
          onPress={onDisable}
          accessibilityLabel={actionLabel(t('settings.reminders.all.off'))}
        />
      </View>
    </SettingRow>
  );
}

/**
 * The quiet pill this screen uses for its actions — the same shape as the Prayer-times screen's
 * "reset offsets", so Settings keeps one button vocabulary.
 *
 * `prominent` fills it instead of outlining it, for the one button on a card that is the whole
 * point of that card (the permission request).
 */
function ActionButton({
  testID,
  icon,
  label,
  onPress,
  disabled = false,
  prominent = false,
  accessibilityLabel,
  accessibilityHint,
}: {
  testID: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  prominent?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();

  return (
    <PressableScale
      testID={testID}
      disabled={disabled}
      haptics
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
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
        borderColor: prominent ? colors.accent : colors.borderMid,
        backgroundColor: prominent ? colors.accent : colors.card,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={16} color={prominent ? colors.sealFg : colors.accent} />
      <AppText
        variant="time"
        weight={600}
        tabularNums={false}
        color={prominent ? colors.sealFg : colors.accent}
      >
        {label}
      </AppText>
    </PressableScale>
  );
}
